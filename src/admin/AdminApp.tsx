import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { stepLabel, type AssignmentStatus, type StepType } from '../../shared/tube'
import { api, ApiError, POLL_MS } from '../api'
import { ago, Button, Card, CopyButton, Field, Notice, Sheet } from '../ui'
import { GuideDiagram, GuideEditor, GuidePreview } from './GuideEditor'
import { HelpPage } from './HelpPage'

export interface StudentRow { id: number; prenom: string; note: string; created_at: string; archived: number; has_code: number }
export interface AssignmentRow { id: number; student_id: number; guide_id: number; status: AssignmentStatus; started_at: string; updated_at: string; guide: string; step_titre: string | null; step_type: StepType | null; chapitre: string | null }
export interface GuideRow { id: number; titre: string; description: string; published: number; chapitres: number; etapes: number }
export interface HelpRow { id: number; message: string; created_at: string; prenom: string; guide: string; step_titre: string | null; step_type: StepType | null; chapitre: string | null }
interface Overview { students: StudentRow[]; assignments: AssignmentRow[]; guides: GuideRow[]; help: HelpRow[] }

const Ctx = createContext<{ data: Overview; refresh: () => Promise<void> }>(null!)
export const useOverview = () => useContext(Ctx)

export const whereIs = (r: { step_titre: string | null; step_type: StepType | null; chapitre: string | null }) =>
  r.step_type ? `${r.chapitre ?? ''} › ${stepLabel({ type: r.step_type, titre: r.step_titre ?? '' })}` : '—'

const STATUS: Record<AssignmentStatus, { label: string; cls: string }> = {
  en_cours: { label: 'En cours', cls: 'bg-accent-soft text-accent' },
  en_pause: { label: 'En pause', cls: 'bg-line text-muted' },
  bloque: { label: 'Bloqué', cls: 'bg-danger-soft text-danger' },
  termine: { label: 'Terminé', cls: 'bg-accent-soft text-ok' },
}
export const StatusPill = ({ status }: { status: AssignmentStatus }) => (
  <span className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[status].cls}`}>{STATUS[status].label}</span>
)

/** Exécute une action admin et affiche l'erreur éventuelle. */
export function useRun() {
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }
  return { error, run, setError }
}

export default function AdminApp() {
  const [data, setData] = useState<Overview | null>(null)
  const [logged, setLogged] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setData(await api<Overview>('admin/overview'))
      setLogged(true)
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setLogged(false)
      else setError((e as Error).message)
    }
  }, [])

  // Pas de temps réel : le tableau de bord se rafraîchit toutes les 20 secondes.
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  if (logged === false) return <AdminLogin onDone={refresh} />
  if (!data) return <p className="p-8 text-center text-muted">{error ?? 'Chargement…'}</p>

  const logout = async () => {
    await api('admin/logout', { body: {} }).catch(() => null)
    setLogged(false)
    setData(null)
  }
  const tab = ({ isActive }: { isActive: boolean }) =>
    `pressable flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${isActive ? 'bg-accent text-on-accent' : 'text-muted'}`

  return (
    <Ctx.Provider value={{ data, refresh }}>
      <BrowserRouter basename="/admin">
        <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 pb-16 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <header className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to="/" className="mr-auto text-xl font-bold tracking-tight text-accent">TUBy <span className="text-sm font-medium text-muted">admin</span></Link>
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={tab}>
                Suivi{data.help.length > 0 && <span className="rounded-full bg-danger px-1.5 text-xs text-surface" aria-label={`${data.help.length} blocages ouverts`}>{data.help.length}</span>}
              </NavLink>
              <NavLink to="/eleves" className={tab}>Élèves</NavLink>
              <NavLink to="/guides" className={tab}>Guides</NavLink>
            </nav>
          </header>
          {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/eleves" element={<Students />} />
            <Route path="/guides" element={<Guides />} />
            <Route path="/guides/:id" element={<GuideEditor />} />
            <Route path="/guides/:id/apercu" element={<GuidePreview />} />
            <Route path="/guides/:id/plan" element={<GuideDiagram />} />
            <Route path="/blocages/:id" element={<HelpPage />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
          <footer className="mt-10 text-center">
            <button type="button" onClick={logout} className="min-h-11 text-sm text-muted underline underline-offset-2">Se déconnecter</button>
          </footer>
        </div>
      </BrowserRouter>
    </Ctx.Provider>
  )
}

function AdminLogin({ onDone }: { onDone: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const { error, run } = useRun()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    if (await run(() => api('admin/login', { body: { password } }))) await onDone()
    setBusy(false)
  }
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <p className="text-3xl font-bold tracking-tight text-accent">TUBy <span className="text-base font-medium text-muted">admin</span></p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Mot de passe" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={busy || !password}>{busy ? 'Connexion…' : 'Entrer'}</Button>
      </form>
    </div>
  )
}

export function H1({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{children}</h1>
      {action}
    </div>
  )
}

// ── Tableau de bord ───────────────────────────────────────────────────────────

function Dashboard() {
  const { data } = useOverview()
  const active = data.students.filter((s) => !s.archived)
  return (
    <>
      <H1>Blocages ouverts {data.help.length > 0 && <span className="ml-1 rounded-full bg-danger px-2.5 py-0.5 align-middle text-base text-surface">{data.help.length}</span>}</H1>
      {data.help.length === 0 ? (
        <Card className="p-5 text-muted">Aucun blocage. Tout le monde avance.</Card>
      ) : (
        <div className="space-y-3">
          {data.help.map((h) => (
            <Link key={h.id} to={`/blocages/${h.id}`} className="pressable block">
              <Card className="border-l-4 border-danger p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-lg font-semibold">{h.prenom}</p>
                  <p className="shrink-0 text-sm text-muted">{ago(h.created_at)}</p>
                </div>
                <p className="mt-0.5 text-sm text-muted">{h.guide}</p>
                <p className="text-sm text-muted">{whereIs(h)}</p>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap">« {h.message} »</p>
                <p className="mt-3 font-semibold text-accent">Traiter ce blocage →</p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-9 text-xl font-semibold">Élèves</h2>
      {active.length === 0 && <Card className="p-5 text-muted">Aucun élève. <Link className="font-semibold text-accent" to="/eleves">Créer un élève</Link></Card>}
      <div className="space-y-3">
        {active.map((s) => {
          const mine = data.assignments.filter((a) => a.student_id === s.id)
          return (
            <Card key={s.id} className="p-5">
              <p className="text-lg font-semibold">{s.prenom}</p>
              {mine.length === 0 && <p className="mt-1 text-sm text-muted">Aucun guide attribué.</p>}
              {mine.map((a) => (
                <div key={a.id} className="mt-3 border-t border-line pt-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium leading-snug">{a.guide}</p>
                    <StatusPill status={a.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted">{whereIs(a)}</p>
                  <p className="text-sm text-muted">Dernière activité : {ago(a.updated_at)}</p>
                </div>
              ))}
            </Card>
          )
        })}
      </div>
    </>
  )
}

// ── Élèves ────────────────────────────────────────────────────────────────────

function CodeCard({ prenom, code, onClose }: { prenom: string; code: string; onClose: () => void }) {
  return (
    <Card className="mb-4 border-2 border-accent p-5">
      <p className="text-sm text-muted">Code de connexion de <strong className="text-ink">{prenom}</strong> : affiché une seule fois, note-le maintenant.</p>
      <p className="my-3 font-mono text-4xl font-bold tracking-[0.25em] text-accent" data-testid="code">{code}</p>
      <div className="flex gap-3">
        <CopyButton text={code} label="Copier le code" />
        <Button small variant="neutral" onClick={onClose}>C’est noté</Button>
      </div>
    </Card>
  )
}

function Students() {
  const { data, refresh } = useOverview()
  const { error, run } = useRun()
  const [prenom, setPrenom] = useState('')
  const [note, setNote] = useState('')
  const [shown, setShown] = useState<{ prenom: string; code: string } | null>(null)
  const [assignFor, setAssignFor] = useState<StudentRow | null>(null)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    await run(async () => {
      const r = await api<{ code: string }>('admin/students', { body: { prenom, note } })
      setShown({ prenom, code: r.code })
      setPrenom('')
      setNote('')
      await refresh()
    })
  }
  const newCode = (s: StudentRow) => {
    if (s.has_code && !window.confirm(`Générer un nouveau code pour ${s.prenom} ? L’ancien ne marchera plus et ses appareils seront déconnectés.`)) return
    void run(async () => {
      const r = await api<{ code: string }>(`admin/students/${s.id}/code`, { body: {} })
      setShown({ prenom: s.prenom, code: r.code })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      await refresh()
    })
  }
  const archive = (s: StudentRow, archived: boolean) => {
    if (archived && !window.confirm(`Archiver ${s.prenom} ? Il ne pourra plus se connecter. Sa progression est conservée.`)) return
    void run(async () => { await api(`admin/students/${s.id}`, { method: 'PATCH', body: { archived } }); await refresh() })
  }
  const editNote = (s: StudentRow) => {
    const next = window.prompt(`Note sur ${s.prenom}`, s.note)
    if (next != null) void run(async () => { await api(`admin/students/${s.id}`, { method: 'PATCH', body: { note: next } }); await refresh() })
  }
  const reset = (a: AssignmentRow, s: StudentRow) => {
    if (!window.confirm(`Remettre « ${a.guide} » à zéro pour ${s.prenom} ? Sa progression sera effacée.`)) return
    void run(async () => { await api(`admin/assignments/${a.id}/reset`, { body: {} }); await refresh() })
  }
  const remove = (a: AssignmentRow, s: StudentRow) => {
    if (!window.confirm(`Retirer « ${a.guide} » à ${s.prenom} ? Sa progression sera supprimée.`)) return
    void run(async () => { await api(`admin/assignments/${a.id}`, { method: 'DELETE' }); await refresh() })
  }

  const active = data.students.filter((s) => !s.archived)
  const archived = data.students.filter((s) => s.archived)
  return (
    <>
      <H1>Élèves</H1>
      {shown && <CodeCard {...shown} onClose={() => setShown(null)} />}
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}

      <div className="space-y-3">
        {active.map((s) => {
          const mine = data.assignments.filter((a) => a.student_id === s.id)
          return (
            <Card key={s.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{s.prenom}</p>
                  <button type="button" onClick={() => editNote(s)} className="text-left text-sm text-muted underline-offset-2 hover:underline">{s.note || 'Ajouter une note'}</button>
                </div>
                {!s.has_code && <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger">Pas encore de code</span>}
              </div>
              {mine.map((a) => (
                <div key={a.id} className="mt-3 border-t border-line pt-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium leading-snug">{a.guide}</p>
                    <StatusPill status={a.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button small variant="neutral" onClick={() => reset(a, s)}>Remettre à zéro</Button>
                    <Button small variant="danger" onClick={() => remove(a, s)}>Retirer</Button>
                  </div>
                </div>
              ))}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <Button small variant="secondary" icon="plus" onClick={() => setAssignFor(s)}>Attribuer un guide</Button>
                <Button small variant="neutral" onClick={() => newCode(s)}>{s.has_code ? 'Nouveau code' : 'Générer son code'}</Button>
                <Button small variant="neutral" onClick={() => archive(s, true)}>Archiver</Button>
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="mt-6 p-5">
        <h2 className="mb-3 text-lg font-semibold">Nouvel élève</h2>
        <form onSubmit={create} className="space-y-3">
          <Field label="Prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} required maxLength={60} />
          <Field label="Note (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          <Button type="submit" className="w-full" disabled={!prenom.trim()}>Créer et obtenir son code</Button>
        </form>
        <p className="mt-3 text-sm text-muted">Le code n’est jamais enregistré en clair : il s’affiche une seule fois. Perdu ? « Nouveau code ».</p>
      </Card>

      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="min-h-11 text-sm font-medium text-muted underline underline-offset-2">Élèves archivés ({archived.length})</summary>
          <div className="mt-2 space-y-2">
            {archived.map((s) => (
              <Card key={s.id} className="flex items-center justify-between gap-3 p-4">
                <span>{s.prenom}</span>
                <Button small variant="neutral" onClick={() => archive(s, false)}>Réactiver</Button>
              </Card>
            ))}
          </div>
        </details>
      )}

      <Sheet open={!!assignFor} onClose={() => setAssignFor(null)} title={`Attribuer un guide à ${assignFor?.prenom ?? ''}`}>
        <div className="space-y-2">
          {data.guides.map((g) => {
            const has = data.assignments.some((a) => a.guide_id === g.id && a.student_id === assignFor?.id)
            return (
              <Button key={g.id} variant="neutral" className="w-full justify-between py-3 text-left" disabled={has}
                onClick={() => void run(async () => { await api('admin/assignments', { body: { guide_id: g.id, student_ids: [assignFor!.id] } }); setAssignFor(null); await refresh() })}>
                <span>{g.titre}{!g.published && <span className="text-sm text-muted"> (brouillon)</span>}</span>
                {has && <span className="text-sm text-muted">déjà attribué</span>}
              </Button>
            )
          })}
          {data.guides.length === 0 && <p className="text-muted">Aucun guide pour l’instant.</p>}
        </div>
      </Sheet>
    </>
  )
}

// ── Guides ────────────────────────────────────────────────────────────────────

function Guides() {
  const { data, refresh } = useOverview()
  const { error, run } = useRun()
  const [titre, setTitre] = useState('')
  const [assignGuide, setAssignGuide] = useState<GuideRow | null>(null)
  const navigate = useNavigate()
  const [picked, setPicked] = useState<number[]>([])
  const active = data.students.filter((s) => !s.archived)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    await run(async () => {
      const r = await api<{ id: number }>('admin/guides', { body: { titre } })
      await refresh()
      navigate(`/guides/${r.id}`)
    })
  }
  const duplicate = (g: GuideRow) => void run(async () => { await api(`admin/guides/${g.id}/duplicate`, { body: {} }); await refresh() })
  const remove = (g: GuideRow, n: number) => {
    if (!window.confirm(`Supprimer « ${g.titre} » ?${n ? ` ${n} élève(s) le suivent : leur progression sera supprimée aussi.` : ''} C’est définitif.`)) return
    void run(async () => { await api(`admin/guides/${g.id}`, { method: 'DELETE' }); await refresh() })
  }
  const openAssign = (g: GuideRow) => { setPicked([]); setAssignGuide(g) }

  return (
    <>
      <H1>Guides</H1>
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      <div className="space-y-3">
        {data.guides.map((g) => {
          const followers = data.assignments.filter((a) => a.guide_id === g.id)
          return (
            <Card key={g.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/guides/${g.id}`} className="text-lg font-semibold leading-snug">{g.titre}</Link>
                {!g.published && <span className="shrink-0 rounded-full bg-line px-2.5 py-1 text-xs font-semibold text-muted">Brouillon</span>}
              </div>
              <p className="mt-1 text-sm text-muted">{g.chapitres} chapitres · {g.etapes} étapes · {followers.length} élève{followers.length > 1 ? 's' : ''}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to={`/guides/${g.id}`}><Button small icon="pencil">Éditer</Button></Link>
                <Button small variant="secondary" icon="plus" onClick={() => openAssign(g)}>Attribuer</Button>
                <Button small variant="neutral" icon="copy" onClick={() => duplicate(g)}>Dupliquer</Button>
                <Button small variant="danger" icon="trash" onClick={() => remove(g, followers.length)}>Supprimer</Button>
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="mt-6 p-5">
        <h2 className="mb-3 text-lg font-semibold">Nouveau guide</h2>
        <form onSubmit={create} className="space-y-3">
          <Field label="Titre" value={titre} onChange={(e) => setTitre(e.target.value)} required maxLength={200} />
          <Button type="submit" className="w-full" disabled={!titre.trim()}>Créer le guide</Button>
        </form>
      </Card>

      <Sheet open={!!assignGuide} onClose={() => setAssignGuide(null)} title="Attribuer ce guide">
        <p className="-mt-2 mb-3 text-sm text-muted">{assignGuide?.titre}</p>
        {assignGuide && !assignGuide.published && <div className="mb-3"><Notice>Ce guide est un brouillon : les élèves ne le verront qu’une fois publié.</Notice></div>}
        <div className="space-y-2">
          {active.map((s) => {
            const has = data.assignments.some((a) => a.guide_id === assignGuide?.id && a.student_id === s.id)
            return (
              <label key={s.id} className={`flex min-h-touch items-center gap-3 rounded-control border border-line px-4 ${has ? 'opacity-50' : ''}`}>
                <input type="checkbox" className="size-6 accent-(--c-accent)" disabled={has} checked={has || picked.includes(s.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />
                <span>{s.prenom}{has && <span className="text-sm text-muted"> · déjà attribué</span>}</span>
              </label>
            )
          })}
          {active.length === 0 && <p className="text-muted">Crée d’abord un élève.</p>}
        </div>
        <Button className="mt-4 w-full" disabled={!picked.length}
          onClick={() => void run(async () => { await api('admin/assignments', { body: { guide_id: assignGuide!.id, student_ids: picked } }); setAssignGuide(null); await refresh() })}>
          Attribuer à {picked.length || '…'} élève{picked.length > 1 ? 's' : ''}
        </Button>
      </Sheet>
    </>
  )
}
