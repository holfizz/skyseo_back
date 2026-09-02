import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { TelegramModule } from '../telegram/telegram.module'
import { CampaignController } from './campaign.controller'
import { CampaignManagerController } from './campaign-manager.controller'
import { CampaignScheduler } from './campaign.scheduler'
import { CampaignService } from './campaign.service'
import { TgWarmupController } from './tg-warmup.controller'
import { TgWarmupScheduler } from './tg-warmup.scheduler'
import { TgWarmupService } from './tg-warmup.service'

// Прогрев Telegram и рассылка с прогретых аккаунтов.
// Один модуль, потому что пул аккаунтов у них общий: рассылка спрашивает у
// прогрева и параметры подключения, и разрешение писать.
@Module({
	// TelegramModule — ради уведомлений админу в бот, когда кто-то ответил.
	imports: [PrismaModule, TelegramModule.forRoot()],
	controllers: [TgWarmupController, CampaignController, CampaignManagerController],
	providers: [TgWarmupService, TgWarmupScheduler, CampaignService, CampaignScheduler],
})
export class TgWarmupModule {}
