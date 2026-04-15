import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { ExecutionsController } from './executions.controller'
import { ExecutionsService } from './executions.service'

@Module({
	imports: [UsersModule],
	providers: [ExecutionsService],
	controllers: [ExecutionsController],
	exports: [ExecutionsService],
})
export class ExecutionsModule {}
