import {
	IsBoolean,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Min,
} from 'class-validator'

export class CreateTaskDto {
	@IsUUID()
	websiteId: string

	@IsEnum(['SEARCH_KEYWORD', 'EXTERNAL_LINK', 'SEARCH_AND_VISIT'])
	type: 'SEARCH_KEYWORD' | 'EXTERNAL_LINK' | 'SEARCH_AND_VISIT'

	@IsOptional()
	@IsString()
	keyword?: string

	@IsOptional()
	@IsString()
	externalUrl?: string

	@IsOptional()
	@IsString()
	geo?: string

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
}
