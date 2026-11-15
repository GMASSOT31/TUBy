// Routes admin (toutes derrière la session admin, vérifiée dans le routeur).
import { normalizePrenom, type StepConfig, type StepType } from '../shared/tube'
import { generateCode, hashCode, randomToken, type Env } from './auth'
import { HttpError, int, str } from './http'
import { toStep, type StepRow } from './student'

const TYPES: StepType[] = ['prerequis', 'action', 'verif', 'choix', 'recap']
const STEP_COLS = 's.id, s.chapter_id, s.position, s.type, s.ref, s.titre, s.objectif, s.quoi_faire, s.config, s.only_for_assignment_id, s.inserted_before_step_id'
const FIRST_STEP = `(SELECT s.id FROM steps s JOIN chapters c ON c.id = s.chapter_id WHERE c.guide_id = ?1 AND s.only_for_assignment_id IS NULL ORDER BY c.position, s.position, s.id LIMIT 1)`

const newRef = () => 'e_' + randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')

interface StepInput { type: StepType; titre: string; objectif: string; quoi_faire: string; config: string }

/** Nettoie une étape reçue de l'éditeur : seuls les champs prévus pour son type sont gardés. */
function stepInput(raw: unknown): StepInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const type = TYPES.includes(r.type as StepType) ? (r.type as StepType) : 'action'
  const c = (r.config && typeof r.config === 'object' ? r.config : {}) as Record<string, unknown>
  const lines = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 500)).filter(Boolean).slice(0, 30) : [])
  const config: StepConfig = {}
  if (type === 'prerequis') config.cases = lines(c.cases)
  if (type === 'recap') config.points = lines(c.points)
  if (type === 'verif') config.si_non = str(c.si_non, 3000)
  if (type === 'choix') {
    config.options = (Array.isArray(c.options) ? c.options : []).slice(0, 4).map((o) => {
      const opt = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
      return { label: str(opt.label, 120), goto: str(opt.goto, 60) || null }
    }).filter((o) => o.label)
    if (config.options.length < 2) throw new HttpError(400, 'Une étape « choix » a besoin d’au moins 2 options.')
  }
  const apres = str(c.apres, 60)
  if (apres && type !== 'choix') config.apres = apres
  return { type, titre: str(r.titre, 300), objectif: str(r.objectif, 600), quoi_faire: str(r.quoi_faire, 6000), config: JSON.stringify(config) }
}

// ── Tableau de bord : tout en un appel ────────────────────────────────────────

export async function overview(env: Env) {
  const db = env.DB
  const [students, assignments, guides, help] = await db.batch([
    db.prepare("SELECT id, prenom, note, created_at, archived, (code_hash <> '') AS has_code FROM students ORDER BY archived, prenom"),
    db.prepare(
      `SELECT a.id, a.student_id, a.guide_id, a.status, a.started_at, a.updated_at, g.titre AS guide, s.titre AS step_titre, s.type AS step_type, c.titre AS chapitre
       FROM assignments a JOIN guides g ON g.id = a.guide_id
       LEFT JOIN steps s ON s.id = a.current_step_id LEFT JOIN chapters c ON c.id = s.chapter_id
       ORDER BY a.updated_at DESC`,
    ),
    db.prepare(
      `SELECT g.id, g.titre, g.description, g.published,
         (SELECT COUNT(*) FROM chapters c WHERE c.guide_id = g.id) AS chapitres,
         (SELECT COUNT(*) FROM steps s JOIN chapters c ON c.id = s.chapter_id WHERE c.guide_id = g.id AND s.only_for_assignment_id IS NULL) AS etapes
       FROM guides g ORDER BY g.id`,
    ),
    db.prepare(
      `SELECT h.id, h.message, h.created_at, st.prenom, g.titre AS guide, s.titre AS step_titre, s.type AS step_type, c.titre AS chapitre
       FROM help_requests h JOIN assignments a ON a.id = h.assignment_id JOIN students st ON st.id = a.student_id JOIN guides g ON g.id = a.guide_id
       LEFT JOIN steps s ON s.id = h.step_id LEFT JOIN chapters c ON c.id = s.chapter_id
       WHERE h.status = 'ouvert' ORDER BY h.created_at`,
    ),
  ])
  return { students: students.results, assignments: assignments.results, guides: guides.results, help: help.results }
}

// ── Élèves ────────────────────────────────────────────────────────────────────

async function prenomTaken(env: Env, key: string, exceptId = 0): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM students WHERE prenom_key = ? AND archived = 0 AND id <> ?').bind(key, exceptId).first())
}

export async function createStudent(env: Env, data: Record<string, unknown>) {
  const prenom = str(data.prenom, 60)
  const key = normalizePrenom(prenom)
  if (!key) throw new HttpError(400, 'Le prénom est obligatoire.')
  if (await prenomTaken(env, key)) throw new HttpError(409, 'Un élève porte déjà ce prénom. Ajoute une initiale pour les distinguer.')
  const code = generateCode()
  const row = await env.DB.prepare('INSERT INTO students (prenom, prenom_key, code_hash, note) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(prenom, key, await hashCode(env, code), str(data.note, 1000)).first<{ id: number }>()
  return { id: row!.id, code }
}

/** Nouveau code : l'ancien ne marche plus et les appareils déjà connectés sont déconnectés. */
export async function regenerateCode(env: Env, id: number) {
  const code = generateCode()
  const [updated] = await env.DB.batch([
    env.DB.prepare('UPDATE students SET code_hash = ? WHERE id = ?').bind(await hashCode(env, code), id),
    env.DB.prepare('DELETE FROM sessions WHERE student_id = ?').bind(id),
    env.DB.prepare("DELETE FROM login_attempts WHERE key = 's:' || (SELECT prenom_key FROM students WHERE id = ?)").bind(id),
  ])
  if (!updated.meta.changes) throw new HttpError(404, 'Élève introuvable.')
  return { code }
}

export async function updateStudent(env: Env, id: number, data: Record<string, unknown>) {
  const current = await env.DB.prepare('SELECT prenom, prenom_key, note, archived FROM students WHERE id = ?').bind(id).first<{ prenom: string; prenom_key: string; note: string; archived: number }>()
  if (!current) throw new HttpError(404, 'Élève introuvable.')
  const prenom = 'prenom' in data ? str(data.prenom, 60) : current.prenom
  const key = normalizePrenom(prenom)
  const archived = 'archived' in data ? (data.archived ? 1 : 0) : current.archived
  if (!key) throw new HttpError(400, 'Le prénom est obligatoire.')
  if (!archived && await prenomTaken(env, key, id)) throw new HttpError(409, 'Un élève actif porte déjà ce prénom.')
  const writes = [
    env.DB.prepare('UPDATE students SET prenom = ?, prenom_key = ?, note = ?, archived = ? WHERE id = ?')
      .bind(prenom, key, 'note' in data ? str(data.note, 1000) : current.note, archived, id),
  ]
  if (archived) writes.push(env.DB.prepare('DELETE FROM sessions WHERE student_id = ?').bind(id))
  await env.DB.batch(writes)
  return { ok: true }
}

// ── Guides ────────────────────────────────────────────────────────────────────

export async function getGuide(env: Env, id: number) {
  const db = env.DB
  const [guide, chapters, steps] = await db.batch([
    db.prepare('SELECT id, titre, description, published FROM guides WHERE id = ?').bind(id),
    db.prepare('SELECT id, position, titre, objectif FROM chapters WHERE guide_id = ? ORDER BY position, id').bind(id),
    db.prepare(`SELECT ${STEP_COLS} FROM steps s JOIN chapters c ON c.id = s.chapter_id WHERE c.guide_id = ? AND s.only_for_assignment_id IS NULL ORDER BY c.position, s.position, s.id`).bind(id),
  ])
  if (!guide.results.length) throw new HttpError(404, 'Guide introuvable.')
  return { guide: guide.results[0], chapters: chapters.results, steps: (steps.results as unknown as StepRow[]).map(toStep) }
}

export async function createGuide(env: Env, data: Record<string, unknown>) {
  const titre = str(data.titre, 200)
  if (!titre) throw new HttpError(400, 'Le titre est obligatoire.')
  const row = await env.DB.prepare('INSERT INTO guides (titre, description, published) VALUES (?, ?, 0) RETURNING id').bind(titre, str(data.description, 1000)).first<{ id: number }>()
  return { id: row!.id }
}

export async function updateGuide(env: Env, id: number, data: Record<string, unknown>) {
  const g = await env.DB.prepare('SELECT titre, description, published FROM guides WHERE id = ?').bind(id).first<{ titre: string; description: string; published: number }>()
  if (!g) throw new HttpError(404, 'Guide introuvable.')
  const titre = 'titre' in data ? str(data.titre, 200) : g.titre
  if (!titre) throw new HttpError(400, 'Le titre est obligatoire.')
  await env.DB.prepare('UPDATE guides SET titre = ?, description = ?, published = ? WHERE id = ?')
    .bind(titre, 'description' in data ? str(data.description, 1000) : g.description, 'published' in data ? (data.published ? 1 : 0) : g.published, id).run()
  return { ok: true }
}

/** Copie un guide en 3 requêtes : les cibles (goto/apres) sont des « ref », donc rien à recâbler. */
export async function duplicateGuide(env: Env, id: number) {
  const row = await env.DB.prepare("INSERT INTO guides (titre, description, published) SELECT titre || ' (copie)', description, 0 FROM guides WHERE id = ? RETURNING id").bind(id).first<{ id: number }>()
  if (!row) throw new HttpError(404, 'Guide introuvable.')
  await env.DB.batch([
    env.DB.prepare('INSERT INTO chapters (guide_id, position, titre, objectif) SELECT ?1, position, titre, objectif FROM chapters WHERE guide_id = ?2').bind(row.id, id),
    env.DB.prepare(
      `INSERT INTO steps (chapter_id, position, type, ref, titre, objectif, quoi_faire, config)
       SELECT nc.id, s.position, s.type, s.ref, s.titre, s.objectif, s.quoi_faire, s.config
       FROM steps s JOIN chapters oc ON oc.id = s.chapter_id JOIN chapters nc ON nc.guide_id = ?1 AND nc.position = oc.position
       WHERE oc.guide_id = ?2 AND s.only_for_assignment_id IS NULL`,
    ).bind(row.id, id),
  ])
  return { id: row.id }
}

export async function deleteGuide(env: Env, id: number) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM guides WHERE id = ?').bind(id), // cascade : chapitres, étapes, attributions
    env.DB.prepare('DELETE FROM step_progress WHERE step_id NOT IN (SELECT id FROM steps)'),
  ])
  return { ok: true }
}

// ── Chapitres ─────────────────────────────────────────────────────────────────

export async function createChapter(env: Env, guideId: number, data: Record<string, unknown>) {
  const titre = str(data.titre, 200)
  if (!titre) throw new HttpError(400, 'Le titre est obligatoire.')
  const row = await env.DB.prepare(
    'INSERT INTO chapters (guide_id, position, titre, objectif) SELECT id, (SELECT COALESCE(MAX(position), -1) + 1 FROM chapters WHERE guide_id = ?1), ?2, ?3 FROM guides WHERE id = ?1 RETURNING id',
  ).bind(guideId, titre, str(data.objectif, 600)).first<{ id: number }>()
  if (!row) throw new HttpError(404, 'Guide introuvable.')
  return { id: row.id }
}

export async function updateChapter(env: Env, id: number, data: Record<string, unknown>) {
  const titre = str(data.titre, 200)
  if (!titre) throw new HttpError(400, 'Le titre est obligatoire.')
  await env.DB.prepare('UPDATE chapters SET titre = ?, objectif = ? WHERE id = ?').bind(titre, str(data.objectif, 600), id).run()
  return { ok: true }
}

export async function deleteChapter(env: Env, id: number) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM chapters WHERE id = ?').bind(id), // cascade : étapes
    env.DB.prepare('DELETE FROM step_progress WHERE step_id NOT IN (SELECT id FROM steps)'),
    env.DB.prepare('UPDATE assignments SET current_step_id = NULL WHERE current_step_id IS NOT NULL AND current_step_id NOT IN (SELECT id FROM steps)'),
  ])
  return { ok: true }
}

const idList = (v: unknown) => JSON.stringify((Array.isArray(v) ? v : []).map(int))

export async function orderChapters(env: Env, guideId: number, data: Record<string, unknown>) {
  await env.DB.prepare('UPDATE chapters SET position = (SELECT key FROM json_each(?1) WHERE value = chapters.id) WHERE guide_id = ?2 AND id IN (SELECT value FROM json_each(?1))')
    .bind(idList(data.ids), guideId).run()
  return { ok: true }
}

// ── Étapes ────────────────────────────────────────────────────────────────────

export async function createStep(env: Env, chapterId: number, data: Record<string, unknown>) {
  const s = stepInput(data)
  const db = env.DB
  const count = await db.prepare('SELECT COUNT(*) AS n FROM steps WHERE chapter_id = ? AND only_for_assignment_id IS NULL').bind(chapterId).first<{ n: number }>()
  const position = Math.min(typeof data.position === 'number' ? Math.max(0, Math.floor(data.position)) : count!.n, count!.n)
  const [, inserted] = await db.batch([
    db.prepare('UPDATE steps SET position = position + 1 WHERE chapter_id = ? AND only_for_assignment_id IS NULL AND position >= ?').bind(chapterId, position),
    db.prepare('INSERT INTO steps (chapter_id, position, type, ref, titre, objectif, quoi_faire, config) SELECT id, ?2, ?3, ?4, ?5, ?6, ?7, ?8 FROM chapters WHERE id = ?1 RETURNING id')
      .bind(chapterId, position, s.type, newRef(), s.titre, s.objectif, s.quoi_faire, s.config),
  ])
  if (!inserted.results.length) throw new HttpError(404, 'Chapitre introuvable.')
  return { id: (inserted.results[0] as { id: number }).id }
}

export async function updateStep(env: Env, id: number, data: Record<string, unknown>) {
  const s = stepInput(data)
  const r = await env.DB.prepare('UPDATE steps SET type = ?, titre = ?, objectif = ?, quoi_faire = ?, config = ? WHERE id = ?').bind(s.type, s.titre, s.objectif, s.quoi_faire, s.config, id).run()
  if (!r.meta.changes) throw new HttpError(404, 'Étape introuvable.')
  return { ok: true }
}

export async function deleteStep(env: Env, id: number) {
  const db = env.DB
  const step = await db.prepare('SELECT s.id, s.chapter_id, s.position, s.only_for_assignment_id, c.guide_id FROM steps s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?').bind(id)
    .first<{ id: number; chapter_id: number; position: number; only_for_assignment_id: number | null; guide_id: number }>()
  if (!step) throw new HttpError(404, 'Étape introuvable.')
  // Les élèves posés sur cette étape (ou sur ses étapes d'aide) glissent sur la suivante, sinon la précédente.
  const { results } = await db.prepare(
    'SELECT s.id FROM steps s JOIN chapters c ON c.id = s.chapter_id WHERE c.guide_id = ? AND s.only_for_assignment_id IS NULL ORDER BY c.position, s.position, s.id',
  ).bind(step.guide_id).all<{ id: number }>()
  const i = results.findIndex((r) => r.id === id)
  const fallback = i >= 0 ? (results[i + 1]?.id ?? results[i - 1]?.id ?? null) : null
  const helpers = 'SELECT id FROM steps WHERE inserted_before_step_id = ?1 AND only_for_assignment_id IS NOT NULL'
  const writes = [
    db.prepare(`DELETE FROM step_progress WHERE step_id = ?1 OR step_id IN (${helpers})`).bind(id),
  ]
  if (step.only_for_assignment_id == null) {
    writes.push(
      db.prepare(`UPDATE assignments SET current_step_id = ?2 WHERE current_step_id = ?1 OR current_step_id IN (${helpers})`).bind(id, fallback),
      db.prepare('DELETE FROM steps WHERE inserted_before_step_id = ?1 AND only_for_assignment_id IS NOT NULL').bind(id),
      db.prepare('UPDATE steps SET position = position - 1 WHERE chapter_id = ? AND only_for_assignment_id IS NULL AND position > ?').bind(step.chapter_id, step.position),
    )
  }
  writes.push(db.prepare('DELETE FROM steps WHERE id = ?').bind(id))
  await db.batch(writes)
  return { ok: true }
}

export async function orderSteps(env: Env, chapterId: number, data: Record<string, unknown>) {
  await env.DB.prepare(
    'UPDATE steps SET position = (SELECT key FROM json_each(?1) WHERE value = steps.id) WHERE chapter_id = ?2 AND only_for_assignment_id IS NULL AND id IN (SELECT value FROM json_each(?1))',
  ).bind(idList(data.ids), chapterId).run()
  return { ok: true }
}

// ── Attributions ──────────────────────────────────────────────────────────────

export async function assign(env: Env, data: Record<string, unknown>) {
  const guideId = int(data.guide_id)
  const ids = (Array.isArray(data.student_ids) ? data.student_ids : []).map(int).slice(0, 40)
  if (!ids.length) throw new HttpError(400, 'Choisis au moins un élève.')
  await env.DB.batch(ids.map((sid) =>
    env.DB.prepare(`INSERT OR IGNORE INTO assignments (guide_id, student_id, current_step_id) SELECT ?1, id, ${FIRST_STEP} FROM students WHERE id = ?2 AND EXISTS (SELECT 1 FROM guides WHERE id = ?1)`).bind(guideId, sid),
  ))
  return { ok: true }
}

export async function unassign(env: Env, id: number) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM steps WHERE only_for_assignment_id = ?').bind(id),
    env.DB.prepare('DELETE FROM assignments WHERE id = ?').bind(id), // cascade : progression, blocages
  ])
  return { ok: true }
}

export async function resetAssignment(env: Env, id: number) {
  const a = await env.DB.prepare('SELECT guide_id FROM assignments WHERE id = ?').bind(id).first<{ guide_id: number }>()
  if (!a) throw new HttpError(404, 'Attribution introuvable.')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM step_progress WHERE assignment_id = ?').bind(id),
    env.DB.prepare("UPDATE help_requests SET status = 'traite', resolved_at = COALESCE(resolved_at, datetime('now')), seen_at = COALESCE(seen_at, datetime('now')) WHERE assignment_id = ?").bind(id),
    env.DB.prepare(`UPDATE assignments SET current_step_id = ${FIRST_STEP}, status = 'en_cours', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?2`).bind(a.guide_id, id),
  ])
  return { ok: true }
}

// ── Blocages ──────────────────────────────────────────────────────────────────

interface HelpRow { id: number; assignment_id: number; step_id: number; message: string; created_at: string; status: string; admin_reply: string | null; resolved_at: string | null; prenom: string; guide: string; guide_id: number }

async function helpRow(env: Env, id: number): Promise<HelpRow> {
  const h = await env.DB.prepare(
    `SELECT h.id, h.assignment_id, h.step_id, h.message, h.created_at, h.status, h.admin_reply, h.resolved_at, st.prenom, g.titre AS guide, g.id AS guide_id
     FROM help_requests h JOIN assignments a ON a.id = h.assignment_id JOIN students st ON st.id = a.student_id JOIN guides g ON g.id = a.guide_id WHERE h.id = ?`,
  ).bind(id).first<HelpRow>()
  if (!h) throw new HttpError(404, 'Blocage introuvable.')
  return h
}

const stepWithChapter = (env: Env, id: number) =>
  env.DB.prepare(`SELECT ${STEP_COLS}, c.titre AS chapitre FROM steps s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?`).bind(id).first<StepRow & { chapitre: string }>()

export async function getHelp(env: Env, id: number) {
  const h = await helpRow(env, id)
  const row = await stepWithChapter(env, h.step_id)
  return { help: h, step: row ? { ...toStep(row), chapitre: row.chapitre } : null }
}

/** Le cœur de l'outil : étapes intermédiaires avant l'étape bloquante, réponse, déblocage. */
export async function resolveHelp(env: Env, id: number, data: Record<string, unknown>) {
  const db = env.DB
  const h = await helpRow(env, id)
  if (h.status !== 'ouvert') throw new HttpError(409, 'Ce blocage est déjà traité.')
  const added = (Array.isArray(data.steps) ? data.steps : []).slice(0, 10).map(stepInput).filter((s) => s.titre || s.quoi_faire)
  const forAll = !!data.for_all
  const reply = str(data.reply, 2000) || null
  const blocking = await stepWithChapter(env, h.step_id)
  const writes: D1PreparedStatement[] = []
  let firstId: number | null = null

  if (added.length && blocking) {
    const n = added.length
    const personalBlocking = blocking.only_for_assignment_id != null
    // Cible de l'insertion : l'étape bloquante, ou sa propre cible si l'élève bloque sur une étape d'aide.
    const anchorId = personalBlocking ? blocking.inserted_before_step_id! : blocking.id
    let start: number
    let onlyFor: number | null
    if (forAll) {
      const anchor = personalBlocking ? await stepWithChapter(env, anchorId) : blocking
      if (!anchor) throw new HttpError(409, 'L’étape bloquante n’existe plus.')
      start = anchor.position
      onlyFor = null
      await db.prepare('UPDATE steps SET position = position + ? WHERE chapter_id = ? AND only_for_assignment_id IS NULL AND position >= ?').bind(n, anchor.chapter_id, start).run()
    } else if (personalBlocking) {
      start = blocking.position
      onlyFor = h.assignment_id
      await db.prepare('UPDATE steps SET position = position + ? WHERE only_for_assignment_id = ? AND inserted_before_step_id = ? AND position >= ?').bind(n, h.assignment_id, anchorId, start).run()
    } else {
      const max = await db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM steps WHERE only_for_assignment_id = ? AND inserted_before_step_id = ?').bind(h.assignment_id, anchorId).first<{ m: number }>()
      start = max!.m + 1
      onlyFor = h.assignment_id
    }
    const insert = (s: ReturnType<typeof stepInput>, i: number) =>
      db.prepare(
        'INSERT INTO steps (chapter_id, position, type, ref, titre, objectif, quoi_faire, config, only_for_assignment_id, inserted_before_step_id, help_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      ).bind(blocking.chapter_id, start + i, s.type, newRef(), s.titre, s.objectif, s.quoi_faire, s.config, onlyFor, anchorId, id)
    firstId = (await insert(added[0], 0).first<{ id: number }>())!.id
    added.slice(1).forEach((s, i) => writes.push(insert(s, i + 1)))
  }

  writes.push(
    db.prepare("UPDATE help_requests SET status = 'traite', admin_reply = ?, resolved_at = datetime('now') WHERE id = ?").bind(reply, id),
    db.prepare("UPDATE assignments SET status = 'en_cours', current_step_id = COALESCE(?, current_step_id), updated_at = datetime('now') WHERE id = ? AND status = 'bloque'").bind(firstId, h.assignment_id),
  )
  await db.batch(writes)
  return { ok: true, added: added.length }
}
