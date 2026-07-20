// Создать (или повысить существующего) менеджера для входа в /manager.
// Запуск из папки skyseo_back:  node scripts/create-manager.js <email> <password>
// Для существующего email — просто ставит роль MANAGER (пароль не меняет).
const fs = require('fs')
const path = require('path')

const BACK = path.resolve(__dirname, '..')
const env = fs.readFileSync(path.join(BACK, '.env'), 'utf8')
const m = env.match(/DATABASE_URL="?([^"\n]+)"?/)
if (m) process.env.DATABASE_URL = m[1]

const { PrismaClient } = require(path.join(BACK, 'node_modules/@prisma/client'))
const bcrypt = require(path.join(BACK, 'node_modules/bcrypt'))
const prisma = new PrismaClient()

async function main() {
	const [email, password] = process.argv.slice(2)
	if (!email || !password) {
		console.error('Usage: node scripts/create-manager.js <email> <password>')
		process.exit(1)
	}
	const hashed = await bcrypt.hash(password, 8)
	const user = await prisma.user.upsert({
		where: { email },
		update: { role: 'MANAGER', isActive: true },
		create: { email, password: hashed, role: 'MANAGER', isActive: true, emailVerified: true },
	})
	console.log(`Аккаунт менеджера готов: ${user.email} (role=${user.role}). Вход: /manager/login`)
}
main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
