import { domainToUnicode } from 'node:url'

/**
 * Домен для текста человеку.
 *
 * Кириллические сайты хранятся в punycode («xn--80aswg.xn--p1ai»), и в
 * сообщении это превращается в кашу. Человеку пишем так, как он привык видеть:
 * «сайт.рф».
 */
export function displayDomain(domain?: string | null): string {
	const clean = String(domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
	if (!clean) return ''
	try {
		return domainToUnicode(clean) || clean
	} catch {
		return clean
	}
}

/** Узнаваемое имя основного домена без зоны: shop.example.co.uk → example. */
export function domainName(domain?: string | null): string {
	const clean = displayDomain(domain).replace(/\.$/, '')
	const labels = clean.split('.').filter(Boolean)
	if (labels.length < 2) return clean
	const last = labels.length - 1
	const doubleSuffix = labels.length >= 3 && labels[last].length === 2
		&& ['co', 'com', 'net', 'org'].includes(labels[last - 1])
	return labels[last - (doubleSuffix ? 2 : 1)]
}

/** Даже домен без протокола Telegram превращает в кликабельную ссылку. */
export function containsDomainOrUrl(text: string): boolean {
	return /https?:\/\/|www\.|(?:^|[^\p{L}\p{N}_])(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,24}(?=$|[^\p{L}\p{N}_])/iu.test(text)
}

/**
 * Сайты, известные всей стране. Показывать их лиду как «конкурента» нельзя:
 * Авито не конкурирует с фабрикой шкафов, и письмо сразу выглядит рассылкой.
 * Сайты, известные только в своей нише, сюда не входят: они и есть конкуренты.
 * Совпадение по домену и по любому его поддомену (uslugi.yandex.ru).
 */
const HUGE_SITES = [
	'avito.ru', 'youla.ru', 'cian.ru', 'domclick.ru', 'drom.ru', 'auto.ru',
	'yandex.ru', 'yandex.com', 'ya.ru', 'dzen.ru', 'kinopoisk.ru', 'mail.ru', 'rambler.ru', 'google.com',
	'2gis.ru', 'profi.ru', 'hh.ru', 'gosuslugi.ru',
	'ozon.ru', 'wildberries.ru', 'sbermegamarket.ru', 'megamarket.ru', 'aliexpress.ru', 'aliexpress.com', 'lamoda.ru',
	'lemanapro.ru', 'leroymerlin.ru', 'petrovich.ru', 'obi.ru', 'castorama.ru', 'ikea.com', 'hoff.ru',
	'mvideo.ru', 'eldorado.ru', 'dns-shop.ru', 'citilink.ru',
	'vk.com', 'ok.ru', 'youtube.com', 'rutube.ru', 'wikipedia.org', 'habr.com', 'vc.ru', 'pikabu.ru',
	'sber.ru', 'sberbank.ru', 'tinkoff.ru', 'tbank.ru',
	'zoon.ru', 'flamp.ru', 'yell.ru', 'otzovik.com', 'irecommend.ru',
]

export function isHugeSite(domain?: string | null): boolean {
	const d = displayDomain(domain)
	return !!d && HUGE_SITES.some(h => d === h || d.endsWith(`.${h}`))
}
