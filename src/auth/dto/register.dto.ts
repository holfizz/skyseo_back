import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator'

export class RegisterDto {
	@IsEmail()
	email: string

	@IsString()
	@MinLength(6)
	password: string

	@IsOptional()
	@IsString()
	referralSource?: string

	@IsOptional()
	@IsString()
	referralCode?: string

	@IsOptional()
	@IsString()
	promoCode?: string

	@IsOptional()
	@IsString()
	marketingCode?: string // код SMM-поста (utm_campaign) из трекинг-ссылки

	@IsOptional()
	@IsString()
	city?: string

	@IsOptional()
	@IsString()
	appVersion?: string

	@IsOptional()
	@IsString()
	role?: string // frontend userType selection: marketer | seo | entrepreneur | startup

	@IsOptional()
	@IsString()
	telegram?: string // необязательный Telegram-контакт, указанный при регистрации
}
