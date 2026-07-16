import { Module } from '@nestjs/common'
import { SmmController } from './smm.controller'
import { SmmService } from './smm.service'

@Module({
	controllers: [SmmController],
	providers: [SmmService],
})
export class SmmModule {}
