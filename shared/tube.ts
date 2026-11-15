// Logique du « tube », partagée entre l'API (qui fait foi) et l'aperçu élève de l'admin.

export type StepType = 'prerequis' | 'action' | 'verif' | 'choix' | 'recap'
export type AssignmentStatus = 'en_cours' | 'en_pause' | 'bloque' | 'termine'

export interface StepConfig {
  cases?: string[] // prerequis
  si_non?: string // verif : consigne de rattrapage
  options?: { label: string; goto: string | null }[] // choix
  points?: string[] // recap
  apres?: string | null // ref de l'étape affichée après un « Oui » (boucles)
}

export interface Step {
  id: number
  chapter_id: number
  position: number
  type: StepType
  ref: string
  titre: string
  objectif: string
  quoi_faire: string
  config: StepConfig
  personal: boolean // étape d'aide propre à un élève
  inserted_before_step_id: number | null
}

export interface Chapter {
  id: number
  position: number
  titre: string
  objectif: string
}

export type Progress = Record<number, { status: 'fait' | 'passe'; answer: unknown }>

export const STEP_TYPES: { type: StepType; label: string }[] = [
  { type: 'action', label: 'Action' },
  { type: 'verif', label: 'Vérification' },
  { type: 'choix', label: 'Choix' },
  { type: 'prerequis', label: 'Prérequis' },
  { type: 'recap', label: 'Récap' },
]

/** Ordre réel des étapes pour un élève : chapitres, puis positions, les étapes d'aide juste avant leur cible. */
export function buildSequence(chapters: Chapter[], steps: Step[]): Step[] {
  const chapterOrder = new Map(chapters.map((c, i) => [c.id, i]))
  const base = steps
    .filter((s) => !s.personal && chapterOrder.has(s.chapter_id))
    .sort((a, b) => chapterOrder.get(a.chapter_id)! - chapterOrder.get(b.chapter_id)! || a.position - b.position || a.id - b.id)
  const helpers = new Map<number, Step[]>()
  for (const s of steps) {
    if (!s.personal || s.inserted_before_step_id == null) continue
    const list = helpers.get(s.inserted_before_step_id) ?? []
    list.push(s)
    helpers.set(s.inserted_before_step_id, list)
  }
  const seq: Step[] = []
  for (const s of base) {
    const mine = helpers.get(s.id)
    if (mine) seq.push(...mine.sort((a, b) => a.position - b.position || a.id - b.id).map((h) => ({ ...h, chapter_id: s.chapter_id })))
    seq.push(s)
  }
  return seq
}

/** Quand on vise une étape, on passe d'abord par ses étapes d'aide pas encore faites. */
function entryPoint(seq: Step[], target: Step, progress: Progress): Step {
  let i = seq.indexOf(target)
  let entry = target
  while (i > 0 && seq[i - 1].personal && seq[i - 1].inserted_before_step_id === target.id) {
    i--
    if (!progress[seq[i].id]) entry = seq[i]
  }
  return entry
}

function byRef(seq: Step[], ref: string | null | undefined): Step | undefined {
  if (!ref) return undefined
  return seq.find((s) => !s.personal && s.ref === ref)
}

/** Étape suivante après validation. `null` = le guide est terminé. */
export function nextStep(seq: Step[], current: Step, progress: Progress, choice?: number): Step | null {
  let target: Step | undefined
  if (current.type === 'choix' && choice != null) target = byRef(seq, current.config.options?.[choice]?.goto)
  if (!target) target = byRef(seq, current.config.apres)
  if (target) return entryPoint(seq, target, progress)
  const i = seq.findIndex((s) => s.id === current.id)
  return seq[i + 1] ?? null
}

export interface Place {
  chapter: Chapter | undefined
  chapterIndex: number
  indexInChapter: number // à partir de 1
  chapterTotal: number
  ratio: number // avancement dans le guide, de 0 à 1
}

export function locate(chapters: Chapter[], seq: Step[], stepId: number | null): Place {
  const i = Math.max(0, seq.findIndex((s) => s.id === stepId))
  const step = seq[i]
  const inChapter = seq.filter((s) => s.chapter_id === step?.chapter_id)
  const chapterIndex = chapters.findIndex((c) => c.id === step?.chapter_id)
  return {
    chapter: chapters[chapterIndex],
    chapterIndex,
    indexInChapter: inChapter.indexOf(step) + 1,
    chapterTotal: inChapter.length,
    ratio: seq.length ? i / seq.length : 0,
  }
}

/** Ce que reçoit l'écran élève en un seul appel. */
export interface TubeState {
  assignment: { id: number; status: AssignmentStatus; current_step_id: number | null }
  guide: { id: number; titre: string }
  chapters: Chapter[]
  steps: Step[] // déjà dans l'ordre réel
  progress: Progress
  help: { message: string; created_at: string } | null // blocage en attente
  notice: { reply: string | null; added: number } | null // aide ajoutée par l'admin, pas encore vue
}

export interface StudentHome {
  student: { id: number; prenom: string }
  assignments: { id: number; titre: string; description: string; status: AssignmentStatus; ratio: number }[]
  tube: TubeState | null
}

export type StudentAction =
  | { action: 'done'; step_id: number; answer?: unknown }
  | { action: 'choose'; step_id: number; option: number }
  | { action: 'pause'; step_id: number }
  | { action: 'resume' }
  | { action: 'help'; step_id: number; message: string }
  | { action: 'cancel_help' }
  | { action: 'jump'; to: number }
  | { action: 'restart' } // nouveau tour : tout est remis à zéro sauf le premier chapitre

/** Applique une action d'élève à un état, sans rien écrire : sert à l'API et à l'aperçu. */
export function applyAction(state: TubeState, act: StudentAction): { state: TubeState; error?: string } {
  const s: TubeState = { ...state, assignment: { ...state.assignment }, progress: { ...state.progress } }
  const seq = s.steps
  const current = seq.find((x) => x.id === s.assignment.current_step_id)
  const stale = (id: number) => !current || current.id !== id
  switch (act.action) {
    case 'done':
    case 'choose': {
      if (stale(act.step_id)) return { state, error: 'stale' }
      if (s.assignment.status === 'bloque') return { state, error: 'bloque' }
      const isChoice = act.action === 'choose'
      if (isChoice !== (current!.type === 'choix')) return { state, error: 'invalid' }
      if (isChoice && !current!.config.options?.[act.option]) return { state, error: 'invalid' }
      const answer = isChoice ? { option: act.option, label: current!.config.options![act.option].label } : (act.answer ?? null)
      s.progress[current!.id] = { status: 'fait', answer }
      const next = nextStep(seq, current!, s.progress, isChoice ? act.option : undefined)
      if (next) {
        s.assignment.current_step_id = next.id
        s.assignment.status = 'en_cours'
      } else s.assignment.status = 'termine'
      s.notice = null
      return { state: s }
    }
    case 'pause':
      if (stale(act.step_id)) return { state, error: 'stale' }
      if (s.assignment.status === 'en_cours') s.assignment.status = 'en_pause'
      return { state: s }
    case 'resume':
      if (s.assignment.status === 'en_pause') s.assignment.status = 'en_cours'
      return { state: s }
    case 'help': {
      if (stale(act.step_id)) return { state, error: 'stale' }
      const message = act.message.trim().slice(0, 2000)
      if (!message) return { state, error: 'invalid' }
      if (s.assignment.status === 'bloque') return { state, error: 'bloque' }
      s.assignment.status = 'bloque'
      s.help = { message, created_at: new Date().toISOString() }
      return { state: s }
    }
    case 'cancel_help':
      if (s.assignment.status !== 'bloque') return { state, error: 'invalid' }
      s.assignment.status = 'en_cours'
      s.help = null
      return { state: s }
    case 'jump': {
      if (s.assignment.status === 'bloque') return { state, error: 'bloque' }
      const target = seq.find((x) => x.id === act.to)
      if (!target) return { state, error: 'invalid' }
      s.assignment.current_step_id = target.id
      s.assignment.status = 'en_cours'
      s.notice = null
      return { state: s }
    }
    case 'restart': {
      if (s.assignment.status === 'bloque') return { state, error: 'bloque' }
      const [setup, second] = s.chapters
      const start = second && seq.find((x) => x.chapter_id === second.id)
      if (!start) return { state, error: 'invalid' }
      for (const x of seq) if (x.chapter_id !== setup.id) delete s.progress[x.id]
      s.assignment.current_step_id = start.id
      s.assignment.status = 'en_cours'
      s.notice = null
      return { state: s }
    }
  }
}

/** Le guide permet-il un nouveau tour (au moins 2 chapitres) ? */
export const canRestart = (state: Pick<TubeState, 'chapters'>) => state.chapters.length >= 2

/** Titre affichable d'une étape, quel que soit son type. */
export function stepLabel(step: Pick<Step, 'type' | 'titre'>): string {
  if (step.titre) return step.titre
  return step.type === 'recap' ? 'Ce que tu viens de faire' : step.type === 'prerequis' ? 'Avant de commencer' : 'Étape'
}

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sans 0/O, 1/I/L

export function normalizePrenom(p: string): string {
  return p.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60)
}

export function normalizeCode(c: string): string {
  return c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}
