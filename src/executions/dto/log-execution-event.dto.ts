import { IsIn, IsObject, IsOptional, IsString } from 'class-validator'

export class LogExecutionEventDto {
	@IsIn([
		'engine_selected',
		'captcha',
		'click',
		'direct_navigation',
		'parser',
		'navigation',
		'failure',
		'completion',
	])
	type: string

	@IsString()
	stage: string

	@IsOptional()
	@IsIn(['yandex', 'google'])
	engine?: string

	@IsOptional()
	@IsString()
	taskId?: string

	@IsOptional()
	@IsObject()
	details?: Record<string, unknown>
}
