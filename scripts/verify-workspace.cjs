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
 const hypotheses=await fetch(origin+'/admin/tg-outreach/hypotheses',{headers:{Authorization:`Bearer ${token}`}})
 assert.equal(hypotheses.status,200)
 const global=await hypotheses.json()
 assert.equal(typeof global.enabled,'boolean');assert.ok(Array.isArray(global.variants))
 for(const v of global.variants) {
  assert.equal(typeof v.enabled,'boolean')
  assert.ok(v.interested>=0 && v.interested<=v.sent,'Interest must belong to the sent cohort')
  assert.ok(v.interestRate>=0 && v.interestRate<=100,'Conversion must be a percentage')
 }
 console.log('PASS global hypotheses: enabled flags and conversion statistics')
 // This endpoint only formats sample text; it writes nothing and sends no messages.
 const preview=await fetch(origin+'/admin/tg-outreach/hypotheses/preview',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({text:'Здравствуйте, {фио}, {сайт}',hasSecondMessage:true,secondMessage:'Компания: {компания}'})})
 assert.equal(preview.status,201)
 const rendered=await preview.json()
 assert.equal(rendered.first,'Здравствуйте, Иван Петрович, example')
 assert.equal(rendered.second,'Компания: ООО «Пример»')
 console.log('PASS hypothesis preview: exact server personalization, no sending or storage')
 assert.equal((await fetch(origin+'/admin/workspace/clients')).status,401)
 for(const path of ['/tasks','/executions','/auth/register','/admin/sites','/admin/users','/updates/latest','/websites','/payments']) assert.equal((await fetch(origin+path)).status,410,path)
 console.log('PASS authenticated workspace APIs, anonymous access denied, legacy APIs retired')
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect())
