#!/usr/bin/env node
const { validateTarget } = require('./bootstrap-operator.cjs')
async function main() {
 const target = validateTarget(process.env)
 if (!process.argv.includes('--apply')) throw new Error('Use --apply and provide email/passwordHash JSON through stdin')
 let input = ''
 for await (const chunk of process.stdin) { input += chunk; if (input.length > 4096) throw new Error('Input too long') }
 const data = JSON.parse(input)
 const email = String(data.email || '').trim().toLowerCase()
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\$2[aby]\$12\$[A-Za-z0-9./]{53}$/.test(data.passwordHash || '')) throw new Error('A valid email and bcrypt cost-12 password hash are required')
 const { PrismaClient } = require('@prisma/client')
 const db = new PrismaClient({ datasources: { db: { url: target.url } } })
 try {
  if (await db.user.count()) throw new Error('Refusing administrator provisioning in a database that already has users')
  const user = await db.user.create({ data: { email, password: data.passwordHash, role: 'ADMIN', roles: ['ADMIN'], balance: 0, emailVerified: true, weeklyReportEnabled: false }, select: { id: true, email: true, role: true, roles: true } })
  console.log(JSON.stringify(user))
 } finally { await db.$disconnect() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
