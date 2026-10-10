import { lazy, Suspense, useSyncExternalStore } from 'react'
import App from './App'
import { useI18n } from './i18n'

const HtmlEditorPage = lazy(() => import('./HtmlEditorPage'))

function subscribeToRoute(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export default function Workspace() {
  const { t } = useI18n()
  const htmlPage = useSyncExternalStore(subscribeToRoute, () => window.location.hash === '#/html')
  return htmlPage
    ? <Suspense fallback={<div className="app-loading">{t('Opening HTML editor…')}</div>}><HtmlEditorPage /></Suspense>
    : <App />
}
