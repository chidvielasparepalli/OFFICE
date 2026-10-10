# Phase 5 — office runtime core

> Historical Phase 5 validation and foundation. Phase 6 extends this same store with requests/plans and preserves manual assignment holds; current scope and limits are in [PHASE6_ORCHESTRATION.md](PHASE6_ORCHESTRATION.md).

Phase 5 adds a deterministic local business-state engine beneath the existing office. It builds on checkpoint `419bd5d5ec1be64307b178fa24161a6a23f106a7`. The canonical GLBs, worker-only headband, animation controller, navigation planner and camera controller are preserved.

The engine records explicitly supplied tasks and commands. It does **not** execute tasks, reason, call providers, run a backend or simulate autonomous work. The default application remains disconnected and empty of employees. Development fixtures are available only through `/?runtime=preview` on the development server.

## Ownership and flow

```text
Explicit command / future trusted runtime adapter
    -> OfficeRuntime transaction
    -> OfficeRuntimeRepository.write(immutable snapshot)
    -> subscriber notification
    -> RuntimeOffice / officeRuntimeBridge
    -> existing OfficeRuntimeSnapshot
    -> OfficeWorld / characterMotion / CameraController

Existing navigation arrival or rejection
    -> bridge correlates the current intent and motion IDs
    -> runtime arrive / rejectMovement command
```

`src/runtime/officeRuntime.ts` is the only business-state store. A command validates references and transitions, constructs a new immutable state, persists it, and then notifies subscribers. A rejected command or failed repository write leaves the previous snapshot and history intact. Unchanged records retain identity. The preserved prototype `OfficeContext` remains unmounted; it is not used as a second store.

The runtime owns task and agent status, assignments, dependencies, progress, blockers, completion and history. The scene owns current interpolated position, posture, animation, selection presentation and camera motion. Reaching a waypoint can acknowledge a spatial intent; it cannot complete a task or invent progress.

## Models

`src/runtime/runtimeTypes.ts` defines the contracts.

| Model                | Fields and role                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RuntimeAgent`       | Stable ID, name, role, department ID, kind, capabilities, status, workstation ID, Manager ID, current task ID, destination, collaborator IDs, blockers, initial/last-arrival ground pose, created/updated timestamps. |
| `RuntimeTask`        | ID, title, description, assignee, status, priority, progress percent, dependency IDs, parent task ID, status reason, dependency-wait flag, JSON metadata and lifecycle timestamps.                                    |
| `RuntimeDepartment`  | ID, supplied name and optional description. No fabricated department metrics.                                                                                                                                         |
| `RuntimeWorkstation` | Stable ID, optional department ID, ground position and heading. A spatial assignment, not a business employee.                                                                                                        |
| `RuntimeEvent`       | Stable event ID, timestamp, uppercase event type, optional agent/task IDs and typed event data.                                                                                                                       |
| `RuntimeActivity`    | Event-linked ID, timestamp, agent/task IDs and a readable description of an accepted command.                                                                                                                         |

Agent kind is exactly `standard-worker` or `manager`. Registration validates references, finite Y-up ground coordinates, unique workstation ownership and explicit identity. Agents register at rest; starting work or movement requires a command. Capability strings and Manager links are data only, not an autonomous dispatcher.

The agent statuses remain `sleeping`, `queued`, `working`, `walking`, `collaborating`, `waiting`, `completed`, `blocked` and `repair`. Task states remain separate: `queued`, `assigned`, `in_progress`, `waiting`, `blocked`, `completed`, `failed`, `cancelled`.

## Tasks, dependencies and history

- `createTask` records the supplied content. `assignTask` sets both the task assignee and the agent's current task. An agent can own one nonterminal current task; there is no hidden queue scheduler.
- `startTask` requires an assignee and completed dependencies. It sets the task to `in_progress`, the agent to `working`, and supplies a fresh workstation intent where a workstation exists. The physical character may still be walking or sitting before its working loop starts.
- Progress changes only through `updateProgress`. `completeTask` explicitly sets completion and 100 percent. Animation duration, navigation and wall-clock time never advance progress.
- Dependency IDs must exist and form an acyclic graph. An unmet prerequisite makes a task wait. Completing it releases dependency-induced waits to `queued` or `assigned`, never automatically starts another task. Failed/cancelled prerequisites remain unmet. Explicit manual waits and blockers remain in place.
- `waitTask`, `blockTask`, `failTask` and `cancelTask` preserve their distinct meanings. Blocked/repair states retain safe physical handling from Phase 4. `beginRepair` records an explicit repair presentation; `repairAgent` acknowledges recovery and restores readiness, without performing repairs or restarting work automatically.
- A completed/failed/cancelled current task remains visible for inspection until another assignment replaces it. Terminal task records are retained.

Events include `TASK_CREATED`, `TASK_ASSIGNED`, `AGENT_STARTED`, `AGENT_WAITING`, `AGENT_WALKING`, `AGENT_COLLABORATING`, `TASK_COMPLETED`, `TASK_FAILED`, `AGENT_BLOCKED` and `AGENT_REPAIRED`, plus registration, readiness, progress, arrival, cancellation and repair-entry events. Every event includes immutable `changes` containing the updated records for agents, tasks, departments, workstations or connection status. Applying these records in committed order reconstructs business state without guessing from event labels. `transactionRevision`, `transactionEventIndex` and `transactionEventCount` identify events belonging to one atomic command, including dependency release. This is a local publication contract, not distributed event infrastructure.

Selection generates no fabricated activity and is excluded from business-event changes. The context shows the latest ten actual agent activities; the task panel shows the latest eight. The in-memory store retains the full session history. While an agent is in `repair`, task resolution/readiness changes cannot silently clear that state; only `repairAgent` acknowledges recovery.

## Store, persistence and subscriptions

`createOfficeRuntime()` starts disconnected with empty normalized registries. Its bound `getSnapshot`, `subscribe` and `dispatch` methods support React's `useSyncExternalStore` without per-agent polling. The store also owns selected agent/task IDs. Disconnecting hides runtime scene data while retaining the local session; the development reset explicitly creates a new empty session.

`OfficeRuntimeRepository` is a synchronous `read` / atomic `write` interface. The provided `InMemoryOfficeRuntimeRepository` keeps snapshots in memory; refresh is not durable persistence. An adapter must either persist the entire transaction or fail without partially writing it. This is a trusted typed boundary, not an external JSON ingestion API. External persistence will require validation, authorization and an asynchronous commit/synchronization strategy before any Supabase adapter is introduced.

Subscribers are notified after successful commits. No network infrastructure, distributed log, background scheduler or independent employee request loop is added. Clock and ID generators can be injected for repeatable tests. Events and activities describe accepted local commands, not fabricated external execution results.

## Spatial intent and the existing navigation system

`AgentSpatialIntent` contains a unique intent ID, destination type/ID, movement reason, requested arrival status and collaborator IDs. Destination types are workstation, hub, agent or named waypoint. It contains no Three.js object.

A movement that requests `working` on arrival must target that agent's own assigned workstation. Hubs, other agents and other desks cannot silently become working seats. The runtime still permits headless task records for an agent without a workstation; it does not invent furniture or a physical working pose for such records.

`src/runtime/officeRuntimeBridge.ts` resolves these through the existing Phase 4 graph:

| Destination             | Resolution                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Assigned workstation ID | Its owner's existing `workstation:<agentId>` calibrated standing anchor.                                          |
| Collaboration hub       | An authored node such as `hub:central`.                                                                           |
| Named waypoint          | Existing corridor, department, meeting or entrance node ID.                                                       |
| Agent ID                | A clear approach to that exact actor's sampled standing position; a seated target uses its accessible chair exit. |

The graph is cached by workstation layout. A route is planned on a new intent, after required characters mount, or when a layout change invalidates it. It is not replanned each frame. Seated departure uses the existing standing exit after headband removal and the authored chair transition. Mid-route changes start from the live spatial view. No-distance arrival at an already occupied workstation does not make a seated worker stand up.

The bridge correlates both intent and motion IDs, ignores stale arrival feedback, and submits accepted arrival/rejection commands. Invalid routes become runtime blockers with a truthful reason. Arrival can set `collaborating`, `waiting` or `working`; task state remains independent. If a workstation arrival is sampled partway through sitting, acknowledgment waits for the actual stable seat/exit sample so reconnecting does not seed an invalid intermediate pose. The same guard covers a new zero-distance workstation intent during a posture transition. A collaboration target is sampled once per intent, without autonomous following or invented conversation.

The existing motion controller now recognizes a successfully completed current command while awaiting runtime acknowledgment. That brief handoff no longer emits the misleading “Walking requires an unfinished explicit path” diagnostic. Missing, cancelled and invalid paths retain their diagnostics; no movement, clip or posture behavior was changed.

Initial fixture positions at a chair can be normalized to the calibrated standing exit for non-seated statuses before mounting. Existing mounted characters are never teleported by updated pose fields. Frame-by-frame positions remain in the existing mutable spatial map; the runtime stores only registration and acknowledged arrival positions.

## Rendering, context and Manager

`src/components/RuntimeOffice.tsx` subscribes to the store and provides the bridge's existing `OfficeRuntimeSnapshot` to `OfficeWorld`. It publishes discrete spatial feedback after rendering or from the existing spatial callback. Business updates do not refocus the camera. Exact-ID scene selection updates the store; explicit external selection produces one camera focus request. Department selection and overview reset keep their existing behavior. There is still one camera controller.

`OfficeContextPanel` resolves the selected agent from the latest projected state. Task title, description, status, progress, dependencies, collaborators, blockers and activity come from the runtime. Missing artifacts, provider usage, costs and other unavailable fields remain unreported. Clicking the current task opens `RuntimeTaskPanel` with its actual assignee, dependencies, status and history. Disconnecting removes runtime details rather than displaying stale business data.

The Manager is a first-class runtime agent with the same task, event, selection and navigation contracts and a separate `manager` kind. Manager links and capabilities leave room for later ownership/delegation logic, but there is no autonomous Manager reasoning or task generation.

The runtime does not know about headbands or animation clips. Existing kind-gated presentation remains authoritative for visuals: standard-worker `working` uses pickup, `seated_work_hard` and removal; Manager `working` uses calm `seated_work` at normal speed. The Manager never mounts the headband loader or accessory. No character model, animation asset or clip was replaced.

## Development scenarios

Run the pinned Node/npm environment and `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`, then open `http://127.0.0.1:5173/?runtime=preview`.

The page starts disconnected. **Connect local runtime** explicitly registers two labeled development workers, the dedicated Manager, three desks and their departments. Fixtures and controls live only in `src/dev/runtimeFixtures.ts` and `src/dev/OfficeRuntimePreview.tsx`; production builds exclude that entry.

1. **Workstation lifecycle:** create a task, assign Worker A, start, observe walk → sit → headband → work, explicitly set progress if desired, then complete and observe removal.
2. **Dependencies:** create A and B, assign them to separate workers, start/complete A, observe B become assigned/eligible, then explicitly start B.
3. **Collaboration:** start a task, request the hub, observe removal/standing/walking/arrival, then request return and observe seating/resumption. Arrival does not finish the task.
4. **Blocked/recovery:** block a started task, enter repair, acknowledge recovery, then separately start/resume. The reason and history update in context.
5. **Manager:** explicitly create/assign/start a development overview task, focus the Manager, inspect actual task context and calm work without any headband.

All task content is labeled development input. Buttons issue commands; they do not generate fake business events on timers. The older `/?office=scenarios` and `/?workers=preview` remain unchanged for 30-worker visual validation.

## Performance and validation

The new runtime adds no dependencies, asset copies, animation mixers, per-frame React state, per-agent polling or per-frame pathfinding. Character GLBs still share geometry/materials/textures/clips with separate skeleton state; desks remain instanced. Existing animation throttling and offscreen handling remain intact. Bridge projections preserve unchanged context identities, index activity once, and bound inspector history. Selection-only commits reuse the prior projected snapshot. The runtime adapter memoizes the unchanged office boundary so counter sampling and task-panel-only updates do not needlessly rerender the scene. Actual projected agent/context updates still render through the existing whole-office snapshot; finer per-agent subscriptions are not claimed.

Development counters expose commands, commits, rejected commands, subscriber notifications, graph builds, route plans, projections, React commits and history counts. They are sampled with a button rather than a polling loop. Session history is currently unbounded; retention and durable pagination are needed before long-running production use.

The full suite passes **226 tests in 15 files**, preserving the 132-test checkpoint and adding 94 regressions. Typecheck, lint, formatting and production build pass with pinned Node 24.21.0 / npm 11.19.0. Lint retains the five pre-existing warnings in the unmounted prototype `WorkstationScreen` / `OfficeContext`; there are no new lint warnings. Coverage includes atomic persistence, event reconstruction, task/agent links, dependencies, repair acknowledgment, spatial intent, kind-specific animation mapping, intermediate-pose reconnects, full hub/return cycles at 16/50/100 ms, context selection and the isolated development controls. The production build retains its existing large-chunk advisory; main JavaScript is 1,382.42 kB (391.15 kB gzip). No dependency was added.

The runtime preview's fresh Chromium run passes all 33 checks with no console errors, failed requests or hot reloads. It verifies exact selection, task/agent context, explicit task/progress/completion changes, dependency release without autostart, collaboration and return, safe blocked/repair acknowledgment, valid reconnects and the Manager's calm accessory-free working state. Five GLBs load once across commands, resets and reconnects. Working animation advances while runtime command/commit counts, subscriptions and route plans stay unchanged. The sampled scenario session has three subscriptions, one navigation-graph build and six route plans; two expected command rejections exercise unmet dependencies and unacknowledged repair. The three-character render sample records 21 draw calls and 149,295 triangles under SwiftShader, not a hardware frame-rate benchmark.

The final [browser evidence](validation/phase5-runtime-browser.json) records **42 passing checks**: 33 runtime, five existing-scene preservation and four production checks, across three fresh sequential Chromium runs on the final source. The 31-character scene retains exact worker/Manager selection, shared worker geometry/materials/headbands and 30 independent worker skeletons. Production serves the rebuilt JavaScript byte-for-byte, excludes development controls/fixture strings and requests no employee/workstation/headband assets while disconnected. All three runs have zero console errors, failed requests and hot reloads. Screenshots and source hashes are listed in the report. The full older Phase 4 browser suite was not repeated.

## Files changed

| Files                                                                                     | Change                                                                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/runtime/runtimeTypes.ts`, `officeRuntime.ts`, `officeRuntime.test.ts`                | Business contracts, local engine/repository and command regressions.                   |
| `src/runtime/officeRuntimeBridge.ts`, `officeRuntimeBridge.test.ts`                       | Existing snapshot projection, deterministic routing and arrival/animation regressions. |
| `src/components/RuntimeOffice.tsx`, `RuntimeOffice.test.tsx`, `RuntimeTaskPanel.tsx`      | Store subscription, selection/feedback integration, actual task context and counters.  |
| `src/components/OfficeContextPanel.tsx`, `OfficeContextPanel.test.tsx`                    | Current task selection/status and requested destination.                               |
| `src/components/3d/OfficeWorld.tsx`                                                       | Optional task selection callback and truthful WebGL fallback copy.                     |
| `src/office/officeState.ts`, `workerPresentation.ts`                                      | Compatible presentation fields for task status, destination and route diagnostics.     |
| `src/office/characterMotion.ts`, `characterMotion.test.ts`                                | Recognize completed-route acknowledgment without a false missing-path warning.         |
| `src/dev/runtimeFixtures.ts`, `OfficeRuntimePreview.tsx`, `OfficeRuntimePreview.test.tsx` | Clearly isolated command-driven development scenarios.                                 |
| `src/App.tsx`, `src/App.css`                                                              | DEV-only runtime entry and compact task/counter styling.                               |
| `BUILD_PLAN.md`, `CODEX_HANDOFF.md`, `README.md`                                          | Current Phase 5 authority, usage and source map.                                       |
| `docs/OPEN_OFFICE_CONTRACT.md`, `docs/PHASE4_INTERACTIONS.md`, `docs/PHASE5_RUNTIME.md`   | Current boundary and preserved historical Phase 4 evidence.                            |
| `docs/validation/phase5-runtime-browser.json`                                             | Recorded browser acceptance evidence.                                                  |

No dependencies, GLBs, original assets, registry URLs, animation clips, navigation planner or camera implementation were changed. The motion-controller change is limited to the completed-route diagnostic guard described above.

## Known limitations / stop boundary

- No actual task execution, autonomous Manager, providers, backend, Supabase, authentication, durable persistence, external realtime, tool execution, memory, QA/repair engine or cost engine.
- One current nonterminal task per agent; assignment does not provide a queue scheduler or reassignment workflow. Capability and parent-task fields are contracts, not orchestration.
- The existing graph is a static single-floor planner, without crowd reservations, collision avoidance between moving agents, dynamic furniture or a full animated-body collision envelope. Its 0.24 m root clearance and narrow calibrated chair exit remain Phase 4 limitations.
- The previous 31-character result of roughly 1.43 million triangles and 1.35 FPS was headless **SwiftShader**, not an RTX 4060 hardware measurement. Hardware frame rate and 100 animated employees remain unverified.
- Asset licensing and existing pose/contact tolerances remain as documented in the asset reports. No source assets were changed.

Phase 5 ends at this local runtime and its validated visualization boundary. Further runtime/backend work requires separate review and authorization.
