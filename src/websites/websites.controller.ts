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
		return this.websitesService.create(req.user.id, dto)
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
}
