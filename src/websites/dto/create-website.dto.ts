import { IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator'

export class CreateWebsiteDto {
	@IsString()
	name: string

	@IsUrl()
	url: string

	@IsOptional()
	@IsString()
	city?: string

	@IsOptional()
	@IsInt()
	@Min(3)
	@Max(500)
	dailyVisitsTarget?: number
}
