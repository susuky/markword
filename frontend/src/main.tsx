import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './persistence.css'
import './styles.css'

if (!document.querySelector('link[rel="manifest"]')) {
  const manifest = document.createElement('link')
  manifest.rel = 'manifest'
  manifest.href = '/manifest.webmanifest'
  document.head.append(manifest)
}

const isProduction = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD === true

if (isProduction && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
