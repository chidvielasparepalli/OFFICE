# Phase 10 — Artifacts and outputs

Phase 10 extends Phase 9 checkpoint `04bb8f4b2b9643a0f964f4a19f70a84ec7d8586f` on `codex/phase10-artifacts`. It adds explicit output metadata, immutable content versions and deterministic output acceptance to the existing runtime. It does not add providers, autonomous execution, production hosting or persistence.

## Ownership and boundaries

```text
Explicit tool/task/user input operation
  → ArtifactStorage.put (immutable bytes, SHA-256 receipt)
  → explicit ArtifactService / principal-bound ArtifactRepository
  → OfficeRuntime artifact command → same repository/events/activity
  → canonical task input/output IDs
  → Manager structured output assessment
  → QAEngine → existing ToolExecutor → version-bound inspection result
  → artifact verified / canonical repair task / attention
```

`RuntimeState.artifacts` is the sole metadata collection. `InMemoryArtifactRepository` is a principal-bound view of the existing runtime, not another metadata database. `ArtifactService` provides explicit creation/version operations and authorized integrity-checked content reads. No tool result automatically creates an artifact. A host can replace the repository/storage adapters later without introducing storage APIs into Three.js.

## Model and immutable versions

`Artifact` records a unique version `artifactId`, stable `lineageId`, name, description, type, input/output role, optional output role, owning task, producing agent, project, access scope, lifecycle status, version/revision, timestamps, normalized source, immutable content reference, bounded metadata, derivation links, supersession links and `verifiedByQA`.

Types are code, file, document, report, image, video, dataset, archive, build, repository-change, configuration and other. Statuses are created, in_progress, completed, failed, verified, superseded and archived. Creation may not assert verified/superseded/archived. Ordinary updates only advance unfinished lifecycle state; content/name/description/metadata changes require `createVersion`/`supersede`. Archive retains inspectable history and bytes.

Each version has its own immutable content identity and source. Creating a version atomically marks the prior record superseded, links both records and appends canonical task output IDs. It never overwrites prior content or transfers a QA verdict. Revision checks reject stale mutations. A superseded historical record retains its original source and any historical QA link. Each new version derives from its immediate predecessor; earlier external derivations and ancestry remain traceable through retained records without copying an ever-growing ancestry list or granting access to that content.

Output mutation is rejected while its QA is pending/running, after its workflow closes, or after a dependent task has begun consuming it. Revisions of delivered workflows need a future explicit revision workflow; this phase does not silently reopen plans. A revised previously verified output becomes pending fresh verification; archiving a required verified output invalidates its current acceptance. Historical passing evidence remains intact.

## Provenance and task relationships

Tool sources require a real completed allowed execution by the producing agent. Its output must contain the same `content` receipt as the artifact. Task sources require an assigned, started/completed producing task. Manager sources additionally require the owned request/coordination task. User input attribution requires an explicit host `import` grant and an opaque user reference; it does not claim an agent producer.

Outputs require an owning task and output role. `artifact.taskId` remains the owning original task when a canonical repair produces a later version; `source.taskId` records the actual repair task. Both original and repair task output ID lists include that version. Agent identity comes from validated provenance, not an independent caller-supplied producer label. Failed artifact repair must use its matching assigned canonical repair task.

User inputs are imported independently and then handed to an authorized receiving task through `linkInputArtifact` before execution. Input and output ID arrays are separate. A linked input remains an input with unchanged provenance; it never counts as the receiving task's produced output. No second task-output entity exists.

## Content storage and integrity

`ArtifactStorage` separates bytes from metadata with `put`, `inspect` and `read`. The development `InMemoryArtifactStorage` stores immutable copies, deduplicates identical bytes/media types and returns defensive read copies. It computes SHA-256 once when storing content. Opaque storage/content IDs, media type, byte length and SHA-256 are the only content fields in runtime snapshots. Creation verifies the receipt against actual configured storage. URLs, arbitrary filesystem locations and fabricated receipts are not accepted.

The development adapter accepts at most 8 MiB per object and 64 MiB per session. UTF-8 text, JSON, JavaScript and XML are checked through the existing Phase 8 credential boundary; invalid UTF-8 is rejected. Other binary formats are opaque. There is no image/video decoder, executable inspection or comprehensive binary credential scanner. No raw content or download link is rendered in generic context.

Service reads check principal access before retrieval and again after the asynchronous read/hash, and reject changed byte length/hash. Hashing happens on explicit storage/read operations, never on an animation frame. A hash proves byte identity only. Refresh loses in-memory bytes; restored metadata may remain historically inspectable, but content reads fail closed if the matching storage is unavailable. Unreferenced storage receipts from rejected registrations may remain until session reset; there is no garbage collector or durable storage transaction yet.

## Access and security

Scopes are agent, task and project. Worker-private scope does not grant the Manager or other workers access. Task scope permits the assignee and responsible Manager. Project access requires exact host grants. Grants distinguish read, modify, archive and user-input import. They are host options, not agent-supplied runtime commands.

An explicit input link grants its assigned task worker read access to that exact version. A live assigned QA inspection can read only its exact targeted version. The matching canonical repair grants its worker read/modify access to the version being repaired; this does not grant access to unrelated private ancestry. A producing agent can read its own output. Ordinary archive/modify checks remain separate. Principal-bound mutation methods that return metadata require read access before changing state, so a write-only grant cannot expose a private record in its response.

Metadata uses the unchanged recursive `memorySafeJson` boundary, including nested keys/values, source fields, restoration, history and repository reads. Rejected operations leave records/events/activity unchanged and return safe structured errors without secret values. Successful artifact events contain IDs/statuses and accepted metadata after-images, not content bytes. Snapshot restoration rejects unsafe artifact metadata and verification without matching retained QA/content identity.

Manager context and UI filter artifact metadata through access checks, including artifact event after-images and source tool-execution events for private artifacts. This prevents a private content receipt from leaking through an older tool event after artifact registration; it cannot retroactively revoke information the Manager was authorized to observe before the artifact acquired its scope. Generic contexts contain bounded references, not file bytes. Full runtime snapshots/commands and raw storage adapters remain privileged host/operator interfaces, as in Phases 5–9; they are not production authentication or untrusted agent APIs.

Artifact-to-memory transfer is explicit and still uses MemoryService's access, credential, source and trust policy. Creation, SHA-256 and QA success grant no memory verification privilege. Phase 8 limitations remain: pattern detection cannot identify every credential, and the system does not independently prove an authorized memory-verification assertion.

## Expected outputs and Manager awareness

Optional canonical `RuntimeTask.expectedOutputs` entries contain exactly role, type and count (one through sixteen; at most sixteen distinct roles). The planner may propose this structured field; validation copies it into canonical tasks. Existing plan-level descriptive output strings remain descriptive and are not parsed for acceptance.

Assessment counts current nonarchived lineage heads, so v1 and v2 cannot satisfy a two-output requirement. Missing matching outputs produce `MISSING_OUTPUT`; present but unverified outputs produce `OUTPUT_UNVERIFIED`. Configured expectations require passing QA. They gate dependent dispatch and Manager completion without changing worker task completion semantics. Tasks without expectations preserve their existing behavior and do not gain an invented output requirement.

ManagerOrchestrator keeps its existing event subscription and reacts to artifact commands. Its context shows accessible actual artifacts and structured output assessments. Execution results return accessible verified artifacts produced by the plan's tasks, not inputs created by other tasks or fabricated placeholders. No artifact reasoning, autonomous tool execution or automatic repair loop is added.

## QA and repair versions

Artifact QA binds the exact registered version ID, version number and SHA-256. The runtime captures this binding; callers cannot supply it as a verification assertion. Every selected artifact check has object input with a reserved runtime-injected `artifact` binding. The approved inspection tool reads immutable bytes through the service and returns that same identity alongside its structured validation output. The existing executor enforces grants, schemas and exact reserved execution inputs.

Missing/mismatched identity evidence blocks acceptance. Only passing bound QA sets the current artifact verified and emits `ARTIFACT_VERIFIED`. This relies on the approved tool's truthful inspection of the identified bytes; an arbitrary echoed hash is not independent proof of tool honesty. Multiple output artifacts can have independent QA policies/results. Canonical task verification aggregates the latest attempts of selected policy chains, and output expectations require all requested outputs.

On failure, Phase 9 creates its normal canonical repair task. The assigned repair worker creates a new artifact version from its actual repair execution/task. Recheck requires the matching newer lineage version and completed linked repair. It retains the original checks, retry limit and previous QA record, changing only the bound target. A normal revision of a previously passing artifact also requires fresh explicit QA. Earlier failures/passes remain inspectable and cannot be reused as the new version's verdict. Retry exhaustion, cancellation, permissions and Manager attention retain Phase 9 behavior.

## Events, UI and office

`ARTIFACT_CREATED`, `ARTIFACT_UPDATED`, `ARTIFACT_VERSION_CREATED`, `ARTIFACT_SUPERSEDED`, `ARTIFACT_VERIFIED`, `ARTIFACT_ARCHIVED` and `ARTIFACT_INPUT_LINKED` use existing transactional events and matching activity. Rejected commands emit no false success. Repository commit failure rolls back artifact, task and event changes together.

Task context shows structured expectations, accessible inputs/outputs, versions, source/producer, QA and integrity metadata. Selected-agent context shows its actual outputs. Views are limited to twenty records and display truthful empty/restricted states. No general file browser or unrestricted download route exists.

The existing 3D bridge, supplied models, navigation and animation remain unchanged. QA waiting/failure/repair/completion use their existing runtime states. Worker headbands remain worker-only; Manager work stays calm. Artifact operations never invent movement, task progress or business completion.

## Development scenarios

Use `/?artifacts=preview` on the development server. It starts empty/disconnected. Explicit plan/dispatch/tool/output/QA controls demonstrate:

- Simple output: actual registered write tool → immutable content receipt → explicit completed artifact (still unverified).
- Verified output: exact v1 inspection → QA pass → verified artifact and Manager completion.
- Repair: incomplete v1 → actual failed inspection → canonical repair → changed v2 bytes → independent recheck → pass, retaining both histories.
- Multiple outputs: two distinct outputs, independently inspected before workflow completion.
- Versioning: immutable v1 bytes/source remain available when v2 supersedes it.
- Missing output: worker completion without the structured deliverable requires Manager attention.
- Access/input: private worker output denied to another worker, explicit user import and task input handoff.

The tools operate only on the session content store. There are no external downloads or fabricated production artifacts. Production query parameters cannot activate these controls; the default office remains disconnected.

## Validation and limitations

Acceptance passed on Node 24.21.0 / npm 11.19.0:

- **738 tests in 44 files:** all 658 prior tests retained, plus 80 artifact/storage/security/QA/Manager/UI regressions. These exercise actual local storage/executor/runtime operations, including long version histories and cross-worker repair provenance.
- Typecheck, lint, formatting and production build pass. Five pre-existing prototype lint warnings, the large-chunk advisory and the development config-loader warning remain; no new dependencies or asset changes were introduced.
- **46 Chromium checks:** 41 development artifact/runtime/security/3D checks and five production-isolation checks. No console/page errors, unexpected failed requests or hot reloads occurred. All fifteen recorded source hashes match the accepted code. Evidence: [development](validation/phase10-artifact-browser.json), [production](validation/phase10-artifact-production-browser.json).
- Browser checks cover explicit tool output, input/output linking, exact-version failed QA, canonical repair, v2 passing recheck, retained v1 history, independent multiple outputs, missing-output attention, private access/receipt filtering, worker headband behavior, calm Manager work, exact selection and overview/focus. The production endpoint denial is an intentional 404, not an asset failure.
- Production JavaScript remains byte-identical to Phase 9: 1,382,420 bytes, SHA-256 `2a7e2d41527e60c570deddcac5a710f352fea0bbee5e26a5e7a3edb8567d4bb7`. Development fixtures and adapters are absent from the served build.
- Five canonical GLB requests loaded once across development scenario resets. Idle counters stayed at 87 commands, 53 commits, 235 subscriber notifications and five subscribers, confirming no idle artifact polling in this sample.

The older complete browser suites and 30–100-agent hardware benchmarks were not repeated. Phase 10's focused scene used two workers and the dedicated Manager; all previous automated animation/navigation/security tests remain green. No rendering-performance improvement or hardware FPS claim is made.

Operations are command/event driven. There are no per-agent polling loops, new subscriptions, per-frame hashing or binary React state. Task context follows linked IDs; agent artifact selection is memoized on metadata/selection changes. Runtime/Manager assessments scan current in-memory records on commands; history indexing, retention/compaction and very large-catalog benchmarks remain future work. No hardware performance claim is based on headless SwiftShader.

Stop after Phase 10. No Supabase/object storage, production hosting, unrestricted downloads, autonomous artifact reasoning, communication, cost controller or deployment is included.
