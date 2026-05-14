import {
	IsBoolean,
	IsInt,
	IsOptional,
	IsUrl,
	MaxLength,
	Min,
} from 'class-validator'

export class UpdateTaskDto {
	@IsOptional()
	@IsInt()
	@Min(1)
	maxYandexVisits?: number

	@IsOptional()
	@IsInt()
	@Min(1)
	maxGoogleVisits?: number

	@IsOptional()
	@IsBoolean()
	useYandex?: boolean

	@IsOptional()
	@IsBoolean()
	useGoogle?: boolean

	@IsOptional()
	@IsInt()
	@Min(1)
	pagesDepthFrom?: number

	@IsOptional()
	@IsInt()
	@Min(1)
	pagesDepthTo?: number

	@IsOptional()
	@IsInt()
	@Min(10)
	pageDurationFrom?: number

	@IsOptional()
	@IsInt()
	@Min(10)
	pageDurationTo?: number

	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@IsOptional()
	@IsUrl()
	@MaxLength(500)
	targetUrl?: string
}
