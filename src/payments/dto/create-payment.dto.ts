import { IsNumber, Min } from 'class-validator'

export class CreatePaymentDto {
	@IsNumber()
	@Min(100)
	amount: number // Сумма в рублях

	@IsNumber()
	@Min(100)
	points: number // Количество баллов
}
