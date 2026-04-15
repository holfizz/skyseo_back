import { IsUUID } from 'class-validator'

export class StartExecutionDto {
	@IsUUID()
	taskId: string
}
