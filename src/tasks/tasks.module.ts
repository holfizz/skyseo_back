import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { TasksController } from './tasks.controller'
import { TasksService } from './tasks.service'

@Module({
	imports: [UsersModule],
	providers: [TasksService],
	controllers: [TasksController],
	exports: [TasksService],
})
export class TasksModule {}
