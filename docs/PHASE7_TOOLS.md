# Phase 7 — Agent tools and execution

> Historical Phase 7 report. The stable checkpoint is now `fc03a208a642de87aecddb15e5dc91fdbeecd2c2`. Phase 8 extends its existing runtime with explicit scoped memory; current scope and limits are in [PHASE8_MEMORY.md](PHASE8_MEMORY.md). The original uncommitted status and stop boundary below describe the end of Phase 7.

Phase 7 adds explicit, bounded local tool execution to the existing Manager/runtime foundation. It does not add autonomous work, a real research provider, a production backend or credentials. The reviewed Phase 5/6 work was checkpointed as `08da2a78c902c1e4d0fb3f959e4043c5eba58915` before implementation; all 336 baseline tests passed at that point. Phase 7 work is on `codex/phase7-tools-execution`.

## Ownership

```text
Explicit development scenario / future authorized caller
  → existing Manager plan and runtime task assignment
  → host ToolExecutor
      → registry + capability + kind + private permission grant
      → input schema → trusted adapter → output schema
      → existing runtime transaction/events/activity
  → streamed immutable snapshot
  → RuntimeOffice → existing navigation/animation/selection
```

`OfficeRuntime` remains the only business-state processor. Its snapshot adds one normalized `toolExecutions` map. The executor holds only active promises/abort handles and fixed host grants. It does not own another task list, business event bus or completion engine. The development host owns the actual runtime and Manager service; the browser holds a read-only snapshot cache, not a second command reducer. Commands from the scene are limited to selection and validated discrete arrival/rejection feedback.

No execution code imports Three.js. No animation event completes a tool or a task. There are no per-agent polling loops or frame-driven tool calls.

## Contracts and registry

`src/tools/toolTypes.ts` defines `Tool`, `ToolSchema`, `ToolDescriptor`, `ToolRequest`, `ToolExecutionResult`, `ToolGrant`, `ToolPermissionDecision`, `ToolContext` and lifecycle commands. A tool has a stable ID, category, required capabilities/permissions, allowed agent kinds, host timeout, pure input/output parsers, safe audit summary, metadata and asynchronous `execute`. Categories include filesystem, terminal, git, research, data and validation; unused categories have no invented adapters.

`ToolRegistry` registers trusted implementation objects, rejects duplicate IDs and unbounded timeouts, and supports lookup/list/unregister/capability checks. Request data cannot register tools, roots, profiles or grants. An unregistered ID, missing capability, wrong kind or missing permission denies execution. Unregister affects future requests; an already-authorized invocation retains its captured implementation.

| Tool               | Input and effects                                                           | Required permissions                   |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------- |
| `filesystem.read`  | Named root and relative ordinary file; bounded UTF-8 text                   | read                                   |
| `filesystem.write` | Named writable root, relative file and bounded text; atomic replacement     | write                                  |
| `terminal.run`     | Named root, relative cwd and fixed command profile ID                       | execute                                |
| `git.inspect`      | Named repository; status, selected-file diff, bounded log or current branch | read, git                              |
| `git.add`          | Explicit ordinary files in named writable repository                        | write, git                             |
| `git.commit`       | Exactly the selected staged files and a bounded message; local commit only  | write, git                             |
| `research.search`  | Structured query through a host-owned `ResearchProvider`                    | read; also network for a live provider |

Read/inspection/research tools can be explicitly granted to a Manager. Write, terminal and Git mutation tools only allow standard workers. The development Manager receives no tool grant. Its normal coordination task still drives calm seated work. Agent capabilities alone never confer host authority.

## Execution and runtime events

Execution records contain execution/agent/task/tool IDs, queued/running/completed/failed/cancelled status, request/start/finish timestamps, a bounded safe input summary, permission decision, validated public output, structured error and metadata. Raw file-write bodies, environment and credentials are not audit input.

Requests must belong to the agent's current, assigned, explicitly started task and a working agent. One live execution is allowed per agent. An execution ID is idempotent: duplicate calls return the first invocation/result and never replace its input. Reusing an ID for another agent/task/tool is rejected. Runtime persistence must succeed before the adapter is called.

The existing event stream gains `TOOL_REQUESTED`, `TOOL_STARTED`, `TOOL_COMPLETED`, `TOOL_FAILED` and `TOOL_CANCELLED`. Records are immutable after-images in the same transaction/replay contract; ordinary activity entries link agent and task. A denied request records requested + failed + blocked atomically and never records started. Malformed input never reaches `execute`; malformed output never becomes a success.

Tool success leaves the task, progress and agent state unchanged. Explicit task completion remains a separate command. Denial, execution failure, output rejection and timeout leave the task unresolved and route through the existing blocked/Manager `needs_attention` path. Cancellation pauses an active task in manual waiting. No retry, repair strategy, fabricated progress or artifact verification is generated.

The Manager monitor observes tool events through its existing subscription. If its own permitted read tool is still active when body tasks finish, coordination completion waits for that tool to finish; it does not bypass the execution guard.

## Filesystem, process and Git safety

Node-only code is in `tools-host/adapters/`. Named absolute roots and executable profiles come from host configuration. Filesystem paths reject traversal, absolute/drive/UNC/device/alternate-stream paths, reserved names, known credential/control locations, symbolic links, junctions and multiply linked files. Parent directories must already exist. Reads/writes are bounded and files must be ordinary single-link files. There is no delete, recursive traversal, directory creation or link-creation tool.

Terminal execution uses `spawn` with `shell: false`, a native absolute executable, fixed arguments, explicit cwd, hidden Windows windows, a minimal environment, timeout, cancellation and combined output limit. The browser cannot supply a binary, shell command, argv, environment or timeout. The development profiles run the pinned Node executable's version command and a fixed host-authored ten-second delay. A private 1.4-second deadline proves timeout; a separate 15-second bound leaves time for an operator to cancel. Per-profile deadlines cannot exceed the tool's configured bound. These profiles do not run repository scripts or agent-written code. Nonzero exits are structured failures with the exit code in the safe error message; failed-process stdout/stderr are deliberately not published.

Git must identify the exact configured standalone repository. External/shared metadata, configuration includes and custom filters are rejected; hooks, fsmonitor, signing, pagers, prompts, external diff/textconv and inherited configuration are disabled. Operations sharing a repository are serialized. Commit checks that the staged file set exactly matches the explicit selection. There is no push, network Git operation, reset, checkout, clean, rebase or history rewrite. The preview uses only a disposable fixture repository, never the OFFICE checkout.

These policies are bounded capabilities, **not an OS sandbox**. Portable Node cannot eliminate path-check/open/rename races against a separate local process with filesystem authority. Host roots/profiles must not be mutated concurrently by an adversary. A trusted executable can still act beyond its cwd; expanding profiles to interpreters, package scripts or plugin-driven validators requires a stronger isolation design. See [host adapter limits](../tools-host/adapters/README.md).

## Cancellation, timeout and stale results

The executor has one runtime subscription that aborts host work when its record becomes terminal or the runtime disconnects. Task cancellation/failure/manual wait/block, request cancellation and disconnect invalidate active execution IDs atomically. Completing a task or requesting movement while its tool is active is rejected with `TOOL_ACTIVE`.

Supplied process adapters terminate their owned process tree and await close. The executor allows a bounded two-second cleanup grace after abort, covering the Windows adapter’s one-second forced-kill fallback. It also bounds a broken adapter that ignores abort; it retains that agent's operational lease until the adapter settles, preventing overlapping retries. The host preview rejects resume, completion and new scenarios while such a cleanup lease remains. Late output never revives cancelled or failed work. Disposal removes the subscription and aborts work.

Cancellation is not rollback. An atomic write or commit that already completed can persist even if cancellation races its acknowledgement. A killed Git process may leave a lock requiring explicit host recovery. There is no automatic destructive cleanup or blind retry. Executor startup refuses retained queued/running records with `UNRESOLVED_EXECUTIONS`; an orphan active retry reports `UNRESOLVED_EXECUTION`. An operator must explicitly cancel/reconcile these records; effects are never replayed. Durable reconciliation and crash recovery remain a future persistence concern.

## Public output and secrets

Inputs and outputs cross strict pure schemas; output must be finite, bounded JSON. Common credential fields, assignments, bearer tokens and private-key blocks are redacted before records/events enter the browser. This is defense in depth, not a universal secret detector. Protection comes primarily from curated disposable sources, blocked credential paths and no inherited process secrets. Arbitrary user repositories or files are not exposed by the preview.

No provider API key, real machine credential or external account is configured. A future provider must remain host-side and return structured output through the same validation and explicit permission boundary.

## Development transport and scenarios

Start the pinned Node/npm Vite development server and open `http://127.0.0.1:5173/?tools=preview`. Connect explicitly. The Vite `configureServer` adapter accepts only loopback Host/Origin, bounded JSON requests, a custom request header and a per-session token. Tokens scope a local fixture session; they are not production authentication or machine credentials. The protocol exposes fixed scenario operations, never arbitrary runtime commands or agent-supplied permissions. Snapshots stream over each action response; there is no polling. The client rejects old session/revision responses. A lost/incomplete stream hides active 3D using a disconnected presentation while preserving untouched host history; explicit reconnect resynchronizes it. The middleware is unavailable in production preview/build; the development UI is removed from production bundles.

The host creates an ignored `.tools-preview.local` fixture repository with safe text and a fixed author. Test repositories are retained for inspection; they are not user project output. A session has explicitly labelled research/coding workers and the existing dedicated Manager, with the same assets and workstation/navigation contracts.

1. **Research:** Manager plans/dispatches a fixed task; worker arrives, sits and uses its headband. The registered research tool returns a visibly labelled deterministic fixture. It performs no web search. Tool completion leaves the task active until explicit completion, which triggers existing headband removal.
2. **Coding boundary:** read an actual fixture file, then execute the fixed Node version profile. This proves safe I/O/process flow; it does not generate or execute application code.
3. **Git:** inspect status/diff, explicitly stage the selected fixture file and request its local commit. The returned commit ID is actual fixture-repository output.
4. **Denied:** the research worker requests a terminal operation without permission; the adapter never runs, audit records explain rejection and Manager attention/context updates.
5. **Timeout/cancel:** run the short-deadline profile to observe actual timeout/blocking. Resume explicitly, run the separate cancellable profile and cancel it to observe unresolved waiting. Resume/completion are explicit controls.

`RuntimeOffice` accepts either the existing synchronous local runtime port or the development asynchronous snapshot port. It reports feedback rejection and uses truthful host-execution wording. The default disconnected production screen, existing Phase 5/6 previews, exact-ID selection, camera and worker-only headband behavior remain intact.

## Validation and limits

Final validation passed with pinned Node 24.21.0 and npm 11.19.0:

- Typecheck, lint, formatting and production build passed. Lint retains five existing warnings in unmounted prototype code. Build retains the large-chunk advisory and reports a future Vite native config-loader compatibility warning for extensionless imports; the pinned bundler-based loader works.
- **457 tests in 31 files passed:** all 336 baseline tests plus 121 additions. Coverage includes real filesystem boundaries, real subprocess cancellation/timeouts/output caps, real isolated Git operations and malicious helper configuration, plus registry/permissions/schema/idempotency/runtime/Manager/transport/client behavior.
- **110 Chromium checks passed:** 31 tool-flow checks, 3 timeout/cancellation checks, 33 Phase 6 orchestration regressions, 33 Phase 5 runtime regressions, 5 checks of the preserved 31-character scene and 5 production-isolation checks. No application console errors, failed requests or source hot reloads occurred. The deliberate production endpoint probe returned the expected 404.
- The production JavaScript is byte-for-byte identical to the Phase 6 checkpoint: 1,382,420 bytes, SHA-256 `2a7e2d41527e60c570deddcac5a710f352fea0bbee5e26a5e7a3edb8567d4bb7`. Development tool code and fixtures are excluded; query parameters cannot activate them.

The [validation record](validation/phase7-tools-browser.json) contains individual checks, source hashes, counters and screenshot references. Browser images show the [working worker](validation/phase7-research-working.png), [permission failure](validation/phase7-permission-denied.png) and [calm selected Manager](validation/phase7-manager-tool-attention.png).

The three-character tool preview sampled 27 draw calls and 156,609 triangles; the 31-character regression sampled 22 calls and 997,027 triangles at the inspected close-up. These are view-dependent SwiftShader render counters, not full-overview or hardware benchmarks. Thirty workers retained one shared worker geometry/material set, one shared headband geometry and independent skeletons. Each scene fetched its five GLBs once. Idle animation generated no additional transport messages, tool launches, planner calls or task progress. No per-frame business updates or polling were added.

Changed implementation areas are `src/tools/` (contracts/registry/executor/research), `tools-host/` (Node adapters and development host), `src/runtime/toolRuntime.ts` and small existing runtime/orchestration hooks, `src/dev/ToolExecutionPreview.tsx` and its transport/fixture modules, the `RuntimeOffice` port, DEV routing in `App.tsx`, host TypeScript/Vite/Vitest configuration, and their tests. README, BUILD_PLAN and CODEX_HANDOFF point to this contract. No dependency, canonical model, GLB, camera, navigation or animation source was changed. Phase 7 remains uncommitted and unpushed on `codex/phase7-tools-execution` for review.

Execution records, events and activity currently grow for a session; durable retention/recovery is deferred. Tools do not verify task quality or fabricate artifacts. Real research, autonomous scheduling, production authentication/transport, production tool isolation, provider calls, deployment, memory, QA/repair and cost systems remain outside this phase. Hardware/100-agent render performance remains unverified; existing SwiftShader measurements are not an RTX 4060 benchmark.

Stop after Phase 7. No later phase is implemented or authorized by this document.
