import { PrismaClient } from '@prisma/client'
import * as jwt from 'jsonwebtoken'
const prisma = new PrismaClient()
;(async () => {
	const u = await prisma.user.findFirst({ where: { OR: [{ role: 'ADMIN' }, { roles: { has: 'ADMIN' } }], isActive: true }, select: { id: true, email: true } })
	process.stdout.write(jwt.sign({ sub: u!.id, email: u!.email }, process.env.JWT_SECRET!, { expiresIn: '2h' }))
	await prisma.$disconnect()
})()
