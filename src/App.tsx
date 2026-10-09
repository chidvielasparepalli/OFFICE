import { ArrowUpRight, Building2, Unplug } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { OfficeWorld } from './components/3d/OfficeWorld'
import './App.css'

const WorkerAssetPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('workers') === 'preview'
    ? lazy(() => import('./dev/WorkerAssetPreview'))
    : null

const OfficeNavigationPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('office') === 'scenarios'
    ? lazy(() => import('./dev/OfficeNavigationPreview'))
    : null

function App() {
  return (
    <div className="office-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="office-header">
        <div className="office-wordmark">
          <Building2 size={26} aria-hidden="true" />
          <span>OFFICE</span>
        </div>
        <a
          className="repository-link"
          href="https://github.com/chidvielasparepalli/OFFICE"
          target="_blank"
          rel="noopener noreferrer"
        >
          View repository
          <ArrowUpRight size={18} aria-hidden="true" />
        </a>
      </header>

      <main id="main-content" tabIndex={-1}>
        <div className="office-introduction">
          <h1>AI Corporate Office OS</h1>
          <p>
            Explore the office space. Agent activity will appear here when a
            real runtime is connected.
          </p>
        </div>

        {OfficeNavigationPreview ? (
          <Suspense fallback={<p>Loading office navigation scenarios…</p>}>
            <OfficeNavigationPreview />
          </Suspense>
        ) : WorkerAssetPreview ? (
          <Suspense fallback={<p>Loading worker asset inspection…</p>}>
            <WorkerAssetPreview />
          </Suspense>
        ) : (
          <OfficeWorld />
        )}

        <div className="office-foundation">
          <section
            className="runtime-notice"
            role="status"
            aria-labelledby="runtime-heading"
          >
            <Unplug size={24} aria-hidden="true" />
            <div>
              <h2 id="runtime-heading">Agent runtime not connected</h2>
              <p>
                No agents are running here. Tasks, costs, approvals, and results
                will appear only when a real runtime is connected.
              </p>
            </div>
          </section>
        </div>
      </main>

      <footer className="office-footer">
        <span>OFFICE</span>
        <span>3D office foundation</span>
      </footer>
    </div>
  )
}

export default App
