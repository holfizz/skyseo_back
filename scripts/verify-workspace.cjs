const {PrismaClient}=require('@prisma/client')
const {JwtService}=require('@nestjs/jwt')
const assert=require('node:assert/strict')
const db=new PrismaClient()
;(async()=>{
 const admin=await db.user.findFirst({where:{isActive:true,OR:[{role:'ADMIN'},{roles:{has:'ADMIN'}}]},select:{id:true}})
 assert.ok(admin,'An active administrator is required')
 const token=new JwtService({secret:process.env.JWT_SECRET}).sign({sub:admin.id},{expiresIn:'2m'})
 const origin='http://127.0.0.1:4000/v1/api'
 for(const path of ['/health','/admin/workspace/dashboard','/admin/workspace/settings','/admin/workspace/clients','/admin/staff','/admin/warmup/accounts','/admin/tg-outreach','/admin/tg-outreach/today']) {
  const start=Date.now();const r=await fetch(origin+path,{headers:{Authorization:`Bearer ${token}`}})
  assert.equal(r.status,200,`${path}: ${r.status}`);await r.json();console.log(`PASS ${path}: 200 (${Date.now()-start}ms)`)
 }
 assert.equal((await fetch(origin+'/admin/workspace/clients')).status,401)
 for(const path of ['/tasks','/executions','/auth/register','/admin/sites','/admin/users','/updates/latest','/websites','/payments']) assert.equal((await fetch(origin+path)).status,410,path)
 console.log('PASS authenticated workspace APIs, anonymous access denied, legacy APIs retired')
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect())
