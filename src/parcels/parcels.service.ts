import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  DeliveryMode,
  ParcelStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NavexService } from '../navex/navex.service';
import { DeliveryRoutesService } from '../delivery-routes/delivery-routes.service';
import {
  AssignDriverDto,
  CreateParcelDto,
  ScanParcelDto,
  SwitchParcelModeDto,
  UpdateParcelDto,
  UpdateParcelStatusDto,
} from './dto/parcel.dto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  PARCEL_DETAIL_INCLUDE,
  PARCEL_LIST_INCLUDE,
  PARCEL_STATUS_LABEL,
  toParcelDetailView,
  toParcelListView,
} from './parcel-view';
import {
  RETURN_STATUSES,
  canTransition,
  requiresComment,
} from './parcel-transitions';
import {
  OPS_STAFF,
  isAgencyRole,
  isGlobalStaff,
} from '../common/agency-roles';

const STAFF_ROLES: Role[] = OPS_STAFF;
const SENDER_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.CHEF_AGENCE,
  Role.EXPEDITEUR,
];
const STATUS_ROLES: Role[] = [
  ...OPS_STAFF,
  Role.LIVREUR,
  Role.PICKUP,
  Role.MAGASINIER,
  Role.SUPPORT,
];
const SENDER_EDITABLE: ParcelStatus[] = [
  ParcelStatus.EN_ATTENTE,
  ParcelStatus.NON_SERIEUX,
];
const NOT_DELETED = {
  status: { not: ParcelStatus.SUPPRIME },
} satisfies Prisma.ParcelWhereInput;

type EventInput = {
  parcelId: number;
  label: string;
  status?: ParcelStatus | null;
  comment?: string | null;
  actorId?: number | null;
};

@Injectable()
export class ParcelsService {
  private readonly logger = new Logger(ParcelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly navex: NavexService,
    private readonly deliveryRoutes: DeliveryRoutesService,
  ) {}

  private editableData(dto: UpdateParcelDto) {
    return {
      recipientName: dto.recipientName,
      phone: dto.phone,
      phone2: dto.phone2,
      governorate: dto.governorate,
      city: dto.city,
      locality: dto.locality,
      address: dto.address,
      price: dto.price,
      articleCount: dto.articleCount,
      parcelCount: dto.parcelCount,
      designation: dto.designation,
      notes: dto.notes,
      paymentMode: dto.paymentMode,
      allowOpen: dto.allowOpen,
      tryProduct: dto.tryProduct,
      isExchange: dto.isExchange,
      exchangeNotes: dto.exchangeNotes,
      zoneId: dto.zoneId,
      lat: dto.lat,
      lng: dto.lng,
      deliveryWindow: dto.deliveryWindow,
      landmarkPhotoName: dto.landmarkPhotoName,
      addressQuality: dto.addressQuality,
      liabilityAcceptedAt:
        dto.liabilityAcceptedAt !== undefined
          ? new Date(dto.liabilityAcceptedAt)
          : undefined,
    };
  }

  private generateCode(prefix: 'UMB' | 'UMB-EXT') {
    const stamp = Date.now().toString(36).toUpperCase();
    const salt = Math.floor(Math.random() * 1296)
      .toString(36)
      .toUpperCase()
      .padStart(2, '0');
    return `${prefix}-${stamp}${salt}`;
  }

  private async resolveAgencyId(
    governorate: string,
  ): Promise<number | null> {
    const agency = await this.prisma.agency.findFirst({
      where: {
        isActive: true,
        governorate: { equals: governorate.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    });
    return agency?.id ?? null;
  }

  private recordEvent(tx: Prisma.TransactionClient, event: EventInput) {
    return tx.parcelEvent.create({
      data: {
        parcelId: event.parcelId,
        label: event.label,
        status: event.status ?? null,
        comment: event.comment ?? null,
        actorId: event.actorId ?? null,
      },
    });
  }

  private async pushToNavex(dto: CreateParcelDto) {
    const external = await this.navex.createParcel({
      nom: dto.recipientName,
      tel: dto.phone,
      ...(dto.phone2 ? { tel2: dto.phone2 } : {}),
      gouvernerat: dto.governorate,
      ville: dto.city,
      adresse: dto.address,
      prix: dto.price,
      nb_article: dto.articleCount ?? 1,
      msg: dto.notes ?? '',
      designation: dto.designation ?? '',
      ouvrir: dto.allowOpen ? 'Oui' : 'Non',
      echange: dto.isExchange ? '1' : '0',
      ...(dto.isExchange && dto.exchangeNotes
        ? { article: dto.exchangeNotes }
        : {}),
    });
    return {
      code: external.status_message
        ? String(external.status_message)
        : this.generateCode('UMB-EXT'),
      bordereauUrl: external.lien ? String(external.lien) : null,
      navexRaw: external as Prisma.InputJsonValue,
    };
  }

  async create(user: AuthUser, dto: CreateParcelDto) {
    if (!SENDER_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'Only staff or expéditeur can create parcels',
      );
    }

    if (dto.zoneId) {
      const zone = await this.prisma.zone.findUnique({
        where: { id: dto.zoneId },
      });
      if (!zone || !zone.isActive)
        throw new BadRequestException('Invalid zone');
    }

    const mode =
      dto.mode ?? (await this.deliveryRoutes.resolveMode(dto.governorate));

    const remote =
      mode === DeliveryMode.EXTERNAL && this.navex.isEnabled()
        ? await this.pushToNavex(dto)
        : null;

    const code =
      remote?.code ??
      this.generateCode(mode === DeliveryMode.EXTERNAL ? 'UMB-EXT' : 'UMB');

    const agencyId = await this.resolveAgencyId(dto.governorate);

    const created = await this.prisma.$transaction(async (tx) => {
      const parcel = await tx.parcel.create({
        data: {
          ...this.editableData(dto),
          recipientName: dto.recipientName,
          phone: dto.phone,
          governorate: dto.governorate,
          city: dto.city,
          address: dto.address,
          price: dto.price,
          articleCount: dto.articleCount ?? 1,
          parcelCount: dto.parcelCount ?? 1,
          tryProduct: dto.tryProduct ?? dto.allowOpen ?? false,
          mode,
          status: ParcelStatus.EN_ATTENTE,
          code,
          bordereauUrl: remote?.bordereauUrl ?? null,
          navexRaw: remote?.navexRaw,
          senderId: user.id,
          agencyId,
        },
      });
      await this.recordEvent(tx, {
        parcelId: parcel.id,
        label: 'Colis créé',
        status: ParcelStatus.EN_ATTENTE,
        actorId: user.id,
        comment:
          mode === DeliveryMode.EXTERNAL
            ? 'Mode EXTERNAL (Navex)'
            : 'Mode INTERNAL (Umbrella)',
      });
      return parcel;
    });

    return this.findOneForUser(user, created.id);
  }

  async switchMode(user: AuthUser, id: number, dto: SwitchParcelModeDto) {
    if (
      !(
        [
          Role.SUPER_ADMIN,
          Role.ADMIN,
          Role.CHEF_AGENCE,
          Role.EXPEDITEUR,
        ] as Role[]
      ).includes(user.role)
    ) {
      throw new ForbiddenException('Cannot change delivery mode');
    }

    const parcel = await this.getOwnedOrStaff(user, id);
    if (parcel.status === ParcelStatus.SUPPRIME) {
      throw new BadRequestException('Parcel already deleted');
    }
    if (parcel.mode === dto.mode) {
      return this.findOneForUser(user, id);
    }
    if (
      user.role === Role.EXPEDITEUR &&
      !SENDER_EDITABLE.includes(parcel.status)
    ) {
      throw new ForbiddenException(
        'Expéditeur: mode change only while parcel is pending',
      );
    }

    if (dto.mode === DeliveryMode.EXTERNAL) {
      let remote: {
        code: string;
        bordereauUrl: string | null;
        navexRaw: Prisma.InputJsonValue;
      } | null = null;
      if (this.navex.isEnabled()) {
        remote = await this.pushToNavex({
          recipientName: parcel.recipientName,
          phone: parcel.phone,
          phone2: parcel.phone2 ?? undefined,
          governorate: parcel.governorate,
          city: parcel.city,
          address: parcel.address,
          price: Number(parcel.price),
          articleCount: parcel.articleCount,
          notes: parcel.notes ?? undefined,
          designation: parcel.designation ?? undefined,
          allowOpen: parcel.allowOpen,
          isExchange: parcel.isExchange,
          exchangeNotes: parcel.exchangeNotes ?? undefined,
        });
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.parcel.update({
          where: { id },
          data: {
            mode: DeliveryMode.EXTERNAL,
            driverId: null,
            code: remote?.code ?? parcel.code ?? this.generateCode('UMB-EXT'),
            bordereauUrl: remote?.bordereauUrl ?? parcel.bordereauUrl,
            ...(remote?.navexRaw ? { navexRaw: remote.navexRaw } : {}),
          },
        });
        await this.recordEvent(tx, {
          parcelId: id,
          label: 'Basculé vers Navex (EXTERNAL)',
          actorId: user.id,
          comment: remote?.code
            ? `Code Navex ${remote.code}`
            : 'Navex désactivé — code local EXTERNAL',
        });
      });
    } else {
      if (
        parcel.mode === DeliveryMode.EXTERNAL &&
        parcel.code &&
        this.navex.isEnabled()
      ) {
        try {
          await this.navex.deleteParcel(parcel.code);
        } catch (error) {
          this.logger.warn(
            `Navex delete on mode switch failed for ${parcel.code}: ${String(error)}`,
          );
        }
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.parcel.update({
          where: { id },
          data: {
            mode: DeliveryMode.INTERNAL,
            bordereauUrl: null,
          },
        });
        await this.recordEvent(tx, {
          parcelId: id,
          label: 'Basculé vers Umbrella (INTERNAL)',
          actorId: user.id,
        });
      });
    }

    return this.findOneForUser(user, id);
  }

  async update(user: AuthUser, id: number, dto: UpdateParcelDto) {
    const parcel = await this.getOwnedOrStaff(user, id);
    if (parcel.status === ParcelStatus.SUPPRIME) {
      throw new BadRequestException('Parcel already deleted');
    }
    if (
      user.role === Role.EXPEDITEUR &&
      !SENDER_EDITABLE.includes(parcel.status)
    ) {
      throw new ForbiddenException('Only pending parcels can be edited');
    }

    const nextGov = dto.governorate ?? parcel.governorate;
    const agencyId =
      dto.governorate !== undefined
        ? await this.resolveAgencyId(nextGov)
        : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.parcel.update({
        where: { id },
        data: {
          ...this.editableData(dto),
          ...(agencyId !== undefined ? { agencyId } : {}),
        },
      });
      await this.recordEvent(tx, {
        parcelId: id,
        label: 'Colis modifié',
        actorId: user.id,
      });
    });
    return this.findOneForUser(user, id);
  }

  async softDelete(user: AuthUser, id: number) {
    const parcel = await this.getOwnedOrStaff(user, id);
    if (
      parcel.mode === DeliveryMode.EXTERNAL &&
      parcel.code &&
      this.navex.isEnabled()
    ) {
      try {
        await this.navex.deleteParcel(parcel.code);
      } catch (error) {
        this.logger.warn(
          `Navex delete failed for ${parcel.code}: ${String(error)}`,
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.parcel.update({
        where: { id },
        data: { status: ParcelStatus.SUPPRIME },
      });
      await this.recordEvent(tx, {
        parcelId: id,
        label: 'Colis supprimé',
        status: ParcelStatus.SUPPRIME,
        actorId: user.id,
      });
    });
    return { id, deleted: true };
  }

  private normalizeCode(code: string): string {
    const normalized = code.trim().slice(0, 64);
    if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
      throw new BadRequestException('Invalid parcel code');
    }
    return normalized;
  }

  private async resolveParcelByCode(code: string) {
    const normalized = this.normalizeCode(code);
    const exact = await this.prisma.parcel.findFirst({
      where: { code: normalized, ...NOT_DELETED },
      include: PARCEL_DETAIL_INCLUDE,
    });
    if (exact) return exact;

    return this.prisma.parcel.findFirst({
      where: {
        ...NOT_DELETED,
        code: { equals: normalized, mode: 'insensitive' },
      },
      include: PARCEL_DETAIL_INCLUDE,
    });
  }

  async findByCodeForUser(user: AuthUser, code: string) {
    const scope = await this.scopeFor(user);
    if (!scope) throw new NotFoundException('Parcel not found');

    const parcel = await this.resolveParcelByCode(code);
    if (!parcel) throw new NotFoundException('Parcel not found');

    const scoped = await this.prisma.parcel.findFirst({
      where: { AND: [{ id: parcel.id }, scope] },
      include: PARCEL_DETAIL_INCLUDE,
    });
    if (!scoped) throw new NotFoundException('Parcel not found');
    return toParcelDetailView(scoped);
  }

  async scan(user: AuthUser, dto: ScanParcelDto) {
    if (!STATUS_ROLES.includes(user.role)) throw new ForbiddenException();

    const parcel = await this.resolveParcelByCode(dto.code);
    if (!parcel) throw new NotFoundException('Parcel not found');

    if (user.role === Role.LIVREUR && parcel.driverId !== user.id) {
      throw new ForbiddenException('Parcel not assigned to this livreur');
    }

    if (!dto.status) {
      await this.prisma.$transaction(async (tx) => {
        await this.recordEvent(tx, {
          parcelId: parcel.id,
          label: 'Scan bordereau',
          status: parcel.status,
          comment: parcel.code ? `Code ${parcel.code}` : null,
          actorId: user.id,
        });
      });
      return this.findOneForUser(user, parcel.id);
    }

    return this.updateStatus(user, parcel.id, {
      status: dto.status,
      comment: dto.comment,
      lat: dto.lat,
      lng: dto.lng,
      driverId: dto.driverId,
    });
  }

  async trackByCode(code: string) {
    const normalized = this.normalizeCode(code);

    const parcel = await this.prisma.parcel.findFirst({
      where: {
        ...NOT_DELETED,
        OR: [
          { code: normalized },
          { code: { equals: normalized, mode: 'insensitive' } },
        ],
      },
      select: {
        code: true,
        status: true,
        recipientName: true,
        city: true,
        governorate: true,
        createdAt: true,
        updatedAt: true,
        events: {
          orderBy: { createdAt: 'asc' },
          select: { label: true, createdAt: true },
        },
      },
    });
    if (!parcel) throw new NotFoundException('Parcel not found');

    const name = parcel.recipientName.trim();
    const masked =
      name.length <= 2
        ? `${name[0] ?? '*'}*`
        : `${name.slice(0, 1)}${'*'.repeat(Math.min(name.length - 1, 6))}`;

    const timeline = parcel.events.length
      ? parcel.events.map((e) => ({ at: e.createdAt, label: e.label }))
      : [{ at: parcel.createdAt, label: 'Colis créé' }];

    return {
      code: parcel.code,
      status: parcel.status,
      recipientName: masked,
      city: parcel.city,
      governorate: parcel.governorate,
      updatedAt: parcel.updatedAt,
      timeline,
    };
  }

  private async scopeFor(
    user: AuthUser,
  ): Promise<Prisma.ParcelWhereInput | null> {
    if (isGlobalStaff(user.role) || user.role === Role.FINANCE) {
      return NOT_DELETED;
    }

    if (isAgencyRole(user.role)) {
      const agencyId =
        user.agencyId ??
        (
          await this.prisma.user.findUnique({
            where: { id: user.id },
            select: { agencyId: true },
          })
        )?.agencyId;
      if (!agencyId) return null;
      const base: Prisma.ParcelWhereInput = {
        ...NOT_DELETED,
        agencyId,
      };
      if (user.role === Role.SUPPORT) {
        return { ...base, status: { in: RETURN_STATUSES } };
      }
      return base;
    }

    if (user.role === Role.LIVREUR)
      return { ...NOT_DELETED, driverId: user.id };
    if (user.role === Role.CLIENT) {
      const me = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { phone: true },
      });
      return me?.phone ? { ...NOT_DELETED, phone: me.phone } : null;
    }
    return { ...NOT_DELETED, senderId: user.id };
  }

  async list(user: AuthUser) {
    const where = await this.scopeFor(user);
    if (!where) return [];
    const rows = await this.prisma.parcel.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: PARCEL_LIST_INCLUDE,
    });
    return rows.map(toParcelListView);
  }

  async findOneForUser(user: AuthUser, id: number) {
    const scope = await this.scopeFor(user);
    if (!scope) throw new NotFoundException('Parcel not found');
    const parcel = await this.prisma.parcel.findFirst({
      where: { AND: [{ id }, scope] },
      include: PARCEL_DETAIL_INCLUDE,
    });
    if (!parcel) throw new NotFoundException('Parcel not found');
    const view = toParcelDetailView(parcel);
    const recipientUser = await this.prisma.user.findFirst({
      where: {
        role: Role.CLIENT,
        phone: parcel.phone,
        isActive: true,
        approvalStatus: ApprovalStatus.APPROVED,
      },
      select: { id: true, name: true, phone: true },
    });
    return {
      ...view,
      recipientUserId: recipientUser?.id ?? null,
      recipientUser: recipientUser
        ? {
            id: recipientUser.id,
            name: recipientUser.name,
            phone: recipientUser.phone,
          }
        : null,
    };
  }

  async assignDriver(user: AuthUser, id: number, dto: AssignDriverDto) {
    const canAssign =
      STAFF_ROLES.includes(user.role) ||
      user.role === Role.MAGASINIER ||
      user.role === Role.PICKUP;
    if (!canAssign) throw new ForbiddenException();
    const parcel = await this.prisma.parcel.findUnique({ where: { id } });
    if (!parcel || parcel.status === ParcelStatus.SUPPRIME) {
      throw new NotFoundException('Parcel not found');
    }
    if (
      isAgencyRole(user.role) &&
      user.agencyId &&
      parcel.agencyId !== user.agencyId
    ) {
      throw new ForbiddenException();
    }
    if (parcel.mode !== DeliveryMode.INTERNAL) {
      throw new BadRequestException('Only INTERNAL parcels can be assigned');
    }

    const driver = await this.prisma.user.findFirst({
      where: { id: dto.driverId, role: Role.LIVREUR, isActive: true },
    });
    if (!driver) throw new BadRequestException('Livreur not found');

    const fromDepot = (
      [
        ParcelStatus.AU_DEPOT,
        ParcelStatus.ARRIVE_DESTINATION,
        ParcelStatus.EXPEDIE_DESTINATION,
        ParcelStatus.RETOUR_DEPOT,
      ] as ParcelStatus[]
    ).includes(parcel.status);
    const nextStatus = fromDepot
      ? ParcelStatus.AFFECTE_LIVREUR
      : ParcelStatus.A_ENLEVER;
    if (fromDepot) {
      const gate = canTransition(parcel.status, nextStatus, user.role);
      if (!gate.ok) throw new BadRequestException(gate.reason);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.parcel.update({
        where: { id },
        data: { driverId: driver.id, status: nextStatus },
      });
      await this.recordEvent(tx, {
        parcelId: id,
        label: `Assigné à ${driver.name}`,
        status: nextStatus,
        actorId: user.id,
      });
    });
    return this.findOneForUser(user, id);
  }

  async updateStatus(user: AuthUser, id: number, dto: UpdateParcelStatusDto) {
    const parcel = await this.prisma.parcel.findUnique({ where: { id } });
    if (!parcel || parcel.status === ParcelStatus.SUPPRIME) {
      throw new NotFoundException('Parcel not found');
    }

    const agencyId =
      user.agencyId ??
      (
        await this.prisma.user.findUnique({
          where: { id: user.id },
          select: { agencyId: true },
        })
      )?.agencyId;

    const canUpdate =
      STATUS_ROLES.includes(user.role) &&
      (isGlobalStaff(user.role) ||
        (user.role === Role.LIVREUR && parcel.driverId === user.id) ||
        (isAgencyRole(user.role) &&
          !!agencyId &&
          parcel.agencyId === agencyId));
    if (!canUpdate) throw new ForbiddenException();

    const gate = canTransition(parcel.status, dto.status, user.role);
    if (!gate.ok) throw new BadRequestException(gate.reason);

    const comment = dto.comment?.trim() || null;
    if (requiresComment(dto.status, parcel.status) && !comment) {
      throw new BadRequestException(
        'Un motif / commentaire est obligatoire pour ce statut',
      );
    }

    let nextDriverId: number | undefined;
    if (dto.driverId != null) {
      const driver = await this.prisma.user.findFirst({
        where: { id: dto.driverId, role: Role.LIVREUR, isActive: true },
      });
      if (!driver) throw new BadRequestException('Livreur not found');
      nextDriverId = driver.id;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.parcel.update({
        where: { id },
        data: {
          status: dto.status,
          ...(nextDriverId != null ? { driverId: nextDriverId } : {}),
          lastLat: dto.lat,
          lastLng: dto.lng,
        },
      });
      await this.recordEvent(tx, {
        parcelId: id,
        label: PARCEL_STATUS_LABEL[dto.status],
        status: dto.status,
        comment,
        actorId: user.id,
      });
    });
    return this.findOneForUser(user, id);
  }

  async syncExternalStatuses(user: AuthUser) {
    if (!STAFF_ROLES.includes(user.role)) throw new ForbiddenException();
    const parcels = await this.prisma.parcel.findMany({
      where: {
        ...NOT_DELETED,
        mode: DeliveryMode.EXTERNAL,
        code: { not: null },
      },
    });

    if (!this.navex.isEnabled()) {
      return { checked: parcels.length, updated: 0, enabled: false };
    }

    let updated = 0;
    for (const parcel of parcels) {
      if (!parcel.code) continue;
      try {
        const remote = await this.navex.getStatus(parcel.code);
        if (!remote.etat) continue;
        const mapped = this.mapNavexStatus(String(remote.etat));
        if (mapped && mapped !== parcel.status) {
          await this.prisma.$transaction(async (tx) => {
            await tx.parcel.update({
              where: { id: parcel.id },
              data: { status: mapped },
            });
            await this.recordEvent(tx, {
              parcelId: parcel.id,
              label: PARCEL_STATUS_LABEL[mapped],
              status: mapped,
              comment: 'Synchronisé depuis Navex',
            });
          });
          updated += 1;
        }
      } catch (error) {
        this.logger.warn(
          `Navex status failed for ${parcel.code}: ${String(error)}`,
        );
      }
    }
    return { checked: parcels.length, updated, enabled: true };
  }

  private async getOwnedOrStaff(user: AuthUser, id: number) {
    const parcel = await this.prisma.parcel.findUnique({ where: { id } });
    if (!parcel) throw new NotFoundException('Parcel not found');
    if (isGlobalStaff(user.role)) return parcel;
    if (
      user.role === Role.CHEF_AGENCE &&
      user.agencyId &&
      parcel.agencyId === user.agencyId
    ) {
      return parcel;
    }
    if (user.role === Role.EXPEDITEUR && parcel.senderId === user.id)
      return parcel;
    throw new ForbiddenException();
  }

  private mapNavexStatus(raw: string): ParcelStatus | null {
    const value = raw.toLowerCase();
    if (value.includes('attente')) return ParcelStatus.EN_ATTENTE;
    if (value.includes('cours')) return ParcelStatus.EN_COURS;
    if (value.includes('livr') && value.includes('pay'))
      return ParcelStatus.LIVRES_PAYES;
    if (value.includes('livr')) return ParcelStatus.LIVRES;
    if (value.includes('enlev')) return ParcelStatus.ENLEVES;
    if (value.includes('depot') || value.includes('dépôt'))
      return ParcelStatus.AU_DEPOT;
    if (value.includes('verif')) return ParcelStatus.A_VERIFIER;
    if (value.includes('echange') || value.includes('échange'))
      return ParcelStatus.ECHANGES;
    if (value.includes('retour') && value.includes('definit'))
      return ParcelStatus.RETOUR_DEFINITIF;
    return null;
  }
}
