import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { NotificationsModule } from '../notifications/notifications.module'
import { OutreachController } from './outreach.controller'
import { OutreachService } from './outreach.service'

@Module({
	imports: [MulterModule.register({ limits: { fileSize: 20 * 1024 * 1024 } }), NotificationsModule],
	controllers: [OutreachController],
	providers: [OutreachService],
})
export class OutreachModule {}
