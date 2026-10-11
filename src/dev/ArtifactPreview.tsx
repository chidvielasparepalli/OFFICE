import { useEffect, useState, useSyncExternalStore } from 'react'
import { ArtifactDetails } from '../components/ArtifactContextPanel'
import { RuntimeOffice } from '../components/RuntimeOffice'
import {
  ARTIFACT_PREVIEW as ids,
  createArtifactPreviewSession,
  type ArtifactPreviewMode,
} from './artifactFixtures'

export default function ArtifactPreview() {
  const [mode, setMode] = useState<ArtifactPreviewMode>('repair')
  const [session, setSession] = useState(createArtifactPreviewSession)
  const { runtime } = session
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(
    'Connect explicitly. No artifacts or task outputs are preloaded.',
  )
  const [result, setResult] = useState<unknown>(null)
  useEffect(() => () => session.dispose(), [session])
  const connected = state.connection === 'local'
  const task = state.tasks[ids.task]
  const currentTask =
    state.tasks[state.agents[ids.workerA]?.currentTaskId ?? '']
  const outputs = session.outputs()
  const latest = session.latest()
  const qa = session.latestQA()
  const repair = session.repair()
  const manager = session.manager.getContext(ids.request)
  async function perform(action: () => unknown | Promise<unknown>) {
    setBusy(true)
    setResult(null)
    try {
      const value = await action()
      setResult(
        value && typeof value === 'object' && 'events' in value
          ? { revision: runtime.getSnapshot().revision }
          : (value ?? null),
      )
      setNotice(
        'Explicit operation completed. Artifact metadata refers to actual stored bytes and accepted runtime evidence.',
      )
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `${'code' in error ? error.code : 'REJECTED'}: ${error.message}`
          : 'Operation rejected.',
      )
    } finally {
      setBusy(false)
    }
  }
  function button(
    id: string,
    label: string,
    action: () => unknown,
    disabled = false,
  ) {
    return (
      <button
        type="button"
        data-testid={`artifact-${id}`}
        disabled={!connected || busy || disabled}
        onClick={() => void perform(action)}
      >
        {label}
      </button>
    )
  }
  return (
    <>
      <p className="asset-preview-notice">
        Artifact development preview. Explicit local tools write immutable
        in-memory bytes. Registration, QA and repair are separate operations; no
        production files, external providers or automatic work.
      </p>
      <fieldset className="animation-preview-controls">
        <legend>Development session</legend>
        <label>
          Scenario{' '}
          <select
            data-testid="artifact-mode"
            value={mode}
            disabled={busy}
            onChange={(event) =>
              setMode(event.target.value as ArtifactPreviewMode)
            }
          >
            <option value="repair">
              QA failure → repair → new version → pass
            </option>
            <option value="simple">
              Simple output without configured verification
            </option>
            <option value="pass">Verified output</option>
            <option value="multiple">Two independently verified outputs</option>
            <option value="missing">Missing required output</option>
            <option value="access">Worker-private artifact access</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="artifact-reset"
          disabled={busy}
          onClick={() => {
            setSession(createArtifactPreviewSession(mode))
            setResult(null)
            setNotice('Reset to an empty disconnected artifact session.')
          }}
        >
          Reset with selected scenario
        </button>
        <button
          type="button"
          data-testid="artifact-connect"
          disabled={busy || connected}
          onClick={() => void perform(session.connect)}
        >
          Connect local artifact runtime
        </button>
      </fieldset>
      <p role="status" data-testid="artifact-notice">
        {notice}
      </p>
      <fieldset className="animation-preview-controls">
        <legend>
          1 — Task, actual tool output, explicit artifact registration
        </legend>
        {button('begin', 'Plan artifact task', session.begin, !!task)}
        {button(
          'input',
          'Import and link user input brief',
          session.importInput,
          !task || task.startedAt !== null || !!state.artifacts[ids.input],
        )}
        {button(
          'start',
          'Dispatch and start worker task',
          session.start,
          task?.status !== 'queued',
        )}
        {button(
          'write-failing',
          'Write document without Acceptance section',
          () => session.write(false),
          currentTask?.status !== 'in_progress',
        )}
        {button(
          'write-passing',
          'Write document with Acceptance section',
          () => session.write(true),
          currentTask?.status !== 'in_progress',
        )}
        {button(
          'create',
          'Register explicit artifact / new version',
          session.createOutput,
          !session.hasPending(),
        )}
        {button(
          'request-qa',
          'Request QA for latest output',
          session.requestQA,
          !latest ||
            Object.values(state.qaRequests).some(
              (item) => item.artifactId === latest.artifactId,
            ),
        )}
        {button(
          'complete',
          'Report worker task completed',
          session.finish,
          currentTask?.status !== 'in_progress',
        )}
        {button(
          'run',
          'Run next queued artifact QA',
          session.runQA,
          task?.status !== 'completed' ||
            !Object.values(state.qaRequests).some(
              (item) => item.status === 'queued',
            ),
        )}
      </fieldset>
      <fieldset className="animation-preview-controls">
        <legend>2 — Repair, version history and access boundary</legend>
        {button(
          'repair',
          'Assign and start canonical repair',
          session.assignRepair,
          repair?.status !== 'queued',
        )}
        {button(
          'recheck',
          'Recheck the repaired artifact version',
          session.recheck,
          qa?.status !== 'failed' ||
            repair?.status !== 'completed' ||
            latest?.version === 1,
        )}
        {button(
          'private-read',
          'Attempt unrelated worker read',
          session.deniedRead,
          !latest,
        )}
      </fieldset>
      <fieldset className="animation-preview-controls">
        <legend>Selection and inspection</legend>
        {button('worker', 'Focus producing worker', () =>
          session.issue({ type: 'selectAgent', agentId: ids.workerA }),
        )}
        {button('verifier', 'Focus verifier worker', () =>
          session.issue({ type: 'selectAgent', agentId: ids.workerB }),
        )}
        {button('manager', 'Focus Manager', () =>
          session.issue({ type: 'selectAgent', agentId: ids.manager }),
        )}
        {button(
          'task',
          'Inspect source task',
          () => session.issue({ type: 'selectTask', taskId: ids.task }),
          !task,
        )}
      </fieldset>
      <section aria-label="Artifact development status">
        <h2>Recorded outputs</h2>
        <p data-testid="artifact-summary">
          {Object.keys(state.artifacts).length} artifact versions ·{' '}
          {Object.keys(state.qaRequests).length} QA attempts ·{' '}
          {Object.keys(state.repairRequests).length} repairs
        </p>
        <dl>
          <dt>Worker task</dt>
          <dd data-testid="artifact-task-status">
            {task?.status ?? 'Not created'}
          </dd>
          <dt>Latest output</dt>
          <dd data-testid="artifact-output-status">
            {latest ? `v${latest.version}: ${latest.status}` : 'Not created'}
          </dd>
          <dt>Latest QA</dt>
          <dd data-testid="artifact-qa-status">
            {qa?.status ?? 'Not requested'}
          </dd>
          <dt>Repair</dt>
          <dd data-testid="artifact-repair-status">
            {repair?.status ?? 'Not requested'}
          </dd>
          <dt>Manager plan</dt>
          <dd data-testid="artifact-manager-status">
            {manager.plan?.status ?? 'Not planned'}
          </dd>
        </dl>
        {manager.plan?.issues.length ? (
          <ul data-testid="artifact-manager-issues">
            {manager.plan.issues.map((item, index) => (
              <li key={index}>
                {item.code}: {item.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div data-testid="artifact-output-list">
          {outputs.length ? (
            outputs.map((item) => (
              <ArtifactDetails
                key={item.artifactId}
                artifact={item}
                state={state}
              />
            ))
          ) : (
            <p>No worker outputs registered.</p>
          )}
        </div>
        <details>
          <summary>Manager output result</summary>
          <pre
            data-testid="artifact-manager-result"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {manager.result
              ? JSON.stringify(manager.result, null, 2)
              : 'No result available.'}
          </pre>
        </details>
        <h3>Explicit operation result</h3>
        <pre
          data-testid="artifact-result"
          style={{
            maxHeight: 260,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {result === null
            ? 'No operation result exposed.'
            : JSON.stringify(result, null, 2)}
        </pre>
      </section>
      <RuntimeOffice
        runtime={runtime}
        diagnostics
        executionNotice="Local artifact development runtime. Office characters visualize accepted state; content remains in controlled in-memory storage."
      />
    </>
  )
}
