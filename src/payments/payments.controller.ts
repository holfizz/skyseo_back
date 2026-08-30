import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreatePaymentDto } from './dto'
import { PaymentsService } from './payments.service'

@Controller('payments')
export class PaymentsController {
	constructor(private paymentsService: PaymentsService) {}

	// Самостоятельной покупки больше нет: тариф не выбирают кнопкой, стоимость
	// считается под проект, баллы начисляет менеджер. Роут не удалён, а закрыт
	// намеренно: у людей открыты старые вкладки кабинета, и они получат внятный
	// отказ, а не 404 с непонятной ошибкой.
	//
	// ВЕБХУК И ПОЛЛИНГ СТАТУСА НИЖЕ НЕ ТРОГАТЬ. По ним доезжают уже созданные
	// платежи: деньги списаны, баллы ещё не начислены. Оба берут сумму из строки
	// Payment, а не из тела запроса, поэтому закрытие создания на них не влияет.
	@Post()
	@UseGuards(JwtAuthGuard)
	async createPayment(@Request() req, @Body() dto: CreatePaymentDto) {
		throw new ForbiddenException(
			'Оплата на сайте отключена. Продвижение подключает менеджер: напишите в Telegram t.me/skyseo_support',
		)
	}

	@Get('history')
	@UseGuards(JwtAuthGuard)
	async getPaymentHistory(@Request() req) {
		return this.paymentsService.getPaymentHistory(req.user.id)
	}

	@Post('webhook')
	@HttpCode(200)
	async handleWebhook(@Body() body: any) {
		return this.paymentsService.handleYooKassaWebhook(body)
	}

	@Get(':id/status')
	@UseGuards(JwtAuthGuard)
	async getPaymentStatus(@Request() req, @Param('id') id: string) {
		return this.paymentsService.getPaymentStatus(id, req.user.id)
	}

	// Ссылка со скидкой 10% из письма о брошенной оплате. Закрыта вместе с покупкой:
	// вопреки названию она не повторяла старый платёж, а СОЗДАВАЛА новый, то есть
	// была вторым входом в самостоятельную оплату, да ещё и без авторизации.
	@Get('repeat/:token')
	async repeatWithDiscount(@Param('token') token: string) {
		throw new ForbiddenException(
			'Оплата на сайте отключена. Напишите менеджеру в Telegram t.me/skyseo_support, он подключит продвижение',
		)
	}
}
