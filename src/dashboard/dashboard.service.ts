import { Injectable } from '@nestjs/common';
import { ParcelStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export const DASHBOARD_STATUSES: Array<{
  key: ParcelStatus;
  label: string;
  tone: string;
}> = [
  { key: ParcelStatus.NON_SERIEUX, label: 'Non sérieux', tone: 'rose' },
  {
    key: ParcelStatus.EN_ATTENTE,
    label: 'En attente de collecte',
    tone: 'amber',
  },
  {
    key: ParcelStatus.A_ENLEVER,
    label: 'En attente de collecte',
    tone: 'violet',
  },
  { key: ParcelStatus.ENLEVES, label: 'Colis récupéré', tone: 'lavender' },
  { key: ParcelStatus.AU_DEPOT, label: 'Arrivé au dépôt', tone: 'blue' },
  {
    key: ParcelStatus.EXPEDIE_DESTINATION,
    label: 'Expédié vers le dépôt de destination',
    tone: 'sky',
  },
  {
    key: ParcelStatus.ARRIVE_DESTINATION,
    label: 'Arrivé au dépôt de destination',
    tone: 'blue',
  },
  {
    key: ParcelStatus.AFFECTE_LIVREUR,
    label: 'Affecté à un livreur',
    tone: 'violet',
  },
  {
    key: ParcelStatus.EN_COURS,
    label: 'En cours de livraison',
    tone: 'mint',
  },
  { key: ParcelStatus.LIVRES, label: 'Livré', tone: 'teal' },
  {
    key: ParcelStatus.LIVRAISON_ANNULEE,
    label: 'Livraison annulée',
    tone: 'rose',
  },
  { key: ParcelStatus.RETOUR_DEPOT, label: 'Retour en agence', tone: 'sky' },
  {
    key: ParcelStatus.RETOUR_EXPEDITEURS,
    label: 'En transit vers l’expéditeur',
    tone: 'red',
  },
  {
    key: ParcelStatus.RETOUR_RECU,
    label: 'Retour livré à l’expéditeur',
    tone: 'red',
  },
  { key: ParcelStatus.A_VERIFIER, label: 'À vérifier', tone: 'pink' },
  { key: ParcelStatus.LIVRES_PAYES, label: 'Livré payé', tone: 'sea' },
  { key: ParcelStatus.ECHANGES, label: 'Échanges', tone: 'olive' },
  { key: ParcelStatus.REMBOURSES, label: 'Remboursés', tone: 'olive' },
  {
    key: ParcelStatus.RETOUR_DEFINITIF,
    label: 'Retour définitif',
    tone: 'red',
  },
  {
    key: ParcelStatus.RETOUR_INTER_AGENCE,
    label: 'Retour inter-agence',
    tone: 'red',
  },
  {
    key: ParcelStatus.SAISIE_DOUANE,
    label: 'Saisie par la Douane',
    tone: 'slate',
  },
];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async statusCounts(user: AuthUser) {
    let where: Record<string, unknown>;

    if (
      user.role === Role.SUPER_ADMIN ||
      user.role === Role.ADMIN ||
      user.role === Role.FINANCE
    ) {
      where = { status: { not: ParcelStatus.SUPPRIME } };
    } else if (
      user.role === Role.CHEF_AGENCE ||
      user.role === Role.SUPPORT ||
      user.role === Role.PICKUP ||
      user.role === Role.MAGASINIER
    ) {
      const agencyId =
        user.agencyId ??
        (
          await this.prisma.user.findUnique({
            where: { id: user.id },
            select: { agencyId: true },
          })
        )?.agencyId;
      where = agencyId
        ? {
            agencyId,
            status:
              user.role === Role.SUPPORT
                ? {
                    in: [
                      ParcelStatus.LIVRAISON_ANNULEE,
                      ParcelStatus.RETOUR_DEPOT,
                      ParcelStatus.RETOUR_DEFINITIF,
                      ParcelStatus.RETOUR_INTER_AGENCE,
                      ParcelStatus.RETOUR_EXPEDITEURS,
                      ParcelStatus.RETOUR_RECU,
                    ],
                  }
                : { not: ParcelStatus.SUPPRIME },
          }
        : { id: -1 };
    } else if (user.role === Role.LIVREUR) {
      where = { driverId: user.id, status: { not: ParcelStatus.SUPPRIME } };
    } else if (user.role === Role.CLIENT) {
      const me = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { phone: true },
      });
      where = me?.phone
        ? { phone: me.phone, status: { not: ParcelStatus.SUPPRIME } }
        : { id: -1 };
    } else {
      where = { senderId: user.id, status: { not: ParcelStatus.SUPPRIME } };
    }

    const grouped = await this.prisma.parcel.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const map = new Map(grouped.map((g) => [g.status, g._count._all]));

    return DASHBOARD_STATUSES.map((item) => ({
      key: item.key,
      label: item.label,
      tone: item.tone,
      count: map.get(item.key) ?? 0,
    }));
  }

  async analytics(user: AuthUser) {
    const allowed: Role[] = [
      Role.SUPER_ADMIN,
      Role.ADMIN,
      Role.FINANCE,
      Role.CHEF_AGENCE,
      Role.SUPPORT,
      Role.PICKUP,
      Role.MAGASINIER,
      Role.EXPEDITEUR,
    ];
    if (!allowed.includes(user.role)) {
      return null;
    }

    const isSender = user.role === Role.EXPEDITEUR;
    const isAgencyStaff =
      user.role === Role.CHEF_AGENCE ||
      user.role === Role.SUPPORT ||
      user.role === Role.PICKUP ||
      user.role === Role.MAGASINIER;
    const agencyId = isAgencyStaff
      ? (user.agencyId ??
        (
          await this.prisma.user.findUnique({
            where: { id: user.id },
            select: { agencyId: true },
          })
        )?.agencyId)
      : null;
    const returnOnly =
      user.role === Role.SUPPORT
        ? {
            in: [
              ParcelStatus.LIVRAISON_ANNULEE,
              ParcelStatus.RETOUR_DEPOT,
              ParcelStatus.RETOUR_DEFINITIF,
              ParcelStatus.RETOUR_INTER_AGENCE,
              ParcelStatus.RETOUR_EXPEDITEURS,
              ParcelStatus.RETOUR_RECU,
            ],
          }
        : { not: ParcelStatus.SUPPRIME };
    const baseWhere: Record<string, unknown> = {
      status: returnOnly,
      ...(isSender ? { senderId: user.id } : {}),
      ...(agencyId ? { agencyId } : {}),
      ...(isAgencyStaff && !agencyId ? { id: -1 } : {}),
    };

    const returnStatuses = [
      ParcelStatus.LIVRAISON_ANNULEE,
      ParcelStatus.RETOUR_DEFINITIF,
      ParcelStatus.RETOUR_INTER_AGENCE,
      ParcelStatus.RETOUR_EXPEDITEURS,
      ParcelStatus.RETOUR_RECU,
      ParcelStatus.RETOUR_DEPOT,
    ];

    const [
      total,
      external,
      internal,
      delivered,
      inProgress,
      returns,
      awaiting,
      exchanges,
      modeGroups,
      recent,
      deliveredSum,
      returnSum,
      payments,
    ] = await Promise.all([
      this.prisma.parcel.count({ where: baseWhere }),
      this.prisma.parcel.count({
        where: { ...baseWhere, mode: 'EXTERNAL' },
      }),
      this.prisma.parcel.count({
        where: { ...baseWhere, mode: 'INTERNAL' },
      }),
      this.prisma.parcel.count({
        where: {
          ...baseWhere,
          status: { in: [ParcelStatus.LIVRES, ParcelStatus.LIVRES_PAYES] },
        },
      }),
      this.prisma.parcel.count({
        where: {
          ...baseWhere,
          status: {
            in: [
              ParcelStatus.EN_COURS,
              ParcelStatus.AU_DEPOT,
              ParcelStatus.A_ENLEVER,
              ParcelStatus.ENLEVES,
            ],
          },
        },
      }),
      this.prisma.parcel.count({
        where: {
          ...baseWhere,
          status: { in: returnStatuses },
        },
      }),
      this.prisma.parcel.count({
        where: { ...baseWhere, status: ParcelStatus.EN_ATTENTE },
      }),
      this.prisma.parcel.count({
        where: { ...baseWhere, status: ParcelStatus.ECHANGES },
      }),
      this.prisma.parcel.groupBy({
        by: ['mode'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { price: true },
      }),
      this.prisma.parcel.findMany({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { createdAt: true, status: true, mode: true, price: true },
      }),
      this.prisma.parcel.aggregate({
        where: {
          ...baseWhere,
          status: { in: [ParcelStatus.LIVRES, ParcelStatus.LIVRES_PAYES] },
        },
        _sum: { price: true },
      }),
      this.prisma.parcel.aggregate({
        where: {
          ...baseWhere,
          status: { in: returnStatuses },
        },
        _sum: { price: true },
      }),
      this.prisma.paymentRequest.findMany({
        where: isSender ? { senderId: user.id } : {},
        select: { amount: true, status: true },
      }),
    ]);

    const dayKeys: string[] = [];
    const dayMap = new Map<
      string,
      { total: number; delivered: number; external: number; internal: number }
    >();

    const toLocalDay = (value: Date) => {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = toLocalDay(d);
      dayKeys.push(key);
      dayMap.set(key, { total: 0, delivered: 0, external: 0, internal: 0 });
    }

    for (const p of recent) {
      const key = toLocalDay(new Date(p.createdAt));
      const bucket = dayMap.get(key);
      if (!bucket) continue;
      bucket.total += 1;
      if (p.mode === 'EXTERNAL') bucket.external += 1;
      else bucket.internal += 1;
      if (
        p.status === ParcelStatus.LIVRES ||
        p.status === ParcelStatus.LIVRES_PAYES
      ) {
        bucket.delivered += 1;
      }
    }

    const revenue = modeGroups.reduce(
      (sum, g) => sum + Number(g._sum.price ?? 0),
      0,
    );

    const encaisse = Number(deliveredSum._sum.price ?? 0);
    const enDemande = payments
      .filter((p) => p.status === 'EN_DEMANDE')
      .reduce((s, p) => s + Number(p.amount), 0);
    const aVerser = payments
      .filter((p) => p.status === 'APPROUVE')
      .reduce((s, p) => s + Number(p.amount), 0);
    const verse = payments
      .filter((p) => p.status === 'PAYE')
      .reduce((s, p) => s + Number(p.amount), 0);
    const retoursMontant = Number(returnSum._sum.price ?? 0);
    const retoursFrais = Math.round(returns * 7 * 100) / 100;
    const disponible = Math.max(0, encaisse - enDemande - aVerser - verse);

    return {
      kpis: {
        total,
        external,
        internal,
        delivered,
        inProgress,
        returns,
        awaiting,
        exchanges,
        revenue,
        deliveryRate: total ? Math.round((delivered / total) * 100) : 0,
        returnRate: total ? Math.round((returns / total) * 100) : 0,
      },
      soldes: {
        disponible,
        enDemande,
        aVerser,
        verse,
        encaisse,
        retoursMontant,
        retoursFrais,
      },
      last7Days: dayKeys.map((key) => ({
        date: key,
        label: key.slice(5),
        ...dayMap.get(key)!,
      })),
    };
  }
}
