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

// ── Plan du guide : diagramme du parcours (Mermaid, chargé à la demande) ─────

function toMermaid(d: GuideData): string {
  const seq = buildSequence(d.chapters, d.steps)
  const text = (s: string) => `"${(s.length > 46 ? s.slice(0, 44) + '…' : s).replace(/"/g, '#quot;')}"`
  const node = (s: Step) => {
    const t = text(stepLabel(s))
    return `S${s.id}${s.type === 'prerequis' ? `[/${t}/]` : s.type === 'recap' ? `[[${t}]]` : s.type === 'verif' || s.type === 'choix' ? `{${t}}` : `[${t}]`}`
  }
  const byRef = new Map(seq.map((s) => [s.ref, s]))
  const out = ['flowchart TD', '  START([Connexion : prénom + code])']
  d.chapters.forEach((c) => {
    out.push(`  subgraph C${c.id}[${text(c.titre)}]`)
    seq.filter((s) => s.chapter_id === c.id).forEach((s) => out.push(`    ${node(s)}`))
    out.push('  end')
  })
  if (seq[0]) out.push(`  START --> S${seq[0].id}`)
  seq.forEach((s, i) => {
    const next = seq[i + 1] ? `S${seq[i + 1].id}` : 'FIN'
    const to = (ref: string | null | undefined) => (ref && byRef.has(ref) ? `S${byRef.get(ref)!.id}` : next)
    if (s.type === 'choix') (s.config.options ?? []).forEach((o) => out.push(`  S${s.id} -- ${text(o.label)} --> ${to(o.goto)}`))
    else out.push(`  S${s.id} --> ${to(s.config.apres)}`)
  })
  out.push('  FIN([Guide terminé])')
  return out.join('\n')
}

export function GuideDiagram() {
  const { id, data, error } = useGuide()
  const box = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!data) return
    let cancelled = false
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid')
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', flowchart: { useMaxWidth: false } })
        const { svg } = await mermaid.render(`plan-${data.guide.id}`, toMermaid(data))
        if (!cancelled && box.current) box.current.innerHTML = svg
      } catch (e) {
        if (!cancelled) setFailed((e as Error).message)
      }
    })()
    return () => { cancelled = true }
  }, [data])
  return (
    <>
      <Link to={`/guides/${id}`} className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"><Icon name="back" size={18} /> Retour au guide</Link>
      <H1>Plan du guide</H1>
      {(error || failed) && <Notice tone="error">{error || failed}</Notice>}
      <Card className="overflow-auto p-4"><div ref={box} className="min-h-40 w-max">{!data && <p className="text-muted">Chargement…</p>}</div></Card>
    </>
  )
}
