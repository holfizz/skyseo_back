import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
;(async () => {
	for (const e of await prisma.tgAccountEvent.findMany({ where: { kind: { startsWith: 'spam' } }, orderBy: { createdAt: 'asc' }, include: { account: { select: { label: true, probe: true } } } })) {
		console.log(`[${e.createdAt.toLocaleTimeString('ru-RU')}] ${e.account.label} · ${e.kind}`)
		console.log(e.text.split('\n').map(l => '   ' + l).join('\n'))
		console.log()
	}
	const a = await prisma.tgAccount.findFirst({ where: { label: 'Ns Sb' }, select: { probe: true } })
	console.log('статус в анкете:', (a?.probe as any)?.spamBlock)
	await prisma.$disconnect()
})()
