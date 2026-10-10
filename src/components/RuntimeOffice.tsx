import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { OfficeWorld } from './3d/OfficeWorld'
import type {
  AgentSpatialSnapshot,
  OfficeSelection,
} from '../office/officeState'
import type {
  RuntimeCommand,
  RuntimeResult,
  RuntimeState,
} from '../runtime/runtimeTypes'
import { createOfficeRuntimeBridge } from '../runtime/officeRuntimeBridge'
import { RuntimeTaskPanel } from './RuntimeTaskPanel'

const RuntimeWorld = memo(OfficeWorld)

/** The renderer consumes snapshots and discrete feedback, never a command reducer. */
export interface RuntimeOfficePort {
  getSnapshot(): RuntimeState
  subscribe(listener: () => void): () => void
  dispatch(command: RuntimeCommand): RuntimeResult | Promise<RuntimeResult>
  getMetrics?(): object
}

export function RuntimeOffice({
  runtime,
  diagnostics = false,
  executionNotice,
}: {
  runtime: RuntimeOfficePort
  diagnostics?: boolean
  executionNotice?: string
}) {
  const state = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  )
  // Replacing the runtime service must discard its route and mount caches.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const bridge = useMemo(() => createOfficeRuntimeBridge(), [runtime])
  const spatialViews = useMemo(
    () => ({ current: new Map<string, AgentSpatialSnapshot>() }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [runtime],
  )
  const [bridgeRevision, refreshBridge] = useReducer(
    (value: number) => value + 1,
    0,
  )
  const snapshot = useMemo(
    () => bridge.project(state, spatialViews.current),
    // Discrete spatial feedback can change the bridge without a business-state update.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [bridge, state, spatialViews, bridgeRevision],
  )
  const [focusRequest, setFocusRequest] = useState<{
    version: number
    selection: OfficeSelection
  }>()
  const sceneSelectedId = useRef<string | null | undefined>(undefined)
  const renderCommits = useRef(0)
  const [counters, setCounters] = useState<object | null>(null)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const feedbackLifetime = useRef(0)

  useEffect(() => {
    feedbackLifetime.current++
    return () => {
      // This ref is a monotonic callback generation, not a captured DOM resource.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      feedbackLifetime.current++
    }
  }, [runtime])

  useEffect(() => {
    renderCommits.current++
  })
  useEffect(() => {
    let selected: string | null | undefined
    const synchronizeSelection = () => {
      const id = runtime.getSnapshot().selectedAgentId
      if (id === selected) return
      selected = id
      // A scene-originated department selection must not be replaced by an overview focus.
      if (sceneSelectedId.current === id) {
        sceneSelectedId.current = undefined
        return
      }
      setFocusRequest((previous) => ({
        version: (previous?.version ?? 0) + 1,
        selection: id ? { kind: 'agent', id } : { kind: 'company' },
      }))
    }
    synchronizeSelection()
    return runtime.subscribe(synchronizeSelection)
  }, [runtime])

  const flushFeedback = useCallback(() => {
    for (const command of bridge.drainFeedback()) {
      const current = runtime.getSnapshot()
      if (
        current.connection === 'local' &&
        current.agents[command.agentId]?.destination?.id === command.intentId
      ) {
        const result = runtime.dispatch(command)
        const generation = feedbackLifetime.current
        const recordResult = (value: RuntimeResult) => {
          if (feedbackLifetime.current === generation)
            setFeedbackError(value.ok ? null : value.error.message)
        }
        if (result instanceof Promise)
          void result.then(recordResult, () =>
            recordResult({
              ok: false,
              error: {
                code: 'TRANSPORT',
                message: 'Host feedback could not be delivered.',
              },
            }),
          )
        else recordResult(result)
      }
    }
  }, [bridge, runtime])
  useEffect(() => {
    // Publish queued external-store feedback after render; retain any rejection for the user.
    // oxlint-disable-next-line react/set-state-in-effect
    flushFeedback()
  }, [snapshot, flushFeedback])
  const onSpatialEvent = useCallback(
    (event: AgentSpatialSnapshot) => {
      if (
        bridge.onSpatialEvent(
          runtime.getSnapshot(),
          event,
          spatialViews.current,
        )
      )
        refreshBridge()
      flushFeedback()
    },
    [bridge, runtime, spatialViews, flushFeedback],
  )
  const onSelectionChange = useCallback(
    (selection: OfficeSelection) => {
      const id = selection.kind === 'agent' ? selection.id : null
      sceneSelectedId.current = id
      runtime.dispatch({ type: 'selectAgent', agentId: id })
    },
    [runtime],
  )
  const onSelectTask = useCallback(
    (taskId: string) => {
      runtime.dispatch({ type: 'selectTask', taskId })
    },
    [runtime],
  )

  return (
    <>
      <p
        className="runtime-notice"
        role="status"
        data-testid="runtime-store-status"
      >
        {state.connection === 'local'
          ? (executionNotice ??
            'Local runtime connected — in-memory state. No AI or external task execution.')
          : 'Runtime disconnected. No agent or task state is supplied to the office.'}
      </p>
      <RuntimeWorld
        runtime={snapshot}
        spatialViews={spatialViews}
        onSpatialEvent={onSpatialEvent}
        onSelectionChange={onSelectionChange}
        selectionRequest={focusRequest}
        onSelectTask={onSelectTask}
      />
      {feedbackError && (
        <p role="alert">Spatial feedback rejected: {feedbackError}</p>
      )}
      <RuntimeTaskPanel
        state={state}
        onClose={() => runtime.dispatch({ type: 'selectTask', taskId: null })}
      />
      {import.meta.env.DEV && diagnostics && (
        <details className="runtime-diagnostics">
          <summary>Development runtime counters</summary>
          <p>Sampled on request; no polling or per-frame state updates.</p>
          <button
            type="button"
            className="reset-view"
            data-testid="runtime-sample-counters"
            onClick={() =>
              setCounters({
                store: runtime.getMetrics?.() ?? null,
                bridge: bridge.getMetrics(),
                renderCommits: renderCommits.current,
                events: state.events.length,
                activities: state.activities.length,
              })
            }
          >
            Sample counters
          </button>
          {counters && (
            <pre data-testid="runtime-counters">
              {JSON.stringify(counters, null, 2)}
            </pre>
          )}
        </details>
      )}
    </>
  )
}
