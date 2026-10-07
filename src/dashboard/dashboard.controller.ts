import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/auth.decorators';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('status-counts')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.FINANCE,
    Role.CHEF_AGENCE,
    Role.SUPPORT,
    Role.PICKUP,
    Role.MAGASINIER,
    Role.EXPEDITEUR,
    Role.LIVREUR,
    Role.CLIENT,
  )
  statusCounts(@CurrentUser() user: AuthUser) {
    return this.dashboard.statusCounts(user);
  }

  @Get('analytics')
  @Roles(
    Role.SUPER_ADMIN,
    Role.ADMIN,
    Role.FINANCE,
    Role.CHEF_AGENCE,
    Role.SUPPORT,
    Role.PICKUP,
    Role.MAGASINIER,
    Role.EXPEDITEUR,
  )
  analytics(@CurrentUser() user: AuthUser) {
    return this.dashboard.analytics(user);
  }
}
