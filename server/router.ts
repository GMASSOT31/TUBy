// Aiguillage de /api/*. Chaque route vérifie la session avant toute lecture ou écriture.
import { normalizeCode, normalizePrenom } from '../shared/tube'
import * as admin from './admin'
import { clearFails, createAdminSession, createStudentSession, endAdminSession, endStudentSession, getStudent, isAdmin, lockedFor, recordFail, verifyCode, verifyPassword, type Env } from './auth'
import { body, HttpError, int, json, str } from './http'
import * as student from './student'

const tooMany = (wait: number) => new HttpError(429, `Trop d’essais. Réessaie dans ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`)

async function studentLogin(env: Env, request: Request): Promise<Response> {
  const data = await body(request)
  const key = normalizePrenom(str(data.prenom, 60))
  const code = normalizeCode(str(data.code, 20))
  if (!key || !code) throw new HttpError(400, 'Écris ton prénom et ton code.')
  const lockKey = `s:${key}`
  const { wait, row } = await lockedFor(env, lockKey)
  if (wait) throw tooMany(wait)
  const { results } = await env.DB.prepare('SELECT id, prenom, code_hash FROM students WHERE prenom_key = ? AND archived = 0').bind(key).all<{ id: number; prenom: string; code_hash: string }>()
  let found: { id: number; prenom: string } | null = null
  for (const s of results.length ? results : [{ id: 0, prenom: '', code_hash: 'x$x' }]) {
    if (await verifyCode(env, code, s.code_hash) && s.id) found = s
  }
  if (!found) {
    const left = await recordFail(env, lockKey, row)
    throw left ? new HttpError(401, 'Prénom ou code incorrect.') : tooMany(600)
  }
  await clearFails(env, lockKey, row)
  return json({ ok: true, prenom: found.prenom }, 200, { 'Set-Cookie': await createStudentSession(env, found.id) })
}

async function adminLogin(env: Env, request: Request): Promise<Response> {
  const data = await body(request)
  const lockKey = `a:${request.headers.get('CF-Connecting-IP') || 'local'}`
  const { wait, row } = await lockedFor(env, lockKey)
  if (wait) throw tooMany(wait)
  if (!env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) throw new HttpError(500, 'Les secrets ADMIN_PASSWORD_HASH et SESSION_SECRET ne sont pas configurés.')
  if (!(await verifyPassword(str(data.password, 200), env.ADMIN_PASSWORD_HASH))) {
    const left = await recordFail(env, lockKey, row)
    throw left ? new HttpError(401, 'Mot de passe incorrect.') : tooMany(600)
  }
  await clearFails(env, lockKey, row)
  return json({ ok: true }, 200, { 'Set-Cookie': await createAdminSession(env) })
}

async function adminRoutes(env: Env, method: string, p: string[], request: Request): Promise<unknown> {
  const data = method === 'GET' || method === 'DELETE' ? {} : await body(request)
  const route = `${method} ${p.map((s) => (/^\d+$/.test(s) ? ':id' : s)).join('/')}`
  const id = () => int(p.find((s) => /^\d+$/.test(s)))
  switch (route) {
    case 'GET overview': return admin.overview(env)
    case 'POST students': return admin.createStudent(env, data)
    case 'PATCH students/:id': return admin.updateStudent(env, id(), data)
    case 'POST students/:id/code': return admin.regenerateCode(env, id())
    case 'POST guides': return admin.createGuide(env, data)
    case 'GET guides/:id': return admin.getGuide(env, id())
    case 'PATCH guides/:id': return admin.updateGuide(env, id(), data)
    case 'DELETE guides/:id': return admin.deleteGuide(env, id())
    case 'POST guides/:id/duplicate': return admin.duplicateGuide(env, id())
    case 'POST guides/:id/chapters': return admin.createChapter(env, id(), data)
    case 'POST guides/:id/order': return admin.orderChapters(env, id(), data)
    case 'PATCH chapters/:id': return admin.updateChapter(env, id(), data)
    case 'DELETE chapters/:id': return admin.deleteChapter(env, id())
    case 'POST chapters/:id/steps': return admin.createStep(env, id(), data)
    case 'POST chapters/:id/order': return admin.orderSteps(env, id(), data)
    case 'PATCH steps/:id': return admin.updateStep(env, id(), data)
    case 'DELETE steps/:id': return admin.deleteStep(env, id())
    case 'POST assignments': return admin.assign(env, data)
    case 'DELETE assignments/:id': return admin.unassign(env, id())
    case 'POST assignments/:id/reset': return admin.resetAssignment(env, id())
    case 'GET help/:id': return admin.getHelp(env, id())
    case 'POST help/:id/resolve': return admin.resolveHelp(env, id(), data)
  }
  throw new HttpError(404, 'Route inconnue.')
}

async function route(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method
  const p = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)

  // Écritures : JSON uniquement et même origine (protection CSRF en plus de SameSite=Lax).
  if (method !== 'GET') {
    const origin = request.headers.get('Origin')
    if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Origine refusée.')
    if (method !== 'DELETE' && !(request.headers.get('Content-Type') || '').includes('application/json')) throw new HttpError(415, 'JSON attendu.')
  }

  if (method === 'POST' && p.join('/') === 'login') return studentLogin(env, request)
  if (method === 'POST' && p.join('/') === 'admin/login') return adminLogin(env, request)

  if (p[0] === 'admin') {
    if (!(await isAdmin(env, request))) throw new HttpError(401, 'Connexion admin requise.')
    if (method === 'POST' && p[1] === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': endAdminSession() })
    return json(await adminRoutes(env, method, p.slice(1), request))
  }

  const me = await getStudent(env, request)
  if (!me) throw new HttpError(401, 'Connexion requise.')
  if (method === 'POST' && p[0] === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': await endStudentSession(env, request) })
  if (method === 'GET' && p[0] === 'state') {
    const a = url.searchParams.get('assignment')
    return json(await student.home(env, me, a ? int(a) : null))
  }
  if (method === 'POST' && p[0] === 'assignments' && p[2] === 'act') {
    const { status, tube } = await student.act(env, me.id, int(p[1]), student.parseAction(await body(request)))
    return json({ tube }, status)
  }
  throw new HttpError(404, 'Route inconnue.')
}

export async function handle(env: Env, request: Request): Promise<Response> {
  try {
    return await route(env, request)
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status)
    console.error(e)
    return json({ error: 'Erreur du serveur. Réessaie dans un instant.' }, 500)
  }
}
