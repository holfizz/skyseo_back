import { IsInt, IsOptional, IsUUID } from 'class-validator'

export class StartExecutionDto {
	@IsUUID()
	taskId: string

	// Версия алгоритма, применённая ПК в момент старта. null = зашитый. Пишется в execution
	// при СОЗДАНИИ — иначе плохая версия в отчётах выглядела бы чище хорошей.
	@IsOptional()
	@IsInt()
	algorithmVersion?: number
}
