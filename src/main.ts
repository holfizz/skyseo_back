import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
	const app = await NestFactory.create(AppModule)

	// Global prefix
	app.setGlobalPrefix('v1/api')

	// CORS
	app.enableCors({
		origin: [
			'http://localhost:3001',
			'http://localhost:5173',
			'https://skyseo.site',
			'http://skyseo.site',
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

bootstrap()
