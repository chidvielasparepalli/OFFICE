# Open office world contract — Phases 3–4

The current [Phase 4 interaction/navigation contract](PHASE4_INTERACTIONS.md) extends the asset foundation below with explicit floor/furniture route validation, waypoint planning, spatial feedback, selection highlighting and truthful full context. It preserves the verified character/headband clips and adds no backend or business runtime.

The user-approved design is an open, spacious, single-level corporate workspace. Company → departments → agents → workstations → tasks/activity is the information hierarchy. The full warehouse shell is not a product requirement.

## World and visibility

- No roof, ceiling, upper slab, enclosing wall or overhead service may obscure workspaces. The candidate contains only a ground slab; zone colors are flat overlays at Y=0.001 m with depth bias to prevent flicker.
- `assets/warehouse/open-layout.json` owns the 36 × 36 m plan, seven department zones, reserved workstation-area centers and circulation anchors. Zones have at least 4 m separation, with open common space through the center. Names describe a proposed layout, not running departments.
- Units are meters; Y is up, +Z is the entrance side, and the ground surface is centered at `[0,0,0]`. No imported transform correction is needed at runtime.
- Future standing-worker envelopes extend to 2.1 m and are included in overview framing. Browser ray checks confirm that those envelopes in all zones have clear sightlines and stay in frame at desktop/mobile overview sizes.
- The separately authorized worker asset phase now verifies 30 canonical stickman samples with supplied desks/chairs/monitors. Their 22 CSS-pixel markers remain identifiable at overview, with deterministic decluttering and a separate accessible list with targets at least 44 CSS pixels. Status has a text/icon cue, not color alone. Floating department labels are omitted while workers are present so they do not cover workers. The small mobile overview relies on markers; close views expose the actual model.
- Close views show the exact worker and supplied workstation together. The preview has 30 stickmen, one dedicated Manager and 31 shared modern workstations. Both characters have separate rigs and fitted office clips. Controls provide labeled animation test input, with no runtime snapshot or tasks. See [the animation report](../assets/animation/README.md).

## Camera ownership

`CameraController` is the sole camera owner. It supports company overview, department focus, reserved workstation-area inspection, smooth wheel zoom, orbit, ground-plane pan, damping, resize and reset. Focus uses `CameraFocus { target, radius }`; selection is separate from camera position. Dragging cancels a camera transition. Reduced-motion users get immediate focus/reset/zoom.

The open preview uses the overview direction `[20,32,24]`, polar limits 2–60 degrees from the Y axis, and distance limits 5–120 m. Department focus frames its footprint and a standing-worker envelope; workstation inspection uses a 2.5 m radius. Reset clears selection and returns to company overview. The preserved Phase 2 procedural scene keeps its original camera settings.

## State and selection boundary

`src/office/officeState.ts` defines a read-only `OfficeRuntimeSnapshot`, `AgentContext`, `DepartmentContext`, `OfficeSelection` and `OfficeSelectionHandler`. The default snapshot is **null**, meaning disconnected, not an empty simulated company.

The future normalized state layer supplies the snapshot. Neither the 3D layer nor the context panel fetches a provider, invents metrics, changes task status, or starts work. `OfficeWorld` owns transient selection only. The canonical worker renderer maps raycast instance indices to supplied IDs and uses the same selection handler as department surfaces and accessible buttons:

```ts
onSelect({ kind: 'agent', id: agent.id })
onSelect({ kind: 'department', id: department.id })
onSelect({ kind: 'company' })
```

The context panel resolves the current ID against each supplied snapshot, so deleted or unavailable records cannot leave stale task details visible. It supports name, role, department, status, task/title/description/progress, manager, dependencies, collaborator, next action, blockers, recent activity, artifacts, provider usage and optional cost. Null fields render as unreported; a cost is never synthesized as zero. Artifact links accept only HTTP(S) URLs without embedded credentials. Provider usage contains public provider/model names and counters, never credentials.

Layout IDs are spatial reservations. A future adapter must explicitly map real runtime department IDs to these areas; it must not use the old prototype fixtures as production state. Prototype components and `OfficeContext` remain preserved and unmounted.

`AgentContext.kind` is explicitly `standard-worker` or `manager`. `presentedAgents()` validates grounded poses and preserves that distinction. `OfficeCharacters` routes normal workers to `StandardWorkerAsset` and Managers to the dedicated `ManagerAsset`; roles and proximity never choose models. Ground `position` seeds mounting; explicit motion commands move an existing character. The assigned `workstation` defines the fixed desk anchor. All desks share `WorkstationAsset`; its chair can roll back during the authored exit. Each character group maps raycasts to its own ID, with independent asset error boundaries and no substitute on failure. Development samples provide labeled animation test states without a runtime snapshot. Official runtime assets are registered in `public/assets/3d/`; rights remain explicitly unverified.

## Deterministic status contract

The exact statuses are `sleeping`, `queued`, `working`, `walking`, `collaborating`, `waiting`, `completed`, `blocked`, and `repair`. The context panel displays the supplied value without advancing it on a timer.

Future visual behavior must follow real state and deterministic application events:

| Status        | Future presentation constraint                                 |
| ------------- | -------------------------------------------------------------- |
| sleeping      | Quiet/inactive pose; no running animation mixer required       |
| queued        | Queued indication; no invented work                            |
| working       | Task-driven pose/activity only while real work is active       |
| walking       | Movement only along a valid deterministic navigation path      |
| collaborating | Explicit supplied collaborator/context                         |
| waiting       | Waiting indication without fabricated progress                 |
| completed     | Bounded completion feedback from a real transition, not a loop |
| blocked       | Visible blocker indication tied to supplied context            |
| repair        | Distinct repair indication tied to real assigned work          |

The separately authorized animation extension implements deterministic visual playback, without real employees, Supabase, backend, task execution or AI/provider integration. Selection, animation and camera motion never become business-state authority.

## Character animation extension

The latest [headband extension](../assets/headband/ANIMATION.md) supersedes the earlier working and blocked/repair behavior below: working equips the supplied accessory and plays a dedicated faster clip; leaving work removes it before movement or calm idle. Blocked/repair finishes removal before pausing. Initial seating requires the actual seat anchor. Known accepted routes may be retraced automatically on working entry; unknown locations still require a supplied safe path.

The earlier rigid-transform/batch description above is historical for characters; desks remain instanced. Each skeletal character now maps mesh raycasts directly to its supplied entity ID. Current animated ground/head positions drive camera focus and markers. Standard workers and Manager continue to use distinct registered models.

`AgentContext.motion?: AgentMotion` carries an explicit command ID, ground-plane path points and speed. `characterMotion.ts` validates finite grounded points, a speed in (0,3] m/s, and connection to the current position. Commands are consumed once; changing `position` does not teleport an existing character. A disconnected destination produces a diagnostic instead of an invented path.

`WORKSTATION_ANCHORS` defines reusable seat/standing anchors rotated by the workstation heading. Working/waiting/sleeping can initially mount seated. Leaving stops typing, exits the chair, then walks along the supplied path. Return requires a supplied path; the character turns toward the desk, sits, then works. Blocked/repair freezes its physical pose with the existing status indicator. Queued/completed preserve seated idle if seated. Collaboration uses explicit movement only. Sleeping uses a static resting pose and stops continuous animation updates.

Each character URL loads once. Clones share geometry, materials, textures and animation clips; bones and playback state vary per employee. Development animation samples remain separate from `OfficeRuntimeSnapshot` and are excluded from the production bundle.

## Acceptance boundary

The warehouse-only local preview remains `/?warehouse=preview`; its production asset URL is still null. `/?workers=preview` adds the validated official characters/workstations during development. Their canonical renderer and runtime URLs are ready for supplied state in production; the default null snapshot mounts no employees. The original procedural building and prototype characters/workstations are preserved. No commit/deployment accompanies local runtime registration; external rights still need verification before redistribution.
