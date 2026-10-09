import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import { RotateCcw } from 'lucide-react'
import { CameraController } from './CameraController'
import { OfficeBuilding } from './OfficeBuilding'
import { OfficeLighting } from './OfficeLighting'
import { CAMERA_FOV } from './officeCamera'
import { WarehouseBuilding } from './WarehouseBuilding'
import {
  officeAssets,
  StandardWorkerAsset,
  ManagerAsset,
  WorkstationAsset,
} from '../../assets/officeAssets'
import { OpenOfficeZones } from './OpenOfficeZones'
import { OfficeContextPanel } from '../OfficeContextPanel'
import { OfficeCharacters, WorkerMarkerProjection } from './OfficeCharacters'
import type { CharacterView } from './AnimatedCharacter'
import { presentedAgents, statusSymbols } from '../../office/workerPresentation'
import { createOfficeNavigation } from '../../office/officeNavigation'
import type { AgentPlacement } from '../../office/workerPresentation'
import type { CameraFocus } from './officeCamera'
import type {
  OfficeRuntimeSnapshot,
  OfficeSelection,
  OfficeSelectionHandler,
  AgentSpatialSnapshot,
} from '../../office/officeState'

// The warehouse candidate retains its separate development-only intake gate.
const warehousePreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('warehouse') === 'preview'

const camera = {
  position: [26, 30, 34] as [number, number, number],
  fov: CAMERA_FOV,
  near: 0.1,
  far: 250,
}

function readSpatialSnapshot(
  views: RefObject<Map<string, AgentSpatialSnapshot>>,
  id: string,
) {
  const snapshot = views.current.get(id)
  return snapshot
    ? { ...snapshot, position: [...snapshot.position] as const }
    : undefined
}

export function OfficeWorld({
  runtime = null,
  inspectionSamples,
  spatialViews: suppliedSpatialViews,
  onSpatialEvent,
  onSelectionChange,
  selectionRequest,
  onSelectTask,
}: {
  runtime?: OfficeRuntimeSnapshot | null
  inspectionSamples?: readonly AgentPlacement[]
  spatialViews?: RefObject<Map<string, AgentSpatialSnapshot>>
  onSpatialEvent?: (snapshot: AgentSpatialSnapshot) => void
  onSelectionChange?: OfficeSelectionHandler
  selectionRequest?: { version: number; selection: OfficeSelection }
  onSelectTask?: (taskId: string) => void
}) {
  const openOffice =
    warehousePreview || inspectionSamples !== undefined || runtime !== null
  const placements = useMemo(
    () => (runtime ? presentedAgents(runtime) : (inspectionSamples ?? [])),
    [runtime, inspectionSamples],
  )
  // Only workstation poses rebuild the static graph; status and selection changes do not.
  const workstationKey = JSON.stringify(
    placements.flatMap((worker) =>
      worker.workstation ? [{ ...worker.workstation, id: worker.id }] : [],
    ),
  )
  const navigation = useMemo(
    () => createOfficeNavigation(JSON.parse(workstationKey)),
    [workstationKey],
  )
  const workers = useMemo(
    () =>
      placements.map((worker) => {
        if (!worker.motion) return worker
        const validation = navigation.validatePath(worker.motion.points)
        return validation.ok
          ? worker
          : {
              ...worker,
              motion: { ...worker.motion, points: [] },
              navigationDiagnostic: validation.diagnostic,
            }
      }),
    [navigation, placements],
  )
  const [resetVersion, setResetVersion] = useState(0)
  const [selection, setSelection] = useState<OfficeSelection>({
    kind: 'company',
  })
  const [focus, setFocus] = useState<CameraFocus | null>(null)
  const [spatialSnapshot, setSpatialSnapshot] = useState<
    AgentSpatialSnapshot | undefined
  >()
  const localSpatialViews = useRef(new Map<string, AgentSpatialSnapshot>())
  const spatialViews = suppliedSpatialViews ?? localSpatialViews
  const [assetUnavailable, setAssetUnavailable] = useState(false)
  const [unavailable, setUnavailable] = useState<readonly string[]>([])
  const blocked = (kind: AgentPlacement['kind'] | 'workstation') =>
    unavailable.includes(kind) ||
    (!import.meta.env.DEV &&
      !(
        kind === 'manager'
          ? ManagerAsset
          : kind === 'workstation'
            ? WorkstationAsset
            : StandardWorkerAsset
      ).productionUrl)
  const labels = useRef(new Map<string, HTMLButtonElement>())
  const workerLabels = useRef(new Map<string, HTMLButtonElement>())
  const characterViews = useRef(new Map<string, CharacterView>())
  const zones = officeAssets.warehouse.layout.departments
  const selectedZone =
    selection.kind === 'department'
      ? zones.find((zone) => zone.id === selection.id)
      : undefined
  const reset = useCallback(() => {
    setSelection({ kind: 'company' })
    onSelectionChange?.({ kind: 'company' })
    setSpatialSnapshot(undefined)
    setFocus(null)
    setResetVersion((version) => version + 1)
  }, [onSelectionChange])
  const refreshSpatial = useCallback(
    (id: string) => {
      setSpatialSnapshot(readSpatialSnapshot(spatialViews, id))
    },
    [spatialViews],
  )
  const select = useCallback(
    (next: OfficeSelection) => {
      if (next.kind === 'company') {
        reset()
        return
      }
      if (
        next.kind === 'agent' &&
        !workers.some((worker) => worker.id === next.id)
      )
        return
      if (
        next.kind === 'department' &&
        !zones.some((zone) => zone.id === next.id)
      )
        return
      setSelection(next)
      onSelectionChange?.(next)
      if (next.kind === 'department') {
        const zone = zones.find((zone) => zone.id === next.id)
        if (zone)
          setFocus({
            target: [zone.position[0], 0, zone.position[2]],
            radius: Math.hypot(zone.size[0] / 2, zone.size[1] / 2, 2.1),
          })
      } else {
        const agent = workers.find((worker) => worker.id === next.id)
        if (agent) {
          refreshSpatial(agent.id)
          const position = characterViews.current.get(agent.id)?.position
          setFocus({
            target: position
              ? [position.x, position.y, position.z]
              : agent.position,
            radius: 1.6,
          })
        }
      }
    },
    [onSelectionChange, refreshSpatial, reset, workers, zones],
  )
  const requestVersion = useRef<number | null>(null)
  useEffect(() => {
    if (
      !selectionRequest ||
      requestVersion.current === selectionRequest.version
    )
      return
    requestVersion.current = selectionRequest.version
    select(selectionRequest.selection)
  }, [selectionRequest, select])
  const spatialEvent = useCallback(
    (snapshot: AgentSpatialSnapshot) => {
      if (selection.kind === 'agent' && selection.id === snapshot.agentId)
        setSpatialSnapshot(snapshot)
      onSpatialEvent?.(snapshot)
    },
    [onSpatialEvent, selection],
  )

  return (
    <section className="office-world" aria-labelledby="office-view-heading">
      <div className="office-view-toolbar">
        <h2 id="office-view-heading">
          {openOffice ? 'Open company workspace' : 'Office overview'}
        </h2>
        <button type="button" className="reset-view" onClick={reset}>
          <RotateCcw size={16} aria-hidden="true" />
          Reset view
        </button>
      </div>
      <div className={openOffice ? 'office-explorer' : undefined}>
        <div
          className="office-viewport"
          role="region"
          aria-label="Interactive 3D office"
          aria-describedby="office-controls"
          tabIndex={0}
          onPointerDown={(event) => {
            if (
              event.target instanceof HTMLElement &&
              event.target.closest('button')
            )
              return
            event.currentTarget.focus({ preventScroll: true })
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Escape' || event.code === 'Space') {
              event.preventDefault()
              reset()
            }
          }}
        >
          <Canvas
            camera={camera}
            frameloop="demand"
            dpr={[1, 1.5]}
            shadows
            fallback={
              <p className="webgl-fallback">
                3D view unavailable. Enable WebGL in your browser to explore the
                office.{' '}
                {runtime
                  ? 'Supplied runtime context remains available.'
                  : 'The agent runtime is not connected.'}
              </p>
            }
          >
            <color attach="background" args={['#edf2f6']} />
            <OfficeLighting />
            {openOffice ? (
              <WarehouseBuilding
                onUnavailable={() => setAssetUnavailable(true)}
              />
            ) : (
              <OfficeBuilding />
            )}
            {openOffice && (
              <OpenOfficeZones
                selection={selection}
                onSelect={select}
                labels={labels}
              />
            )}
            {openOffice && workers.length > 0 && (
              <>
                <OfficeCharacters
                  workers={workers}
                  views={characterViews}
                  spatialViews={spatialViews}
                  onSpatialEvent={spatialEvent}
                  selectedId={selection.kind === 'agent' ? selection.id : null}
                  onSelect={select}
                  onUnavailable={(kind) =>
                    setUnavailable((current) =>
                      current.includes(kind) ? current : [...current, kind],
                    )
                  }
                />
                <WorkerMarkerProjection
                  workers={workers}
                  labels={workerLabels}
                  views={characterViews}
                />
              </>
            )}
            <CameraController
              resetVersion={resetVersion}
              focus={openOffice ? focus : null}
              openOffice={openOffice}
              bounds={openOffice ? officeAssets.warehouse.bounds : undefined}
            />
          </Canvas>
          {openOffice && workers.length === 0 && (
            <div className="zone-label-overlay">
              {zones.map((zone) => (
                <button
                  key={zone.id}
                  className="zone-label"
                  type="button"
                  ref={(element) => {
                    if (element) labels.current.set(zone.id, element)
                    else labels.current.delete(zone.id)
                  }}
                  aria-pressed={
                    selection.kind === 'department' && selection.id === zone.id
                  }
                  onClick={() => select({ kind: 'department', id: zone.id })}
                >
                  {zone.name}
                </button>
              ))}
            </div>
          )}
          {assetUnavailable && (
            <p className="asset-load-error" role="alert">
              Warehouse asset unavailable. Showing the open planning floor.
            </p>
          )}
          {workers.length > 0 && (
            <div className="worker-marker-overlay">
              {workers.map(
                (worker, index) =>
                  !blocked(worker.kind) && (
                    <button
                      key={worker.id}
                      className="worker-marker"
                      type="button"
                      ref={(element) => {
                        if (element)
                          workerLabels.current.set(worker.id, element)
                        else workerLabels.current.delete(worker.id)
                      }}
                      aria-label={`${worker.label}; ${worker.status ?? 'static asset sample'}; ${worker.id}`}
                      title={`${worker.label} · ${worker.status ?? 'Static sample'}`}
                      aria-pressed={
                        selection.kind === 'agent' && selection.id === worker.id
                      }
                      data-status={worker.status ?? 'sample'}
                      data-kind={worker.kind}
                      onClick={() => select({ kind: 'agent', id: worker.id })}
                    >
                      <span>
                        {worker.status
                          ? statusSymbols[worker.status]
                          : worker.kind === 'manager'
                            ? 'M'
                            : index + 1}
                      </span>
                    </button>
                  ),
              )}
            </div>
          )}
          {workers.length > 0 &&
            (blocked('standard-worker') ||
              blocked('manager') ||
              blocked('workstation')) && (
              <p className="asset-load-error" role="alert">
                {['standard-worker', 'manager', 'workstation']
                  .filter((kind) =>
                    blocked(kind as AgentPlacement['kind'] | 'workstation'),
                  )
                  .join(', ')}{' '}
                asset unavailable. No substitute model is shown.
              </p>
            )}
        </div>
        {openOffice && (
          <OfficeContextPanel
            onSelectTask={onSelectTask}
            selection={selection}
            runtime={runtime}
            departmentName={selectedZone?.name}
            spatial={spatialSnapshot}
            inspectionSample={
              runtime === null &&
              inspectionSamples &&
              selection.kind === 'agent'
                ? workers.find((worker) => worker.id === selection.id)
                : undefined
            }
            onSelect={select}
            onFocusAgent={(id) => select({ kind: 'agent', id })}
            onRefreshSpatial={refreshSpatial}
            onInspectWorkstation={(id) => {
              const workstation = workers.find(
                (worker) => worker.id === id,
              )?.workstation
              if (workstation)
                setFocus({ target: workstation.position, radius: 2.5 })
            }}
            onInspect={() => {
              if (selectedZone) {
                const desk = workers.find(
                  (worker) =>
                    worker.workstation &&
                    Math.abs(
                      worker.workstation.position[0] - selectedZone.position[0],
                    ) <
                      selectedZone.size[0] / 2 &&
                    Math.abs(
                      worker.workstation.position[2] - selectedZone.position[2],
                    ) <
                      selectedZone.size[1] / 2,
                )?.workstation
                setFocus({
                  target: desk?.position ?? [
                    selectedZone.position[0],
                    0,
                    selectedZone.position[2],
                  ],
                  radius: 2.5,
                })
              }
            }}
          />
        )}
      </div>
      {workers.length > 0 && (
        <details className="worker-index">
          <summary>
            {inspectionSamples && !runtime ? 'Asset samples' : 'Agents'} (
            {workers.length})
          </summary>
          <div>
            {workers.map((worker) => (
              <button
                key={worker.id}
                type="button"
                onClick={() => select({ kind: 'agent', id: worker.id })}
              >
                {worker.label}
                {worker.status ? ` · ${worker.status}` : ''}
              </button>
            ))}
          </div>
        </details>
      )}
      {openOffice && (
        <>
          <nav
            className="department-navigation"
            aria-label="Department workspaces"
          >
            {zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                aria-pressed={
                  selection.kind === 'department' && selection.id === zone.id
                }
                onClick={() => select({ kind: 'department', id: zone.id })}
              >
                {zone.name}
              </button>
            ))}
          </nav>
          <p className="office-controls">
            Open layout preview. Select a department to focus; inspect its
            reserved workstation area for a closer view.
          </p>
        </>
      )}
      <p id="office-controls" className="office-controls">
        Drag to orbit · Scroll to zoom · Right-drag to pan. On touch, use one
        finger to orbit and two to pan or pinch. Space or Escape resets the
        focused view.
      </p>
    </section>
  )
}
