import { IsNumber, Max, Min } from 'class-validator'

export class CreatePaymentDto {
	@IsNumber()
	@Min(100)
	@Max(1_000_000)
	amount: number // Сумма в рублях

	// ВНИМАНИЕ: поля points здесь НЕТ намеренно.
	// Раньше клиент присылал и сумму, и количество баллов, а связь между ними не
	// проверялась нигде — можно было заплатить 100 ₽ и запросить сколько угодно баллов.
	// Теперь баллы считает сервер: см. POINTS_PER_RUBLE в payments.service.ts.
	// Старые клиенты могут продолжать слать points — ValidationPipe(whitelist: true)
	// отбросит поле молча, без ошибки.
}
