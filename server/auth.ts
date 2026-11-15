// Sessions, hachages et limite d'essais. Tout passe par WebCrypto (disponible dans les Pages Functions).
import { CODE_ALPHABET } from '../shared/tube'

export interface Env {
  DB: D1Database
  ADMIN_PASSWORD_HASH: string // "pbkdf2$<itérations>$<sel base64>$<hash base64>"
  SESSION_SECRET: string // clé de signature (cookies admin) et poivre des codes élèves
}

const enc = new TextEncoder()
const STUDENT_COOKIE = 'tuby_s'
const ADMIN_COOKIE = 'tuby_a'
const STUDENT_TTL = 60 * 60 * 24 * 365 // 1 an
const ADMIN_TTL = 60 * 60 * 24 * 30 // 30 jours
const MAX_FAILS = 5
const LOCK_SECONDS = 600

export const now = () => Math.floor(Date.now() / 1000)

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function randomToken(bytes = 32): string {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)))
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

/** Comparaison à temps constant. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── Codes élèves ──────────────────────────────────────────────────────────────

export function generateCode(): string {
  let code = ''
  while (code.length < 6) {
    const [b] = crypto.getRandomValues(new Uint8Array(1))
    if (b < 248) code += CODE_ALPHABET[b % CODE_ALPHABET.length] // 248 = 8 × 31 : tirage sans biais
  }
  return code
}

export async function hashCode(env: Env, code: string): Promise<string> {
  const salt = randomToken(9)
  return `${salt}$${await hmac(env.SESSION_SECRET, `code:${salt}:${code}`)}`
}

export async function verifyCode(env: Env, code: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split('$')
  const computed = await hmac(env.SESSION_SECRET, `code:${salt ?? ''}:${code}`)
  return !!hash && same(computed, hash)
}

// ── Mot de passe admin (PBKDF2) ───────────────────────────────────────────────

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = (stored || '').split('$')
  if (scheme !== 'pbkdf2' || !salt || !hash) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations: Number(iterations) }, key, 256)
  return same(toB64(bits), hash)
}

// ── Cookies ───────────────────────────────────────────────────────────────────

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`

// ── Session élève : jeton aléatoire, seul son hash est stocké ─────────────────

export async function createStudentSession(env: Env, studentId: number): Promise<string> {
  const token = randomToken()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
    env.DB.prepare('INSERT INTO sessions (token_hash, student_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), studentId, now() + STUDENT_TTL),
  ])
  return cookie(STUDENT_COOKIE, token, STUDENT_TTL)
}

export async function getStudent(env: Env, request: Request): Promise<{ id: number; prenom: string } | null> {
  const token = readCookie(request, STUDENT_COOKIE)
  if (!token) return null
  return env.DB.prepare(
    'SELECT st.id, st.prenom FROM sessions se JOIN students st ON st.id = se.student_id WHERE se.token_hash = ? AND se.expires_at > ? AND st.archived = 0',
  ).bind(await sha256(token), now()).first<{ id: number; prenom: string }>()
}

export async function endStudentSession(env: Env, request: Request): Promise<string> {
  const token = readCookie(request, STUDENT_COOKIE)
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
  return cookie(STUDENT_COOKIE, '', 0)
}

// ── Session admin : cookie signé (invalidé si le mot de passe change) ─────────

const adminSignature = (env: Env, exp: string, nonce: string) => hmac(env.SESSION_SECRET, `admin:${exp}:${nonce}:${env.ADMIN_PASSWORD_HASH}`)

export async function createAdminSession(env: Env): Promise<string> {
  const exp = String(now() + ADMIN_TTL)
  const nonce = randomToken(12)
  return cookie(ADMIN_COOKIE, `${exp}.${nonce}.${await adminSignature(env, exp, nonce)}`, ADMIN_TTL)
}

export async function isAdmin(env: Env, request: Request): Promise<boolean> {
  const [exp, nonce, sig] = (readCookie(request, ADMIN_COOKIE) || '').split('.')
  if (!exp || !nonce || !sig || !env.SESSION_SECRET || Number(exp) < now()) return false
  return same(await adminSignature(env, exp, nonce), sig)
}

export const endAdminSession = () => cookie(ADMIN_COOKIE, '', 0)

// ── Limite d'essais : 5 erreurs → blocage 10 minutes ──────────────────────────

interface Attempt { fails: number; locked_until: number }

/** Secondes de blocage restantes (0 = libre). */
export async function lockedFor(env: Env, key: string): Promise<{ wait: number; row: Attempt | null }> {
  const row = await env.DB.prepare('SELECT fails, locked_until FROM login_attempts WHERE key = ?').bind(key).first<Attempt>()
  return { wait: row && row.locked_until > now() ? row.locked_until - now() : 0, row }
}

/** Enregistre une erreur ; renvoie le nombre d'essais restants avant blocage. */
export async function recordFail(env: Env, key: string, row: Attempt | null): Promise<number> {
  const fails = (row && row.locked_until === 0 ? row.fails : 0) + 1
  const locked = fails >= MAX_FAILS
  await env.DB.prepare(
    'INSERT INTO login_attempts (key, fails, locked_until) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET fails = ?2, locked_until = ?3',
  ).bind(key, locked ? 0 : fails, locked ? now() + LOCK_SECONDS : 0).run()
  return locked ? 0 : MAX_FAILS - fails
}

export async function clearFails(env: Env, key: string, row: Attempt | null): Promise<void> {
  if (row) await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run()
}
