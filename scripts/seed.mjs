// Importe le guide de départ (seed/guide-site-web.yaml), l'élève Alessio et son attribution.
// Usage : node scripts/seed.mjs --local | --remote   (sans effet si le guide existe déjà)
// Le code d'Alessio n'est pas créé ici : génère-le dans l'admin (Élèves → Nouveau code).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

const target = process.argv.includes('--remote') ? '--remote' : '--local'
const wrangler = (args) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'tuby', target, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

const data = parse(readFileSync(new URL('../seed/guide-site-web.yaml', import.meta.url), 'utf8'))
const STUDENT = 'Alessio'
const studentKey = q(STUDENT.toLowerCase())

const existing = JSON.parse(wrangler(['--json', '--command', `SELECT COUNT(*) AS n FROM guides WHERE titre = ${q(data.guide)}`]))
if (existing[0].results[0].n > 0) {
  console.log('Le guide est déjà importé : rien à faire.')
  process.exit(0)
}

// Les adresses citées dans le guide deviennent des liens cliquables.
const SITES = /(?<![\w./[])(github\.com\/new|claude\.ai|github\.com|supabase\.com|dash\.cloudflare\.com)(?![\w/])/g
const rich = (text) => (text || '').trim().replace(SITES, '[$1](https://$1)')

const guide = `(SELECT id FROM guides WHERE titre = ${q(data.guide)} ORDER BY id DESC LIMIT 1)`
const sql = [`INSERT INTO guides (titre, description, published) VALUES (${q(data.guide)}, 'De l''idée du client au site en ligne, étape par étape.', 1);`]
let first = null
let count = 0
data.chapitres.forEach((ch, ci) => {
  sql.push(`INSERT INTO chapters (guide_id, position, titre, objectif) VALUES (${guide}, ${ci}, ${q(ch.titre)}, ${q(ch.objectif)});`)
  const chapter = `(SELECT id FROM chapters WHERE guide_id = ${guide} AND position = ${ci})`
  ch.etapes.forEach((e, si) => {
    const config = {}
    if (e.cases) config.cases = e.cases
    if (e.points) config.points = e.points
    if (e.si_non) config.si_non = rich(e.si_non)
    if (e.options) config.options = e.options.map((o) => ({ label: o.label, goto: o.goto ?? null }))
    if (e.apres) config.apres = e.apres
    const ref = e.id || `c${ci}e${si + 1}`
    const titre = e.titre || e.question || (e.type === 'recap' ? 'Ce que tu viens de faire' : '')
    first ??= ref
    count++
    sql.push(
      `INSERT INTO steps (chapter_id, position, type, ref, titre, objectif, quoi_faire, config) VALUES (${chapter}, ${si}, ${q(e.type)}, ${q(ref)}, ${q(titre)}, ${q(e.objectif || '')}, ${q(rich(e.quoi))}, ${q(JSON.stringify(config))});`,
    )
  })
})
sql.push(
  `INSERT INTO students (prenom, prenom_key, note) SELECT ${q(STUDENT)}, ${studentKey}, '15 ans, débutant. Comptes au nom d''un parent.' WHERE NOT EXISTS (SELECT 1 FROM students WHERE prenom_key = ${studentKey} AND archived = 0);`,
  `INSERT INTO assignments (guide_id, student_id, current_step_id) VALUES (${guide}, (SELECT id FROM students WHERE prenom_key = ${studentKey} AND archived = 0), (SELECT s.id FROM steps s JOIN chapters c ON c.id = s.chapter_id WHERE c.guide_id = ${guide} AND s.ref = ${q(first)}));`,
)

const file = join(mkdtempSync(join(tmpdir(), 'tuby-seed-')), 'seed.sql')
writeFileSync(file, sql.join('\n') + '\n')
wrangler(['--file', file, '--yes'])
console.log(`Guide importé (${data.chapitres.length} chapitres, ${count} étapes) et attribué à ${STUDENT}.`)
