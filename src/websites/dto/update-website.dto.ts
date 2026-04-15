import { IsBoolean, IsOptional, IsUrl } from 'class-validator'

export class UpdateWebsiteDto {
	@IsOptional()
	@IsUrl()
	url?: string

	@IsOptional()
	@IsBoolean()
	isActive?: boolean
}
