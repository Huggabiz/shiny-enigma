import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useProjectStore } from './store/useProjectStore'
import type { Project } from './types'

declare global {
  interface Window {
    __VIEWER_MODE__?: boolean;
    __EMBEDDED_PROJECT__?: Project;
  }
}

if (window.__VIEWER_MODE__ && window.__EMBEDDED_PROJECT__) {
  const store = useProjectStore.getState();
  store.loadProject(window.__EMBEDDED_PROJECT__);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
