import { ArrowUpRight, Building2, Unplug } from 'lucide-react'
import './App.css'

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
            A workspace for building a real multi-agent company and its
            interactive 3D office.
          </p>
        </div>

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

          <section
            className="prototype-notice"
            aria-labelledby="prototype-heading"
          >
            <h2 id="prototype-heading">Your 3D prototype is preserved.</h2>
            <p>
              The existing department, workstation, character, screen, and
              camera components are kept in the source. The scene is not mounted
              in this phase.
            </p>
            <details className="prototype-source">
              <summary>View prototype source</summary>
              <ul aria-label="Preserved prototype components">
                <li>
                  <code>DepartmentPod.tsx</code>
                </li>
                <li>
                  <code>Workstation.tsx</code>
                </li>
                <li>
                  <code>AgentCharacter.tsx</code>
                </li>
                <li>
                  <code>WorkstationScreen.tsx</code>
                </li>
                <li>
                  <code>CameraController.tsx</code>
                </li>
              </ul>
              <p>
                Mock office data remains prototype/test data. It is not loaded
                by this shell.
              </p>
            </details>
          </section>
        </div>
      </main>

      <footer className="office-footer">
        <span>React + Vite foundation</span>
        <span>Next phase: 3D engine foundation</span>
      </footer>
    </div>
  )
}

export default App
