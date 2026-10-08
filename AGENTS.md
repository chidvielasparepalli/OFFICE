# OFFICE — Codex Repository Instructions

## Mission

Build the AI Corporate Office OS described in `BUILD_PLAN.md`.

This repository is a personal, AI-assisted engineering project. The goal is to build a real multi-agent operating system represented by a truthful interactive 3D corporate office.

## Source of truth

- `BUILD_PLAN.md` = product architecture, milestones, invariants, V1/V2 scope.
- `3D_ASSET_LIBRARY.md` = external 3D asset candidates, provenance, and asset intake rules.
- Actual source code and database migrations = implementation truth.
- Do not invent mock production state when real runtime state exists.

Read only the documents relevant to the current task. Do not unnecessarily load every project document for a small change.

## Codex operating model

Work as the lead software engineer.

For a new or complex task:

1. Inspect the relevant repository files and existing implementation.
2. Identify the smallest correct change.
3. State the implementation approach briefly.
4. Implement the change.
5. Run the most relevant checks.
6. Fix failures caused by the change.
7. Re-check the affected behavior.
8. Summarize what changed and any remaining risk.

For large features, work in milestones instead of attempting the entire project in one edit.

Do not stop merely because a subproblem is difficult. Continue through investigation, implementation, testing, and repair unless blocked by missing credentials, unavailable external services, or a genuinely ambiguous product decision.

## Architecture invariants

### 1. Backend truth

The backend/database/runtime is authoritative for:

- agent status
- tasks
- dependencies
- handoffs
- artifacts
- approvals
- API access
- costs
- notifications
- important lifecycle transitions

The 3D world visualizes this state.

Never make an animation the source of truth for business state.

### 2. Manager ownership

The Manager is the single responsible owner of user goals.

Workers execute delegated tasks. They do not independently redefine the company's global plan.

### 3. Deterministic 3D runtime

Do not use an LLM for:

- camera interpolation
- walking
- sitting/standing
- animation playback
- ordinary navigation
- rendering
- interpolation
- routine UI state

Use AI where reasoning is actually required.

### 4. Agent lifecycle

Only agents with meaningful active work should wake.

Sleeping agents should be visually quiet and computationally cheap.

### 5. No fake production data

Mocks are acceptable for isolated UI/prototype tests, but do not replace the real office runtime with hardcoded agents, tasks, completion states, fake costs, or fake events in production paths.

### 6. Security

Never expose or commit secrets.

Never put provider/API secrets in:

- React code
- client bundles
- `NEXT_PUBLIC_*` variables
- localStorage
- sessionStorage
- public assets
- Git history

Provider credentials stay server-side behind the API/Secrets broker.

### 7. Existing systems

Prefer extending existing working systems over rewriting them.

Before replacing a subsystem, identify:

- why it must change
- what depends on it
- migration impact
- rollback/recovery path

### 8. 3D assets

External OBJ/FBX/GLTF assets must go through the asset pipeline:

```
source asset
  -> Blender inspection
  -> cleanup / normalization
  -> optimization
  -> GLB/glTF
  -> production asset registry
  -> R3F
```

Do not blindly commit huge raw assets into the application bundle.

Preserve asset provenance and license information.

### 9. Performance

Avoid:

- React state updates every frame
- one network request per employee
- duplicate copies of identical heavy models
- unnecessary animation mixers for sleeping agents
- excessive shadows
- uncontrolled texture sizes

Target a scene that can scale toward 50–100 agents.

### 10. Camera ownership

Use a single camera controller.

Do not let unrelated components fight over the Three.js camera.

## 3D implementation rules

Prefer:

- React Three Fiber
- `@react-three/drei`
- GLB/glTF
- AnimationMixer for imported character clips
- GSAP for deterministic camera/UI transitions
- reusable assets
- LOD where appropriate
- instancing where appropriate
- cached asset loading

The camera should support:

- overview
- department focus
- agent focus
- workstation inspection
- reset

Employee interaction should support:

- hover
- selection
- camera focus
- inspector
- real state visualization

## Backend integration rules

Prefer one normalized office-state layer for the client.

Do not let every 3D object directly query Supabase.

The preferred flow is:

```
Supabase / API / Realtime
        ↓
OfficeStateProvider
        ↓
normalized state
        ↓
3D scene + HUD + inspectors
```

## Database changes

For schema changes:

1. Inspect existing migrations/schema.
2. Add a migration rather than changing production assumptions silently.
3. Keep authorization/RLS considerations explicit.
4. Update affected code and tests.
5. Never print or expose secret values.

## Testing

Use the repository's actual scripts.

At minimum, for meaningful code changes, run the relevant:

- typecheck
- lint
- unit/integration tests
- production build

For 3D changes also verify:

- browser console
- asset load errors
- WebGL/rendering errors
- camera interaction
- selection/focus
- performance regressions

Do not blindly run every expensive test for a trivial documentation edit.

## Asset acceptance checklist

Before adopting a third-party 3D asset:

- source URL recorded
- creator recorded
- license recorded
- redistribution/use permission checked
- attribution requirement recorded
- file format known
- polygon/triangle count checked
- texture sizes checked
- scale/orientation checked
- origin/pivot checked
- animation availability checked
- material compatibility checked
- production GLB generated
- final file size acceptable

## Git discipline

Prefer small focused commits.

Good examples:

- `feat: add r3f office foundation`
- `feat: add reusable employee character`
- `feat: connect agent state to 3d scene`
- `feat: add task-driven navigation`
- `perf: optimize office asset loading`
- `fix: repair employee camera focus`
- `docs: update build plan`

Do not mix unrelated cleanup with feature work unless required.

## Definition of a completed task

A task is complete when:

- requested behavior is implemented
- existing functionality remains intact
- relevant checks pass
- important runtime errors are resolved
- security boundaries remain intact
- the implementation is documented when architecture changed

Do not claim a feature is complete merely because files were edited.

## When blocked

If blocked by a missing file, secret, external service, or user decision:

- identify exactly what is missing
- finish all work that does not depend on it
- leave the repository in a coherent state
- clearly report the blocker

## Current 3D warehouse asset

The project may receive an Office Warehouse OBJ/MTL/texture package from the user.

Treat those raw files as source assets.

Do not assume the file structure, materials, scale, topology, or license without inspection.

Once the files are present, inspect them in Blender, identify useful building parts, then convert and optimize them into production GLB assets.

## Important

Do not blindly follow an old instruction if it conflicts with the current repository state or the current task.

Use `BUILD_PLAN.md` as the architectural contract, but use the actual codebase as implementation truth.
