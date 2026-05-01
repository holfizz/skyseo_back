import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { TaskSchedulerService } from './task-scheduler.service'
import { TasksController } from './tasks.controller'
import { TasksService } from './tasks.service'

@Module({
	imports: [UsersModule],
	providers: [TasksService, TaskSchedulerService],
	controllers: [TasksController],
	exports: [TasksService],
})
export class TasksModule {}
