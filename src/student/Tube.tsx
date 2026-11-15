// Le tube : une seule étape à l'écran, une sortie évidente sur chaque écran.
// Composant sans réseau : il reçoit un état et émet des actions (sert aussi à l'aperçu admin).
import { useState, type ReactNode } from 'react'
import { canRestart, locate, nextStep, stepLabel, type Step, type StudentAction, type TubeState } from '../../shared/tube'
import { Button, Icon, Notice, RichText, Sheet } from '../ui'

interface Props {
  state: TubeState
  onAct: (action: StudentAction) => void
  error?: string | null
  planFooter?: ReactNode // liens discrets en bas du plan (mes guides, déconnexion)
}

export function Tube({ state, onAct, error, planFooter }: Props) {
  const { assignment, chapters, steps } = state
  const [planOpen, setPlanOpen] = useState(false)
  const step = steps.find((s) => s.id === assignment.current_step_id) ?? steps[0]
  const place = locate(chapters, steps, step?.id ?? null)
  const finished = assignment.status === 'termine'

  if (!step) {
    return <Screen><Message title="Ce guide est encore vide" text="Gaby est en train de le préparer. Reviens un peu plus tard." /></Screen>
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
      <header className="shrink-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          aria-label="Ouvrir le plan du guide"
          className="pressable flex min-h-12 w-full items-center gap-1.5 rounded-control text-left text-sm text-muted"
        >
          <span className="shrink-0">Guide</span>
          <span aria-hidden="true">›</span>
          <span className="min-w-0 truncate font-medium text-ink">{place.chapter?.titre}</span>
          <span aria-hidden="true">›</span>
          <span className="shrink-0">{finished ? 'Terminé' : `Étape ${place.indexInChapter}/${place.chapterTotal}`}</span>
          <span className="ml-auto shrink-0 text-accent"><Icon name="list" size={20} /></span>
        </button>
        <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Avancement du guide" aria-valuenow={Math.round((finished ? 1 : place.ratio) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(2, (finished ? 1 : place.ratio) * 100)}%` }} />
        </div>
      </header>

      {finished ? (
        <Body k="fin" footer={
          <>
            {canRestart(state) && <Button className="mb-3 w-full" icon="plus" onClick={() => onAct({ action: 'restart' })}>Commencer un nouveau site</Button>}
            <Button className="w-full" variant={canRestart(state) ? 'neutral' : 'secondary'} icon="list" onClick={() => setPlanOpen(true)}>Revoir une étape</Button>
          </>
        }>
          <Message title="Bravo, guide terminé !" text={canRestart(state) ? `Tu es allé jusqu’au bout. Pour ton prochain site, touche « Commencer un nouveau site » : tu repars directement à « ${chapters[1].titre} ». Tes outils sont déjà prêts.` : 'Tu es allé jusqu’au bout.'} />
        </Body>
      ) : assignment.status === 'bloque' ? (
        <Body k="attente" footer={<Button className="w-full" variant="neutral" onClick={() => onAct({ action: 'cancel_help' })}>Finalement, j’ai réussi : je continue</Button>}>
          <Message title="Message envoyé à Gaby." text="Il va t’ajouter des étapes pour t’aider. Tu peux laisser cet écran ouvert : la suite s’affichera toute seule." />
          <div className="mt-6 rounded-control bg-accent-soft p-4">
            <p className="mb-1 text-sm font-medium text-muted">Ton message · étape « {stepLabel(step)} »</p>
            <p className="whitespace-pre-wrap">{state.help?.message}</p>
          </div>
        </Body>
      ) : assignment.status === 'en_pause' ? (
        <Body k="pause" footer={<Button className="w-full" onClick={() => onAct({ action: 'resume' })}>Reprendre maintenant</Button>}>
          <Message title="À bientôt, tu reprendras ici." text={`Ta position est enregistrée : « ${stepLabel(step)} ». Tu peux fermer l’appli.`} />
        </Body>
      ) : (
        <StepScreen key={step.id} state={state} step={step} onAct={onAct} error={error} />
      )}

      {planOpen && <Plan state={state} onClose={() => setPlanOpen(false)} footer={planFooter} onJump={(id) => { setPlanOpen(false); onAct({ action: 'jump', to: id }) }} onRestart={() => { setPlanOpen(false); onAct({ action: 'restart' }) }} />}
    </div>
  )
}

function Screen({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col justify-center px-5">{children}</div>
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="pt-6">
      <h1 className="text-[1.7rem] font-semibold leading-tight">{title}</h1>
      <p className="mt-3 text-lg leading-relaxed text-muted">{text}</p>
    </div>
  )
}

/** Centre défilant + zone de boutons collée en bas, accessible au pouce. */
function Body({ k, children, footer }: { k: string | number; children: ReactNode; footer: ReactNode }) {
  return (
    <>
      <main key={k} className="anim-slide min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5">{children}</main>
      <footer className="shrink-0 border-t border-line bg-bg px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">{footer}</footer>
    </>
  )
}

function StepScreen({ state, step, onAct, error }: { state: TubeState; step: Step; onAct: Props['onAct']; error?: string | null }) {
  const [helping, setHelping] = useState(false)
  const [message, setMessage] = useState('')
  const [saidNo, setSaidNo] = useState(false) // verif : « Non » → consigne de rattrapage
  const [checked, setChecked] = useState<boolean[]>(() => (step.config.cases ?? []).map(() => false))
  const done = (answer?: unknown) => onAct({ action: 'done', step_id: step.id, answer })
  const isLast = nextStep(state.steps, step, state.progress) === null

  // Pause et À l'aide : toujours visibles, sous le bouton principal.
  const escape = (
    <div className="mt-3 flex gap-3">
      <Button className="flex-1" variant="neutral" icon="pause" onClick={() => onAct({ action: 'pause', step_id: step.id })}>Pause</Button>
      <Button className="flex-1" variant="ghost" icon="help" onClick={() => setHelping(true)}>À l’aide !</Button>
    </div>
  )

  let question: string | null = null
  let buttons: ReactNode
  if (helping) {
    buttons = (
      <form onSubmit={(e) => { e.preventDefault(); if (message.trim()) onAct({ action: 'help', step_id: step.id, message }) }}>
        <label htmlFor="blocage" className="mb-2 block font-medium">Explique ce qui te bloque</label>
        <textarea
          id="blocage" autoFocus rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000}
          placeholder="Ce que tu as essayé, ce que tu vois à l’écran…"
          className="w-full rounded-control border border-line bg-surface px-4 py-3 text-base leading-relaxed placeholder:text-muted/70"
        />
        <div className="mt-3 flex gap-3">
          <Button className="flex-1" variant="neutral" onClick={() => setHelping(false)}>Annuler</Button>
          <Button className="flex-[2]" type="submit" disabled={!message.trim()}>Envoyer à Gaby</Button>
        </div>
      </form>
    )
  } else if (step.type === 'prerequis') {
    const all = checked.every(Boolean)
    buttons = (
      <>
        <Button className="w-full" disabled={!all} onClick={() => done({ cases: checked })}>C’est parti</Button>
        {!all && <p className="mt-2 text-center text-sm text-muted">Coche chaque ligne pour continuer.</p>}
        {escape}
      </>
    )
  } else if (step.type === 'choix') {
    buttons = (
      <>
        <div className="grid gap-3">
          {(step.config.options ?? []).map((o, i) => (
            <Button key={i} className="w-full py-3 text-left" variant="secondary" onClick={() => onAct({ action: 'choose', step_id: step.id, option: i })}>{o.label}</Button>
          ))}
        </div>
        {escape}
      </>
    )
  } else if (step.type === 'recap') {
    buttons = <Button className="w-full" onClick={() => done()}>{isLast ? 'Terminé' : 'Chapitre suivant'}</Button>
  } else if (step.type === 'verif' && !saidNo) {
    buttons = (
      <>
        <div className="flex gap-3">
          <Button className="flex-[2]" onClick={() => done({ reponse: 'oui' })}>Oui</Button>
          <Button className="flex-1" variant="secondary" onClick={() => setSaidNo(true)}>Non</Button>
        </div>
        {escape}
      </>
    )
  } else {
    question = step.type === 'verif' ? null : 'C’est fait ?'
    buttons = (
      <>
        <Button className="w-full" onClick={() => done(step.type === 'verif' ? { reponse: 'non' } : undefined)}>{step.type === 'verif' ? 'C’est fait' : 'Oui'}</Button>
        {escape}
      </>
    )
  }

  return (
    <Body
      k={step.id}
      footer={
        <>
          {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}
          {question && <p className="mb-3 text-center text-lg font-semibold">{question}</p>}
          {buttons}
        </>
      }
    >
      {state.notice && (
        <div className="mb-5 rounded-control bg-accent-soft p-4" role="status">
          <p className="font-semibold text-accent">Gaby t’a ajouté de l’aide</p>
          {state.notice.reply && <p className="mt-1 whitespace-pre-wrap">{state.notice.reply}</p>}
        </div>
      )}
      {step.personal && <p className="mb-2 text-sm font-medium text-accent">Étape d’aide, rien que pour toi</p>}
      {step.type === 'verif' && <p className="mb-2 text-sm font-medium text-muted">Petite vérification</p>}
      <h1 className="text-[1.7rem] font-semibold leading-tight">{stepLabel(step)}</h1>

      {step.objectif && (
        <section className="mt-5">
          <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-muted">Objectif</h2>
          <p className="text-lg leading-relaxed">{step.objectif}</p>
        </section>
      )}
      {step.quoi_faire && (
        <section className="mt-5">
          <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-muted">Quoi faire</h2>
          <RichText text={step.quoi_faire} className="text-lg" />
        </section>
      )}

      {step.type === 'prerequis' && (
        <ul className="mt-5 space-y-3">
          {(step.config.cases ?? []).map((label, i) => (
            <li key={i}>
              <label className="pressable flex min-h-touch items-center gap-3 rounded-control border border-line bg-surface px-4 py-3">
                <input type="checkbox" checked={checked[i] ?? false} onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} className="size-6 shrink-0 accent-(--c-accent)" />
                <span className="leading-snug">{label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {step.type === 'verif' && saidNo && (
        <section className="anim-fade mt-5 rounded-control bg-accent-soft p-4">
          <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-muted">Pas de souci, fais-le maintenant</h2>
          <RichText text={step.config.si_non || 'Fais-le maintenant, puis reviens ici.'} className="text-lg" />
        </section>
      )}

      {step.type === 'recap' && (
        <ul className="mt-5 space-y-3">
          {(step.config.points ?? []).map((point, i) => (
            <li key={i} className="flex gap-3 text-lg leading-snug">
              <span className="mt-0.5 text-ok"><Icon name="check" /></span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}
    </Body>
  )
}

/** Plan du guide : chapitres repliables, état de chaque étape, tap = on y va directement. */
function Plan({ state, onClose, onJump, onRestart, footer }: { state: TubeState; onClose: () => void; onJump: (stepId: number) => void; onRestart: () => void; footer?: ReactNode }) {
  const current = state.assignment.current_step_id
  const currentChapter = state.steps.find((s) => s.id === current)?.chapter_id
  const [openChapter, setOpenChapter] = useState<number | undefined>(currentChapter)
  const blocked = state.assignment.status === 'bloque'
  return (
    <Sheet open onClose={onClose} title="Plan du guide">
      <p className="-mt-2 mb-4 text-sm text-muted">{state.guide.titre}</p>
      {blocked && <div className="mb-3"><Notice>Tu pourras changer d’étape dès que Gaby t’aura répondu.</Notice></div>}
      <div className="space-y-2">
        {state.chapters.map((ch) => {
          const steps = state.steps.filter((s) => s.chapter_id === ch.id)
          const doneCount = steps.filter((s) => state.progress[s.id]).length
          const isOpen = openChapter === ch.id
          return (
            <div key={ch.id} className="rounded-control border border-line">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpenChapter(isOpen ? undefined : ch.id)} className="flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left">
                <span className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}><Icon name="chevron" size={18} /></span>
                <span className="min-w-0 flex-1 font-medium leading-snug">{ch.titre}</span>
                <span className="shrink-0 text-sm text-muted">{doneCount}/{steps.length}</span>
              </button>
              {isOpen && (
                <ol className="border-t border-line py-1">
                  {steps.map((s) => {
                    const here = s.id === current
                    const isDone = !!state.progress[s.id]
                    return (
                      <li key={s.id}>
                        <button
                          type="button" disabled={blocked} onClick={() => onJump(s.id)} aria-current={here ? 'step' : undefined}
                          className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-60 ${here ? 'bg-accent-soft font-semibold text-accent' : ''}`}
                        >
                          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${isDone ? 'bg-ok text-surface' : here ? 'bg-accent text-on-accent' : 'border border-line'}`}>
                            {isDone ? <Icon name="check" size={14} /> : here ? <Icon name="chevron" size={14} /> : null}
                          </span>
                          <span className="min-w-0 flex-1 leading-snug">{stepLabel(s)}{s.personal && <span className="ml-2 text-sm font-normal text-accent">aide</span>}</span>
                          <span className="sr-only">{isDone ? 'fait' : here ? 'en cours' : 'à venir'}</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          )
        })}
      </div>
      {canRestart(state) && !blocked && (
        <Button className="mt-5 w-full" variant="secondary" icon="plus" onClick={() => {
          const [setup, start] = state.chapters
          if (window.confirm(`Commencer un nouveau site ?\n\nTu repars à « ${start.titre} ». « ${setup.titre} » reste fait ; toutes les autres étapes repassent à faire.`)) onRestart()
        }}>Commencer un nouveau site</Button>
      )}
      {footer && <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">{footer}</div>}
    </Sheet>
  )
}
