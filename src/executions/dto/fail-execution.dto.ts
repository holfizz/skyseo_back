import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator'

export enum ExecutionFailureReasonDto {
	CAPTCHA = 'CAPTCHA',
	SCRIPT_ERROR = 'SCRIPT_ERROR',
	NOT_IN_SERP = 'NOT_IN_SERP',
	LOCK_TIMEOUT = 'LOCK_TIMEOUT',
}

export class FailExecutionDto {
	@IsEnum(ExecutionFailureReasonDto)
	failureReason: ExecutionFailureReasonDto

	@IsOptional()
	@IsInt()
	@Min(0)
	pagesVisited?: number

	@IsOptional()
	@IsInt()
	@Min(0)
	duration?: number

	@IsOptional()
	@IsBoolean()
	targetVisited?: boolean

	@IsOptional()
	@IsBoolean()
	directNavigationUsed?: boolean
}
