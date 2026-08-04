import { Module } from '@nestjs/common'
import { TelegramModule } from '../telegram/telegram.module'
import { ManagerService } from './manager.service'

/**
 * Кабинет менеджера (/manager) удалён — его работа переехала в CRM.
 *
 * Сам ManagerService остался и активно используется:
 *   • CrmService — карточка клиента платформы, тренд, логи, заметки, «кого дожать»;
 *   • AdminService — те же данные в админке владельца.
 * HTTP-слоя (контроллер и гвард) у модуля больше нет, только провайдер.
 *
 * Опасные операции менеджера — проведение платежей и удаление сайтов/ключей —
 * в CRM намеренно НЕ переносились: они необратимы и касаются денег,
 * поэтому остаются у владельца в админке.
 */
@Module({
	imports: [TelegramModule.forRoot()],
	providers: [ManagerService],
	exports: [ManagerService],
})
export class ManagerModule {}
