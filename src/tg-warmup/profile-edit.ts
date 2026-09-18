import { Api, type TelegramClient } from 'teleproto'
import { CustomFile } from 'teleproto/client/uploads'
import { call, classifyError, TgError } from './tg-client'

/**
 * Профиль аккаунта в Telegram: имя, фамилия, «о себе», юзернейм, день рождения, фото.
 *
 * Правка идёт по шагам, и каждый шаг отчитывается сам: юзернейм может оказаться
 * занят, а имя при этом сменится — и человек должен видеть ровно это, а не общее
 * «не получилось». Шаг с ошибкой соединения/аккаунта (бан, разлогин, прокси)
 * прерывает всё — дальше пытаться бессмысленно, и это уже ошибка аккаунта.
 */

export type Birthday = { day: number; month: number; year?: number | null }

export type ProfileNow = {
	firstName: string
	lastName: string
	about: string
	username: string
	birthday: Birthday | null
}

export type ProfilePatch = {
	firstName?: string
	lastName?: string
	about?: string
	/** Пустая строка — убрать юзернейм. */
	username?: string
	/** null — убрать день рождения. */
	birthday?: Birthday | null
	photo?: { buffer: Buffer; name: string }
	removePhoto?: boolean
}

export type ProfileStep = { step: string; ok: boolean; message?: string }

export async function readProfile(client: TelegramClient): Promise<ProfileNow> {
	const me: any = await call(client, 'getMe', () => client.getMe())
	const full: any = await call(client, 'getFullUser', () =>
		client.invoke(new Api.users.GetFullUser({ id: new Api.InputUserSelf() })),
	)
	const b = full?.fullUser?.birthday
	return {
		firstName: me?.firstName ?? '',
		lastName: me?.lastName ?? '',
		about: full?.fullUser?.about ?? '',
		username: me?.username ?? '',
		birthday: b ? { day: b.day, month: b.month, year: b.year ?? null } : null,
	}
}

/** Понятный текст для типовых отказов Telegram при правке профиля. */
function explain(message: string, seconds?: number): string {
	const m = message.toUpperCase()
	if (seconds) return `Telegram просит подождать ${seconds} с — слишком частые изменения`
	if (m.includes('USERNAME_OCCUPIED')) return 'Этот юзернейм уже занят'
	if (m.includes('USERNAME_PURCHASE_AVAILABLE')) return 'Юзернейм занят: продаётся на Fragment'
	if (m.includes('USERNAME_INVALID')) return 'Недопустимый юзернейм: 5–32 символа, латиница, цифры и _, начинается с буквы'
	if (m.includes('FIRSTNAME_INVALID')) return 'Недопустимое имя'
	if (m.includes('ABOUT_TOO_LONG')) return 'Описание слишком длинное (без Premium — до 70 символов)'
	if (m.includes('BIRTHDAY_INVALID')) return 'Недопустимая дата рождения'
	if (m.includes('PHOTO_CROP_SIZE_SMALL')) return 'Фото слишком маленькое — нужно хотя бы 160×160'
	if (m.includes('IMAGE_PROCESS_FAILED') || m.includes('PHOTO_INVALID')) return 'Telegram не смог обработать картинку — попробуйте JPG'
	if (m.includes('PREMIUM_ACCOUNT_REQUIRED')) return 'Нужен Telegram Premium'
	return message
}

/** Шаг правки: успех, понятный отказ или обрыв всей операции. */
async function step(steps: ProfileStep[], name: string, fn: () => Promise<unknown>) {
	try {
		await fn()
		steps.push({ step: name, ok: true })
	} catch (e: any) {
		const failure = e instanceof TgError ? e.failure : classifyError(e)
		if (/NOT_MODIFIED/i.test(failure.message)) {
			steps.push({ step: name, ok: true })
			return
		}
		// Аккаунт или соединение сломались — продолжать нечего.
		if (['banned', 'unauthorized', 'frozen', 'proxy', 'timeout'].includes(failure.kind)) throw new TgError(failure)
		steps.push({ step: name, ok: false, message: explain(failure.message, failure.seconds) })
	}
}

export async function applyProfile(client: TelegramClient, patch: ProfilePatch): Promise<ProfileStep[]> {
	const steps: ProfileStep[] = []

	if (patch.firstName !== undefined || patch.lastName !== undefined || patch.about !== undefined) {
		await step(steps, 'Имя и описание', () =>
			call(client, 'updateProfile', () =>
				client.invoke(
					new Api.account.UpdateProfile({
						...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
						...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
						...(patch.about !== undefined ? { about: patch.about } : {}),
					}),
				),
			),
		)
	}

	if (patch.username !== undefined) {
		await step(steps, 'Юзернейм', () =>
			call(client, 'updateUsername', () =>
				client.invoke(new Api.account.UpdateUsername({ username: patch.username! })),
			),
		)
	}

	if (patch.birthday !== undefined) {
		const b = patch.birthday
		await step(steps, 'День рождения', () =>
			call(client, 'updateBirthday', () =>
				client.invoke(
					new Api.account.UpdateBirthday(
						b ? { birthday: new Api.Birthday({ day: b.day, month: b.month, ...(b.year ? { year: b.year } : {}) }) } : {},
					),
				),
			),
		)
	}

	if (patch.removePhoto) {
		await step(steps, 'Удаление фото', async () => {
			const res: any = await call(client, 'getUserPhotos', () =>
				client.invoke(new Api.photos.GetUserPhotos({ userId: new Api.InputUserSelf(), offset: 0, limit: 1 })),
			)
			const photo = res?.photos?.[0]
			if (!photo) return
			await call(client, 'deletePhotos', () =>
				client.invoke(
					new Api.photos.DeletePhotos({
						id: [new Api.InputPhoto({ id: photo.id, accessHash: photo.accessHash, fileReference: photo.fileReference })],
					}),
				),
			)
		})
	}

	if (patch.photo) {
		const { buffer, name } = patch.photo
		await step(steps, 'Фото', async () => {
			const file = await call(client, 'uploadFile', () =>
				client.uploadFile({ file: new CustomFile(name, buffer.length, '', buffer), workers: 1 }),
			)
			await call(client, 'uploadProfilePhoto', () =>
				client.invoke(new Api.photos.UploadProfilePhoto({ file })),
			)
		})
	}

	return steps
}
