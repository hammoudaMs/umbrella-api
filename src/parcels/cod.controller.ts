import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CodService } from './cod.service';
import { SettleCodDto } from './dto/cod.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/auth.decorators';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('cod')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.FINANCE)
@Controller('cod')
export class CodController {
  constructor(private readonly cod: CodService) {}

  @Get()
  list() {
    return this.cod.list();
  }

  @Post('settle')
  settle(@CurrentUser() user: AuthUser, @Body() dto: SettleCodDto) {
    return this.cod.settle(user, dto.parcelIds);
  }
}
