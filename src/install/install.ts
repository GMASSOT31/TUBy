// Installation de TUBy comme une appli : détection du navigateur, invitation native, mémoire du refus.
// Le navigateur envoie « beforeinstallprompt » très tôt : initInstall() doit être appelé avant le rendu.
import { useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** native = installation en un clic (Chrome, Edge, Samsung…) ; ios / mac = tutoriel ; null = rien à proposer. */
export type InstallMode = 'native' | 'ios' | 'mac' | null

interface Memo { snoozeUntil?: number; never?: boolean; installed?: boolean }
const KEY = 'tuby-install'
const DAY = 24 * 60 * 60 * 1000
export const SNOOZE_DAYS = 7

const read = (): Memo => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Memo } catch { return {} }
}
const write = (m: Memo) => {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...m })) } catch { /* navigation privée : on ne retient rien */ }
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
/** iPhone, iPod et iPad (un iPad récent se présente comme un Mac tactile). */
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
export const isIPad = /iPad/.test(ua) || (isIOS && !/iPhone|iPod/.test(ua))
export const isIOSChrome = isIOS && /CriOS/.test(ua)
/** Safari 17+ sur Mac sait « Ajouter au Dock ». */
const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Version\/(1[7-9]|[2-9]\d)/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua)

let deferred: InstallPromptEvent | null = null
let tutorialOpen = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())

/** L'appli tourne-t-elle déjà installée (fenêtre indépendante, sans barre d'adresse) ? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches)
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // on garde l'invitation du navigateur pour la proposer au bon moment
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    write({ installed: true })
    emit()
  })
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', emit)
}

export function installMode(): InstallMode {
  if (isStandalone()) return null
  if (deferred) return 'native'
  if (isIOS) return 'ios'
  if (isMacSafari) return 'mac'
  return null
}

/** L'invitation automatique peut-elle s'afficher (pas refusée, pas reportée, pas déjà installée) ? */
export function mayInvite(): boolean {
  const m = read()
  return !m.never && !m.installed && !(m.snoozeUntil && m.snoozeUntil > Date.now())
}

/** Lance l'installation : fenêtre du navigateur (un clic) ou tutoriel (iPhone, iPad, Mac). */
export async function install() {
  if (deferred) {
    const event = deferred
    deferred = null // une invitation native ne sert qu'une fois
    emit()
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') write({ installed: true })
    else write({ snoozeUntil: Date.now() + SNOOZE_DAYS * DAY })
    emit()
  } else if (installMode()) {
    tutorialOpen = true
    emit()
  }
}

export const later = () => { write({ snoozeUntil: Date.now() + SNOOZE_DAYS * DAY }); emit() }
export const never = () => { write({ never: true }); emit() }
/** iPhone, iPad, Mac : le navigateur ne nous prévient pas, l'élève nous le dit. */
export const markInstalled = () => { write({ installed: true }); tutorialOpen = false; emit() }
export const closeTutorial = () => { tutorialOpen = false; emit() }

/** État d'installation, mis à jour quand le navigateur ou l'utilisateur le change. */
export function useInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    listeners.add(f)
    return () => { listeners.delete(f) }
  }, [])
  return { mode: installMode(), invite: mayInvite(), tutorialOpen }
}
