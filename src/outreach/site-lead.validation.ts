/** Syntax validation only: accepts public domain names, including internationalized domains. */
export function validateLeadSite(value: string): { domain: string; error: string } {
 const empty = (error: string) => ({ domain: '', error })
 const raw = value.trim()
 if (!raw) return empty('Введите адрес сайта')
 if (raw.length > 300 || /\s/.test(raw)) return empty('Введите адрес сайта без пробелов, например site.ru')
 try {
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return empty('Укажите обычный адрес сайта, например site.ru')
  const domain = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!domain.includes('.')) return empty('Пожалуйста, добавьте точку и доменную зону: например, site.ru')
  const labels = domain.split('.')
  if (domain.length > 253 || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels[labels.length - 1])) return empty('Проверьте адрес: после точки должна быть доменная зона, например .ru или .com')
  return { domain, error: '' }
 } catch { return empty('Проверьте адрес сайта, например site.ru') }
}

export function normalizeLeadTelegram(value: string): string | null {
 const username = value.trim().replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/\/$/, '')
 return /^[a-z][a-z0-9_]{3,31}$/i.test(username) ? `@${username}` : null
}
