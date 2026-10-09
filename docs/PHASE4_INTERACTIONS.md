# Phase 4 — agent interaction and office navigation

This phase extends the verified character foundation. The supplied worker, Manager, workstation and headband GLBs, their rigs and their clips are unchanged. There is no backend, authentication, task execution, provider integration or production agent runtime.

## Selection and camera

`OfficeWorld` owns transient `OfficeSelection`. Character and visible accessory hits bubble to the character's exact agent ID and stop propagation; desks never resolve to a nearby employee. HTML markers and the accessible agent list use the same handler. The dedicated Manager keeps its own model and identity. Selection adds a ground ring and marks the agent button without restarting animation.

The single existing `CameraController` receives one-shot focus requests for company, department, workstation and current agent position. Focus does not lock camera tracking. Orbit, pan, wheel zoom, resize and reset remain available. A context-panel focus action can recenter a moving agent; reset clears selection. No new camera controller or postprocessing is introduced.

## Runtime input and spatial feedback

`src/office/officeState.ts` names the runtime task, activity, dependency, position, workstation and context interfaces. `AgentContext` remains a compatible alias for existing snapshot producers. `OfficeRuntimeSnapshot` is a read-only input; `null` means disconnected. No scene component fetches or fabricates business data.

`AgentPlacement` projects identity, model kind, supplied status, initial ground pose, workstation and movement command into rendering. The nine statuses remain sleeping, queued, working, walking, collaborating, waiting, completed, blocked and repair. A state input drives the existing motion/headband controller. Playing a clip or reaching a waypoint never changes a task or runtime status.

The later worker-only accessory correction also gates working presentation by model kind: standard workers equip the red headband and use `seated_work_hard`; the Manager uses calm `seated_work` with no accessory load, attachment or headband sequence in any state. The models, common navigation and exact-ID selection remain unchanged. The Phase 4 browser report below is historical evidence from before this correction; current ownership checks are in [worker-only headband validation](validation/worker-only-headband-browser.json).

`AgentSpatialSnapshot` is local presentation feedback: current ground position and facing, workstation, destination, movement state, speed, path progress, collaboration target, physical phase, diagnostic and command/arrival IDs. The scene updates mutable refs during its existing frame callback. React receives copies on selection, discrete phase/command/arrival changes, or the inspector's explicit refresh action, rather than every frame. Inspectors label this as a sampled spatial view. An arrival ID means a route ended, not that work completed.

The context panel resolves the selected ID against the latest runtime snapshot. It displays task, description, progress, dependencies, collaborator, blockers, next action and activity only when supplied. Development samples explicitly say runtime disconnected and use unavailable-field messages. Spatial fixture status is labeled as visual test input. Artifact URL validation and the old unmounted prototype provider remain intact.

## Navigation and movement

`src/office/officeNavigation.ts` builds a deterministic graph from the open floor, authored department/circulation anchors and assigned workstation poses. It exposes stable corridor, department, workstation, meeting and collaboration destinations. Routing happens when a command is requested, not on every frame. Validated floor and furniture clearance constrain every route segment; missing or unreachable destinations report a diagnostic instead of guessing or teleporting.

The planner uses Y-up meters on the 36 × 36 m floor, with a 0.24 m ground clearance radius. Separate measured desktop and chair footprints include the chair's 0.40 m rollback. Keeping those footprints separate preserves the calibrated standing exit; narrow gaps between adjacent desks are rejected. Rotated workstations use the same local footprints. The graph is rebuilt only when workstation poses/IDs change.

| Node ID                          | Spatial meaning                                     |
| -------------------------------- | --------------------------------------------------- |
| `workstation:<id>`               | Assigned workstation's calibrated standing anchor   |
| `department:<id>`                | Clear department entrance, outside the desk rows    |
| `hub:central`                    | Open collaboration point `[0,0,3]`                  |
| `corridor:0..3`                  | Central circulation at Z = −15, −6, 0 and 15 m      |
| `entrance:front`                 | `[0,0,17]`                                          |
| `meeting:open`                   | Open meeting point `[0,0,10]`                       |
| `waypoint:<id>:<shape>:<corner>` | Safe corner outside an inflated furniture footprint |

`planNavigation(currentPosition, destinationNodeId)` returns explicit points and a named destination, or a diagnostic. `planApproach(currentPosition, targetPosition)` finds a clear standing approach without crossing the other actor's position. `validatePath(points)` also guards externally supplied routes at the renderer boundary. Planning uses a static visibility graph and deterministic distance search; no LLM or physics engine is involved.

`AgentMotion` retains its explicit command ID, ground points and speed, with an optional named destination. Reusing an ID does not restart motion. New position fields do not teleport mounted characters. Mid-route commands begin at the current spatial position. Seated departure starts from the existing workstation standing anchor after the authored chair/headband exit.

The existing motion controller removes the worker's band, rises from the chair, follows the route and reports arrival. A caller may then supply collaborating, working or another appropriate state. Returning reaches the assigned standing anchor, turns toward the desk and sits. Standard workers then run the existing headband sequence; the Manager proceeds directly to calm seated work. Blocked/repair and sequence reversal retain their verified behavior. The old known-route return remains compatible; the new planner supplies routes for other valid locations.

## Local validation scenarios

Development-only `/?office=scenarios` contains thirty labeled worker fixtures and one dedicated Manager fixture. It has no `OfficeRuntimeSnapshot`, tasks, progress, costs or invented activity. Explicit controls select/focus an actor, request work, walk to a collaboration point, return to the desk, or supply one of the nine visual states. Matching command-arrival events advance only the local scenario's visual input. There are no random timers or automatic work-completion loops.

The scenario reserves its single hub point for one actor and releases it after that actor departs and clears 1.2 m, avoiding overlapping demonstration characters. This is a local test constraint, not a production crowd scheduler. The planner's standing-agent approach is covered separately by tests.

The older `/?workers=preview` animation validation remains available. Both development entries are excluded from the production bundle. Default production remains runtime-disconnected and contains no fabricated workforce.

## Limits and validation

The graph is a single-floor deterministic spatial foundation, not a general navigation mesh or crowd simulation. It does not reserve space between moving employees, track moving furniture, or negotiate simultaneous arrivals. Changes to workstation placement require rebuilding the graph and requesting new routes. Collaboration has a spatial indicator and explicit target; no conversation or reasoning is simulated. Asset licensing and existing physical-animation tolerances remain as documented in the asset reports.

The 0.24 m planning radius is a ground-root proxy, not a full animated-limb collision envelope. Existing asset verification records walk-start mesh widths of 0.634 m for the worker and 0.723 m for the Manager. The calibrated chair exit has only 5 mm beyond that planning radius. The retained posture/contact checks cover that authored exit; arbitrary turns, arm sweeps and simultaneous crowd encounters need broader collision/reservation work before a production crowd runtime.

Typecheck, lint, all 118 automated tests, formatting and production build pass with Node 24.21.0 / npm 11.19.0. Lint retains five existing warnings in the preserved prototype `WorkstationScreen`/`OfficeContext`; the production build retains its existing large-chunk advisory. The final main JavaScript is 1,381.45 kB (390.92 kB gzip). New regression coverage includes every desk's hub/return route, live route reversal, rotated furniture, narrow gaps, rejected and invalidated commands, arrival identity, pre-load request rejection, hub occupancy, typed context and all nine statuses.

[Chromium evidence](validation/phase4-browser.json) records 51 unique passing checks: 42 from the main run plus ten isolated follow-up checks, with one duplicate removed. The second-page delayed-loading wait timed out under the main run; a fresh single-page run passed guarded loading and full recovery, the older animation preview, and production verification without application changes. This is combined evidence on the same frozen implementation, not one uninterrupted passing script.

The browser verified 30 workers, the dedicated Manager and 31 shared workstations; exact-ID selection and highlight; truthful context; both character types' full desk/hub/return sequences; headband removal and reattachment; blocked/repair interruption; department, workstation and moving-agent focus; orbit, pan, zoom, reset and responsive resize. Recorded movement remained continuous and within the planner's walkable ground. Five GLBs loaded once each with matching hashes. There were no console errors or failed requests. Representative close-up frames showed no obvious floating, detached accessories or furniture penetration; this does not cover every animated limb sweep.

The overview sample measured 1.35 FPS, 86 draw calls and 1,431,353 triangles, with 27 geometries and 62 textures. A matching headless Chromium capture identified ANGLE/Vulkan SwiftShader software rendering. Resource sharing and functional stability passed, but this result does not establish smooth hardware rendering or 100-agent performance. Those remain unverified.

SHA-256 checks confirm the worker, Manager, workstation and headband bytes are unchanged from the accepted animation milestone. No asset conversion or animation redesign was performed. Development fixture IDs and controls are absent from the production JavaScript.

## Changed files in this phase

| Files                                                                                     | Responsibility                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/office/officeNavigation.ts`, `.test.ts`                                              | Static graph, route/approach planning and walkable-space validation                                          |
| `src/office/officeState.ts`                                                               | Named runtime interfaces and separate local spatial feedback                                                 |
| `src/office/workerPresentation.ts`, `.test.ts`                                            | Stable normalized identities and visual input projection                                                     |
| `src/office/characterMotion.ts`, `.test.ts`                                               | Arrival/progress feedback and stopping externally invalidated routes; existing animation sequencing retained |
| `src/components/3d/AnimatedCharacter.tsx`                                                 | Discrete spatial feedback and selected-agent ring                                                            |
| `src/components/3d/OfficeCharacters.tsx`                                                  | Shared feedback wiring for both canonical character types                                                    |
| `src/components/3d/OfficeWorld.tsx`                                                       | Route validation, selection/focus, sampled context and external event boundary                               |
| `src/components/OfficeContextPanel.tsx`, `.test.tsx`                                      | Truthful context, workstation/agent focus and spatial refresh                                                |
| `src/dev/OfficeNavigationPreview.tsx`, `.test.tsx`, `src/dev/officeNavigationFixtures.ts` | Isolated explicit scenarios for 30 workers and Manager                                                       |
| `src/App.tsx`, `src/App.css`                                                              | Development-only entry and restrained state-marker colors                                                    |
| `BUILD_PLAN.md`, `CODEX_HANDOFF.md`, `docs/OPEN_OFFICE_CONTRACT.md`, this document        | Authorized phase boundary, architecture and evidence                                                         |
| `docs/validation/phase4-browser.json`                                                     | Durable Chromium checks, asset hashes, movement traces and performance observations                          |

Pre-existing changes from earlier milestones remain preserved. The prototype provider, procedural employee/workstation components and all canonical asset files were not changed in this phase.
