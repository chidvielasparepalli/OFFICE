# Phase 6 — Manager orchestration core

Phase 6 extends the reviewed Phase 5 runtime. It coordinates explicitly supplied requests and task records locally; it does not execute the tasks, interpret arbitrary requests with AI, or verify external results. The 226-test Phase 5 baseline passed before implementation. Its uncommitted work was preserved on `codex/phase6-manager-orchestration`.

## Ownership and flow

```text
Request input → ManagerOrchestrator → Planner → unknown structured proposal
                                              ↓ validation
                              atomic accepted plan + RuntimeTasks
                                              ↓ explicit dispatch
                                  existing runtime commands/events
                                      ↙                 ↘
                            Manager monitor        existing 3D bridge
                            plan/request status    navigation + animation
```

`OfficeRuntime` remains the only business store. Its immutable snapshot now also contains normalized `requests` and `plans`. Orchestration commands use the existing transaction, repository commit, event after-images, activity history and subscriber notification boundary. The orchestrator holds only service lifecycle, event cursor, derived context cache and diagnostics. It has no parallel agents, task list, event bus or persistent workflow store.

The renderer still owns physical interpolation and animation. No orchestration module imports Three.js, manipulates a mesh or uses animation completion as task completion.

## Models and planning boundary

| Model             | Contract                                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ManagerRequest`  | Request ID, title, description, requester, priority, constraints, responsible Manager ID, lifecycle status, accepted plan ID, current planning attempt, coordination task, issues and timestamps.                                                                                |
| `PlanProposal`    | Plan/request IDs, objective, proposed ordinary task definitions, dependencies, capabilities/preferred worker, constraints and expected output descriptions. Proposed tasks must start `queued`.                                                                                  |
| `ExecutionPlan`   | References canonical runtime task IDs and their assignment requirements. Dependencies, assignees, progress and task statuses are read from `RuntimeTask`, not copied into the plan. Includes ownership, objective, constraints, expected outputs, status, issues and timestamps. |
| `ExecutionResult` | Derived request/plan status and actual completed, failed and blocked task IDs. Artifact references are empty until an artifact system supplies them. Summary explicitly distinguishes recorded completion from verified output.                                                  |
| `ManagerContext`  | Responsible Manager, active request/plan, active/blocked/completed tasks, active assignees, dependencies, relevant events and derived result. This is a read-only view of the runtime.                                                                                           |

Request states are `received`, `planning`, `planned`, `executing`, `blocked`, `completed`, `failed`, `cancelled`. Plan states are `planned`, `executing`, `needs_attention`, `completed`, `failed`, `cancelled`; worker-task failure currently requires attention, rather than automatically terminating or repairing the request. Planner rejection fails the request before a plan exists.

`Planner` is the `ReasoningProvider` structured-planning contract: `plan(request, context): Promise<unknown>`. It receives immutable request data and a limited agent/capability context, without the runtime command service. `DeterministicPlanner` invokes an explicitly supplied proposal factory. There is no default production template, provider name, network transport, credential handling or code/tool execution capability.

`validatePlanProposal` treats the result as untrusted data. It checks exact object fields, required nonempty descriptions, safe unique IDs, collisions with runtime tasks/plans, request ownership, queued task state, supported priorities, retained request constraints, known and capable preferred standard workers, internal dependency references and cycle rejection. It returns an independent frozen proposal in dependency order. Unsupported fields, accessors, malformed arrays, Manager-as-worker assignments and external/cross-plan dependency IDs are rejected. Expected-output descriptions may be empty; they are not output artifacts.

The complete proposal is validated before any body task is created. Acceptance creates every canonical task and the plan in one existing repository transaction. A rejected proposal or failed repository commit publishes no partial plan. Planning attempts have unique IDs: cancellation or disconnect invalidates the attempt, so a late reply cannot become live after reconnect.

## Manager service and dispatch

`ManagerOrchestrator` exposes `receiveRequest`, `planRequest`, `dispatchReady`, `synchronize`, `cancelRequest`, `getContext`, `getMetrics`, `start` and `dispose`. Its single subscription is explicitly started/stopped and supports React StrictMode remounts. One Manager coordinates one active request at a time; additional received requests wait for an explicit planning command. Cancelling only the coordination task cannot free the Manager from an accepted request; the request must be resolved or explicitly cancelled.

Beginning planning creates, assigns and starts a real Manager coordination task through the existing task handlers. It records the service's actual responsibility for that request and remains active while monitoring the accepted plan. It is separate from the plan's body-task list, avoiding a circular completion condition. A blocked, repaired, cancelled or otherwise interrupted coordination task prevents silent workflow completion.

`TaskDispatcher` selects a worker using exact capability inclusion, Manager ownership (or an unowned worker), optional preferred ID and availability. Equally eligible workers sort by stable ID. Managers are excluded. Workers with a nonterminal current task or a blocked, repair, working, walking or collaborating state are unavailable. A preferred worker does not silently fall back to another agent.

`dispatchReady` is an explicit command, not a monitor effect. It considers unassigned queued tasks with completed prerequisites, ordered by priority and stable plan order. `dispatchPlanTask` rechecks ownership, current coordination, readiness, capabilities and availability atomically, then reuses `assignTask` and `startTask`. Assignment and start publish together. An unmet dependency stays waiting; completing its prerequisite only releases readiness. Another explicit dispatch is required. An unavailable worker produces an `AGENT_UNAVAILABLE` issue and an attention state; eligibility can clear that issue, but never starts the task automatically.

The Phase 5 assignment hold correction preserves an existing manual `waiting` or `blocked` status and reason when assigning its first worker. Assignment cannot silently clear a manual hold. Explicit resume and repair acknowledgment retain their previous meanings.

## Monitoring, failures and completion

The monitor consumes committed task/agent events, accepted plans and reconnect events. It advances its cursor before issuing derived-status commands, so synchronous subscriber reentry cannot repeatedly process the same events. Synchronization is idempotent: unchanged status/issues produce no extra commit or activity. Selection changes do not call the planner or dispatch workers.

`synchronizePlan` reads canonical task state. Blocked tasks, manual waits, failed/cancelled tasks, unavailable assigned workers, incompatible direct assignments, dependencies outside the accepted plan and interrupted Manager coordination produce structured issues. These paths require explicit operator intervention; there is no generated recovery strategy, replanning loop or QA/repair engine. Existing generic Phase 5 task commands remain available for explicit local control; the monitor reports incompatible changes rather than hiding them.

When every body task is recorded completed and Manager coordination remains available, synchronization completes the coordination task and request/plan. It does not fabricate files, URLs, QA approval or verified results. Whole-request cancellation cancels its nonterminal body tasks and coordination task atomically, leaving unrelated tasks alone.

Events add `REQUEST_RECEIVED`, `PLANNING_STARTED`, `PLAN_ACCEPTED`, `PLAN_REJECTED`, `PLAN_DISPATCHED`, `PLAN_STATUS_CHANGED` and `REQUEST_CANCELLED`. Request/plan after-images extend the same replay/publication contract as Phase 5. Activities describe accepted commands and state changes. The repository is still synchronous and in-memory; no durable or distributed event infrastructure was added.

Rejected persistence writes cannot undo an already accepted upstream task command. A failed monitor, issue-recording or proposal-rejection write is surfaced as a technical service error and visible preview notice, without inventing a business event. There is no automatic retry loop. `synchronize` retries an accepted plan explicitly; an unresolved planning attempt can be explicitly cancelled. Repository fault-injection tests cover these paths.

## Runtime and 3D integration

The existing `RuntimeOffice` and runtime bridge consume the same canonical agents/tasks. Dispatch creates the existing workstation intent; the existing graph and controller perform walk → seat → work. Worker completion drives existing headband removal. Exact-ID selection, task context, camera focus, collaboration movement and open-top visibility remain in the Phase 4/5 systems.

Kind-specific visuals are unchanged: standard workers use the supplied stickman and red-headband working-hard sequence; the dedicated Manager uses calm `seated_work` at normal speed and never mounts a headband. Manager planning/monitoring is represented by its coordination task, without a visual-only business state. No GLB, registry URL, mesh, animation clip, camera or navigation implementation was changed for Phase 6.

## Development scenarios

Run the pinned toolchain and Vite, then open `http://127.0.0.1:5173/?manager=preview`. This lazy entry and all templates/registrations are guarded by `import.meta.env.DEV`. Production remains empty and disconnected, including when the development query parameter is supplied.

The preview explicitly connects two labelled development workers and the dedicated Manager at authored desks. It preserves entered request prose and applies one named deterministic research → implementation template; it does not pretend to understand the prose. Controls issue real local runtime commands:

1. **Request and plan:** submit the request, explicitly plan, inspect task descriptions/dependencies and Manager coordination.
2. **Dependency dispatch:** dispatch research, observe its existing walk/seating/headband sequence, explicitly record completion, then explicitly dispatch the newly eligible implementation task.
3. **Blocked:** block a dispatched task with an entered reason; observe `needs_attention`, worker context and safe animation. Resume remains a separate explicit runtime command.
4. **Failure:** record a task failure; inspect the retained failure and attention state. No retry or repair is invented.
5. **Success:** explicitly complete both tasks; inspect recorded completed IDs and the factual result with no artifacts.

The task graph is a compact dependency/assignment table, not a second editable task system. The existing agent/task inspector remains the selected entity interface. Reset creates an empty disconnected runtime; disconnect hides live context while retaining the local session. The older `/?runtime=preview`, `/?office=scenarios` and `/?workers=preview` remain available for their respective checks.

## Performance and validation

There are no new dependencies, asset loads, per-agent polling loops, per-frame planner calls, React animation state updates or new animation systems. The Manager uses one subscription and processes only committed events. Context is cached per snapshot/request; the existing bridge still shares unchanged agent contexts and memoizes the scene boundary. Plan scans run at discrete runtime changes, not animation frames. Sampled counters expose planner calls, dispatch attempts, monitor passes/failures and monitor commit errors alongside the existing runtime/bridge counters.

All **336 tests in 22 files pass**, preserving all 226 Phase 5 tests and adding 110 tests. Typecheck, lint, formatting and production build pass with Node 24.21.0 / npm 11.19.0. Lint retains five existing warnings in unmounted prototype components; the existing large-bundle advisory remains. The final preview wording/guard also passed its nine integration tests and scoped lint. No dependencies were added.

[Chromium evidence](validation/phase6-orchestration-browser.json) records **75 passing checks** across four fresh sequential sessions: 33 Manager orchestration checks, all 33 Phase 5 runtime checks, five 31-character preservation checks and four production-isolation checks. All sessions report zero console errors, failed requests and hot reloads. Exact marker/mesh selection, request/plan/task context, capability assignment, dependency release without autostart, blocked/failure attention, success results, worker travel/seating/headband/removal, calm accessory-free Manager, reconnect/reset and shared resources passed. Final recorded source hashes match the tested files. An earlier harness-only offscreen marker click was corrected by scrolling the canvas before a fresh full run; no application change was needed.

The primary session records four runtime subscriptions, two explicit planner calls, three dispatch attempts, fifteen event-driven monitor passes and zero monitor failures. Steady working frames did not change planner, dispatch, monitor or runtime counters. Five GLBs load once across both requests and reconnect; the 31-character scene retains shared worker geometry/materials/headbands and separate skeletons. The selected three-character view records 21 draw calls and 149,295 triangles under headless SwiftShader, not hardware FPS. Screenshots were visually inspected for seated workers, the red band, the dedicated calm Manager and truthful context.

The served production JavaScript is byte-identical to Phase 5: `index-CmU8X8M7.js`, 1,382,420 bytes (391.15 kB gzip), SHA-256 `2a7e2d41527e60c570deddcac5a710f352fea0bbee5e26a5e7a3edb8567d4bb7`. Combined development query parameters cannot enable fixtures in production, and the disconnected production world requests no employee/workstation/headband GLBs. The full older Phase 4 browser suite and hardware performance benchmark were not repeated.

## Files changed from the reviewed Phase 5 baseline

| Files                                                                                     | Purpose                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/orchestration/orchestrationTypes.ts`                                                 | Request, proposal, plan, result, Manager context and reasoning contracts.                        |
| `src/orchestration/ManagerOrchestrator.ts`, `ManagerOrchestrator.test.ts`                 | Planner coordination, dispatcher, event monitor, derived context/result and service regressions. |
| `src/orchestration/planValidation.ts`, `planValidation.test.ts`                           | Unknown proposal validation and DAG ordering.                                                    |
| `src/orchestration/capabilityMatcher.ts`, `capabilityMatcher.test.ts`                     | Deterministic eligible-worker matching.                                                          |
| `src/orchestration/planner.ts`, `planner.test.ts`                                         | Injected deterministic planner adapter.                                                          |
| `src/orchestration/orchestrationBridge.test.ts`                                           | Connected runtime → navigation → character/headband regression.                                  |
| `src/runtime/orchestrationRuntime.ts`, `orchestrationRuntime.test.ts`                     | Atomic orchestration commands using the existing transaction.                                    |
| `src/runtime/runtimeTypes.ts`, `officeRuntime.ts`                                         | New normalized maps/events/commands and preservation of manual assignment holds.                 |
| `src/runtime/officeRuntimeBridge.test.ts`                                                 | Empty request/plan maps added to the existing typed fixture; existing cases preserved.           |
| `src/dev/ManagerOrchestrationPreview.tsx`, `.css`, `.test.tsx`, `managerFixtures.ts`      | Isolated explicit development scenarios and UI tests.                                            |
| `src/App.tsx`                                                                             | DEV-only lazy preview entry.                                                                     |
| `BUILD_PLAN.md`, `CODEX_HANDOFF.md`, `README.md`, `docs/PHASE5_RUNTIME.md`, this document | Current phase authority, usage and historical boundary clarification.                            |
| `docs/validation/phase6-orchestration-browser.json`                                       | Final Chromium acceptance evidence.                                                              |

The prior Phase 5 bridge, animation controller, renderer, agent/task inspectors, development fixtures and their tests remain byte-for-byte unchanged except for the bridge test's two new empty maps. No dependencies or assets changed. Git changes also contain the preserved uncommitted Phase 5 work; this table identifies the Phase 6 increment.

## Limits and stop boundary

- No external reasoning, actual task execution, artifact verification, automatic dispatch, scheduling, repair reasoning, QA engine or autonomous Manager. Completion means explicit local task records completed.
- One active request per Manager, one nonterminal current task per worker, dependencies confined to one accepted plan. Capacity shortages need an explicit later dispatch. Plan revision and reassignment are not implemented.
- The repository is a trusted typed synchronous boundary. External providers/persistence need authentication, authorization, transport/input limits and durable asynchronous synchronization before production use.
- History and request/plan registries retain the session; they are not paginated or persisted across refresh. Large long-running sessions need retention/indexing work.
- Existing static navigation, crowd/collision limitations, asset licensing and contact tolerances remain unchanged. Headless SwiftShader measurements are not RTX 4060 performance measurements; hardware and 100 animated agents remain unverified.
- Phase 6 ends here. No Phase 7, real LLM provider, Supabase, backend, authentication, external tools, memory, cost controller or deployment is included.
