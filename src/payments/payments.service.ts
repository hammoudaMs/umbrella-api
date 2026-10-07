import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ParcelStatus,
  PaymentRequestStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreatePaymentRequestDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto';

const STAFF: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.FINANCE];
const PAYABLE: ParcelStatus[] = [
  ParcelStatus.LIVRES,
  ParcelStatus.LIVRES_PAYES,
];
const ACTIVE_REQUEST: PaymentRequestStatus[] = [
  PaymentRequestStatus.EN_DEMANDE,
  PaymentRequestStatus.APPROUVE,
  PaymentRequestStatus.PAYE,
];

const PAYMENT_INCLUDE = {
  items: { include: { parcel: { select: { id: true, code: true } } } },
  sender: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PaymentRequestInclude;

type PaymentWithItems = Prisma.PaymentRequestGetPayload<{
  include: typeof PAYMENT_INCLUDE;
}>;

function toPaymentView(payment: PaymentWithItems) {
  return {
    ...payment,
    amount: Number(payment.amount),
    items: payment.items.map((i) => ({ ...i, amount: Number(i.amount) })),
  };
}

const ALLOWED_TRANSITIONS: Record<
  PaymentRequestStatus,
  PaymentRequestStatus[]
> = {
  EN_DEMANDE: [PaymentRequestStatus.APPROUVE, PaymentRequestStatus.REJETE],
  APPROUVE: [PaymentRequestStatus.PAYE, PaymentRequestStatus.REJETE],
  PAYE: [],
  REJETE: [],
};

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: AuthUser, dto: CreatePaymentRequestDto) {
    if (![...STAFF, Role.EXPEDITEUR].includes(user.role)) {
      throw new ForbiddenException();
    }
    const parcelIds = [...new Set(dto.parcelIds)];

    const parcels = await this.prisma.parcel.findMany({
      where: {
        id: { in: parcelIds },
        status: { in: PAYABLE },
        paymentItems: {
          none: { paymentRequest: { status: { in: ACTIVE_REQUEST } } },
        },
        ...(user.role === Role.EXPEDITEUR ? { senderId: user.id } : {}),
      },
    });

    if (parcels.length !== parcelIds.length) {
      throw new BadRequestException(
        'Certains colis sont introuvables, non livrés ou déjà dans une demande',
      );
    }
    const senders = new Set(parcels.map((p) => p.senderId));
    if (senders.size > 1) {
      throw new BadRequestException(
        'Une demande ne peut concerner qu’un seul expéditeur',
      );
    }

    const amount = parcels.reduce((sum, p) => sum + Number(p.price), 0);
    const created = await this.prisma.paymentRequest.create({
      data: {
        amount,
        note: dto.note,
        senderId: parcels[0].senderId,
        items: {
          create: parcels.map((p) => ({ parcelId: p.id, amount: p.price })),
        },
      },
      include: PAYMENT_INCLUDE,
    });
    return toPaymentView(created);
  }

  async list(user: AuthUser) {
    const rows = await this.prisma.paymentRequest.findMany({
      where: STAFF.includes(user.role) ? {} : { senderId: user.id },
      orderBy: { createdAt: 'desc' },
      include: PAYMENT_INCLUDE,
    });
    return rows.map(toPaymentView);
  }

  async updateStatus(user: AuthUser, id: number, dto: UpdatePaymentStatusDto) {
    if (!STAFF.includes(user.role)) throw new ForbiddenException();
    const existing = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { items: { select: { parcelId: true } } },
    });
    if (!existing) throw new NotFoundException('Payment request not found');
    if (!ALLOWED_TRANSITIONS[existing.status].includes(dto.status)) {
      throw new BadRequestException(
        `Transition ${existing.status} → ${dto.status} impossible`,
      );
    }

    const parcelIds = existing.items.map((i) => i.parcelId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        },
        include: PAYMENT_INCLUDE,
      });
      if (dto.status === PaymentRequestStatus.PAYE && parcelIds.length) {
        await tx.parcel.updateMany({
          where: { id: { in: parcelIds } },
          data: { status: ParcelStatus.LIVRES_PAYES },
        });
        await tx.parcelEvent.createMany({
          data: parcelIds.map((parcelId) => ({
            parcelId,
            label: 'Livré payé',
            status: ParcelStatus.LIVRES_PAYES,
            comment: `Paiement #${id} versé`,
            actorId: user.id,
          })),
        });
      }
      return payment;
    });
    return toPaymentView(updated);
  }
}
