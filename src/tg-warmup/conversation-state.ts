import { Prisma } from '@prisma/client'

export type ReplyState = 'NEEDS_REPLY' | 'NO_REPLY_NEEDED' | 'WAITING_CLIENT' | 'NONE'
type StateInput = {
	replyHandledThroughTgId?: number
	peerDeleted?: boolean
}

export function replyState(recipient: StateInput, last?: { tgId: number; out: boolean } | null): ReplyState {
	if (!last) return 'NONE'
	if (last.out) return 'WAITING_CLIENT'
	if (recipient.peerDeleted || last.tgId <= (recipient.replyHandledThroughTgId ?? 0)) return 'NO_REPLY_NEEDED'
	return 'NEEDS_REPLY'
}

/** Shared by the inbox counter/filter; unread status is deliberately irrelevant. */
export const waitingConversationsSql = Prisma.sql`
	SELECT r."id" FROM "tg_recipients" r
	JOIN LATERAL (
		SELECT m."tgId", m."out" FROM "tg_dialog_messages" m
		WHERE m."recipientId" = r."id" ORDER BY m."tgId" DESC LIMIT 1
	) last_message ON true
	WHERE last_message."out" = false
	  AND last_message."tgId" > r."replyHandledThroughTgId"
	  AND r."peerDeleted" = false
`
