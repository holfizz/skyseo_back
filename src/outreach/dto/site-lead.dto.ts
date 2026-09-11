import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/** Заявка с формы на сайте: сайт обязателен, контакт — хотя бы один (проверка в сервисе). */
export class SiteLeadDto {
	@IsString()
	@MaxLength(300)
	site!: string

	@IsOptional()
	@IsString()
	@MaxLength(120)
	telegram?: string

	@IsOptional()
	@IsString()
	@MaxLength(40)
	phone?: string

	/** true = автосохранение: форму заполнили, но не нажали «Отправить». */
	@IsOptional()
	@IsBoolean()
	auto?: boolean
}
