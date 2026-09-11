import { Body, Controller, Post } from '@nestjs/common'
import { SiteLeadDto } from './dto/site-lead.dto'
import { SiteLeadService } from './site-lead.service'

/** Публичный (без авторизации) приём заявок с формы на сайте. */
@Controller('lead')
export class SiteLeadController {
	constructor(private readonly svc: SiteLeadService) {}

	@Post()
	create(@Body() dto: SiteLeadDto) {
		return this.svc.create(dto)
	}
}
