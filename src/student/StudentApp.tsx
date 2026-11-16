import { useCallback, useEffect, useRef, useState } from 'react'
import { applyAction, type StudentAction, type StudentHome, type TubeState } from '../../shared/tube'
import { api, ApiError, POLL_MS } from '../api'
import { Button, Card, Field, Notice } from '../ui'
import { Tube } from './Tube'
import { InstallLink } from '../install/InstallPrompt'

const STATUS: Record<string, string> = { en_cours: 'En cours', en_pause: 'En pause', bloque: 'En attente de Gaby', termine: 'Terminé' }

export default function StudentApp() {
  const [home, setHome] = useState<StudentHome | null>(null)
  const [logged, setLogged] = useState<boolean | null>(null) // null = on ne sait pas encore
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tube = home?.tube ?? null
  const tubeRef = useRef<TubeState | null>(null)
  tubeRef.current = tube

  const setTube = (t: TubeState | null) => setHome((h) => (h ? { ...h, tube: t } : h))

  const load = useCallback(async (assignmentId: number | null, firstOpen = false) => {
    try {
      let data = await api<StudentHome>(`state${assignmentId ? `?assignment=${assignmentId}` : ''}`)
      // À l'ouverture, une pause se termine : l'élève retombe directement sur son étape.
      if (firstOpen && data.tube?.assignment.status === 'en_pause') {
        const r = await api<{ tube: TubeState }>(`assignments/${data.tube.assignment.id}/act`, { body: { action: 'resume' } })
        data = { ...data, tube: r.tube }
      }
      setHome(data)
      setLogged(true)
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setLogged(false)
      else if (e instanceof ApiError && e.status === 404) { setSelected(null); void load(null) }
      else setError((e as Error).message)
    }
  }, [])

  useEffect(() => { void load(null, true) }, [load])

  // Écran d'attente : on redemande l'état toutes les 20 secondes (pas de temps réel).
  const waiting = tube?.assignment.status === 'bloque'
  const tubeId = tube?.assignment.id ?? null
  useEffect(() => {
    if (!waiting || !tubeId) return
    const tick = () => { if (document.visibilityState === 'visible') void load(tubeId) }
    const timer = window.setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [waiting, tubeId, load])

  // Les actions partent au serveur une par une, dans l'ordre des taps. L'écran change tout de suite
  // (affichage optimiste) ; la réponse du serveur ne s'applique que s'il n'y a plus d'action en attente,
  // sinon une réponse en retard ramènerait l'élève sur un écran qu'il a déjà quitté.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)
  const act = (action: StudentAction) => {
    const before = tubeRef.current
    if (!before) return
    setError(null)
    const optimistic = applyAction(before, action).state
    tubeRef.current = optimistic
    setTube(optimistic)
    pending.current++
    queue.current = queue.current.then(async () => {
      try {
        const r = await api<{ tube: TubeState }>(`assignments/${before.assignment.id}/act`, { body: action })
        if (--pending.current === 0) setTube(r.tube)
      } catch (e) {
        pending.current--
        if (e instanceof ApiError && e.status === 401) return setLogged(false)
        const fresh = e instanceof ApiError && e.status === 409 ? (e.data as { tube?: TubeState } | null)?.tube : null
        if (fresh) { if (pending.current === 0) setTube(fresh) }
        else {
          setError((e as Error).message)
          if (pending.current === 0) void load(before.assignment.id)
        }
      }
    })
  }

  const logout = async () => {
    await api('logout', { body: {} }).catch(() => null)
    setHome(null)
    setSelected(null)
    setLogged(false)
  }

  const openGuide = (id: number | null) => {
    setSelected(id)
    if (id == null) setTube(null)
    void load(id, true)
  }

  if (logged === false) return <Login onDone={() => { setLogged(null); void load(null, true) }} />
  if (!home) {
    return (
      <Centered>
        {error ? <><Notice tone="error">{error}</Notice><Button className="mt-4 w-full" onClick={() => void load(selected, true)}>Réessayer</Button></> : <p className="text-center text-muted">Chargement…</p>}
      </Centered>
    )
  }

  const many = home.assignments.length > 1
  const quit = (
    <span className="flex items-center gap-4">
      <InstallLink />
      <a href="/admin" className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-2">Espace admin</a>
      <button type="button" onClick={logout} className="min-h-11 text-sm font-medium text-accent">Se déconnecter</button>
    </span>
  )

  if (tube) {
    return (
      <Tube
        state={tube}
        onAct={act}
        error={error}
        planFooter={<>{many ? <Button small variant="ghost" icon="back" onClick={() => openGuide(null)}>Mes guides</Button> : <span />}{quit}</>}
      />
    )
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-5 pb-10 pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="text-[1.7rem] font-semibold">Salut {home.student.prenom} !</h1>
      {home.assignments.length === 0 ? (
        <>
          <p className="mt-3 text-lg leading-relaxed text-muted">Tu n’as pas encore de guide. Gaby va t’en donner un : reviens un peu plus tard.</p>
          <Button className="mt-6 w-full" variant="secondary" onClick={() => void load(null)}>Actualiser</Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-lg text-muted">Choisis le guide à reprendre.</p>
          <div className="mt-6 space-y-4">
            {home.assignments.map((a) => (
              <Card key={a.id} className="p-5">
                <h2 className="text-lg font-semibold leading-snug">{a.titre}</h2>
                {a.description && <p className="mt-1 text-muted">{a.description}</p>}
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, a.ratio * 100)}%` }} /></div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-sm text-muted">{STATUS[a.status]}</span>
                  <Button onClick={() => openGuide(a.id)}>{a.status === 'termine' ? 'Revoir' : a.ratio > 0 ? 'Reprendre' : 'Commencer'}</Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      <div className="mt-8 text-center">{quit}</div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">{children}</div>
}

function Login({ onDone }: { onDone: () => void }) {
  const [prenom, setPrenom] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('login', { body: { prenom, code } })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Centered>
      <p className="text-3xl font-bold tracking-tight text-accent">TUBy</p>
      <h1 className="mt-6 text-[1.7rem] font-semibold leading-tight">Connecte-toi</h1>
      <p className="mt-2 text-lg text-muted">Écris ton prénom et le code que Gaby t’a donné.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Ton prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} autoComplete="username" autoCapitalize="words" required />
        <Field
          label="Ton code secret" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="current-password"
          autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={8} required
          style={{ letterSpacing: '0.3em', fontWeight: 600 }} hint="6 lettres et chiffres."
        />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={busy || !prenom.trim() || code.trim().length < 6}>{busy ? 'Connexion…' : 'Entrer'}</Button>
      </form>
      <p className="mt-8 flex items-center justify-center gap-5"><InstallLink /><a href="/admin" className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-2">Espace admin</a></p>
    </Centered>
  )
}
