import type { Request, Response, NextFunction } from 'express'
/** Closed by default: importing a legacy module cannot reopen the retired product. */
export function retiredProductGate(req: Request, res: Response, next: NextFunction) {
 const path = req.path.replace(/\/+$/, '')
 const allowed = /^\/v1\/api\/(health|auth\/(login|forgot-password|reset-password)|users\/profile)$/.test(path)
  || /^\/v1\/api\/admin\/(workspace|warmup|tg-outreach|staff)(\/|$)/.test(path)
  || /^\/v1\/api\/manager\/outreach(\/|$)/.test(path)
  || /^\/v1\/api\/workspace\/crm(\/|$)/.test(path)
 if (req.method === 'OPTIONS' || (req.method === 'POST' && path === '/v1/api/lead') || allowed) return next()
 return res.status(410).json({ message: 'Старое приложение SkySEO отключено', code: 'PRODUCT_RETIRED' })
}
