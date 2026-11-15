// Routes élève. Un élève ne lit et ne modifie que ses propres attributions.
import { applyAction, buildSequence, type AssignmentStatus, type Chapter, type Progress, type Step, type StepConfig, type StudentAction, type StudentHome, type TubeState } from '../shared/tube'
import type { Env } from './auth'
import { HttpError } from './http'

interface AssignmentRow { id: number; status: AssignmentStatus; current_step_id: number | null; guide_id: number; titre: string; description: string; done: number; total: number }
export interface StepRow { id: number; chapter_id: number; position: number; type: Step['type']; ref: string; titre: string; objectif: string; quoi_faire: string; config: string; only_for_assignment_id: number | null; inserted_before_step_id: number | null }

export function parseConfig(text: string | null): StepConfig {
  try {
    const v = JSON.parse(text || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export const toStep = (r: StepRow): Step => ({
  id: r.id, chapter_id: r.chapter_id, position: r.position, type: r.type, ref: r.ref, titre: r.titre, objectif: r.objectif,
  quoi_faire: r.quoi_faire, config: parseConfig(r.config), personal: r.only_for_assignment_id != null, inserted_before_step_id: r.inserted_before_step_id,
})

async function loadTube(env: Env, a: AssignmentRow): Promise<TubeState> {
  const db = env.DB
  const [chapters, steps, progress, help] = await db.batch([
    db.prepare('SELECT id, position, titre, objectif FROM chapters WHERE guide_id = ? ORDER BY position, id').bind(a.guide_id),
    db.prepare(
      `SELECT s.id, s.chapter_id, s.position, s.type, s.ref, s.titre, s.objectif, s.quoi_faire, s.config, s.only_for_assignment_id, s.inserted_before_step_id
       FROM steps s JOIN chapters c ON c.id = s.chapter_id
       WHERE c.guide_id = ? AND (s.only_for_assignment_id IS NULL OR s.only_for_assignment_id = ?)`,
    ).bind(a.guide_id, a.id),
    db.prepare('SELECT step_id, status, answer FROM step_progress WHERE assignment_id = ?').bind(a.id),
    db.prepare(
      `SELECT h.message, h.created_at, h.status, h.admin_reply, (SELECT COUNT(*) FROM steps s WHERE s.help_request_id = h.id) AS added
       FROM help_requests h WHERE h.assignment_id = ? AND (h.status = 'ouvert' OR h.seen_at IS NULL) ORDER BY h.id DESC`,
    ).bind(a.id),
  ])
  const seq = buildSequence(chapters.results as unknown as Chapter[], (steps.results as unknown as StepRow[]).map(toStep))
  const prog: Progress = {}
  for (const p of progress.results as { step_id: number; status: 'fait' | 'passe'; answer: string | null }[]) {
    prog[p.step_id] = { status: p.status, answer: p.answer ? JSON.parse(p.answer) : null }
  }
  const helps = help.results as { message: string; created_at: string; status: string; admin_reply: string | null; added: number }[]
  const open = a.status === 'bloque' ? helps.find((h) => h.status === 'ouvert') : undefined
  const answered = helps.find((h) => h.status === 'traite')
  // Étape courante disparue (supprimée par l'admin) : on reprend au début.
  const current = seq.some((s) => s.id === a.current_step_id) ? a.current_step_id : (seq[0]?.id ?? null)
  return {
    assignment: { id: a.id, status: a.status === 'bloque' && !open ? 'en_cours' : a.status, current_step_id: current },
    guide: { id: a.guide_id, titre: a.titre },
    chapters: chapters.results as unknown as Chapter[],
    steps: seq,
    progress: prog,
    help: open ? { message: open.message, created_at: open.created_at } : null,
    notice: answered ? { reply: answered.admin_reply, added: answered.added } : null,
  }
}

async function assignmentsOf(env: Env, studentId: number): Promise<AssignmentRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.status, a.current_step_id, a.guide_id, g.titre, g.description,
       (SELECT COUNT(*) FROM step_progress p WHERE p.assignment_id = a.id) AS done,
       (SELECT COUNT(*) FROM steps s JOIN chapters c ON c.id = s.chapter_id WHERE c.guide_id = a.guide_id AND s.only_for_assignment_id IS NULL) AS total
     FROM assignments a JOIN guides g ON g.id = a.guide_id
     WHERE a.student_id = ? AND g.published = 1 ORDER BY a.id`,
  ).bind(studentId).all<AssignmentRow>()
  return results
}

/** Tout ce qu'il faut à l'écran élève, en un seul appel. */
export async function home(env: Env, student: { id: number; prenom: string }, assignmentId: number | null): Promise<StudentHome> {
  const rows = await assignmentsOf(env, student.id)
  const wanted = assignmentId != null ? rows.find((r) => r.id === assignmentId) : rows.length === 1 ? rows[0] : undefined
  if (assignmentId != null && !wanted) throw new HttpError(404, 'Guide introuvable.')
  return {
    student,
    assignments: rows.map((r) => ({
      id: r.id, titre: r.titre, description: r.description, status: r.status,
      ratio: r.status === 'termine' ? 1 : r.total ? Math.min(0.95, r.done / r.total) : 0,
    })),
    tube: wanted ? await loadTube(env, wanted) : null,
  }
}

/** Valide la forme d'une action reçue du navigateur. */
export function parseAction(raw: Record<string, unknown>): StudentAction {
  const num = (v: unknown) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new HttpError(400, 'Action invalide.')
    return v
  }
  switch (raw.action) {
    case 'done': return { action: 'done', step_id: num(raw.step_id), answer: JSON.stringify(raw.answer ?? null).length <= 2000 ? raw.answer : null }
    case 'choose': return { action: 'choose', step_id: num(raw.step_id), option: num(raw.option) }
    case 'pause': return { action: 'pause', step_id: num(raw.step_id) }
    case 'help': return { action: 'help', step_id: num(raw.step_id), message: typeof raw.message === 'string' ? raw.message : '' }
    case 'jump': return { action: 'jump', to: num(raw.to) }
    case 'restart': return { action: 'restart' }
    case 'resume': return { action: 'resume' }
    case 'cancel_help': return { action: 'cancel_help' }
  }
  throw new HttpError(400, 'Action invalide.')
}

export async function act(env: Env, studentId: number, assignmentId: number, action: StudentAction): Promise<{ status: number; tube: TubeState }> {
  const row = (await assignmentsOf(env, studentId)).find((r) => r.id === assignmentId)
  if (!row) throw new HttpError(404, 'Guide introuvable.')
  const before = await loadTube(env, row)
  const { state, error } = applyAction(before, action)
  if (error === 'stale' || error === 'bloque') return { status: 409, tube: before } // l'écran n'était plus à jour
  if (error) throw new HttpError(400, 'Action impossible.')

  const db = env.DB
  const a = state.assignment
  const writes = [
    db.prepare("UPDATE assignments SET current_step_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?").bind(a.current_step_id, a.status, a.id),
  ]
  const markSeen = db.prepare("UPDATE help_requests SET seen_at = datetime('now') WHERE assignment_id = ? AND status = 'traite' AND seen_at IS NULL").bind(a.id)
  if (action.action === 'done' || action.action === 'choose') {
    writes.push(
      db.prepare(
        `INSERT INTO step_progress (assignment_id, step_id, status, answer, done_at) VALUES (?1, ?2, 'fait', ?3, datetime('now'))
         ON CONFLICT(assignment_id, step_id) DO UPDATE SET status = 'fait', answer = ?3, done_at = datetime('now')`,
      ).bind(a.id, action.step_id, JSON.stringify(state.progress[action.step_id]?.answer ?? null)),
      markSeen,
    )
  } else if (action.action === 'jump') {
    writes.push(markSeen)
  } else if (action.action === 'restart') {
    // Le premier chapitre (les outils) reste fait ; tout le reste repart de zéro.
    writes.push(
      db.prepare('DELETE FROM step_progress WHERE assignment_id = ? AND step_id NOT IN (SELECT id FROM steps WHERE chapter_id = ?)').bind(a.id, before.chapters[0].id),
      markSeen,
    )
  } else if (action.action === 'help') {
    writes.push(db.prepare('INSERT INTO help_requests (assignment_id, step_id, message) VALUES (?, ?, ?)').bind(a.id, action.step_id, state.help!.message))
  } else if (action.action === 'cancel_help') {
    writes.push(
      db.prepare("UPDATE help_requests SET status = 'traite', resolved_at = datetime('now'), seen_at = datetime('now') WHERE assignment_id = ? AND status = 'ouvert'").bind(a.id),
    )
  }
  await db.batch(writes)
  return { status: 200, tube: state }
}
