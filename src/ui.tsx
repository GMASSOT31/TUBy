// Briques d'interface partagées (style repris de Suivy). Zones tactiles d'au moins 56 px.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'

const ICONS = {
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  check: 'M20 6 9 17l-5-5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  pause: 'M9 5v14M15 5v14',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 18h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  x: 'M18 6 6 18M6 6l12 12',
  dot: 'M12 12h.01',
} as const
export type IconName = keyof typeof ICONS

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={ICONS[name]} />
    </svg>
  )
}

type Variant = 'primary' | 'secondary' | 'neutral' | 'ghost' | 'danger'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent font-semibold shadow-card',
  secondary: 'bg-accent-soft text-accent font-semibold',
  neutral: 'bg-surface text-ink font-medium border border-line',
  ghost: 'text-accent font-medium',
  danger: 'bg-danger-soft text-danger font-semibold',
}

export function Button({ variant = 'primary', icon, small, className = '', children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; small?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`pressable inline-flex items-center justify-center gap-2 rounded-control disabled:opacity-45 disabled:active:scale-100 ${small ? 'min-h-11 px-3.5 text-sm' : 'min-h-touch px-5 text-base'} ${VARIANTS[variant]} ${className}`}
    >
      {icon && <Icon name={icon} size={small ? 18 : 22} />}
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card bg-surface shadow-card ${className}`}>{children}</div>
}

const CONTROL = 'w-full rounded-control border border-line bg-surface px-4 text-base text-ink placeholder:text-muted/70'

export function Field({ label, hint, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-muted">{label}</label>
      <input id={id} {...rest} className={`min-h-touch ${CONTROL}`} />
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
    </div>
  )
}

export function TextArea({ label, hint, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-muted">{label}</label>
      <textarea id={id} rows={3} {...rest} className={`py-3 leading-relaxed ${CONTROL}`} />
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
    </div>
  )
}

export function Select({ label, className = '', children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-muted">{label}</label>
      <select id={id} {...rest} className={`min-h-touch ${CONTROL}`}>{children}</select>
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  const tones = { info: 'bg-accent-soft text-ink', error: 'bg-danger-soft text-danger', ok: 'bg-accent-soft text-ok' }
  return <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-control px-4 py-3 text-sm ${tones[tone]}`}>{children}</p>
}

/** Panneau qui monte du bas (centré sur ordinateur). Échap ou appui à côté pour fermer. */
export function Sheet({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`anim-sheet relative max-h-[90dvh] w-full overflow-y-auto rounded-t-[28px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-[28px] ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="pressable -m-2 rounded-full p-2 text-muted"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Bouton « Copier » : confirme brièvement que c'est copié. */
export function CopyButton({ text, label = 'Copier', small = true }: { text: string; label?: string; small?: boolean }) {
  const [done, setDone] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text })
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setDone(true)
    timer.current = window.setTimeout(() => setDone(false), 1800)
  }
  return <Button variant="secondary" small={small} icon={done ? 'check' : 'copy'} onClick={copy}>{done ? 'Copié' : label}</Button>
}

/** Texte riche simple : paragraphes, liens [texte](https://…), blocs « [À COPIER] … » avec bouton Copier. */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return null
  return (
    <div className={`space-y-3 leading-relaxed ${className}`}>
      {lines.map((line, i) => {
        const copy = line.match(/^\[À COPIER\]\s*(.+)$/i)
        if (copy) {
          return (
            <div key={i} className="rounded-control border border-line bg-bg p-4">
              <p className="mb-3 whitespace-pre-wrap text-[0.95rem]">{copy[1]}</p>
              <CopyButton text={copy[1]} />
            </div>
          )
        }
        return <p key={i}>{inline(line)}</p>
      })}
    </div>
  )
}

function inline(line: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/g
  let last = 0
  for (const m of line.matchAll(re)) {
    if (m.index > last) out.push(line.slice(last, m.index))
    const href = m[2] || m[3]
    out.push(<a key={m.index} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2">{m[1] || href.replace(/^https?:\/\//, '')}</a>)
    last = m.index + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

/** Date SQLite (UTC) → « il y a 5 min », « hier », « 12 nov. ». */
export function ago(sqlDate: string | null | undefined): string {
  if (!sqlDate) return '—'
  const d = new Date(sqlDate.includes('T') ? sqlDate : sqlDate.replace(' ', 'T') + 'Z')
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  if (min < 60 * 24) return `il y a ${Math.round(min / 60)} h`
  if (min < 60 * 48) return 'hier'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}
