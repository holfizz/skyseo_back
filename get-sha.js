#!/usr/bin/env node

/**
 * Простой интерактивный скрипт для получения SHA512
 * Просто запусти: node get-sha.js
 */

const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const http = require('http')
const { URL } = require('url')
const readline = require('readline')

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})

function question(query) {
	return new Promise(resolve => rl.question(query, resolve))
}

async function calculateSHA512FromStream(stream) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha512')
		let totalBytes = 0

		stream.on('data', data => {
			hash.update(data)
			totalBytes += data.length
			if (totalBytes % (5 * 1024 * 1024) < 65536) {
				process.stdout.write(
					`\r📥 Загружено: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
				)
			}
		})

		stream.on('end', () => {
			process.stdout.write(
				`\r📥 Загружено: ${(totalBytes / 1024 / 1024).toFixed(2)} MB\n`,
			)
			resolve({
				sha512: hash.digest('base64'),
				size: totalBytes,
			})
		})

		stream.on('error', reject)
	})
}

async function downloadAndHash(url) {
	return new Promise((resolve, reject) => {
		const parsedUrl = new URL(url)
		const client = parsedUrl.protocol === 'https:' ? https : http

		console.log(`🌐 Загрузка файла...`)
		console.log('')

		client
			.get(url, response => {
				if (response.statusCode === 302 || response.statusCode === 301) {
					const redirectUrl = response.headers.location
					console.log(`↪️  Редирект...`)
					downloadAndHash(redirectUrl).then(resolve).catch(reject)
					return
				}

				if (response.statusCode !== 200) {
					reject(
						new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`),
					)
					return
				}

				const contentLength = response.headers['content-length']
				if (contentLength) {
					console.log(
						`📦 Размер: ${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB`,
					)
					console.log('')
				}

				calculateSHA512FromStream(response).then(resolve).catch(reject)
			})
			.on('error', reject)
	})
}

async function hashLocalFile(filePath) {
	const stats = fs.statSync(filePath)
	console.log(`📦 Размер: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
	console.log('')

	const stream = fs.createReadStream(filePath)
	return calculateSHA512FromStream(stream)
}

async function main() {
	console.clear()
	console.log('━'.repeat(60))
	console.log('🔐 Получение SHA512 хеша')
	console.log('━'.repeat(60))
	console.log('')

	const input = await question('Вставь ссылку или путь к файлу: ')

	if (!input || input.trim() === '') {
		console.log('❌ Ничего не введено')
		rl.close()
		return
	}

	console.log('')
	console.log('⏳ Обработка...')
	console.log('')

	try {
		let result

		if (input.startsWith('http://') || input.startsWith('https://')) {
			result = await downloadAndHash(input)
		} else {
			if (!fs.existsSync(input)) {
				console.error(`❌ Файл не найден: ${input}`)
				rl.close()
				return
			}
			result = await hashLocalFile(input)
		}

		console.log('')
		console.log('━'.repeat(60))
		console.log('✅ Готово!')
		console.log('━'.repeat(60))
		console.log('')
		console.log('SHA512:')
		console.log(result.sha512)
		console.log('')
		console.log(
			`Размер: ${result.size} байт (${(result.size / 1024 / 1024).toFixed(2)} MB)`,
		)
		console.log('')
		console.log('━'.repeat(60))
		console.log('')
	} catch (error) {
		console.error('')
		console.error('❌ Ошибка:', error.message)
	}

	rl.close()
}

main()
