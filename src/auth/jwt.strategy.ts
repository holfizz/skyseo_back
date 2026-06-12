import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { UsersService } from '../users/users.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
	constructor(
		private configService: ConfigService,
		private usersService: UsersService,
	) {
		super({
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			secretOrKey: configService.get('JWT_SECRET'),
		})
	}

	async validate(payload: any) {
		let user: any
		try {
			user = await this.usersService.findById(payload.sub)
		} catch (err) {
			// Ошибка БД при поиске юзера не должна выглядеть как 401 (Passport
			// конвертирует любое исключение из validate() в UnauthorizedException).
			// Бросаем 500 — клиент увидит transient error, а не ложный "токен истёк".
			console.error('[JwtStrategy] DB error during user lookup:', (err as any)?.message)
			throw new InternalServerErrorException('Auth validation failed')
		}
		if (!user || !user.isActive) {
			throw new UnauthorizedException()
		}
		return user
	}
}
