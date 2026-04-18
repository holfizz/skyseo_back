import { Module } from '@nestjs/common'
import { UpdatesController } from './updates.controller'

@Module({
	controllers: [UpdatesController],
})
export class UpdatesModule {}
