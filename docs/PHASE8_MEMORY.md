# Phase 8 — Memory system

Phase 8 extends the existing runtime with explicit, scoped memory. It builds on the reviewed Phase 7 checkpoint `fc03a20` on `codex/phase8-memory-system`. It does not add a provider, autonomous learning, a production backend or durable database. Canonical models, animations, navigation, camera and worker-only headband behavior remain unchanged.

## Ownership and repository

```text
Trusted application / explicit development control
  → MemoryService
  → principal-bound MemoryRepository
  → InMemoryMemoryRepository
  → existing OfficeRuntime transaction
  → existing OfficeRuntimeRepository + events/activity + subscribers
```

There is one normalized `RuntimeState.memories` collection. `InMemoryMemoryRepository` is a scoped view of that collection, not another store or event bus. `MemoryService` provides explicit `remember`, `recall` and `forTask` operations through the repository interface. The repository supports add/get/update/archive/supersede/search, list by scope/private agent/project, and task context. `listByAgent` means that agent's private scope; it is not an unrestricted query of everything they authored.

The existing synchronous repository commit persists memory and event after-images atomically. Persistence failure publishes neither. Restoration accepts older snapshots without a memory collection. A future remote repository will require an asynchronous atomic commit/synchronization design while preserving validation, access control, event publication and revision checks; this phase adds no Supabase adapter. All runtime repository snapshots remain trusted host data, not an external JSON ingestion API.

## Model, types and scopes

`src/memory/memoryTypes.ts` defines the model and provider-independent repository contract. Each record contains ID, creator agent ID, scope, optional project ID, type, bounded content/metadata, importance, trust, source, useful-write reason/rationale, optional verification assertion, retention, lifecycle timestamps, revision and supersession links.

Types are exactly **working, episodic, semantic, project and preference**. Types describe information, not permissions. Scopes are exact `{ kind, id }` pairs: **agent, task, project and organization**. A project-scoped record derives its project ID from its scope. Task-scoped records derive it from the existing task's `metadata.projectId`; conflicting claims are rejected. No competing project/task model is introduced. Project identifiers and grants are supplied by the trusted application until a project registry exists.

## Explicit write policy and sources

A write must specify a useful reason: decision, constraint, approach, lesson, preference, fact or outcome, plus a nonempty rationale. Content is limited to 4,000 characters, rationale to 500, verification evidence to 1,000 and the incoming JSON to 8 KiB. Unknown fields, invalid enums and non-JSON/oversized metadata fail before mutation. There is no listener that stores tool output, chat, Manager thoughts or completed tasks automatically.

Sources are user, task, agent, tool, Manager or system:

- Agent/Manager attribution must match the acting principal; the Manager source also requires Manager kind.
- User/system attribution requires an explicit host grant on the destination scope.
- Task-outcome attribution requires access to a real completed, failed or cancelled task in the same project. Failures remain failures; remembering a lesson does not alter the task.
- Tool attribution requires the acting agent's real completed execution in the same project. The initial memory must be unverified. Tool completion by itself creates no memory.

Writes are assertions supplied by authorized callers, not automated assessments of usefulness or factual correctness. The caller must curate the content and rationale.

## Trust and importance

Trust is **verified, observed, inferred or unverified**. Verification requires an exact scope `verify` grant and explicit evidence; the record retains who asserted verification and when. The service does not independently prove the assertion. Tool evidence cannot become observed/inferred by an update; promotion requires the separate authorized verification operation. Supersession cannot bypass this protection. Original source attribution remains intact on updates.

Importance is an ordinal **low < normal < high < critical**, not a probabilistic score. It influences retrieval tie-breaking, minimum-importance filtering and working-memory lifetime. Editing content is not an update: create an explicit replacement instead. Metadata changes to a verified record require a new explicit trust assertion.

## Access control

Own agent-private memory and assigned-task memory allow read/write intrinsically. All other scopes require exact host grants; there are no wildcards or implicit Manager overrides. Organization memory always requires a grant. Verification is never implicit. A record linked to a project additionally requires project read access. Grants are defensively captured when the runtime is created; commands cannot supply grants, and mutating the original policy cannot elevate access.

Every repository operation checks the bound principal. A mixed authorized/unauthorized scope request fails instead of returning a partial answer. `get`, updates, archives and supersession apply the same scope/project checks. The Manager can publish shared project decisions but cannot read a worker's private context without an explicit grant. Reconfigure a trusted host session to change grants; live grant-management/authentication is outside this phase.

The full runtime snapshot/event after-images are **privileged host/operator data**. Future agents must receive only the principal-bound repository/service interface, never raw `OfficeRuntime`, `dispatch`, snapshots or unfiltered event feeds. The local development page is a trusted operator fixture, not a production multi-user security boundary. A future server transport must authenticate the principal and project filtered views before sending private data to clients.

## Retrieval and context limits

Queries require explicit scopes. Retrieval excludes archived, superseded and expired memories, checks project access and filters irrelevant keyword results. Unicode word tokens are matched exactly, case-insensitively; there are no embeddings, stemming, network calls or semantic guessing.

The deterministic sort is lexicographic:

1. Number of distinct matching query keywords.
2. Exact requested-task scope, then requested-project relevance.
3. Importance.
4. Creator matches the acting agent.
5. Most recent update, then stable ID ascending for ties.

No hidden weighted score is used. An empty query ranks eligible scoped records using the remaining criteria. Duplicate normalized assertions with the same scope, project, type, source and trust are included once; distinct provenance or trust remains visible instead of being silently merged.

`forTask` derives the project from the existing task and considers the agent's private scope, the task scope and the project scope. Extra scopes must be explicit and authorized. Memories linked to other projects are excluded even when that actor has access to them. Returned records retain source, trust, type, timestamps and lineage.

Default output is at most 8 records and 6,000 characters; hard maxima are 20 records and 16,000 characters. An optional approximate-token budget uses `ceil(characters / 4)` and can only tighten the character bound. This is not a provider tokenizer. The **entire serialized context**, including identity, metadata, provenance and a notice that memories are evidence rather than instructions, counts toward the budget. Records are indivisible: an oversized record is skipped, not silently truncated. A budget too small for the empty context identity is rejected. Filters also support minimum importance.

Context assembly is an explicit command. There is no automatic planner injection or memory-driven action. Future planning can consume the returned bounded context while retaining its metadata/trust boundary.

## Retention and conflicts

Working memory expires from creation after low=1 hour, normal=8 hours, high=24 hours or critical=72 hours. Raising importance later cannot extend expiry. Expired entries are excluded from reads/search/context but retained in trusted history until explicitly archived; there is no background timer or purge job.

Episodic and task-scoped memories use history retention without automatic expiry. Other non-working memories, including project facts/preferences, persist until archived or superseded. Persistent here means retained by the supplied repository instance, **not surviving a browser refresh/process restart without a durable adapter**.

Conflicting independent writes remain separate active assertions. Only explicit `supersede` deactivates the old record and creates the replacement atomically, with reciprocal links in the same scope/project. Expected revisions prevent lost updates. Cyclic or inconsistent restored lineage is rejected. Archives preserve audit history. There is no physical deletion API, automatic contradiction detection or fact merging.

## Runtime events and 3D

The existing event stream adds `MEMORY_CREATED`, `MEMORY_RETRIEVED`, `MEMORY_UPDATED`, `MEMORY_ARCHIVED` and `MEMORY_SUPERSEDED`. Queries audit authorized result IDs and context size, not query text or content in activity summaries. Full after-images remain in the privileged transaction log for replay. Rejected commands leave state/history unchanged and return structured errors.

Memory operations do not change agent status, task progress, assignments, spatial intent, posture or headband behavior. The office may show actual generic memory activity through the existing context projection. There are no visual remembering effects, per-agent polls, frame-driven searches or extra animation resources.

## Secrets

The existing bounded public-JSON validator is reused, with rejection instead of storing redacted credential data. Sensitive key names, common credential assignments/bearer tokens/private-key blocks, recognizable API/token patterns and credential-bearing URLs are rejected. Tests use only synthetic values and prove rejected writes never reach storage/events.

This is defense in depth, not a universal credential detector. Encoded or unknown secret formats cannot be guaranteed detectable. Only curated non-secret application data should be admitted; real credentials remain in the secrets layer. No real credentials are configured or used.

## Development scenarios

Run the pinned Node/npm development server and open `http://127.0.0.1:5173/?memory=preview`. It starts empty/disconnected. Explicit connection registers the existing two development workers and dedicated Manager; it creates no tasks or memories.

- **A:** Manager attributes a labelled user/project preference; later worker-task context retrieves it.
- **B:** Create/start an earlier task, complete it explicitly, explicitly remember its lesson, then start a later task and assemble context.
- **C:** Worker A remembers and recalls a private lesson; Worker B and Manager are denied. The page clears the prior result before showing denial.
- **D:** Start a Manager review task, store a shared architecture decision, and build its planning context. The Manager retains calm work with no headband.
- **E:** Supersede the decision; subsequent retrieval includes the replacement, while privileged history retains both.
- **F:** The existing tool executor runs the labelled deterministic research fixture. It creates no memory until an explicit write, which remains unverified. A worker's unauthorized verification attempt is rejected.

The preview shows the captured context revision and never silently refreshes or reruns it on a 3D render. Refresh/reset discards this in-memory development session. Production excludes the preview and all fixtures.

## Validation and limitations

The full automated suite passes **524 tests across 33 files**, retaining every one of the 457 Phase 7 assertions and adding 67 memory/preview tests. The final run used `npm test -- --maxWorkers=2`; an oversubscribed run hit two existing real-Git tests' unchanged five-second deadlines. No tests or deadlines were relaxed.

The memory preview passes **32 Chromium checks**, including all six scenarios, denied private access, explicit tool provenance, context budgets, supersession, animation, exact selection and reconnect. The animation-cost check focuses the worker before measuring because offscreen animation updates intentionally stop. Browser waits accommodate SwiftShader; observed pose changes, not elapsed wall time, establish animation progress. Across seven observed render frames, command/commit/notification counters stayed at 54/45/138. Five canonical GLBs loaded once across the scenarios and reconnect. No memory operation created movement or task progress.

Final validation records **73 passing Chromium checks**: 32 memory scenarios, 31 preserved tool-execution checks, 5 checks of the 30-worker-plus-Manager scene and 5 production-isolation checks. There were no application console errors or failed requests. The deliberate development-endpoint probe correctly returned 404 in production. Typecheck, lint, formatting and the production build passed. Five existing prototype lint warnings and the Vite chunk/config-loader advisories remain.

The production JavaScript is byte-identical to Phase 7 and excludes memory fixtures. Source hashes confirm that character animation, camera, navigation, assets, the 3D bridge, orchestrator, tool executor and dependency files remain unchanged. Full Phase 5/6 browser suites were not repeated; their automated assertions remain passing. Machine-readable evidence, source hashes and two inspected screenshots are in `docs/validation/phase8-memory-browser.json` and the adjacent `phase8-memory-*.png` files.

The initial repository scans candidates on explicit requests. Large-memory indexing, durable storage, retention compaction, authentication, cross-process consistency and distributed permission revocation are not implemented. Existing runtime event history remains unbounded. Hardware/100-agent rendering performance remains unverified; headless SwiftShader is not a hardware benchmark. No dependencies or assets were added.

Stop after Phase 8. No Supabase, embeddings/vector database, provider-specific memory API, autonomous loop, QA/repair engine, costs, communications or deployment is implemented.
