import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Put,
	Request,
	UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreateWebsiteDto, UpdateWebsiteDto } from './dto'
import { WebsitesService } from './websites.service'

@Controller('websites')
@UseGuards(JwtAuthGuard)
export class WebsitesController {
	constructor(private websitesService: WebsitesService) {}

	@Post()
	async create(@Request() req, @Body() dto: CreateWebsiteDto) {
		// Лимиты бесплатного тарифа применяем только к веб-версии; десктоп-приложение не трогаем
		const isApp = String(req.headers?.['user-agent'] || '').includes('SkySEO-Desktop')
		return this.websitesService.create(req.user.id, req.user.email, dto, isApp)
	}

	@Get()
	async findAll(@Request() req) {
		return this.websitesService.findAll(req.user.id)
	}

	@Get(':id')
	async findOne(@Request() req, @Param('id') id: string) {
		return this.websitesService.findOne(id, req.user.id)
	}

	@Put(':id')
	async update(
		@Request() req,
		@Param('id') id: string,
		@Body() dto: UpdateWebsiteDto,
	) {
		return this.websitesService.update(id, req.user.id, dto)
	}

	@Delete(':id')
	async delete(@Request() req, @Param('id') id: string) {
		return this.websitesService.delete(id, req.user.id)
	}

	@Post(':id/report-restricted')
	async reportRestricted(@Request() req, @Param('id') id: string, @Body() body: { message?: string; telegram?: string }) {
		return this.websitesService.reportRestricted(id, req.user.id, body?.message ?? '', body?.telegram ?? '')
	}
}
