#!/usr/bin/env node
// Explicit bootstrap of a NEW isolated database. Never reads a local .env file.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

function validateTarget(env) {
 const raw = env.DATABASE_URL
 if (!raw || !env.SKYSEO_BOOTSTRAP_DATABASE) throw new Error('Set DATABASE_URL and SKYSEO_BOOTSTRAP_DATABASE explicitly')
 const url = new URL(raw)
 const database = decodeURIComponent(url.pathname.slice(1))
 if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)
  || (url.port && url.port !== '5432') || !/^skyseo_operator_\d{8}$/.test(database)
  || database !== env.SKYSEO_BOOTSTRAP_DATABASE || url.searchParams.get('schema') && url.searchParams.get('schema') !== 'public') {
  throw new Error('Refusing database bootstrap: target must be the explicitly named, local skyseo_operator_YYYYMMDD database')
 }
 return { url: raw, database }
}

async function main() {
 if (!process.argv.includes('--apply')) throw new Error('Use --apply for this explicitly authorized new-database bootstrap')
 const target = validateTarget(process.env)
 const root = path.resolve(__dirname, '../..')
 const schema = path.join(root, 'prisma/schema.prisma')
 const sqlPath = path.join(root, 'prisma/bootstrap/20261109_operator.sql')
 const manifest = JSON.parse(fs.readFileSync(path.join(root, 'prisma/bootstrap/20261109_operator.json')))
 const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
 if (hash(schema) !== manifest.schemaSha256 || hash(sqlPath) !== manifest.sqlSha256) throw new Error('Bootstrap schema has changed; generate and review a new baseline first')
 for (const [name, expected] of Object.entries(manifest.migrations)) {
  if (hash(path.join(root, 'prisma/migrations', name, 'migration.sql')) !== expected) throw new Error('Historical migration changed: ' + name)
 }
 const { PrismaClient } = require('@prisma/client')
 const db = new PrismaClient({ datasources: { db: { url: target.url } } })
 const cli = path.join(root, 'node_modules/prisma/build/index.js')
 function run(args, input) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, DATABASE_URL: target.url }, input, encoding: 'utf8', timeout: 120000 })
  if (result.error || result.status !== 0) {
   const message = String(result.error?.message || result.stderr || result.stdout || 'Prisma command failed').split(target.url).join('[database]')
   throw new Error(message)
  }
 }
 try {
  const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
  const userTables = tables.filter(row => row.tablename !== '_prisma_migrations')
  if (userTables.length && !process.argv.includes('--resume')) throw new Error('Database is not empty; refusing to replace existing tables')
  if (!userTables.length) {
   run(['db', 'execute', '--schema', schema, '--stdin'], 'BEGIN;\n' + fs.readFileSync(sqlPath, 'utf8') + '\nCOMMIT;\n')
  } else {
   for (const row of userTables) {
    const name = row.tablename.replace(/"/g, '""')
    const result = await db.$queryRawUnsafe(`SELECT EXISTS (SELECT 1 FROM public."${name}" LIMIT 1) AS populated`)
    if (result[0].populated) throw new Error('Resume is only permitted before any application data has been created')
   }
  }
  run(['migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', schema, '--exit-code'])
  const known = tables.some(row => row.tablename === '_prisma_migrations')
   ? await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL') : []
  const applied = new Set(known.map(row => row.migration_name))
  let marked = 0
  for (const name of Object.keys(manifest.migrations)) {
   if (applied.has(name)) continue
   run(['migrate', 'resolve', '--schema', schema, '--applied', name])
   marked++
   if (marked % 25 === 0) console.log('Historical migrations baselined:', marked)
  }
  run(['migrate', 'deploy', '--schema', schema])
  console.log('New operator database is ready; baseline migrations:', Object.keys(manifest.migrations).length)
 } finally { await db.$disconnect() }
}
module.exports = { validateTarget }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
