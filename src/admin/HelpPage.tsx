// Traiter un blocage : étapes intermédiaires avant l'étape bloquante, réponse courte, déblocage.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { stepLabel, type Step } from '../../shared/tube'
import { api } from '../api'
import { ago, Button, Card, Icon, Notice, RichText, TextArea } from '../ui'
import { H1, useOverview, useRun } from './AdminApp'
import { emptyStep, StepForm, type StepDraft } from './GuideEditor'

interface HelpData {
  help: { id: number; message: string; created_at: string; status: 'ouvert' | 'traite'; admin_reply: string | null; resolved_at: string | null; prenom: string; guide: string; guide_id: number }
  step: (Step & { chapitre: string }) | null
}

export function HelpPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { refresh } = useOverview()
  const { error, run } = useRun()
  const [data, setData] = useState<HelpData | null>(null)
  const [drafts, setDrafts] = useState<StepDraft[]>([])
  const [forAll, setForAll] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { void run(async () => setData(await api<HelpData>(`admin/help/${id}`))) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return error ? <Notice tone="error">{error}</Notice> : <p className="text-muted">Chargement…</p>
  const { help: h, step } = data
  const filled = drafts.filter((d) => d.titre.trim() || d.quoi_faire.trim())

  const resolve = async () => {
    setBusy(true)
    const ok = await run(async () => {
      await api(`admin/help/${id}/resolve`, { body: { reply, steps: filled, for_all: forAll } })
      await refresh()
    })
    setBusy(false)
    if (ok) navigate('/')
  }

  return (
    <>
      <Link to="/" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"><Icon name="back" size={18} /> Suivi</Link>
      <H1>Blocage de {h.prenom}</H1>

      <Card className="border-l-4 border-danger p-5">
        <p className="text-sm text-muted">{h.guide} · {ago(h.created_at)}</p>
        <p className="mt-2 whitespace-pre-wrap text-lg">« {h.message} »</p>
      </Card>

      <h2 className="mb-2 mt-6 text-sm font-medium uppercase tracking-wide text-muted">L’étape où {h.prenom} bloque</h2>
      <Card className="p-5">
        {step ? (
          <>
            <p className="text-sm text-muted">{step.chapitre}{step.personal && ' · étape d’aide'}</p>
            <p className="mt-1 text-lg font-semibold">{stepLabel(step)}</p>
            {step.objectif && <p className="mt-2 text-muted">{step.objectif}</p>}
            {step.quoi_faire && <RichText text={step.quoi_faire} className="mt-2" />}
            {step.config.si_non && <p className="mt-2 text-sm text-muted">Si « Non » : {step.config.si_non}</p>}
          </>
        ) : <p className="text-muted">Cette étape a été supprimée du guide.</p>}
      </Card>

      {h.status === 'traite' ? (
        <div className="mt-6"><Notice tone="ok">Blocage traité {ago(h.resolved_at)}.{h.admin_reply ? ` Ta réponse : « ${h.admin_reply} »` : ''}</Notice></div>
      ) : (
        <>
          <h2 className="mb-2 mt-6 text-sm font-medium uppercase tracking-wide text-muted">Étapes intermédiaires (affichées juste avant)</h2>
          <div className="space-y-3">
            {drafts.map((d, i) => (
              <Card key={i} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold">Étape d’aide {i + 1}</p>
                  <Button small variant="danger" icon="trash" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>Retirer</Button>
                </div>
                <StepForm value={d} onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? v : x)))} />
              </Card>
            ))}
          </div>
          {step && drafts.length < 10 && (
            <Button className="mt-3 w-full" variant="secondary" icon="plus" onClick={() => setDrafts([...drafts, emptyStep()])}>
              {drafts.length ? 'Ajouter une autre étape' : 'Ajouter une étape intermédiaire'}
            </Button>
          )}
          {drafts.length > 0 && (
            <label className="mt-3 flex min-h-touch items-center gap-3 rounded-control border border-line bg-surface px-4 py-2">
              <input type="checkbox" className="size-6 shrink-0 accent-(--c-accent)" checked={forAll} onChange={(e) => setForAll(e.target.checked)} />
              <span className="leading-snug">Ajouter aussi au guide pour tous <span className="block text-sm text-muted">Sinon : pour {h.prenom} seulement.</span></span>
            </label>
          )}

          <TextArea className="mt-6" label={`Réponse courte affichée à ${h.prenom} (facultatif)`} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} />
          {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
          <Button className="mt-4 w-full" disabled={busy} onClick={() => void resolve()}>
            {filled.length ? `Envoyer ${filled.length} étape${filled.length > 1 ? 's' : ''} et débloquer ${h.prenom}` : `Marquer comme traité et débloquer ${h.prenom}`}
          </Button>
        </>
      )}
    </>
  )
}
