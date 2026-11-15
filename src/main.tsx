import '@fontsource-variable/inter'
import './styles.css'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import StudentApp from './student/StudentApp'

// L'admin est chargé à part : les élèves ne téléchargent jamais son code.
const AdminApp = lazy(() => import('./admin/AdminApp'))
const isAdmin = /^\/admin(\/|$)/.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <Suspense fallback={<p className="p-8 text-center text-muted">Chargement…</p>}><AdminApp /></Suspense> : <StudentApp />}
  </StrictMode>,
)
