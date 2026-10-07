import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentRequestDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/auth.decorators';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EXPEDITEUR)
  @Post()
  create(
    @CurrentUser() user: { id: number; role: Role; email: string },
    @Body() dto: CreatePaymentRequestDto,
  ) {
    return this.payments.create(user, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.FINANCE, Role.EXPEDITEUR)
  list(@CurrentUser() user: { id: number; role: Role; email: string }) {
    return this.payments.list(user);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.FINANCE)
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: { id: number; role: Role; email: string },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    return this.payments.updateStatus(user, id, dto);
  }
}
