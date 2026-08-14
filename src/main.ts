import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { json, urlencoded } from 'express'
import helmet from 'helmet'
import { AppModule } from './app.module'

async function bootstrap() {
	const app = await NestFactory.create(AppModule)

	// Дефолт express — 100 KB. import.json одного прогона парсера выдачи
	// весит 1-2 MB (весь топ-50 по каждому ключу + контакты), с дефолтом
	// загрузка падала бы с 413 ещё до контроллера.
	app.use(json({ limit: '20mb' }))
	app.use(urlencoded({ extended: true, limit: '20mb' }))

	// Trust proxy для получения реального IP через заголовки
	// Доверяем всем прокси в Docker сети (172.x.x.x) и локальным адресам
	app.getHttpAdapter().getInstance().set('trust proxy', [
		'loopback',
		'linklocal',
		'uniquelocal',
		'172.16.0.0/12', // Docker networks
		'10.0.0.0/8', // Private networks
		'192.168.0.0/16', // Private networks
		// Зеркало i.skyseo.site: доверяем его X-Forwarded-For, иначе все запросы
		// через него придут с одного адреса и упрутся в лимит регистраций по IP
		// (countRecentRegistrationsByIp), а registrationIp будет адресом зеркала.
		'109.107.173.48',
		'193.242.106.50', // прежнее зеркало, сервер больше не отвечает
	])

	app.use(helmet({
		crossOriginEmbedderPolicy: false,
		contentSecurityPolicy: false,
	}))

	// Global prefix
	app.setGlobalPrefix('v1/api')

	// CORS
	app.enableCors({
		origin: [
			'http://localhost:3000',
			'http://localhost:3001',
			'http://localhost:5173',
			'https://skyseo.site',
			'http://skyseo.site',
			'https://pro.skyseo.site',
			'https://go.skyseo.site',
			'https://crm.skyseo.site',
		],
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization'],
	})

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
		}),
	)

	const port = process.env.PORT || 3000
	await app.listen(port, '0.0.0.0')
	console.log(`🚀 Server running on http://localhost:${port}/v1/api`)
}

bootstrap().catch(err => {
	console.error('❌ Failed to start application:', err)
	process.exit(1)
})
