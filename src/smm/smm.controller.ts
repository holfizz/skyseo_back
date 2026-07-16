import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { SmmGuard } from './smm.guard'
import { SmmService } from './smm.service'

@Controller('smm')
@UseGuards(JwtAuthGuard, SmmGuard)
export class SmmController {
	constructor(private smm: SmmService) {}

	@Get('posts')
	list() {
		return this.smm.listPosts()
	}

	@Post('posts')
	create(
		@Body()
		body: { title: string; tgUrl?: string; tgText?: string; destination?: string },
	) {
		return this.smm.createPost(body)
	}

	// Переименовать и/или привязать ссылку на пост в ТГ после публикации.
	@Patch('posts/:id')
	update(@Param('id') id: string, @Body() body: { title?: string; tgUrl?: string }) {
		return this.smm.updatePost(id, body)
	}

	@Delete('posts/:id')
	remove(@Param('id') id: string) {
		return this.smm.deletePost(id)
	}
}
