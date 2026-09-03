import { request, type Agent } from 'http'

// Через require, а не import: у пакета только карта exports, а проект собирается
// со старым разрешением модулей (moduleResolution: node), которое её не читает.
// В рантайме require карту понимает, так что достаточно описать нужный кусок типа.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SocksProxyAgent } = require('socks-proxy-agent') as {
	SocksProxyAgent: new (uri: string) => Agent
}

/**
 * Кто прячется за прокси: страна выхода и тип канала.
 *
 * Раньше и то и другое вводили руками, и это было и лишней работой, и
 * источником вранья: человек отмечает «мобильный», потому что так написано у
 * продавца, а на деле там дата-центр. Оценка аккаунта опирается на тип канала
 * сильнее, чем на что-либо ещё в блоке «Сеть», так что цена ошибки высокая.
 *
 * Запрос идёт ЧЕРЕЗ САМ ПРОКСИ, а не по его адресу. Это принципиально: у
 * мобильных прокси адрес входа и адрес выхода — разные машины, и география
 * важна именно у выхода, потому что её видит Telegram.
 *
 * ip-api.com: без ключа, отдаёт признаки mobile и hosting, ограничение
 * 45 запросов в минуту с одного адреса. Запросы идут через разные прокси,
 * поэтому в лимит упирается только их собственный источник, не наш сервер.
 */

export type ProxyOrigin = {
	/** Адрес, который видит внешний мир. */
	ip: string | null
	/** ISO-код страны выхода. */
	geo: string | null
	/** mobile — сотовый оператор, datacenter — хостинг, residential — всё прочее. */
	type: 'mobile' | 'residential' | 'datacenter' | null
	/** Кто владелец адреса: полезно, когда тип определился неожиданно. */
	isp: string | null
}

const EMPTY: ProxyOrigin = { ip: null, geo: null, type: null, isp: null }

const FIELDS = 'status,message,countryCode,mobile,proxy,hosting,isp,query'

export type ProxyDialInfo = {
	host: string
	port: number
	username?: string | null
	password?: string | null
	kind: string
}

/**
 * Определить происхождение выхода. Никогда не бросает: не удалось — вернули
 * пустое. Живость прокси проверяется отдельно, коннектом к дата-центру
 * Telegram, и от того, ответил ли справочник, не зависит.
 */
export function detectOrigin(proxy: ProxyDialInfo, timeoutMs = 12_000): Promise<ProxyOrigin> {
	const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@` : ''
	const scheme = proxy.kind === 'socks4' ? 'socks4' : 'socks5'
	let agent: Agent
	try {
		agent = new SocksProxyAgent(`${scheme}://${auth}${proxy.host}:${proxy.port}`)
	} catch {
		return Promise.resolve(EMPTY)
	}

	return new Promise<ProxyOrigin>(resolve => {
		let done = false
		const finish = (value: ProxyOrigin) => {
			if (done) return
			done = true
			clearTimeout(timer)
			resolve(value)
		}
		const timer = setTimeout(() => {
			req.destroy()
			finish(EMPTY)
		}, timeoutMs)

		const req = request(
			{ host: 'ip-api.com', path: `/json/?fields=${FIELDS}`, agent, timeout: timeoutMs },
			res => {
				const chunks: Buffer[] = []
				res.on('data', c => chunks.push(c))
				res.on('end', () => {
					try {
						const d = JSON.parse(Buffer.concat(chunks).toString('utf8'))
						if (d?.status !== 'success') return finish(EMPTY)
						finish({
							ip: d.query ?? null,
							geo: d.countryCode ?? null,
							// Порядок важен: сотовый оператор бывает размечен и как
							// прокси, но для нас он в первую очередь мобильный.
							type: d.mobile ? 'mobile' : d.hosting ? 'datacenter' : 'residential',
							isp: d.isp ?? null,
						})
					} catch {
						finish(EMPTY)
					}
				})
			},
		)
		req.on('error', () => finish(EMPTY))
		req.on('timeout', () => {
			req.destroy()
			finish(EMPTY)
		})
		req.end()
	})
}
