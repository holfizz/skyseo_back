import { Module } from '@nestjs/common'
import { RewardsController } from './rewards.controller'
import { RewardsService } from './rewards.service'

@Module({
	providers: [RewardsService],
	controllers: [RewardsController],
	exports: [RewardsService],
})
export class RewardsModule {}
