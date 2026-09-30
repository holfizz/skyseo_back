import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { TgWarmupModule } from '../tg-warmup/tg-warmup.module'
import { WorkspaceController } from './workspace.controller'
import { WorkspaceService } from './workspace.service'
@Module({ imports: [PrismaModule, TgWarmupModule], controllers: [WorkspaceController], providers: [WorkspaceService] })
export class WorkspaceModule {}
