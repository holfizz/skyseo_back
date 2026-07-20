import { Module } from '@nestjs/common'
import { ManagerController } from './manager.controller'
import { ManagerService } from './manager.service'

@Module({
	controllers: [ManagerController],
	providers: [ManagerService],
	exports: [ManagerService],
})
export class ManagerModule {}
