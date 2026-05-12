import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator'

export enum ExecutionCompletionKindDto {
	NORMAL = 'NORMAL',
	DEGRADED = 'DEGRADED',
	SKIPPED = 'SKIPPED',
}

export class CompleteExecutionDto {
	@IsBoolean()
	foundInTop: boolean

	@IsOptional()
	@IsInt()
	@Min(1)
	position?: number

	@IsOptional()
	@IsInt()
	@Min(1)
	yandexPosition?: number

	@IsOptional()
	@IsInt()
	@Min(1)
	googlePosition?: number

	@IsInt()
	@Min(0)
	pagesVisited: number

	@IsOptional()
	@IsBoolean()
	targetVisited?: boolean

	@IsOptional()
	@IsBoolean()
	directNavigationUsed?: boolean

	@IsOptional()
	@IsEnum(ExecutionCompletionKindDto)
	completionKind?: ExecutionCompletionKindDto

	@IsInt()
	@Min(0)
	duration: number // в секундах
}
