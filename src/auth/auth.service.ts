import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { ApprovalStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ZonesService } from '../zones/zones.service';
import { PUBLIC_SIGNUP_ROLES, SignInDto, SignUpDto } from './dto/auth.dto';

export const PORTAL_BY_ROLE: Record<Role, string> = {
  SUPER_ADMIN: '/super-admin',
  ADMIN: '/admin',
  CHEF_AGENCE: '/chef-agence',
  SUPPORT: '/support',
  PICKUP: '/pickup',
  MAGASINIER: '/magasinier',
  FINANCE: '/finance',
  EXPEDITEUR: '/expediteur',
  LIVREUR: '/livreur',
  CLIENT: '/client',
};

const PENDING_MESSAGE =
  'Votre compte est en cours de vérification. Patientez jusqu’à l’approbation de notre équipe.';
const REJECTED_MESSAGE =
  'Compte refusé — contactez le support Umbrella Express.';

type PublicUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  agencyId: number | null;
  approvalStatus?: ApprovalStatus;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly zones: ZonesService,
  ) {}

  async signup(dto: SignUpDto) {
    if (!PUBLIC_SIGNUP_ROLES.includes(dto.role)) {
      throw new BadRequestException(
        'Public signup allows EXPEDITEUR or LIVREUR only',
      );
    }

    const phone = dto.phone?.trim() ?? '';
    if (!/^[0-9]{8}$/.test(phone)) {
      throw new BadRequestException('Téléphone : 8 chiffres');
    }

    const governorate = dto.governorate.trim();
    const city = dto.city.trim();
    const address = dto.address.trim();
    if (!governorate || !city || address.length < 3) {
      throw new BadRequestException('Adresse incomplète');
    }

    let productTypes: string[] = [];
    let productNotes: string | null = null;
    let shopName: string | null = null;
    if (dto.role === Role.EXPEDITEUR) {
      productTypes = (dto.productTypes ?? [])
        .map((t) => t.trim())
        .filter(Boolean);
      if (productTypes.length === 0) {
        throw new BadRequestException('Choisissez au moins un type de produit');
      }
      if (productTypes.includes('Autre')) {
        const notes = dto.productNotes?.trim() ?? '';
        if (notes.length < 2) {
          throw new BadRequestException('Précisez le type de produit');
        }
        productNotes = notes;
      } else {
        productNotes = dto.productNotes?.trim() || null;
      }
      shopName = dto.shopName?.trim() || dto.name.trim();
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) throw new ConflictException('Email already registered');

    let zoneId: number | null = null;
    if (dto.role === Role.LIVREUR) {
      zoneId = await this.zones.ensureZoneForGovernorate(governorate);
    }

    const password = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.toLowerCase(),
        phone,
        password,
        role: dto.role,
        approvalStatus: ApprovalStatus.PENDING,
        governorate,
        city,
        address,
        shopName,
        productTypes,
        productNotes,
        zoneId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        approvalStatus: true,
        zoneId: true,
      },
    });

    return {
      pending: true as const,
      message: PENDING_MESSAGE,
      user,
    };
  }

  async signin(dto: SignInDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (user.approvalStatus === ApprovalStatus.PENDING) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCOUNT_PENDING',
        message: PENDING_MESSAGE,
      });
    }
    if (user.approvalStatus === ApprovalStatus.REJECTED) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACCOUNT_REJECTED',
        message: REJECTED_MESSAGE,
      });
    }

    const publicUser: PublicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      agencyId: user.agencyId,
      approvalStatus: user.approvalStatus,
    };
    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.agencyId,
    );
    return {
      user: publicUser,
      portal: PORTAL_BY_ROLE[user.role],
      ...tokens,
    };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        agencyId: true,
        approvalStatus: true,
        zoneId: true,
        governorate: true,
        city: true,
        address: true,
        productTypes: true,
        productNotes: true,
        shopName: true,
        createdAt: true,
        agency: { select: { id: true, name: true, governorate: true } },
        homeZone: { select: { id: true, name: true, governorate: true } },
      },
    });
    if (!user) return null;
    return { ...user, portal: PORTAL_BY_ROLE[user.role] };
  }

  async refresh(refreshToken: string) {
    let payload: {
      sub: number;
      email: string;
      role: Role;
      agencyId?: number | null;
    };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (
      !user?.refreshToken ||
      !user.isActive ||
      user.approvalStatus !== ApprovalStatus.APPROVED
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const match = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!match) throw new UnauthorizedException('Invalid refresh token');

    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.agencyId,
    );
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        agencyId: user.agencyId,
        approvalStatus: user.approvalStatus,
      },
      portal: PORTAL_BY_ROLE[user.role],
      ...tokens,
    };
  }

  async logout(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  private async issueTokens(
    userId: number,
    email: string,
    role: Role,
    agencyId: number | null,
  ) {
    const payload = { sub: userId, email, role, agencyId };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow('JWT_SECRET'),
      expiresIn: '1h',
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });

    const hashed = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed },
    });

    return { accessToken, refreshToken };
  }
}
