import { Module } from '@nestjs/common'
import { FollowUpService } from './follow-up.service'

@Module({ providers: [FollowUpService], exports: [FollowUpService] })
export class FollowUpModule {}
