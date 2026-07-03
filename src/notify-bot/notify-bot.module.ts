import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { NotifyBotController } from './notify-bot.controller'
import { NotifyBotService } from './notify-bot.service'

@Module({
	imports: [PrismaModule],
	controllers: [NotifyBotController],
	providers: [NotifyBotService],
	exports: [NotifyBotService],
})
export class NotifyBotModule {}
