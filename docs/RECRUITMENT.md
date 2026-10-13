# CEO-controlled recruitment

This local implementation extends accepted Phase 12 (`ca11044`) on `codex/ceo-recruitment`. The interrupted Phase 13 branch contained no implementation changes. This feature does not claim Phase 13 is complete.

## Audit and boundaries

The repository already contained the deterministic runtime, Manager orchestrator, permissioned ToolExecutor, provider broker, budget reservations/ledger, memory security, versioned artifacts, QA and recipient-filtered realtime. It did not contain a live provider adapter, durable runtime repository, authenticated CEO account or Supabase schema. Those existing systems remain the integration points; there is no second task engine, business store or event bus.

Recruitment now has a real Node host workflow with durable local records and CEO authentication. The OpenAI adapter is implemented, but no live API call was made during validation because `OPENAI_API_KEY` was unavailable. A Codex subscription/model selection does not supply this server credential. All automated provider tests inject synthetic HTTP responses, and browser evaluations are explicitly marked simulations.

No database migrations were added: Supabase is not configured. `LocalRuntimeRepository` implements the existing synchronous `OfficeRuntimeRepository` transaction contract. Supabase persistence/RLS and production authentication remain future integrations, not completed services.

## Local setup

Use the repository's pinned Node 24.21.0 / npm 11.19.0. In PowerShell, after installing dependencies if needed:

```powershell
$env:Path = "$PWD\.toolchain.local\node-v24.21.0-win-x64;$env:Path"
npm ci
npm run recruitment:setup
npm run dev -- --host 127.0.0.1
```

Open the printed local URL with `/?recruitment=office`, or choose **Recruit employees**. Setup asks for a hidden password and creates one local CEO account; it will not overwrite an existing account. Sign in, enter the specification and explicit assessment criteria, review proposal version, approve, then start the interview. The browser defaults to clearly labelled, zero-spend simulation. The normal production bundle remains disconnected and contains no recruitment host or provider credential code.

For optional live OpenAI work, stop the dev server and inject a key privately into its host environment, then restart:

```powershell
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'OpenAI API key' -AsSecureString)).Password
$env:OFFICE_PROVIDER_BUDGET_MICROS = '1000000'
npm run dev -- --host 127.0.0.1
```

Do not use a `VITE_*` variable, commit the value, paste it into an employee prompt, or send it through the browser. One million local microcredits is the default lifetime host ceiling, with an approximate USD interpretation described below. Select live mode explicitly and approve its budget. Missing credentials, unsupported integrations, budget denial and provider outages pause recruitment; they do not demonstrate inadequate skills.

After a clean server restart, sign in again and reconnect to the retained runtime. After a hard crash, a stale exclusive lock deliberately blocks startup. With the original process stopped, run `npm run recruitment:setup -- --recover-lock`; this only releases a lock whose owner is provably dead. It never resets records. Corrupt snapshots fail closed and require manual recovery from a known-good backup.

## Canonical records and approval

`RuntimeState.recruitments` holds sessions, ordered proposal versions, exact-version CEO decisions, assessment attempts/evidence, technical failures and presentation intents. `RuntimeState.employees` holds stable employee identity, immutable approved configurations, activation mode, employment status and audit timestamps. Candidate ID becomes employee/agent ID only in the atomic activation transaction. Candidate visitors are not operational runtime agents.

The CEO form explicitly collects identity, role, department, mission, responsibilities, instructions, personality, provider/model, tools, private memory scope, knowledge references, Manager/collaborators, budget and concrete work-sample criteria. This is structured intake, not a claim of autonomous natural-language Manager planning. Changes create a new version and invalidate approval. Rejection/cancellation cannot be overridden by the Manager; terminal recruitment cannot restart.

CEO authority is injected by the authenticated host, never accepted as a request field. The runtime additionally checks separate CEO/Manager/service principal lists. Only the service advances execution and records assessments; only an exact current approved proposal with all mandatory checks passed can activate. Activation registers one canonical worker and claims one unoccupied, department-compatible workstation in the same repository commit. No available desk yields technical attention, not a desk collision or successful hire.

## Execution and evidence

```text
CEO request → versioned proposal → CEO decision
  → candidate and Manager arrive → interview
  → approved configuration → runtime initialization
  → explicit work samples through ToolExecutor / ProviderBroker
  → deterministic criteria evaluation
  → rejection OR atomic employee activation
  → existing runtime navigation to the assigned desk
```

The live adapter uses OpenAI Responses with `gpt-6-astra`, strict structured `{ answer }` output, `store: false`, low reasoning effort, fixed endpoint, bounded output and no model-selected external tools. It validates HTTP response shape, refusal/incomplete states, response size and usage before accepting a result. It never publishes raw provider exceptions. Model availability and structured output are documented by [OpenAI's model page](https://developers.openai.com/api/docs/models/gpt-6-astra) and [structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

During onboarding the existing Manager is the task owner; the candidate's approved instructions, role, mission, responsibilities, working style and test input are isolated per execution. A candidate has no operational tool grants. After live activation, the CEO can submit a bounded work request to that employee. Its persistent configuration reconstructs the provider session and approved grants; it executes a real canonical task through the same broker. Sleep/restart never creates another employee identity. Simulation employees cannot issue live tasks.

Initial supported integration: structured text work using `provider.invoke`, private agent memory boundaries and no external knowledge source. Requested repository, scanner, filesystem, shell or other unsupported integrations block initialization. They are never silently omitted or marked validated. No autonomous task loop is added.

Post-hire work retrieves at most three memories and 2,000 characters through the existing `MemoryService`, restricted to that employee's private agent scope. Source and trust metadata remain attached. Candidate work samples receive no Manager-private memory, and recruitment does not automatically write provider output to memory.

CEO-authored mandatory criteria use case-insensitive expected phrases in actual work-sample output. Missing required phrases are a recorded capability-test failure; provider/transport/parser/permission errors are technical failures. These narrow samples are not a professional certification, semantic QA verdict or proof that an arbitrary security analysis is correct. Broader skills need specialized approved evaluation tools. Outputs remain unverified; successful generation never upgrades memory trust or artifact QA.

Mocks are explicit `mock-success`, `mock-capability-failure` and `mock-technical-failure` modes, retained permanently in the approved configuration, assessment evidence and employee mode. They exercise backend transitions without API calls and cannot become live employees by changing a frontend label.

## Costs and secrets

The existing broker performs provider/capability/tool permission checks and reserves cost before reading credentials. Its trusted adapter estimate includes UTF-8 input, schema and framing overhead. Live requests are capped at 100,000 estimated input units, 8,192 output units and 120 seconds. No fallback model or provider is silently substituted for the approved model.

The local policy charges measured token usage at a conservative 13 microcredits/input token and 50/output token. This is a policy ceiling with a micro-USD interpretation, not a reconciled OpenAI invoice. It accounts conservatively for the documented input/cache-write pricing; cache discounts, tax, exchange rates and future pricing changes are not calculated. Prompt size stays below the model's long-context pricing threshold. Every request must fit both the approved lifetime employee/onboarding ceiling and the host lifetime ceiling. No automatic refill occurs.

Timeouts and crashes after dispatch retain unknown billing liability. The service refuses a retry while that recruitment has an unresolved reservation. It does not infer a free request or automatically repeat a paid call. Existing host reconciliation commands require actual evidence; there is no new reconciliation UI.

Keys stay in the host `SecretStore`. The Phase 8 recursive credential detector and exact configured-secret checks protect specs, answers, assessments, snapshots and realtime payloads. Detection is pattern-based; it is not universal secret discovery. Raw prompts are not copied into task event payloads. Personnel configuration and interview evidence are visible only in the authenticated CEO projection, not ordinary office projections. Explicit memory writes still require the existing scope/source/trust policy.

## Persistence and host security

Local records reside in ignored `.office.local`. Snapshots use a bounded checksum envelope, atomic replacement and a single-writer lock; failures preserve the previous committed state. The checksum detects corruption, not hostile modification by someone who already controls the operating-system account. Passwords use scrypt; sessions use random, expiring HttpOnly/SameSite=Strict cookies, rate-limited login and server-side identity. HTTP cookies are appropriate only for this loopback development host. A production deployment needs HTTPS and a production identity provider.

Endpoints require exact loopback Host/Origin, a custom request header, bounded JSON and a small allowlisted action grammar. Browser actor IDs, arbitrary runtime commands and host tool arguments are rejected. Vite file serving explicitly denies the data directory and encoded/path aliases. Logout closes streams; stream publication rechecks session validity. Secrets and host adapters are excluded from the production client bundle.

Background work runs in the host after the interview starts, independently of a connected page. A restart records technical interruption and does not replay active tools. If activation already committed but its workstation movement did not, startup restores only the missing spatial intent or arrival acknowledgment, without repeating hiring or provider work. The CEO can explicitly retry up to three attempts, retaining previous evidence. Cancellation aborts in-flight execution. Termination cancels work, clears capabilities and rejects subsequent task/tool execution. The scene and recipient projections omit the terminated avatar before its freed desk can be reused; canonical identity and the CEO's personnel/history records remain intact.

## Realtime, UI and 3D

The existing `office:runtime` channel publishes committed recruitment/employee after-images alongside the existing domains. The same read-only `RealtimeStore` enforces revision ordering, stale/duplicate rejection, reconnect and authoritative snapshots. There is one subscription per office, no per-agent polling or animation-frame business writes.

The office UI contains recruitment intake, exact-version approval/change/reject actions, proposal file, actual assessment evidence, truthful technical states, history and employee roster. Candidate labels and HTML status text are accessible without relying on color or motion.

Candidates reuse the canonical Stickman, cloned skeletons and shared GLB/material resources. A small shared folder placeholder attaches to the hand; it is an application-file prop, not a replacement character. Authored open interview waypoints face candidate and dedicated Manager toward each other. Both must arrive before the interview starts. The pose acknowledgment can start the interview, but can never approve, pass an assessment or activate an employee.

Live assessments start a canonical task with an explicit `current-position` work location. The runtime accepts this only for the settled Manager interview and its exact approved recruitment task. The task remains `in_progress`, the Manager remains `working`, and existing tool permissions still apply. The bridge maps that location to calm standing review, so starting provider work does not send the Manager back to a desk. Ordinary tasks keep their workstation behavior.

Successful activation switches the same identity to the existing employee bridge and sends it to its exclusive desk. Skills rejection walks the visitor to the entrance; technical failure retains a paused candidate instead. Discrete acknowledgments are validated against current host intent. Reload reconstructs the accepted scene, and duplicates cannot create another character or employee. The Manager retains the dedicated model and never uses a headband. Existing worker headband, camera, selection, assets and navigation contracts remain intact.

## Validation and limitations

Automated coverage includes exact-version authorization, illegal transitions, mock/live-adapter distinctions, skills versus technical outcomes, retry/history, atomic activation, occupied desks, persistence/restart, cancellation, termination, configured-secret rejection, private projections, real HTTP authentication/CSRF/file isolation, provider parsing/accounting, transport recovery, candidate selection and shared props.

Final automated validation: **1,138 tests across 72 files pass**, preserving the 937-test Phase 12 baseline and adding 201 tests. The complete suite ran with `npm test -- --maxWorkers=2`; running it concurrently with compilation had exhausted three tests' unchanged five-second deadlines. No assertions, coverage or timeout limits were reduced. `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build` pass. Lint retains five baseline warnings in `WorkstationScreen` and `OfficeContext`; the build retains its large-chunk warning and reports extensionless imports as incompatible with a future native config loader. The current Vite loader builds successfully. The ten HTTP tests exercise authentication, forged authority, stream access, bounded response framing and private-file aliases, including a public-directory junction.

Final Chromium validation: **39 checks pass** — 34 authenticated recruitment checks and five production-isolation checks. They cover exact-version approval, candidate arrival/file, backend-confirmed simulated hiring, assigned seating, Manager identity, skills rejection/exit, technical retry, refresh/resync, authorization, private-file protection, cancellation during movement, termination and exclusive reuse of the freed desk. There were no console errors or unexpected failed requests. Source hashes were checked against the final implementation; production JavaScript contains no recruitment host, credential handling or simulation fixtures. Sanitized evidence: [recruitment browser](validation/recruitment-browser.json) and [production browser](validation/recruitment-production-browser.json).

All 57 finite browser responses had valid bounded framing, with no signal aborts, read errors, CDP loading failures or reload aborts. Each of the five canonical GLBs loaded once per page lifecycle; hiring a replacement added no asset requests. Existing Three.js deprecation and software-renderer readback warnings are recorded in the evidence. This is shared-loading and idle-command validation, not a hardware FPS or 100-employee benchmark.

No live provider spending, Supabase, production deployment, external repository scanning, hosted authentication or autonomous Manager reasoning is claimed. The local snapshot repository is single-host and size-bounded; it is not a scalable database. There are no new authored handshake, escort or seated interview clips; existing walking/standing/working motions provide the presentation. Simulated checks can finish immediately once the interview starts because no artificial success timer is used.

This intake uses existing authored departments and one available workstation per department. It does not add departments or desks automatically. Post-hire configuration changes are not exposed yet; the activated configuration remains immutable. Additional employee work is explicit and bounded, not an autonomous employment loop.

A paused candidate reserves the interview area until retried or cancelled. Rejected navigation and uncertain provider billing require manual intervention; retry cannot clear an unrelated Manager blocker or replay a request whose cost is unresolved.

In-flight animation interpolation is not persisted every frame. A refresh resumes the accepted route from its last authoritative anchor, so partial walking distance can replay. Camera focus remains a one-shot focus with free orbit, not automatic tracking of a moving candidate.

Movement interruption preserves the already accepted corridor until replacement props reach the animation controller. Both employees and visitors use the same validated departure-prefix helper; delayed React commits do not require teleporting or relaxing furniture collision checks. Tests cover interruption after an extra animation frame and reject old corridors when furniture now blocks them.

Finite JSON responses use an exact UTF-8 `Content-Length`, at most 4,000,000 bytes, without compression or chunked encoding. The browser rejects missing, malformed or oversized framing before native body consumption, then verifies the decoded byte count before parsing. The host applies the same bound to successful and rejected responses. Request deadlines remain enforced; the long-lived realtime stream retains its separate incremental reader. This avoids Chromium's observed cancellation reports for successfully completed manual-reader fetches without accepting unbounded bodies.

## Changed-file manifest

- `.gitignore`
- `BUILD_PLAN.md`
- `CODEX_HANDOFF.md`
- `docs/RECRUITMENT.md`
- `docs/validation/recruitment-browser.json`
- `docs/validation/recruitment-production-browser.json`
- `package.json`
- `README.md`
- `scripts/setup-recruitment.mjs`
- `src/App.recruitment.test.tsx`
- `src/App.tsx`
- `src/components/3d/AnimatedCharacter.tsx`
- `src/components/3d/OfficeWorld.tsx`
- `src/components/RuntimeOffice.test.tsx`
- `src/components/RuntimeOffice.tsx`
- `src/dev/toolPreviewClient.ts`
- `src/office/characterMotion.test.ts`
- `src/office/characterMotion.ts`
- `src/office/officeNavigation.test.ts`
- `src/office/officeNavigation.ts`
- `src/office/officeState.ts`
- `src/office/workerPresentation.ts`
- `src/orchestration/capabilityMatcher.test.ts`
- `src/orchestration/planValidation.test.ts`
- `src/realtime/realtimeCodec.ts`
- `src/realtime/realtimeTypes.ts`
- `src/realtime/realtimeValidation.ts`
- `src/recruitment/recruitmentClient.test.ts`
- `src/recruitment/recruitmentClient.ts`
- `src/recruitment/recruitmentCost.test.ts`
- `src/recruitment/recruitmentCost.ts`
- `src/recruitment/recruitmentFolder.test.ts`
- `src/recruitment/recruitmentFolder.ts`
- `src/recruitment/recruitmentInterruption.test.ts`
- `src/recruitment/RecruitmentOffice.css`
- `src/recruitment/RecruitmentOffice.test.tsx`
- `src/recruitment/RecruitmentOffice.tsx`
- `src/recruitment/recruitmentPolicy.ts`
- `src/recruitment/recruitmentScene.test.ts`
- `src/recruitment/recruitmentScene.ts`
- `src/recruitment/recruitmentTypes.ts`
- `src/runtime/officeRuntime.ts`
- `src/runtime/officeRuntimeBridge.test.ts`
- `src/runtime/officeRuntimeBridge.ts`
- `src/runtime/recruitmentRuntime.test.ts`
- `src/runtime/recruitmentRuntime.ts`
- `src/runtime/runtimeTypes.ts`
- `src/tools/ToolExecutor.ts`
- `tools-host/preview/realtimeStream.ts`
- `tools-host/providers/ProviderBroker.test.ts`
- `tools-host/providers/ProviderBroker.ts`
- `tools-host/providers/ProviderRegistry.ts`
- `tools-host/realtime/publication.ts`
- `tools-host/recruitment/CeoAuth.test.ts`
- `tools-host/recruitment/CeoAuth.ts`
- `tools-host/recruitment/LocalRuntimeRepository.test.ts`
- `tools-host/recruitment/LocalRuntimeRepository.ts`
- `tools-host/recruitment/OpenAIResponsesAdapter.test.ts`
- `tools-host/recruitment/OpenAIResponsesAdapter.ts`
- `tools-host/recruitment/plugin.test.ts`
- `tools-host/recruitment/plugin.ts`
- `tools-host/recruitment/RecruitmentService.test.ts`
- `tools-host/recruitment/RecruitmentService.ts`
- `vite.config.ts`
