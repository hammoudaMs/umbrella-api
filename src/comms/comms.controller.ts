import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CommsService } from './comms.service';
import { CommsGateway } from './comms.gateway';
import {
  CreateCallDto,
  CreateConversationDto,
  DirectoryQueryDto,
  MessagesQueryDto,
  SendMessageDto,
  UpdateCallDto,
} from './dto/comms.dto';

@ApiTags('comms')
@ApiBearerAuth()
@Controller()
export class CommsController {
  constructor(
    private readonly comms: CommsService,
    private readonly gateway: CommsGateway,
  ) {}

  @Get('users/directory')
  directory(@CurrentUser() user: AuthUser, @Query() query: DirectoryQueryDto) {
    return this.comms.directory(user, query);
  }

  @Get('conversations')
  list(@CurrentUser() user: AuthUser) {
    return this.comms.listConversations(user);
  }

  @Get('conversations/peer-for-parcel/:parcelId')
  peerForParcel(
    @CurrentUser() user: AuthUser,
    @Param('parcelId', ParseIntPipe) parcelId: number,
  ) {
    return this.comms.peerForParcel(user, parcelId);
  }

  @Post('conversations')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) {
    return this.comms.createConversation(user, dto);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: MessagesQueryDto,
  ) {
    return this.comms.listMessages(user, id, query);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('conversations/:id/messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
  ) {
    const { message, participantIds } = await this.comms.sendMessage(
      user,
      id,
      dto,
    );
    this.gateway.emitMessageNew(participantIds, {
      conversationId: id,
      message,
    });
    return message;
  }

  @Get('calls/turn-credentials')
  turnCredentials(@CurrentUser() user: AuthUser) {
    return this.comms.turnCredentials(user);
  }

  @Post('calls')
  async createCall(@CurrentUser() user: AuthUser, @Body() dto: CreateCallDto) {
    const call = await this.comms.createCall(user, dto);
    this.gateway.emitToUser(call.calleeId, 'call:ring', call);
    return call;
  }

  @Patch('calls/:id')
  async updateCall(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCallDto,
  ) {
    const call = await this.comms.updateCall(user, id, dto);
    const peerId = call.callerId === user.id ? call.calleeId : call.callerId;
    this.gateway.emitToUser(peerId, 'call:status', call);
    return call;
  }
}
