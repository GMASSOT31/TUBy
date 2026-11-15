import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { applyAction, buildSequence, STEP_TYPES, stepLabel, type Chapter, type Step, type StepConfig, type StepType, type StudentAction, type TubeState } from '../../shared/tube'
import { api } from '../api'
import { Tube } from '../student/Tube'
import { Button, Card, Field, Icon, Notice, Select, Sheet, TextArea } from '../ui'
import { H1, useOverview, useRun } from './AdminApp'

interface GuideData { guide: { id: number; titre: string; description: string; published: number }; chapters: Chapter[]; steps: Step[] }
export interface StepDraft { type: StepType; titre: string; objectif: string; quoi_faire: string; config: StepConfig }
export const emptyStep = (): StepDraft => ({ type: 'action', titre: '', objectif: '', quoi_faire: '', config: {} })
export interface Target { ref: string; label: string }

function useGuide() {
  const id = Number(useParams().id)
  const [data, setData] = useState<GuideData | null>(null)
  const { error, run } = useRun()
  const load = useCallback(() => run(async () => setData(await api<GuideData>(`admin/guides/${id}`))), [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])
  return { id, data, load, error, run }
}

const TYPE_LABEL = Object.fromEntries(STEP_TYPES.map((t) => [t.type, t.label])) as Record<StepType, string>
const targetsOf = (d: GuideData): Target[] =>
  d.chapters.flatMap((c, ci) => d.steps.filter((s) => s.chapter_id === c.id).map((s, si) => ({ ref: s.ref, label: `Ch. ${ci + 1} · ${si + 1}. ${stepLabel(s)}` })))

const lines = (v: string[] | undefined) => (v ?? []).join('\n')
const toLines = (v: string) => v.split('\n')

/** Formulaire d'une étape (éditeur de guide et étapes intermédiaires d'un blocage). */
export function StepForm({ value, onChange, targets }: { value: StepDraft; onChange: (v: StepDraft) => void; targets?: Target[] }) {
  const set = (patch: Partial<StepDraft>) => onChange({ ...value, ...patch })
  const cfg = (patch: Partial<StepConfig>) => onChange({ ...value, config: { ...value.config, ...patch } })
  const options = value.config.options ?? []
  const isQuestion = value.type === 'verif' || value.type === 'choix'
  const targetSelect = (label: string, current: string | null | undefined, onPick: (ref: string | null) => void) => (
    <Select label={label} value={current ?? ''} onChange={(e) => onPick(e.target.value || null)}>
      <option value="">L’étape suivante dans l’ordre</option>
      {(targets ?? []).map((t) => <option key={t.ref} value={t.ref}>{t.label}</option>)}
    </Select>
  )
  return (
    <div className="space-y-3">
      <Select label="Type d’étape" value={value.type} onChange={(e) => {
        const type = e.target.value as StepType
        set({ type, config: type === 'choix' && (value.config.options ?? []).length < 2 ? { ...value.config, options: [{ label: 'Oui', goto: null }, { label: 'Non', goto: null }] } : value.config })
      }}>
        {STEP_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
      </Select>
      <Field label={isQuestion ? 'Question posée à l’élève' : 'Titre'} value={value.titre} onChange={(e) => set({ titre: e.target.value })} maxLength={300}
        placeholder={value.type === 'recap' ? 'Ce que tu viens de faire' : value.type === 'verif' ? 'T’as pensé à… ?' : ''} />
      {value.type === 'action' && <Field label="Objectif (une phrase)" value={value.objectif} onChange={(e) => set({ objectif: e.target.value })} maxLength={600} />}
      {value.type !== 'recap' && (
        <TextArea label={value.type === 'action' ? 'Quoi faire' : 'Texte d’explication (facultatif)'} rows={value.type === 'action' ? 5 : 2} value={value.quoi_faire} onChange={(e) => set({ quoi_faire: e.target.value })}
          hint={<>Une ligne = un paragraphe. Une ligne qui commence par <code>[À COPIER]</code> devient un bloc avec bouton Copier. Lien : <code>[texte](https://…)</code>.</>} />
      )}
      {value.type === 'prerequis' && <TextArea label="Cases à cocher (une par ligne)" rows={4} value={lines(value.config.cases)} onChange={(e) => cfg({ cases: toLines(e.target.value) })} />}
      {value.type === 'recap' && <TextArea label="Points du récap (un par ligne)" rows={4} value={lines(value.config.points)} onChange={(e) => cfg({ points: toLines(e.target.value) })} />}
      {value.type === 'verif' && <TextArea label="Consigne si l’élève répond « Non »" value={value.config.si_non ?? ''} onChange={(e) => cfg({ si_non: e.target.value })} />}
      {value.type === 'choix' && (
        <div className="space-y-3">
          {options.map((o, i) => (
            <div key={i} className="rounded-control border border-line p-3">
              <div className="flex items-end gap-2">
                <Field className="flex-1" label={`Bouton ${i + 1}`} value={o.label} onChange={(e) => cfg({ options: options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} maxLength={120} />
                {options.length > 2 && <Button small variant="danger" icon="trash" aria-label="Supprimer ce bouton" onClick={() => cfg({ options: options.filter((_, j) => j !== i) })} />}
              </div>
              {targets && <div className="mt-2">{targetSelect('Envoie vers', o.goto, (ref) => cfg({ options: options.map((x, j) => (j === i ? { ...x, goto: ref } : x)) }))}</div>}
            </div>
          ))}
          {options.length < 4 && <Button small variant="secondary" icon="plus" onClick={() => cfg({ options: [...options, { label: '', goto: null }] })}>Ajouter un bouton</Button>}
        </div>
      )}
      {targets && value.type !== 'choix' && targetSelect('Après validation, aller à', value.config.apres, (ref) => cfg({ apres: ref }))}
    </div>
  )
}

// ── Éditeur : chapitres → étapes ──────────────────────────────────────────────

export function GuideEditor() {
  const { id, data, load, error, run } = useGuide()
  const { refresh } = useOverview()
  const [stepSheet, setStepSheet] = useState<{ chapterId: number; stepId: number | null; draft: StepDraft } | null>(null)
  const [chapterSheet, setChapterSheet] = useState<{ id: number | null; titre: string; objectif: string } | null>(null)
  const [meta, setMeta] = useState<{ titre: string; description: string } | null>(null)
  const targets = useMemo(() => (data ? targetsOf(data) : []), [data])
  if (!data) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">Chargement…</p>
  const g = data.guide
  const reload = async () => { await load(); void refresh() }
  const move = <T extends { id: number }>(list: T[], index: number, delta: number) => {
    const ids = list.map((x) => x.id)
    const j = index + delta
    if (j < 0 || j >= ids.length) return null
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    return ids
  }

  const saveStep = () => run(async () => {
    const s = stepSheet!
    if (s.stepId) await api(`admin/steps/${s.stepId}`, { method: 'PATCH', body: s.draft })
    else await api(`admin/chapters/${s.chapterId}/steps`, { body: s.draft })
    setStepSheet(null)
    await reload()
  })
  const saveChapter = () => run(async () => {
    const c = chapterSheet!
    if (c.id) await api(`admin/chapters/${c.id}`, { method: 'PATCH', body: c })
    else await api(`admin/guides/${id}/chapters`, { body: c })
    setChapterSheet(null)
    await reload()
  })

  return (
    <>
      <Link to="/guides" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"><Icon name="back" size={18} /> Tous les guides</Link>
      <H1>{g.titre}</H1>
      {g.description && <p className="-mt-2 mb-4 text-muted">{g.description}</p>}
      <div className="mb-5 flex flex-wrap gap-2">
        <Link to={`/guides/${id}/apercu`}><Button small icon="eye">Aperçu élève</Button></Link>
        <Link to={`/guides/${id}/plan`}><Button small variant="secondary" icon="list">Plan du guide</Button></Link>
        <Button small variant="neutral" icon="pencil" onClick={() => setMeta({ titre: g.titre, description: g.description })}>Titre</Button>
        <Button small variant="neutral" onClick={() => void run(async () => { await api(`admin/guides/${id}`, { method: 'PATCH', body: { published: !g.published } }); await reload() })}>
          {g.published ? 'Publié · repasser en brouillon' : 'Brouillon · publier'}
        </Button>
      </div>
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}

      <div className="space-y-4">
        {data.chapters.map((ch, ci) => {
          const steps = data.steps.filter((s) => s.chapter_id === ch.id)
          return (
            <Card key={ch.id} className="p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold leading-snug">{ch.titre}</h2>
                  {ch.objectif && <p className="text-sm text-muted">{ch.objectif}</p>}
                </div>
                <div className="flex shrink-0">
                  <IconBtn icon="up" label="Monter le chapitre" disabled={ci === 0} onClick={() => { const ids = move(data.chapters, ci, -1); if (ids) void run(async () => { await api(`admin/guides/${id}/order`, { body: { ids } }); await reload() }) }} />
                  <IconBtn icon="down" label="Descendre le chapitre" disabled={ci === data.chapters.length - 1} onClick={() => { const ids = move(data.chapters, ci, 1); if (ids) void run(async () => { await api(`admin/guides/${id}/order`, { body: { ids } }); await reload() }) }} />
                  <IconBtn icon="pencil" label="Modifier le chapitre" onClick={() => setChapterSheet({ id: ch.id, titre: ch.titre, objectif: ch.objectif })} />
                  <IconBtn icon="trash" label="Supprimer le chapitre" onClick={() => { if (window.confirm(`Supprimer « ${ch.titre} » et ses ${steps.length} étapes ?`)) void run(async () => { await api(`admin/chapters/${ch.id}`, { method: 'DELETE' }); await reload() }) }} />
                </div>
              </div>
              <ol className="mt-3 divide-y divide-line border-y border-line">
                {steps.map((s, si) => (
                  <li key={s.id} className="flex items-center gap-1 py-1.5">
                    <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setStepSheet({ chapterId: ch.id, stepId: s.id, draft: { type: s.type, titre: s.titre, objectif: s.objectif, quoi_faire: s.quoi_faire, config: s.config } })}>
                      <span className="w-6 shrink-0 text-right text-sm text-muted">{si + 1}</span>
                      <span className="min-w-0 leading-snug">
                        <span className="line-clamp-2">{stepLabel(s)}</span>
                        <span className="text-xs font-semibold text-accent">{TYPE_LABEL[s.type]}</span>
                      </span>
                    </button>
                    <IconBtn icon="up" label="Monter l’étape" disabled={si === 0} onClick={() => { const ids = move(steps, si, -1); if (ids) void run(async () => { await api(`admin/chapters/${ch.id}/order`, { body: { ids } }); await reload() }) }} />
                    <IconBtn icon="down" label="Descendre l’étape" disabled={si === steps.length - 1} onClick={() => { const ids = move(steps, si, 1); if (ids) void run(async () => { await api(`admin/chapters/${ch.id}/order`, { body: { ids } }); await reload() }) }} />
                  </li>
                ))}
              </ol>
              <Button small variant="ghost" icon="plus" className="mt-2" onClick={() => setStepSheet({ chapterId: ch.id, stepId: null, draft: emptyStep() })}>Ajouter une étape</Button>
            </Card>
          )
        })}
      </div>
      <Button className="mt-4 w-full" variant="secondary" icon="plus" onClick={() => setChapterSheet({ id: null, titre: '', objectif: '' })}>Ajouter un chapitre</Button>

      <Sheet wide open={!!stepSheet} onClose={() => setStepSheet(null)} title={stepSheet?.stepId ? 'Modifier l’étape' : 'Nouvelle étape'}>
        {stepSheet && <StepForm value={stepSheet.draft} onChange={(draft) => setStepSheet({ ...stepSheet, draft })} targets={targets} />}
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
        <Button className="mt-4 w-full" onClick={() => void saveStep()}>Enregistrer</Button>
        {stepSheet?.stepId && (
          <Button className="mt-3 w-full" variant="danger" icon="trash" onClick={() => {
            if (window.confirm('Supprimer cette étape ?')) void run(async () => { await api(`admin/steps/${stepSheet.stepId}`, { method: 'DELETE' }); setStepSheet(null); await reload() })
          }}>Supprimer l’étape</Button>
        )}
      </Sheet>

      <Sheet open={!!chapterSheet} onClose={() => setChapterSheet(null)} title={chapterSheet?.id ? 'Modifier le chapitre' : 'Nouveau chapitre'}>
        {chapterSheet && (
          <div className="space-y-3">
            <Field label="Titre" value={chapterSheet.titre} onChange={(e) => setChapterSheet({ ...chapterSheet, titre: e.target.value })} maxLength={200} />
            <Field label="Objectif" value={chapterSheet.objectif} onChange={(e) => setChapterSheet({ ...chapterSheet, objectif: e.target.value })} maxLength={600} />
            <Button className="w-full" disabled={!chapterSheet.titre.trim()} onClick={() => void saveChapter()}>Enregistrer</Button>
          </div>
        )}
      </Sheet>

      <Sheet open={!!meta} onClose={() => setMeta(null)} title="Titre du guide">
        {meta && (
          <div className="space-y-3">
            <Field label="Titre" value={meta.titre} onChange={(e) => setMeta({ ...meta, titre: e.target.value })} maxLength={200} />
            <TextArea label="Description" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} maxLength={1000} />
            <Button className="w-full" disabled={!meta.titre.trim()} onClick={() => void run(async () => { await api(`admin/guides/${id}`, { method: 'PATCH', body: meta }); setMeta(null); await reload() })}>Enregistrer</Button>
          </div>
        )}
      </Sheet>
    </>
  )
}

function IconBtn({ icon, label, ...rest }: { icon: 'up' | 'down' | 'pencil' | 'trash'; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className="pressable flex size-11 shrink-0 items-center justify-center rounded-full text-muted disabled:opacity-25">
      <Icon name={icon} size={18} />
    </button>
  )
}

// ── Aperçu élève : le vrai tube, sans rien enregistrer ───────────────────────

export function GuidePreview() {
  const { id, data, error } = useGuide()
  const [state, setState] = useState<TubeState | null>(null)
  useEffect(() => {
    if (!data) return
    const steps = buildSequence(data.chapters, data.steps)
    setState({ assignment: { id: 0, status: 'en_cours', current_step_id: steps[0]?.id ?? null }, guide: data.guide, chapters: data.chapters, steps, progress: {}, help: null, notice: null })
  }, [data])
  if (!state) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">Chargement…</p>
  const act = (a: StudentAction) => setState((s) => (s ? applyAction(s, a).state : s))
  return (
    <div className="fixed inset-0 z-40 bg-bg">
      <Tube state={state} onAct={act} planFooter={<Link to={`/guides/${id}`} className="flex min-h-11 items-center gap-1 text-sm font-semibold text-accent"><Icon name="back" size={18} /> Quitter l’aperçu</Link>} />
      <Link to={`/guides/${id}`} className="fixed right-3 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))] z-40 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-bg shadow-pop">Aperçu · quitter</Link>
    </div>
  )
}

// ── Plan du guide : le parcours en liste, avec ses embranchements et ses boucles ──

const TYPE_STYLE: Record<StepType, string> = {
  prerequis: 'bg-line text-muted',
  action: 'bg-accent-soft text-accent',
  verif: 'bg-line text-warn',
  choix: 'bg-accent text-on-accent',
  recap: 'bg-line text-ok',
}

interface Pos { chapter: number; index: number; step: Step }

export function GuideDiagram() {
  const { id, data, error } = useGuide()
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [details, setDetails] = useState<Set<number>>(new Set())
  const [flash, setFlash] = useState<number | null>(null)
  const started = useRef(false)

  const { byRef, order } = useMemo(() => {
    const byRef = new Map<string, Pos>()
    const order = new Map<number, Pos>()
    data?.chapters.forEach((c, ci) => data.steps.filter((s) => s.chapter_id === c.id).forEach((s, si) => {
      const pos = { chapter: ci, index: si, step: s }
      byRef.set(s.ref, pos)
      order.set(s.id, pos)
    }))
    return { byRef, order }
  }, [data])

  useEffect(() => {
    if (data && !started.current) { started.current = true; setOpen(new Set(data.chapters.slice(0, 1).map((c) => c.id))) }
  }, [data])

  if (!data) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">Chargement…</p>

  const toggle = (set: Set<number>, n: number) => { const next = new Set(set); if (next.has(n)) next.delete(n); else next.add(n); return next }
  const allOpen = open.size === data.chapters.length

  /** Ouvre le chapitre visé, fait défiler jusqu'à l'étape et la met en évidence un instant. */
  const goTo = (pos: Pos) => {
    const chapterId = data.chapters[pos.chapter].id
    setOpen((o) => new Set(o).add(chapterId))
    window.setTimeout(() => {
      document.getElementById(`step-${pos.step.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlash(pos.step.id)
      window.setTimeout(() => setFlash(null), 1600)
    }, 60)
  }
  const jumpChapter = (ci: number) => {
    const c = data.chapters[ci]
    setOpen((o) => new Set(o).add(c.id))
    window.setTimeout(() => document.getElementById(`chapitre-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  const label = (p: Pos) => `${p.chapter}.${p.index + 1} ${stepLabel(p.step)}`
  /** Pastille cliquable vers une autre étape ; ↩ si on revient en arrière (boucle). */
  const Target = ({ from, to }: { from: Pos; to: Pos | undefined }) => {
    if (!to) return <span className="text-muted">l’étape suivante</span>
    const back = to.chapter < from.chapter || (to.chapter === from.chapter && to.index <= from.index)
    return (
      <button type="button" onClick={() => goTo(to)} className="pressable inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-left text-sm font-medium text-accent">
        <span aria-hidden="true">{back ? '↩' : '→'}</span>
        <span className="min-w-0 leading-snug">{label(to)}</span>
        {back && <span className="sr-only">(retour en arrière)</span>}
      </button>
    )
  }

  return (
    <>
      <Link to={`/guides/${id}`} className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"><Icon name="back" size={18} /> Retour au guide</Link>
      <H1>Plan du guide</H1>
      <p className="-mt-2 mb-4 text-muted">{data.guide.titre}</p>

      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2 overflow-x-auto pb-1" role="navigation" aria-label="Aller à un chapitre">
          {data.chapters.map((c, ci) => (
            <button key={c.id} type="button" onClick={() => jumpChapter(ci)} className="pressable min-h-10 shrink-0 rounded-full bg-accent-soft px-4 text-sm font-semibold text-accent">Ch. {ci}</button>
          ))}
          <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(data.chapters.map((c) => c.id)))} className="min-h-10 shrink-0 px-3 text-sm font-medium text-muted underline underline-offset-2">
            {allOpen ? 'Tout replier' : 'Tout déplier'}
          </button>
        </div>
      </div>

      <details className="mb-4 rounded-control border border-line bg-surface px-4 py-2 text-sm">
        <summary className="flex min-h-11 items-center font-medium text-muted">Légende</summary>
        <div className="space-y-2 pb-2">
          <div className="flex flex-wrap gap-2">{STEP_TYPES.map((t) => <span key={t.type} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TYPE_STYLE[t.type]}`}>{t.label}</span>)}</div>
          <p className="text-muted"><strong className="text-ink">→</strong> vers une étape plus loin · <strong className="text-ink">↩</strong> retour en arrière (boucle). Touche une pastille pour y aller.</p>
        </div>
      </details>

      <div className="space-y-4">
        {data.chapters.map((c, ci) => {
          const steps = data.steps.filter((s) => s.chapter_id === c.id)
          const isOpen = open.has(c.id)
          return (
            <Card key={c.id} className="overflow-hidden">
              <div id={`chapitre-${c.id}`} className="scroll-mt-20" />
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(toggle(open, c.id))} className="flex min-h-touch w-full items-center gap-3 px-4 py-3 text-left">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-on-accent">{ci}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{c.titre.replace(/^Chapitre\s*\d+\s*·\s*/i, '')}</span>
                  <span className="text-sm text-muted">{steps.length} étape{steps.length > 1 ? 's' : ''}</span>
                </span>
                <span className={`text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}><Icon name="chevron" size={18} /></span>
              </button>
              {isOpen && (
                <div className="border-t border-line px-4 pb-4 pt-3">
                  {c.objectif && <p className="mb-3 text-sm text-muted">{c.objectif}</p>}
                  <ol className="relative ml-4 border-l-2 border-line">
                    {steps.map((s, si) => {
                      const here = order.get(s.id)!
                      const expanded = details.has(s.id)
                      const hasMore = !!(s.objectif || s.quoi_faire || s.config.cases?.length || s.config.points?.length)
                      return (
                        <li key={s.id} id={`step-${s.id}`} className={`relative scroll-mt-28 rounded-control py-2 pl-5 pr-2 transition-colors duration-500 ${flash === s.id ? 'bg-accent-soft' : ''}`}>
                          <span className={`absolute -left-[0.6rem] top-4 flex size-5 items-center justify-center rounded-full border-2 border-surface text-[0.65rem] font-bold ${TYPE_STYLE[s.type]}`}>{si + 1}</span>
                          <button type="button" disabled={!hasMore} aria-expanded={hasMore ? expanded : undefined} onClick={() => setDetails(toggle(details, s.id))} className="flex min-h-11 w-full flex-col items-start gap-1 text-left">
                            <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${TYPE_STYLE[s.type]}`}>{TYPE_LABEL[s.type]}</span>
                            <span className="font-medium leading-snug">{stepLabel(s)}</span>
                          </button>

                          {expanded && (
                            <div className="anim-fade mt-1 space-y-2 rounded-control bg-bg p-3 text-sm">
                              {s.objectif && <p><strong>Objectif :</strong> {s.objectif}</p>}
                              {s.quoi_faire && <p className="line-clamp-6 whitespace-pre-wrap text-muted">{s.quoi_faire.replace(/\[À COPIER\]\s*/gi, '📋 ')}</p>}
                              {s.config.cases && <ul className="list-inside list-disc text-muted">{s.config.cases.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                              {s.config.points && <ul className="list-inside list-disc text-muted">{s.config.points.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                            </div>
                          )}

                          {s.type === 'choix' && (
                            <ul className="mt-1 space-y-2">
                              {(s.config.options ?? []).map((o, i) => (
                                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                                  <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">{o.label}</span>
                                  <Target from={here} to={o.goto ? byRef.get(o.goto) : undefined} />
                                </li>
                              ))}
                            </ul>
                          )}
                          {s.type === 'verif' && s.config.si_non && (
                            <p className="mt-1 text-sm text-muted"><strong className="text-ink">Si « Non » :</strong> <span className="line-clamp-2">{s.config.si_non}</span></p>
                          )}
                          {s.type !== 'choix' && s.config.apres && (
                            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">Après « Oui » :</span><Target from={here} to={byRef.get(s.config.apres)} /></p>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                  {ci < data.chapters.length - 1 && <p className="mt-3 text-sm text-muted">↓ puis chapitre {ci + 1}</p>}
                  {ci === data.chapters.length - 1 && <p className="mt-3 text-sm font-medium text-ok">✓ Guide terminé</p>}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}
