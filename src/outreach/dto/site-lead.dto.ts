import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/** Заявка с формы на сайте: сайт обязателен, Telegram обязателен. */
export class SiteLeadDto {
	@IsString()
	@MaxLength(300)
	site!: string

	@IsString()
	@MaxLength(120)
	telegram!: string

	/** true = автосохранение: форму заполнили, но не нажали «Отправить». */
	@IsOptional()
	@IsBoolean()
	auto?: boolean
}
