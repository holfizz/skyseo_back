import { PrismaService } from '../prisma/prisma.service'

// Общий построитель текстового трейса выполнения.
// Используется и админкой (GET /admin/executions/:id/trace), и кабинетом менеджера —
// формат вывода менять нельзя, на него завязан фронт админки.
export async function loadExecutionTrace(prisma: PrismaService, id: string) {
	const ex = await prisma.execution.findUnique({
		where: { id },
		select: {
			id: true, status: true, completionKind: true, failureReason: true,
			foundInTop: true, position: true,
			yandexFoundInTop: true, googleFoundInTop: true, yandexPosition: true, googlePosition: true,
			targetVisited: true, directNavigationUsed: true, pagesVisited: true, duration: true,
			createdAt: true, completedAt: true,
			task: { select: { keyword: true, useYandex: true, useGoogle: true, website: { select: { url: true } } } },
			executor: { select: { email: true, appVersion: true } },
			events: { select: { engine: true, type: true, stage: true, details: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
		},
	})
	if (!ex) return { text: 'Выполнение не найдено', execution: null }
	const hhmmss = (d: Date) => new Date(d).toLocaleTimeString('ru-RU', { hour12: false })
	const engines = [ex.task?.useYandex && 'yandex', ex.task?.useGoogle && 'google'].filter(Boolean).join('+') || '—'
	const L: string[] = []
	L.push(`ВЫПОЛНЕНИЕ ${ex.id}`)
	L.push(`сайт: ${ex.task?.website?.url ?? '—'}`)
	L.push(`запрос: "${ex.task?.keyword ?? '—'}" | движки: ${engines}`)
	L.push(`ПК: ${ex.executor?.email ?? '—'} · v${ex.executor?.appVersion ?? '?'}`)
	L.push(`старт: ${new Date(ex.createdAt).toLocaleString('ru-RU')} | длит: ${ex.duration ?? '—'}с`)
	L.push(`ИТОГ: ${ex.status} / ${ex.completionKind ?? '—'}${ex.failureReason ? ` (${ex.failureReason})` : ''}`)
	L.push(`Яндекс: ${ex.yandexFoundInTop ? 'найден, поз.' + (ex.yandexPosition ?? '?') : 'НЕ найден'} · Google: ${ex.googleFoundInTop ? 'найден, поз.' + (ex.googlePosition ?? '?') : 'НЕ найден'}`)
	L.push(`зашли на сайт: ${ex.targetVisited ? 'ДА' : 'НЕТ'}${ex.directNavigationUsed ? ' (прямой заход, не клик)' : ''} · страниц: ${ex.pagesVisited ?? 0}`)
	L.push(`—— шаги (${ex.events.length}) ——`)
	for (const e of ex.events) {
		const d = (e.details && typeof e.details === 'object' ? e.details : {}) as Record<string, unknown>
		let extra = ''
		if ('results' in d) extra = `результатов=${d.results}`
		else if ('parsed' in d) extra = `цель=${d.target} | спарсили: ${((d.parsed as string[]) || []).join(', ')}`
		else if ('url' in d) extra = String(d.url).replace(/^https?:\/\//, '').slice(0, 60)
		else if ('reason' in d) extra = String(d.reason)
		else if ('dom' in d) extra = 'dom=' + JSON.stringify(d.dom).slice(0, 120)
		L.push(`${hhmmss(e.createdAt)} [${e.engine ?? '-'}] ${e.stage}${extra ? ' — ' + extra : ''}`)
	}
	return { text: L.join('\n'), execution: ex }
}
