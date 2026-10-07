import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ApprovalStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  AGENCY_REQUIRED_ROLES,
  isAgencyRole,
} from '../common/agency-roles';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './dto/user.dto';

const ADMIN_CREATABLE: Role[] = [
  Role.EXPEDITEUR,
  Role.LIVREUR,
  Role.CLIENT,
  Role.ADMIN,
  Role.FINANCE,
  Role.SUPPORT,
  Role.PICKUP,
  Role.MAGASINIER,
];

const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  agencyId: true,
  zoneId: true,
  approvalStatus: true,
  approvedAt: true,
  governorate: true,
  city: true,
  address: true,
  shopName: true,
  productTypes: true,
  productNotes: true,
  isActive: true,
  createdAt: true,
  agency: { select: { id: true, name: true, governorate: true } },
  homeZone: { select: { id: true, name: true, governorate: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser) {
    const where =
      actor.role === Role.SUPER_ADMIN
        ? {}
        : { role: { not: Role.SUPER_ADMIN } };

    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_USER_SELECT,
    });
  }

  async create(actor: AuthUser, dto: CreateUserDto) {
    if (actor.role === Role.ADMIN) {
      if (!ADMIN_CREATABLE.includes(dto.role)) {
        throw new ForbiddenException('Admins cannot create this role');
      }
    } else if (actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException();
    }

    if (dto.role === Role.SUPER_ADMIN && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException();
    }

    if (dto.role === Role.CHEF_AGENCE && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only super-admin can create chef d’agence');
    }

    const agencyId = await this.resolveAgencyId(dto.role, dto.agencyId);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) throw new ConflictException('Email already registered');

    const password = await bcrypt.hash(dto.password, 12);
    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        password,
        role: dto.role,
        agencyId,
      },
      select: PUBLIC_USER_SELECT,
    });
  }

  private async resolveAgencyId(
    role: Role,
    agencyId?: number | null,
  ): Promise<number | null> {
    if (AGENCY_REQUIRED_ROLES.includes(role)) {
      if (agencyId == null) {
        throw new BadRequestException('agencyId is required for this role');
      }
      const agency = await this.prisma.agency.findFirst({
        where: { id: agencyId, isActive: true },
        select: { id: true },
      });
      if (!agency) throw new BadRequestException('Agency not found');
      return agency.id;
    }
    return agencyId ?? null;
  }

  private assertCanManage(actor: AuthUser, targetRole: Role, nextRole?: Role) {
    if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.ADMIN) {
      throw new ForbiddenException();
    }
    if (actor.role === Role.ADMIN) {
      if (targetRole === Role.SUPER_ADMIN || targetRole === Role.CHEF_AGENCE) {
        throw new ForbiddenException('Admins cannot manage this user');
      }
      if (nextRole && !ADMIN_CREATABLE.includes(nextRole)) {
        throw new ForbiddenException('Admins cannot assign this role');
      }
    }
    if (
      (nextRole === Role.SUPER_ADMIN || nextRole === Role.CHEF_AGENCE) &&
      actor.role !== Role.SUPER_ADMIN
    ) {
      throw new ForbiddenException();
    }
  }

  async update(actor: AuthUser, id: number, dto: UpdateUserDto) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    this.assertCanManage(actor, target.role, dto.role);

    const email = dto.email?.toLowerCase();
    if (email && email !== target.email) {
      const taken = await this.prisma.user.findFirst({
        where: { email, id: { not: id } },
        select: { id: true },
      });
      if (taken) throw new ConflictException('Email already registered');
    }

    if (dto.role && dto.role !== target.role && target.id === actor.id) {
      throw new BadRequestException('Cannot change your own role');
    }

    const nextRole = dto.role ?? target.role;
    const data: {
      name?: string;
      email?: string;
      phone?: string | null;
      role?: Role;
      password?: string;
      agencyId?: number | null;
    } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (email !== undefined) data.email = email;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 12);
    if (dto.agencyId !== undefined || dto.role !== undefined) {
      data.agencyId = isAgencyRole(nextRole)
        ? await this.resolveAgencyId(
            nextRole,
            dto.agencyId !== undefined ? dto.agencyId : target.agencyId,
          )
        : null;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: PUBLIC_USER_SELECT,
    });
  }

  async setActive(actor: AuthUser, id: number, isActive: boolean) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    if (target.id === actor.id) {
      throw new BadRequestException('Cannot change your own active status');
    }

    if (
      actor.role === Role.ADMIN &&
      (target.role === Role.SUPER_ADMIN || target.role === Role.CHEF_AGENCE)
    ) {
      throw new ForbiddenException();
    }

    if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.ADMIN) {
      throw new ForbiddenException();
    }

    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: PUBLIC_USER_SELECT,
    });
  }

  async setApproval(
    actor: AuthUser,
    id: number,
    status: ApprovalStatus,
  ) {
    if (status !== ApprovalStatus.APPROVED && status !== ApprovalStatus.REJECTED) {
      throw new BadRequestException('status must be APPROVED or REJECTED');
    }
    if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.ADMIN) {
      throw new ForbiddenException();
    }

    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === actor.id) {
      throw new BadRequestException('Cannot change your own approval status');
    }
    if (
      actor.role === Role.ADMIN &&
      (target.role === Role.SUPER_ADMIN || target.role === Role.CHEF_AGENCE)
    ) {
      throw new ForbiddenException();
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        approvalStatus: status,
        approvedAt: new Date(),
        approvedById: actor.id,
      },
      select: PUBLIC_USER_SELECT,
    });
  }

  async updateProfile(actor: AuthUser, dto: UpdateProfileDto) {
    const email = dto.email?.toLowerCase();
    if (email) {
      const taken = await this.prisma.user.findFirst({
        where: { email, id: { not: actor.id } },
        select: { id: true },
      });
      if (taken) throw new ConflictException('Email already registered');
    }
    return this.prisma.user.update({
      where: { id: actor.id },
      data: { name: dto.name, email, phone: dto.phone },
      select: PUBLIC_USER_SELECT,
    });
  }

  async changePassword(actor: AuthUser, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!user) throw new NotFoundException('User not found');
    const ok = await bcrypt.compare(dto.currentPassword, user.password);
    if (!ok) throw new BadRequestException('Mot de passe actuel incorrect');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit être différent',
      );
    }
    await this.prisma.user.update({
      where: { id: actor.id },
      data: { password: await bcrypt.hash(dto.newPassword, 12) },
    });
    return { updated: true };
  }

  async listLivreurs() {
    return this.prisma.user.findMany({
      where: {
        role: Role.LIVREUR,
        isActive: true,
        approvalStatus: ApprovalStatus.APPROVED,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        zoneId: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
