/** Telegram explicitly rejected this recipient; changing sender cannot fix it. */
export function recipientRejection(message: string): string | null {
    if (/ALLOW_PAYMENT_REQUIRED(?:_\d+)?/.test(message)) return 'Контакт принимает только платные сообщения. Отправка отменена';
    if (/PRIVACY_PREMIUM_REQUIRED|PREMIUM_ACCOUNT_REQUIRED/.test(message)) return 'Telegram требует Premium для этого контакта. Отправка отменена';
    if (/USERNAME_NOT_OCCUPIED|Could not find the input entity|No user has|контакт не найден/i.test(message)) return 'Контакт не найден в Telegram';
    return null;
}

export function confirmedDelivery(r: { sentAt?: Date | null; deliveryUnknown?: boolean; error?: string | null }): boolean {
    return !!r.sentAt && !r.deliveryUnknown && !recipientRejection(r.error ?? '');
}

export function deliveryReason(error: string | null | undefined): string | null {
    if (!error) return null;
    return recipientRejection(error)
        ?? (/ECONNREFUSED|ECONNRESET|socks|proxy|EHOSTUNREACH|ENETUNREACH/i.test(error) ? 'Не удалось подключиться через прокси' : error);
}

/** Only connection failures proven to have happened before send may move sender. */
export function safeConnectionFallback(attempted: boolean, kind: string): boolean {
    return !attempted && ['proxy', 'timeout'].includes(kind);
}
