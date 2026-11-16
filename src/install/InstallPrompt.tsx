// Invitation à installer TUBy : discrète, une seule fois, avec tutoriel quand le navigateur ne sait pas le faire seul.
import { useEffect, useState } from 'react'
import { Button, Icon, Sheet } from '../ui'
import { closeTutorial, install, isIOSChrome, isIPad, later, markInstalled, never, SNOOZE_DAYS, useInstall } from './install'

const DELAY_MS = 2500 // laisse le temps de voir l'écran avant de proposer quoi que ce soit

/** Bandeau d'invitation (automatique) + tutoriel iPhone / iPad / Mac. À monter une fois, à la racine. */
export function InstallPrompt() {
  const { mode, invite, tutorialOpen } = useInstall()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])
  const show = ready && !!mode && invite && !tutorialOpen
  const touch = window.matchMedia('(pointer: coarse)').matches

  return (
    <>
      {show && (
        <div
          role="dialog" aria-label="Installer TUBy" aria-modal="false"
          className="anim-sheet fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 mx-auto max-w-md rounded-card bg-surface p-4 shadow-pop sm:inset-x-auto sm:bottom-6 sm:right-6 sm:top-auto sm:w-[22rem]"
        >
          <div className="flex items-start gap-3">
            <img src="/icons/icon-192.png" alt="" width={48} height={48} className="size-12 shrink-0 rounded-[12px]" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug">Installer TUBy</p>
              <p className="text-sm leading-snug text-muted">Ouvre tes guides en un {touch ? 'tap' : 'clic'}, comme une vraie appli.</p>
            </div>
            <button type="button" onClick={later} aria-label="Fermer" title={`Je reverrai la proposition dans ${SNOOZE_DAYS} jours`} className="pressable -m-1 rounded-full p-1.5 text-muted">
              <Icon name="x" size={20} />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button small className="flex-1" onClick={() => void install()}>{mode === 'native' ? 'Installer' : 'Comment faire ?'}</Button>
            <Button small variant="ghost" onClick={later}>Plus tard</Button>
          </div>
          <button type="button" onClick={never} className="mt-1 min-h-9 w-full text-center text-xs text-muted underline underline-offset-2">Ne plus proposer</button>
        </div>
      )}
      <Sheet open={tutorialOpen} onClose={closeTutorial} title="Installer TUBy">
        {mode === 'mac' ? <MacSteps /> : <IOSSteps />}
        <Button className="mt-5 w-full" onClick={markInstalled}>C’est fait</Button>
        <Button className="mt-2 w-full" variant="ghost" onClick={() => { later(); closeTutorial() }}>Plus tard</Button>
      </Sheet>
    </>
  )
}

/** Lien discret « Installer l'appli », toujours disponible même après « Plus tard » ou « Ne plus proposer ». */
export function InstallLink({ className = '' }: { className?: string }) {
  const { mode } = useInstall()
  if (!mode) return null
  return (
    <button type="button" onClick={() => void install()} className={`inline-flex min-h-11 items-center gap-1.5 text-sm text-muted underline underline-offset-2 ${className}`}>
      Installer l’appli
    </button>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">{n}</span>
      <span className="pt-1 leading-relaxed">{children}</span>
    </li>
  )
}

const ShareIcon = () => (
  <svg className="mx-0.5 inline size-5 -translate-y-0.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Partager">
    <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" />
  </svg>
)
const AddIcon = () => (
  <svg className="mx-0.5 inline size-5 -translate-y-0.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" />
  </svg>
)

function IOSSteps() {
  const where = isIOSChrome ? 'en haut à droite, dans la barre d’adresse' : isIPad ? 'en haut à droite de l’écran' : 'en bas de l’écran'
  return (
    <>
      <ol className="space-y-4">
        <Step n={1}>Touche le bouton <strong>Partager</strong> <ShareIcon /> {where}.</Step>
        <Step n={2}>Fais défiler et touche <strong>Sur l’écran d’accueil</strong> <AddIcon />.</Step>
        <Step n={3}>Touche <strong>Ajouter</strong>, en haut à droite.</Step>
      </ol>
      <p className="mt-4 text-sm text-muted">Ouvre ensuite TUBy depuis ton écran d’accueil. La première fois, tu devras te reconnecter avec ton prénom et ton code.</p>
    </>
  )
}

function MacSteps() {
  return (
    <ol className="space-y-4">
      <Step n={1}>Dans la barre de menus en haut de l’écran, clique <strong>Fichier</strong>.</Step>
      <Step n={2}>Choisis <strong>Ajouter au Dock…</strong></Step>
      <Step n={3}>Clique <strong>Ajouter</strong>. TUBy s’ouvre dans sa propre fenêtre, depuis le Dock.</Step>
    </ol>
  )
}
