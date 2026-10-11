# Phase 9 — QA and repair

Phase 9 extends the validated Phase 8 security checkpoint `99f2df5` on `codex/phase9-qa-repair`. It adds explicit quality evaluation and bounded repair coordination. The runtime, tools, memory security policy and supplied character/animation assets remain authoritative. No provider, autonomous repair, production backend or new execution privileges are introduced.

## Ownership and execution

```text
Responsible Manager / explicit operator command
  → OfficeRuntime.requestQA (selected policy)
  → worker completes canonical task (still unverified)
  → QAEngine.run
  → canonical inspection task assigned to QA-capable worker
  → existing ToolExecutor → registry, host grants, schemas, execution records
  → OfficeRuntime.completeQA derives result from recorded evidence
  → verification / canonical repair task / attention
  → existing events, activity, Manager subscription, UI and 3D bridge
```

`src/qa/qaTypes.ts` contains the contracts, `qaPolicy.ts` validates policy and evaluates evidence, and `QAEngine.ts` coordinates explicitly requested tool calls. `src/runtime/qaRuntime.ts` applies changes inside the existing atomic runtime transaction. `RuntimeState.qaRequests` and `repairRequests` are normalized collections in the same repository/snapshot, not independent stores or event buses. Inspection and repair work use the canonical `RuntimeTask` collection.

QAEngine keeps only an in-flight promise map. Repeated concurrent runs of the same QA/verifier share one promise; a different verifier conflicts. Terminal QA is not rerun. Each new recheck has a new ID. Cancellation/disconnection invalidates tool authority through the existing task/ToolExecutor cancellation boundary; late results cannot verify cancelled work.

## Requests, checks and evidence

A request records QA/task/source-agent IDs, responsible Manager, optional artifact ID, scope, explicit checks, priority, status and timestamps. It also records root/previous QA IDs, associated repair, attempt count, retry limit, verifier/inspection task and allocated tool-execution IDs. Statuses are `queued`, `running`, `passed`, `failed`, `blocked`, `cancelled`.

Check categories are functional, correctness, structure, requirement-compliance, formatting, security, performance and accessibility. A category is descriptive: selecting “security” does not claim comprehensive scanning. Checks select a registered tool and a typed assertion over its structured output: path existence, JSON equality, string inclusion, numeric maximum, or credential-pattern absence. Build/Test/Structure/Requirement policies can compose these assertions with approved tool outputs; QA never parses arbitrary prose as a pass or executes shell/file operations directly.

Policy validation requires 1–16 unique checks, at least one required check, exact supported fields/enums and bounded JSON. Paths have at most 12 keys; inputs/expected JSON are at most 4 KiB, the complete request at most 32 KiB. Existing `memorySafeJson` rejects credential-like policy values rather than persisting them as QA/event data. This reuses the Phase 8 boundary; no second sanitizer is introduced.

Every result contains check outcomes, passed/failed check IDs, findings, evidence, maximum finding severity, verifier and timestamps. A finding links its check, original task/artifact, factual assertion outcome, severity and suggested repair category. Evidence references actual committed tool-execution IDs, tool IDs, output paths, assertion match and structured error code. Raw outputs are retained only in the existing tool record; QA summaries do not duplicate them. Missing evidence is reported as unavailable, never fabricated.

Evidence must match the allocated execution ID, tool, verifier and inspection task, have an allowed permission decision, successful status and actual start/completion timestamps. Before execution or reuse, ToolExecutor also binds a reserved QA execution ID to the exact configured JSON input; a different input cannot seed a passing record under that ID. Exact retries of retained terminal executions remain idempotent. Execution failure, denial, cancellation or unusable output blocks that check. A completed tool with an unmet assertion fails that check. Tool success alone does not imply quality or task completion.

## Decision and verification semantics

1. Any unavailable **required** check makes QA blocked.
2. Otherwise any failed required check, or failed optional error/critical check, makes QA failed.
3. Otherwise QA passes. Optional info/warning failures and unavailable optional checks remain visible but do not block acceptance.

Severity is `info`, `warning`, `error`, `critical`, ordered only for the result's maximum finding severity. Free-form text never decides status. A `no-credentials` assertion uses the unchanged pattern validator; a tool redaction marker also fails it because original cleanliness cannot be established. This is not an exhaustive security scanner. Performance assertions compare explicit numeric tool outputs to a declared threshold, not inferred hardware capability.

`RuntimeTask.status = completed` means the worker has reported completion. Optional `task.verification` separately records the latest QA ID, pending/running/verified/failed/blocked/cancelled status, attempt count, limit and attention. Only a passing result produces `verified`. Configured QA gates dependent task readiness and Manager plan completion. Failures and all earlier attempts remain immutable records.

Unconfigured legacy tasks retain their existing completion semantics but are explicitly unverified in the UI and Manager result (`verifiedTaskIds` is separate from `completedTaskIds`). QA is explicitly selected, not retroactively invented for every task. Configure policy before dependent work starts or the owning workflow completes; late attachment is rejected. An existing policy cannot be replaced to reset retries, and inspection/repair children cannot acquire recursive QA policies. They use the source policy's recheck. Manager coordination control tasks cannot be QA targets: quality policies belong to their work outputs.

## Repair, rechecks and interruption

Failed QA atomically creates a `RepairRequest` and a canonical child task unless its retry limit is exhausted. The request links source QA/task, finding IDs, required changes, required capabilities, priority, responsible agent, status, attempt and timestamps. Repair statuses are queued, assigned, in_progress, waiting, completed, failed and cancelled. The task's parent/metadata retain traceability; there is no separate repair task database.

`assignRepair` uses the existing capability/Manager matcher and deterministic candidate order. The source worker blocked by this exact QA failure may repair its own work if qualified and otherwise free. Generic canonical task assignment/start also enforce repair capability and Manager ownership, so they cannot bypass this boundary. Manager remains a coordinator, not an automatically assigned worker.

Assignment, start, actual approved tool invocation, completion and recheck are explicit commands. `startRepair` starts the canonical task. Existing task lifecycle transitions synchronize the repair record and activity once per accepted runtime command. A repair worker uses the existing `repair` visual indicator; the ToolExecutor permits that state only for the actual assigned in-progress canonical repair task. No general permission or arbitrary repair-state tool exception exists.

The default maximum is two repairs, configurable from zero to five. Initial QA attempt is zero. A completed repair increments the next QA attempt. Failure at the limit emits `REPAIR_EXHAUSTED`, creates no further repair and leaves the workflow needing attention. Completing a repair is not verification. `recheckQA` requires its linked completed repair after failure, creates a new QA ID and retains the original checks/scope and history. Blocked/cancelled inspections may be explicitly retried without consuming a repair attempt; they are never retried automatically. Historical attempts cannot fork competing rechecks, and terminal workflows cannot reopen through QA/repair commands.

Cancellation of a Manager request cancels its live QA, inspection tools and nonterminal repair tasks. A failed/cancelled source task or disconnection also invalidates pending QA. Reconciliation releases repair posture on terminal repair outcomes. A QA result does not overwrite the source worker's status if that worker has already moved to another task.

## Manager, events and activity

ManagerOrchestrator retains its single subscription. It monitors QA/repair events, exposes actual attempts/repairs in context and offers ownership-checked request/assignment/start/recheck methods. Pending QA keeps a workflow executing. Failed/blocked/cancelled QA, failed repairs and exhaustion yield structured attention. Passing QA allows explicit downstream dispatch or plan completion. The Manager does not automatically run tools or invent recovery strategies.

The same runtime events add `QA_REQUESTED`, `QA_STARTED`, `QA_PASSED`, `QA_FAILED`, `QA_BLOCKED`, `QA_CANCELLED`, and repair requested/assigned/started/waiting/completed/failed/cancelled/exhausted events. Accepted changes and after-images commit atomically with matching activity. Invalid commands return structured errors, retain the previous snapshot and emit no misleading success event. There is no parallel audit stream.

## Memory and security

QA creates **no memory automatically**. An explicit caller can curate a useful lesson through the existing principal-bound MemoryService/MemoryRepository. The development example remembers a successful repair approach from its real completed tool execution as **tool/unverified**, even after QA passes. Later task-context retrieval preserves that source and trust.

No memory source type, verification privilege or grant is added. Recursive credential rejection, access checks, immutable source identity, ordinary trust preservation, verified-promotion grant/evidence requirements, supersession and restored-history validation remain unchanged. A QA pass is not a memory verification grant. Phase 8 limitations remain: credential detection is pattern-based, and the system does not independently prove an authorized verification assertion. Full runtime snapshots/commands remain privileged host/operator interfaces, not authenticated agent APIs.

## UI and 3D

The task inspector shows verification, latest result/severity, failed checks, findings, evidence references, repair status, count/limit, attention and retained attempts. Selected-agent context links actual QA tasks/repair assignments; empty states explicitly say QA is not available.

The existing runtime bridge and character system remain unchanged. Source completion pending QA presents waiting; failure presents blocked; active repair presents repair; passed QA presents completed when the source still owns the worker. The Manager keeps calm seated work and never loads a headband. Normal worker working uses the existing seated/headband sequence. Selection, camera, navigation, shared assets and open-top office are preserved.

Repair presentation indicates runtime repair state at the worker's current location. This phase does not invent repair gestures or remote-site movement. Future repair operations needing a different physical location must provide explicit spatial intent through the existing navigation boundary.

## Development scenarios

Open `/?qa=preview` in development. It begins empty/disconnected. Connect explicitly, choose a mode and create the Manager plan. A registered write tool modifies a labelled in-memory document; a registered inspection tool reads its actual contents. There are no fabricated execution records or production fixtures.

- **Pass:** write an Acceptance section, complete the task, run QA; verification gates Manager completion.
- **Fail → repair → pass:** write the incomplete draft, complete, inspect, assign/start repair, write the actual fixed document, complete repair, request/run recheck.
- **Exhaustion:** repair without satisfying the assertion, recheck, observe bounded failure/attention.
- **Blocked:** verifier lacks the required host tool grant; adapter execution is denied and QA blocks.
- **History:** earlier failed and later passing QA records remain independently inspectable.
- **Memory:** explicitly save a repair lesson, then assemble later task context; tool provenance remains unverified.

The development tools have access only to this session document. Existing host tools can be selected through the same executor contracts and their existing grants/profiles, but this phase adds no host privilege. QA context and previews are DEV-gated; production remains disconnected with no fabricated workforce. The preview keeps company overview during initial navigation; explicit agent selection then focuses the current position. The existing camera does not continuously follow a moving selected character.

## Validation, performance and limits

The complete suite passes **658 tests across 40 files**: all 564 baseline tests plus 94 new assertions covering policy/evidence, executor binding/cancellation, canonical runtime transactions, Manager gates and development/UI flows. The Phase 8 security implementation and its regression tests are unchanged. Final command: `npm test -- --maxWorkers=2 --reporter=dot`; the lower concurrency avoids CPU contention with software-rendered browser tests. An earlier concurrent run hit the existing navigation test's five-second timeout; no test or timeout was weakened.

Typecheck, lint, formatting and production build pass. The five existing prototype lint warnings, large production chunk advisory and future Vite native-config-loader advisory remain. Production JavaScript remains exactly 1,382,420 bytes with SHA-256 `2a7e2d41527e60c570deddcac5a710f352fea0bbee5e26a5e7a3edb8567d4bb7`; DEV-only QA adds no bytes or fixture state to that bundle.

Targeted Chromium acceptance passes **48 checks**: [43 QA/runtime/security/3D checks](validation/phase9-qa-browser.json) and [five production-isolation checks](validation/phase9-qa-production-browser.json). Actual document writes and inspections prove pass, failure, repair, recheck, retained history, blocked permission, retry exhaustion and explicit unverified memory. Worker/Manager exact selection and camera focus, seated worker headband pickup/removal, calm headband-free Manager, overview reset and runtime-driven indicators pass. Browser console/page errors and unexpected failed requests are zero. The intentionally unavailable production execution endpoint returns 404. Validated source hashes are recorded; no hot reload occurred during acceptance.

All five canonical GLBs load once across four scenario resets. During the idle sample, commands (86), commits (52), notifications (231) and subscribers (5) remain unchanged. This confirms no QA polling in that sample, not a large-company throughput benchmark. The preview uses two workers and one Manager; all prior automated regressions remain green, but the older complete browser suites and a new 100-agent hardware benchmark were not repeated.

No new runtime store, per-agent polling, per-frame check, animation mixer, GLB or dependency is added. QAEngine executes only requested attempts; the existing Manager subscription observes commits. Lifecycle reconciliation scans the current QA/repair collections once per relevant command. Like existing runtime history, these collections are unbounded in this in-memory milestone; durable retention/indexing and very large-history benchmarks remain future work.

Verification covers only the selected assertions and evidence captured at inspection time. It is not comprehensive security, accessibility or performance certification, nor proof an external artifact remains unchanged afterward. Tools that fail execution yield blocked QA; a build/test tool should provide structured validation outcomes when a failed test is to be treated as a quality failure. There is no artifact content-version registry, autonomous repair strategy, external provider, durable backend or production deployment. Headless SwiftShader observations are not RTX hardware benchmarks.
