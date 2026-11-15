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
  it('le guide propose les 3 stockages, et Claude les nomme avec les mêmes mots au chapitre 1', () => {
    const choix = byTitle('Quel stockage pour ton site')
    expect(choix.config.options!.map((o) => o.label)).toEqual(['Aucun', 'Cloudflare D1', 'Supabase', 'Je ne sais plus'])
    for (const phrase of ['« Stockage : aucun »', '« Stockage : Cloudflare D1 »', '« Stockage : Supabase »']) expect(raw).toContain(phrase)
  })

  it('le chapitre 0 ne demande ni Supabase ni connecteur (seulement si le site a des photos)', () => {
    expect(seq.filter((s) => s.chapter_id === 1).map((s) => s.titre).join(' ')).not.toMatch(/supabase|connecteur/i)
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

  const choice = (o: number) => pick(at('Quel stockage pour ton site'), o)
  const walk = (s: TubeState, n: number) => { const seen = [here(s)]; for (let i = 0; i < n; i++) { s = yes(s); seen.push(here(s)) } return seen }

  it('stockage « Aucun » : on envoie directement, puis on enregistre dans GitHub', () => {
    expect(walk(choice(0), 1)).toEqual(['Envoie et laisse Claude travailler', 'Enregistre le travail dans GitHub'])
  })

  it('stockage « Cloudflare D1 » : créer la base, la donner à Claude Code, envoyer, enregistrer', () => {
    expect(walk(choice(1), 3)).toEqual(['Crée la base de données', 'Donne-la à Claude Code', 'Envoie et laisse Claude travailler', 'Enregistre le travail dans GitHub'])
  })

  it('stockage « Supabase » : compte, connecteur, envoi, création de la base, clés, enregistrer (sans passer par D1)', () => {
    expect(walk(choice(2), 5)).toEqual([
      'Compte Supabase', 'Ajoute le connecteur Supabase', 'Envoie ton message à Claude Code',
      'Fais créer la base par Claude', 'Donne les clés à Claude Code', 'Enregistre le travail dans GitHub',
    ])
  })

  it('« Je ne sais plus » : on demande à Claude puis on revient à la question', () => {
    const s = choice(3)
    expect(here(s)).toBe('Demande à Claude')
    expect(here(yes(s))).toBe('Quel stockage pour ton site ?')
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
      s = cur.type === 'choix' ? pick(s, cur.titre.startsWith('Quel stockage') ? 2 : cur.titre === 'Alors ?' ? 0 : 1) : yes(s)
    }
    expect(s.assignment.status).toBe('termine')
  })
})
