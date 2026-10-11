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

const OfficeRuntimePreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('runtime') === 'preview'
    ? lazy(() => import('./dev/OfficeRuntimePreview'))
    : null

const ManagerOrchestrationPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('manager') === 'preview'
    ? lazy(() => import('./dev/ManagerOrchestrationPreview'))
    : null

const ToolExecutionPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('tools') === 'preview'
    ? lazy(() => import('./dev/ToolExecutionPreview'))
    : null

const MemoryPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('memory') === 'preview'
    ? lazy(() => import('./dev/MemoryPreview'))
    : null

const QAPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('qa') === 'preview'
    ? lazy(() => import('./dev/QAPreview'))
    : null

const ArtifactPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('artifacts') === 'preview'
    ? lazy(() => import('./dev/ArtifactPreview'))
    : null

const ProviderCostPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('providers') === 'preview'
    ? lazy(() => import('./dev/ProviderCostPreview'))
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
            {ProviderCostPreview
              ? 'Provider development preview. Host-only deterministic adapters enforce permissions, secrets boundaries and local credit accounting; no external calls or spending are enabled.'
              : ArtifactPreview
                ? 'Artifact development preview. Explicit outputs preserve immutable versions, provenance and QA evidence in the local runtime.'
                : QAPreview
                  ? 'QA development preview. Explicit tool checks distinguish completed work from verified work; repair attempts are bounded and retain history.'
                  : MemoryPreview
                    ? 'Memory development preview. Scoped, explicit memory operations use the local runtime; no automatic learning or external provider is connected.'
                    : ToolExecutionPreview
                      ? 'Tool execution development preview. Host permissions protect disposable workspaces; no autonomous work or external AI provider is connected.'
                      : ManagerOrchestrationPreview
                        ? 'Manager orchestration development preview. Requests, plans and dispatch use the local runtime; execution outcomes are explicit test commands.'
                        : OfficeRuntimePreview
                          ? 'Local runtime development preview. All commands and task records are explicit test scenarios; no external work is executed.'
                          : 'Explore the office space. Agent activity will appear here when a real runtime is connected.'}
          </p>
        </div>

        {ProviderCostPreview ? (
          <Suspense fallback={<p>Loading provider preview.</p>}>
            <ProviderCostPreview />
          </Suspense>
        ) : ArtifactPreview ? (
          <Suspense fallback={<p>Loading artifact preview.</p>}>
            <ArtifactPreview />
          </Suspense>
        ) : QAPreview ? (
          <Suspense fallback={<p>Loading QA preview.</p>}>
            <QAPreview />
          </Suspense>
        ) : MemoryPreview ? (
          <Suspense fallback={<p>Loading memory preview…</p>}>
            <MemoryPreview />
          </Suspense>
        ) : ToolExecutionPreview ? (
          <Suspense fallback={<p>Loading tool execution preview…</p>}>
            <ToolExecutionPreview />
          </Suspense>
        ) : ManagerOrchestrationPreview ? (
          <Suspense fallback={<p>Loading Manager orchestration preview…</p>}>
            <ManagerOrchestrationPreview />
          </Suspense>
        ) : OfficeRuntimePreview ? (
          <Suspense fallback={<p>Loading local runtime preview…</p>}>
            <OfficeRuntimePreview />
          </Suspense>
        ) : OfficeNavigationPreview ? (
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

        {!OfficeRuntimePreview &&
          !ManagerOrchestrationPreview &&
          !ToolExecutionPreview &&
          !QAPreview &&
          !ArtifactPreview &&
          !ProviderCostPreview &&
          !MemoryPreview && (
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
                    No agents are running here. Tasks, costs, approvals, and
                    results will appear only when a real runtime is connected.
                  </p>
                </div>
              </section>
            </div>
          )}
      </main>

      <footer className="office-footer">
        <span>OFFICE</span>
        <span>3D office foundation</span>
      </footer>
    </div>
  )
}

export default App
