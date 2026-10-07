import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApprovalStatus,
  CallStatus,
  ParcelStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateCallDto,
  CreateConversationDto,
  DirectoryQueryDto,
  MessagesQueryDto,
  SendMessageDto,
  UpdateCallDto,
} from './dto/comms.dto';

const PERSON = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
} satisfies Prisma.UserSelect;

const OPEN_DIRECTORY: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.CHEF_AGENCE,
  Role.SUPPORT,
];

@Injectable()
export class CommsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async assertParticipant(userId: number, conversationId: number) {
    const hit = await this.prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: { conversationId, userId },
      },
    });
    if (!hit) throw new ForbiddenException('Not a conversation participant');
    return hit;
  }

  private async hasSharedDelivery(
    livreurId: number,
    clientPhone: string,
    parcelId?: number,
  ) {
    const count = await this.prisma.parcel.count({
      where: {
        status: { not: ParcelStatus.SUPPRIME },
        driverId: livreurId,
        phone: clientPhone,
        ...(parcelId != null ? { id: parcelId } : {}),
      },
    });
    return count > 0;
  }

  private async assertCanMessagePeer(
    user: AuthUser,
    peer: { id: number; role: Role; phone: string | null },
    parcelId?: number,
  ) {
    const pair = [user.role, peer.role] as const;
    const isLivreurClient =
      (pair[0] === Role.LIVREUR && pair[1] === Role.CLIENT) ||
      (pair[0] === Role.CLIENT && pair[1] === Role.LIVREUR);

    if (!isLivreurClient) return;

    const livreurId = user.role === Role.LIVREUR ? user.id : peer.id;
    const client =
      user.role === Role.CLIENT
        ? await this.prisma.user.findUnique({
            where: { id: user.id },
            select: { phone: true },
          })
        : { phone: peer.phone };

    if (!client?.phone) {
      throw new ForbiddenException(
        'Compte client sans téléphone — messagerie indisponible',
      );
    }

    const linked = await this.hasSharedDelivery(
      livreurId,
      client.phone,
      parcelId,
    );
    if (!linked) {
      throw new ForbiddenException(
        'Messagerie réservée aux colis partagés livreur ↔ client',
      );
    }
  }

  async peerForParcel(user: AuthUser, parcelId: number) {
    const parcel = await this.prisma.parcel.findFirst({
      where: {
        id: parcelId,
        status: { not: ParcelStatus.SUPPRIME },
      },
      select: {
        id: true,
        code: true,
        phone: true,
        driverId: true,
        senderId: true,
      },
    });
    if (!parcel) throw new NotFoundException('Parcel not found');

    if (user.role === Role.LIVREUR) {
      if (parcel.driverId !== user.id) throw new ForbiddenException();
      const peer = await this.prisma.user.findFirst({
        where: {
          role: Role.CLIENT,
          phone: parcel.phone,
          isActive: true,
          approvalStatus: ApprovalStatus.APPROVED,
        },
        select: PERSON,
      });
      if (!peer) {
        throw new NotFoundException(
          'Aucun compte client Umbrella pour ce destinataire',
        );
      }
      return { parcelId: parcel.id, parcelCode: parcel.code, peer };
    }

    if (user.role === Role.CLIENT) {
      const me = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { phone: true },
      });
      if (!me?.phone || me.phone !== parcel.phone) {
        throw new ForbiddenException();
      }
      if (!parcel.driverId) {
        throw new NotFoundException('Aucun livreur assigné à ce colis');
      }
      const peer = await this.prisma.user.findFirst({
        where: {
          id: parcel.driverId,
          role: Role.LIVREUR,
          isActive: true,
          approvalStatus: ApprovalStatus.APPROVED,
        },
        select: PERSON,
      });
      if (!peer) throw new NotFoundException('Livreur introuvable');
      return { parcelId: parcel.id, parcelCode: parcel.code, peer };
    }

    throw new ForbiddenException();
  }

  async directory(user: AuthUser, query: DirectoryQueryDto) {
    const q = query.q?.trim();
    const textFilter: Prisma.UserWhereInput | undefined = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        }
      : undefined;

    if (user.role === Role.LIVREUR) {
      const phones = await this.prisma.parcel.findMany({
        where: {
          driverId: user.id,
          status: { not: ParcelStatus.SUPPRIME },
        },
        select: { phone: true },
        distinct: ['phone'],
      });
      const phoneList = phones.map((p) => p.phone).filter(Boolean);
      if (!phoneList.length) return [];
      return this.prisma.user.findMany({
        where: {
          id: { not: user.id },
          role: Role.CLIENT,
          phone: { in: phoneList },
          isActive: true,
          approvalStatus: ApprovalStatus.APPROVED,
          ...(textFilter ?? {}),
        },
        select: PERSON,
        orderBy: { name: 'asc' },
        take: 40,
      });
    }

    if (user.role === Role.CLIENT) {
      const me = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { phone: true },
      });
      if (!me?.phone) return [];
      const drivers = await this.prisma.parcel.findMany({
        where: {
          phone: me.phone,
          driverId: { not: null },
          status: { not: ParcelStatus.SUPPRIME },
        },
        select: { driverId: true },
        distinct: ['driverId'],
      });
      const driverIds = drivers
        .map((d) => d.driverId)
        .filter((id): id is number => id != null);
      if (!driverIds.length) return [];
      return this.prisma.user.findMany({
        where: {
          id: { in: driverIds.filter((id) => id !== user.id) },
          role: Role.LIVREUR,
          isActive: true,
          approvalStatus: ApprovalStatus.APPROVED,
          ...(textFilter ?? {}),
        },
        select: PERSON,
        orderBy: { name: 'asc' },
        take: 40,
      });
    }

    const where: Prisma.UserWhereInput = {
      id: { not: user.id },
      isActive: true,
      approvalStatus: ApprovalStatus.APPROVED,
      ...(OPEN_DIRECTORY.includes(user.role)
        ? {}
        : user.role === Role.EXPEDITEUR
          ? { role: { in: [Role.LIVREUR, Role.SUPPORT, Role.ADMIN] } }
          : { role: { in: [Role.EXPEDITEUR, Role.LIVREUR, Role.CLIENT] } }),
      ...(textFilter ?? {}),
    };
    return this.prisma.user.findMany({
      where,
      select: PERSON,
      orderBy: { name: 'asc' },
      take: 40,
    });
  }

  async listConversations(user: AuthUser) {
    const rows = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId: user.id } } },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      include: {
        participants: { include: { user: { select: PERSON } } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sender: { select: PERSON } },
        },
        parcel: { select: { id: true, code: true } },
      },
    });

    return rows.map((c) => {
      const peer = c.participants.find((p) => p.userId !== user.id)?.user ?? null;
      const me = c.participants.find((p) => p.userId === user.id);
      const last = c.messages[0] ?? null;
      const unread =
        last &&
        last.senderId !== user.id &&
        (!me?.lastReadAt || last.createdAt > me.lastReadAt)
          ? 1
          : 0;
      return {
        id: c.id,
        parcelId: c.parcelId,
        parcel: c.parcel,
        peer,
        lastMessage: last
          ? {
              id: last.id,
              body: last.body,
              createdAt: last.createdAt,
              senderId: last.senderId,
              sender: last.sender,
            }
          : null,
        lastMessageAt: c.lastMessageAt,
        unread,
        updatedAt: c.updatedAt,
      };
    });
  }

  async createConversation(user: AuthUser, dto: CreateConversationDto) {
    if (dto.peerUserId === user.id) {
      throw new BadRequestException('Cannot message yourself');
    }
    const peer = await this.prisma.user.findFirst({
      where: {
        id: dto.peerUserId,
        isActive: true,
        approvalStatus: ApprovalStatus.APPROVED,
      },
      select: PERSON,
    });
    if (!peer) throw new NotFoundException('User not found');

    if (dto.parcelId) {
      const parcel = await this.prisma.parcel.findUnique({
        where: { id: dto.parcelId },
        select: { id: true },
      });
      if (!parcel) throw new NotFoundException('Parcel not found');
    }

    await this.assertCanMessagePeer(user, peer, dto.parcelId);

    const existing = await this.prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: user.id } } },
          { participants: { some: { userId: dto.peerUserId } } },
          { participants: { every: { userId: { in: [user.id, dto.peerUserId] } } } },
        ],
      },
      include: {
        participants: { include: { user: { select: PERSON } } },
        parcel: { select: { id: true, code: true } },
        _count: { select: { participants: true } },
      },
    });

    if (existing && existing._count.participants === 2) {
      if (dto.parcelId && existing.parcelId !== dto.parcelId) {
        await this.prisma.conversation.update({
          where: { id: existing.id },
          data: { parcelId: dto.parcelId },
        });
        existing.parcelId = dto.parcelId;
      }
      return this.getConversationSummary(user, existing.id);
    }

    const created = await this.prisma.conversation.create({
      data: {
        parcelId: dto.parcelId ?? null,
        participants: {
          create: [{ userId: user.id }, { userId: dto.peerUserId }],
        },
      },
    });
    return this.getConversationSummary(user, created.id);
  }

  private async getConversationSummary(user: AuthUser, id: number) {
    const list = await this.listConversations(user);
    const hit = list.find((c) => c.id === id);
    if (!hit) throw new NotFoundException('Conversation not found');
    return hit;
  }

  async listMessages(
    user: AuthUser,
    conversationId: number,
    query: MessagesQueryDto,
  ) {
    await this.assertParticipant(user.id, conversationId);
    const take = Math.min(query.take ?? 40, 100);
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take,
      include: { sender: { select: PERSON } },
    });

    await this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId: user.id },
      },
      data: { lastReadAt: new Date() },
    });

    return {
      items: messages.reverse(),
      nextCursor:
        messages.length === take ? messages[messages.length - 1]?.id : null,
    };
  }

  async sendMessage(
    user: AuthUser,
    conversationId: number,
    dto: SendMessageDto,
  ) {
    await this.assertParticipant(user.id, conversationId);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Empty message');

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderId: user.id,
          body,
        },
        include: { sender: { select: PERSON } },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt },
      });
      await tx.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId, userId: user.id },
        },
        data: { lastReadAt: created.createdAt },
      });
      return created;
    });

    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });

    return { message, participantIds: participants.map((p) => p.userId) };
  }

  async createCall(user: AuthUser, dto: CreateCallDto) {
    await this.assertParticipant(user.id, dto.conversationId);
    const peers = await this.prisma.conversationParticipant.findMany({
      where: { conversationId: dto.conversationId },
      select: { userId: true },
    });
    const calleeId = peers.find((p) => p.userId !== user.id)?.userId;
    if (!calleeId) throw new BadRequestException('No peer in conversation');

    const call = await this.prisma.callSession.create({
      data: {
        conversationId: dto.conversationId,
        callerId: user.id,
        calleeId,
        status: CallStatus.RINGING,
      },
      include: {
        caller: { select: PERSON },
        callee: { select: PERSON },
      },
    });
    return call;
  }

  async updateCall(user: AuthUser, id: number, dto: UpdateCallDto) {
    const call = await this.prisma.callSession.findUnique({ where: { id } });
    if (!call) throw new NotFoundException('Call not found');
    if (call.callerId !== user.id && call.calleeId !== user.id) {
      throw new ForbiddenException('Not a call participant');
    }

    const data: Prisma.CallSessionUpdateInput = { status: dto.status };
    if (dto.status === CallStatus.ACTIVE && !call.startedAt) {
      data.startedAt = new Date();
    }
    if (
      dto.status === CallStatus.ENDED ||
      dto.status === CallStatus.MISSED ||
      dto.status === CallStatus.REJECTED
    ) {
      data.endedAt = new Date();
    }

    return this.prisma.callSession.update({
      where: { id },
      data,
      include: {
        caller: { select: PERSON },
        callee: { select: PERSON },
      },
    });
  }

  /** Coturn time-limited credentials (TURN REST API / shared secret). */
  turnCredentials(user: AuthUser) {
    const secret = this.config.get<string>('TURN_SECRET');
    const urls = (this.config.get<string>('TURN_URLS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const stun = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
    if (!secret || urls.length === 0) {
      return { iceServers: stun, ttl: 0 };
    }
    const ttl = 24 * 3600;
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiry}:${user.id}`;
    const credential = createHmac('sha1', secret)
      .update(username)
      .digest('base64');
    return {
      iceServers: [
        ...stun,
        ...urls.map((url) => ({
          urls: url,
          username,
          credential,
        })),
      ],
      ttl,
    };
  }

  async participantIds(conversationId: number) {
    const rows = await this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}
