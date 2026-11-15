import { describe, expect, it } from 'vitest'
import { applyAction, buildSequence, locate, nextStep, normalizeCode, normalizePrenom, type Chapter, type Step, type TubeState } from '../shared/tube'

const chapters: Chapter[] = [
  { id: 1, position: 0, titre: 'Chapitre 0', objectif: '' },
  { id: 2, position: 1, titre: 'Chapitre 1', objectif: '' },
]
const step = (id: number, chapter_id: number, position: number, extra: Partial<Step> = {}): Step => ({
  id, chapter_id, position, type: 'action', ref: `s${id}`, titre: `Étape ${id}`, objectif: '', quoi_faire: '', config: {}, personal: false, inserted_before_step_id: null, ...extra,
})
const base: Step[] = [
  step(1, 1, 0),
  step(2, 1, 1, { type: 'choix', config: { options: [{ label: 'Oui', goto: 's4' }, { label: 'Non', goto: 's5' }, { label: 'Sais pas', goto: 's3' }] } }),
  step(3, 1, 2, { config: { apres: 's2' } }),
  step(4, 1, 3),
  step(5, 2, 0),
  step(6, 2, 1, { type: 'recap' }),
]
const state = (steps: Step[], current: number): TubeState => ({
  assignment: { id: 9, status: 'en_cours', current_step_id: current },
  guide: { id: 1, titre: 'G' }, chapters, steps: buildSequence(chapters, steps), progress: {}, help: null, notice: null,
})

describe('ordre des étapes', () => {
  it('suit les chapitres puis les positions, quel que soit l’ordre reçu', () => {
    expect(buildSequence(chapters, [...base].reverse()).map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6])
  })
  it('place les étapes d’aide juste avant leur cible', () => {
    const helpers = [step(11, 1, 1, { personal: true, inserted_before_step_id: 4 }), step(10, 1, 0, { personal: true, inserted_before_step_id: 4 })]
    expect(buildSequence(chapters, [...base, ...helpers]).map((s) => s.id)).toEqual([1, 2, 3, 10, 11, 4, 5, 6])
  })
})

describe('avancer dans le tube', () => {
  it('Oui passe à l’étape suivante et marque l’étape faite', () => {
    const { state: s } = applyAction(state(base, 1), { action: 'done', step_id: 1 })
    expect(s.assignment.current_step_id).toBe(2)
    expect(s.progress[1].status).toBe('fait')
  })
  it('un choix envoie directement vers sa cible', () => {
    expect(applyAction(state(base, 2), { action: 'choose', step_id: 2, option: 1 }).state.assignment.current_step_id).toBe(5)
  })
  it('« apres » fait boucler vers l’étape indiquée', () => {
    expect(applyAction(state(base, 3), { action: 'done', step_id: 3 }).state.assignment.current_step_id).toBe(2)
  })
  it('la dernière étape termine le guide', () => {
    const s = state(base, 6)
    expect(nextStep(s.steps, s.steps[5], {})).toBeNull()
    expect(applyAction(s, { action: 'done', step_id: 6 }).state.assignment.status).toBe('termine')
  })
  it('refuse une action sur une étape qui n’est plus à l’écran', () => {
    expect(applyAction(state(base, 1), { action: 'done', step_id: 4 }).error).toBe('stale')
  })
  it('un saut ne marque rien comme fait', () => {
    const { state: s } = applyAction(state(base, 1), { action: 'jump', to: 5 })
    expect(s.assignment.current_step_id).toBe(5)
    expect(s.progress).toEqual({})
  })
})

describe('pause et aide', () => {
  it('Pause garde la position, Reprendre relance', () => {
    const paused = applyAction(state(base, 4), { action: 'pause', step_id: 4 }).state
    expect(paused.assignment).toMatchObject({ status: 'en_pause', current_step_id: 4 })
    expect(applyAction(paused, { action: 'resume' }).state.assignment.status).toBe('en_cours')
  })
  it('À l’aide bloque l’élève et garde son message ; plus rien n’avance tant que c’est bloqué', () => {
    const blocked = applyAction(state(base, 4), { action: 'help', step_id: 4, message: '  perdu  ' }).state
    expect(blocked.assignment.status).toBe('bloque')
    expect(blocked.help?.message).toBe('perdu')
    expect(applyAction(blocked, { action: 'done', step_id: 4 }).error).toBe('bloque')
    expect(applyAction(blocked, { action: 'cancel_help' }).state.assignment.status).toBe('en_cours')
  })
  it('après les étapes d’aide, l’élève retombe sur l’étape où il bloquait', () => {
    const helpers = [step(10, 1, 0, { personal: true, inserted_before_step_id: 4 }), step(11, 1, 1, { personal: true, inserted_before_step_id: 4 })]
    let s = state([...base, ...helpers], 10)
    s = applyAction(s, { action: 'done', step_id: 10 }).state
    expect(s.assignment.current_step_id).toBe(11)
    s = applyAction(s, { action: 'done', step_id: 11 }).state
    expect(s.assignment.current_step_id).toBe(4)
  })
  it('un choix qui vise une étape passe d’abord par ses étapes d’aide pas encore faites', () => {
    const helpers = [step(10, 1, 0, { personal: true, inserted_before_step_id: 4 })]
    const s = state([...base, ...helpers], 2)
    expect(applyAction(s, { action: 'choose', step_id: 2, option: 0 }).state.assignment.current_step_id).toBe(10)
    const done = { ...s, progress: { 10: { status: 'fait' as const, answer: null } } }
    expect(applyAction(done, { action: 'choose', step_id: 2, option: 0 }).state.assignment.current_step_id).toBe(4)
  })
})

describe('nouveau site', () => {
  it('remet tout à zéro sauf le premier chapitre et repart au chapitre suivant', () => {
    const done = { status: 'fait' as const, answer: null }
    const s: TubeState = { ...state(base, 6), assignment: { id: 9, status: 'termine', current_step_id: 6 }, progress: { 1: done, 2: done, 4: done, 5: done, 6: done } }
    const { state: r } = applyAction(s, { action: 'restart' })
    expect(r.assignment).toMatchObject({ status: 'en_cours', current_step_id: 5 })
    expect(Object.keys(r.progress).map(Number).sort()).toEqual([1, 2, 4])
  })
  it('passe d’abord par une étape d’aide placée en tête du chapitre suivant', () => {
    const helper = step(10, 2, 0, { personal: true, inserted_before_step_id: 5 })
    expect(applyAction(state([...base, helper], 6), { action: 'restart' }).state.assignment.current_step_id).toBe(10)
  })
  it('impossible tant qu’une demande d’aide attend', () => {
    const s = applyAction(state(base, 4), { action: 'help', step_id: 4, message: 'perdu' }).state
    expect(applyAction(s, { action: 'restart' }).error).toBe('bloque')
  })
})

describe('repères', () => {
  it('le fil d’Ariane donne le chapitre et « étape n/total »', () => {
    const s = state(base, 5)
    expect(locate(chapters, s.steps, 5)).toMatchObject({ chapterIndex: 1, indexInChapter: 1, chapterTotal: 2 })
  })
  it('normalise prénom et code', () => {
    expect(normalizePrenom('  Éloïse  ')).toBe('eloise')
    expect(normalizeCode(' ab-c2 3d ')).toBe('ABC23D')
  })
})
