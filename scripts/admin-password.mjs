// Définit (ou change) le mot de passe admin. Seul son hash PBKDF2 est enregistré.
//   node scripts/admin-password.mjs                      → génère un mot de passe fort, l'affiche une fois, l'envoie à Cloudflare
//   node scripts/admin-password.mjs "mon mot de passe"   → utilise celui-ci
//   ajoute --local pour écrire dans .dev.vars (tests sur ta machine) au lieu de Cloudflare
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pbkdf2Sync, randomBytes } from 'node:crypto'

const ITERATIONS = 100_000
const args = process.argv.slice(2)
const local = args.includes('--local')
const given = args.find((a) => !a.startsWith('--'))
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789' // 54 signes sans ambiguïté
const generate = () =>
  Array.from(randomBytes(64)).filter((b) => b < 216).slice(0, 20).map((b) => ALPHABET[b % ALPHABET.length]).join('').replace(/(.{5})(?=.)/g, '$1-')
const password = given || generate()
if (password.length < 12) {
  console.error('Mot de passe trop court : 12 caractères minimum.')
  process.exit(1)
}
const salt = randomBytes(16)
const hash = `pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256').toString('base64')}`

if (local) {
  const file = new URL('../.dev.vars', import.meta.url)
  const lines = (existsSync(file) ? readFileSync(file, 'utf8') : '').split('\n').filter((l) => l.includes('='))
  const vars = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  vars.ADMIN_PASSWORD_HASH = JSON.stringify(hash)
  vars.SESSION_SECRET ??= JSON.stringify(randomBytes(32).toString('base64'))
  writeFileSync(file, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
} else {
  execFileSync('npx', ['wrangler', 'pages', 'secret', 'put', 'ADMIN_PASSWORD_HASH', '--project-name', 'tuby'], { input: hash, stdio: ['pipe', 'inherit', 'inherit'] })
  console.log('Actif au prochain déploiement : pousse un commit, ou relance le dernier déploiement dans Cloudflare.')
}
console.log(given ? 'Mot de passe admin enregistré.' : `\nMot de passe admin (affiché une seule fois, note-le) :\n\n    ${password}\n`)
