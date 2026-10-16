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

/** Only documented pre-send failures may be imported again; FAILED alone proves nothing. */
export function reusableUnsentRecipient(r: {
    status: string; sentAt?: Date | null; sentMsgId?: number | null; accountId?: string | null;
    deliveryUnknown?: boolean; readAt?: Date | null; repliedAt?: Date | null;
    secondSentAt?: Date | null; blockedAt?: Date | null; outcome?: string | null;
    error?: string | null; campaign: { status: string }; _count: { messages: number };
}): boolean {
    if (r.sentAt || r.sentMsgId != null || r.accountId || r.deliveryUnknown || r.readAt || r.repliedAt
        || r.secondSentAt || r.blockedAt || r.outcome || r._count.messages !== 0) return false;
    if (r.status === 'QUEUED') return r.campaign.status === 'DONE' && !r.error;
    return r.status === 'FAILED' && (/^не хватает данных для текста: /.test(r.error ?? '')
        || r.error === 'ссылка или домен в тексте: отправка отменена');
}
