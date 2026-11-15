// Vérifie le guide de départ tel qu'il sera importé : chaque cible existe, chaque chemin mène quelque part.
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import raw from '../seed/guide-site-web.yaml?raw'
import { applyAction, buildSequence, type Chapter, type Step, type StepType, type TubeState } from '../shared/tube'

interface YStep { type: StepType; id?: string; titre?: string; question?: string; quoi?: string; si_non?: string; cases?: string[]; points?: string[]; options?: { label: string; goto: string }[]; apres?: string }
const data = parse(raw) as { guide: string; chapitres: { titre: string; etapes: YStep[] }[] }

const chapters: Chapter[] = data.chapitres.map((c, ci) => ({ id: ci + 1, position: ci, titre: c.titre, objectif: '' }))
let nextId = 1
const steps: Step[] = data.chapitres.flatMap((c, ci) => c.etapes.map((e, si) => ({
  id: nextId++, chapter_id: ci + 1, position: si, type: e.type, ref: e.id || `c${ci}e${si + 1}`,
  titre: e.titre || e.question || '', objectif: '', quoi_faire: e.quoi || '',
  config: { cases: e.cases, points: e.points, si_non: e.si_non, options: e.options, apres: e.apres },
  personal: false, inserted_before_step_id: null,
})))
const seq = buildSequence(chapters, steps)
const byTitle = (t: string) => seq.find((s) => s.titre.startsWith(t))!
const at = (titre: string): TubeState => ({
  assignment: { id: 1, status: 'en_cours', current_step_id: byTitle(titre).id },
  guide: { id: 1, titre: data.guide }, chapters, steps: seq, progress: {}, help: null, notice: null,
})
const here = (s: TubeState) => seq.find((x) => x.id === s.assignment.current_step_id)!.titre
const yes = (s: TubeState) => applyAction(s, { action: 'done', step_id: s.assignment.current_step_id! }).state
const pick = (s: TubeState, option: number) => applyAction(s, { action: 'choose', step_id: s.assignment.current_step_id!, option }).state

describe('guide de départ', () => {
  it('ne parle plus de Supabase : tout est chez Cloudflare', () => {
    expect(raw.toLowerCase()).not.toContain('supabase')
  })

  it('chaque cible (goto, apres) existe', () => {
    const refs = new Set(steps.map((s) => s.ref))
    for (const s of steps) {
      for (const o of s.config.options ?? []) expect(refs, `${s.titre} → ${o.goto}`).toContain(o.goto)
      if (s.config.apres) expect(refs, `${s.titre} → ${s.config.apres}`).toContain(s.config.apres)
    }
  })

  it('chaque chapitre commence par ses prérequis et se termine par son récap', () => {
    for (const c of chapters) {
      const mine = seq.filter((s) => s.chapter_id === c.id)
      expect(mine[0].type).toBe('prerequis')
      expect(mine.at(-1)!.type).toBe('recap')
    }
  })

  it('base de données « Oui » : créer la base, la donner à Claude Code, envoyer', () => {
    let s = pick(at('Ton site a-t-il besoin'), 0)
    expect(here(s)).toBe('Crée la base de données')
    s = yes(s)
    expect(here(s)).toBe('Donne-la à Claude Code')
    s = yes(s)
    expect(here(s)).toBe('Envoie et laisse Claude travailler')
    expect(here(yes(s))).toBe('Enregistre le travail dans GitHub')
  })

  it('base de données « Non » : on envoie directement', () => {
    expect(here(pick(at('Ton site a-t-il besoin'), 1))).toBe('Envoie et laisse Claude travailler')
  })

  it('« Je ne sais plus » : on demande à Claude puis on revient à la question', () => {
    const s = pick(at('Ton site a-t-il besoin'), 2)
    expect(here(s)).toBe('Demande à Claude')
    expect(here(yes(s))).toMatch(/^Ton site a-t-il besoin/)
  })

  it('les boucles bug et modifications client reviennent au bon endroit', () => {
    let s = pick(at('Alors ?'), 1)
    expect(here(s)).toBe('Explique le problème à Claude Code')
    s = yes(yes(s))
    expect(here(s)).toBe('Teste sur ordinateur')
    s = pick(at('Le client veut des modifications'), 0)
    expect(here(yes(s))).toBe('Montre le site au client')
  })

  it('on peut aller du début à la fin en répondant Oui partout', () => {
    let s = at('Avant de commencer')
    for (let i = 0; i < 200 && s.assignment.status !== 'termine'; i++) {
      const cur = seq.find((x) => x.id === s.assignment.current_step_id)!
      s = cur.type === 'choix' ? pick(s, cur.titre.startsWith('Ton site') ? 1 : cur.titre === 'Alors ?' ? 0 : 1) : yes(s)
    }
    expect(s.assignment.status).toBe('termine')
  })
})
