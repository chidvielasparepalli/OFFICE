# Phase 11 — API, secrets and cost

Phase 11 extends checkpoint `d088ef888204379283d62588473d293cd026bcef` on `codex/phase11-api-secrets-cost`. The complete 738-test Phase 10 suite passed before implementation. This phase adds a controlled provider boundary with deterministic host adapters; no live provider, paid request, autonomous loop or production backend is configured.

## Architecture and ownership

```text
Explicit assigned task / host-authorized caller
  → existing ToolExecutor + ToolRegistry + host tool grant
  → provider.invoke input validation
  → host ProviderBroker
      → provider/model/capability + agent grant + availability
      → estimate + atomic runtime budget reservation
      → host-only SecretStore → approved adapter
      → safe output + actual usage / unresolved liability
  → same OfficeRuntime repository, events and activity
  → immutable credit ledger + browser-safe snapshot
  → existing Manager / task / 3D presentation
```

The runtime owns `providerRequests` and the append-only `creditLedger`. The broker holds host dependencies, not another task, balance or event store. It exposes a registered tool to the existing executor. ToolExecutor's only extension carries the allowlisted `providerBroker` marker from a trusted registered network tool; no credential or arbitrary descriptor metadata is copied.

The executor continues to enforce current task ownership, explicit started state, agent kind, host tool permissions, execution leases, idempotency, cancellation and timeout. Workers request a result through the tool interface. They never receive the broker's dependencies, secret references or raw credentials.

## Provider registry and typed contracts

`src/providers/providerTypes.ts` defines public descriptors, capabilities, invocation inputs, execution results, reservations, usage, budget policy and ledger records. Capabilities are text, structured, research, image and video. A descriptor contains a stable ID, name, enabled flag, availability, supported capabilities, explicit model IDs, model limits/pricing and at most three configured fallback routes.

`tools-host/providers/ProviderRegistry.ts` stores frozen public metadata separately from a captured trusted adapter and host secret reference. Registration validates IDs, unique models, supported capabilities, integer pricing/limits and bounded routing. The public list has no adapter, secret reference, environment name or vault detail. It supports provider IDs such as OpenAI, Google or Anthropic without importing their SDKs or implementing brand-specific logic in workers. The development registry contains explicitly labelled fixture providers only.

An invocation specifies provider/model, capability, bounded JSON input, maximum output units, request cost ceiling and explicit fallback permission. Public accounting stores a SHA-256 request fingerprint and selection metadata, not raw prompts or credentials. A successful result contains provider/model/request identity, safe output, usage, estimated/actual cost, unit and retryability. Denials and failures are structured tool errors plus the corresponding runtime request when identity/input were valid. Malformed inputs and unknown agents fail at the existing tool boundary before an accounting request is created.

## Host-only secrets and public-data boundary

`SecretStore` is a host adapter interface. `InMemorySecretStore` uses private fields and injected values; no browser environment, localStorage, sessionStorage or client state is involved. The broker checks policy and reserves cost before reading a credential. Only the trusted adapter invocation receives it. Production vaults, secret rotation, authentication and OS isolation are not implemented.

Public data uses the unchanged Phase 8 `memorySafeJson` rejection policy. The host secret adapter additionally rejects exact configured values and their JSON-escaped, URL-encoded and Base64 representations. Nested fields, input, output and usage must pass the boundary before storage or publication. Provider exception messages/codes are never copied into public errors; fixed broker codes and a generic message are returned. Failed output is discarded, not stored as a redacted successful answer.

The development Vite server denies HTTP access to `tools-host/**` and its temporary bundled configuration directory, while retaining its normal sensitive-file deny list. Host code is absent from client module imports and production bundles. This includes deterministic fixture values: they remain host-only even though they are deliberately synthetic and cannot access a real service.

Detection is defense in depth, not universal exfiltration detection. Arbitrary encodings or secrets unknown to the configured store can evade pattern checks. Approved host adapters remain trusted code; a hostile adapter is not sandboxed. Phase 8 trust/source/access restrictions are unchanged, and an authorized verification assertion is still not independently proven by this system.

## Cost calculation and budgets

This implementation uses **integer microcredits** (`credit-micros`), with 1,000,000 microcredits per display credit. These are deterministic local accounting units, not USD/INR pricing or a real provider bill. No live pricing lookup or provider request is used to estimate cost.

Each model declares integer input/output microcredits per unit. The fixture input upper bound is the UTF-8 byte length of serialized input; output is bounded by the requested maximum units. Estimated cost is input units × input rate + maximum output units × output rate. Actual cost uses the adapter's reported input/output units and the captured rates. Multiplication/sums use BigInt internally and reject individual charges outside the JSON-safe integer range. Aggregate summaries use exact decimal strings.

Host-configured lifetime limits cover company/global, per agent, per task and per request, plus an optional request-count quota. Missing policy defaults to zero authority. The request's own cost ceiling can tighten the host maximum. Reservations check committed spend **plus outstanding/unknown liabilities** atomically inside the existing runtime transaction; concurrent callers cannot reserve the same remaining balance. No automatic refill or currency conversion exists.

Actual spend above an estimate is recorded without clamping, and the result is rejected when the approved usage ceiling was violated. Subsequent requests observe the real debt. A hard external spending guarantee requires an adapter/provider that enforces its usage bound; accounting cannot undo an already billed request. Unrepresentable or invalid usage retains an unresolved reservation for attention.

## Ledger, failures, cancellation and recovery

Every accepted reservation, denial, settlement and reconciliation appends an immutable ledger entry containing its request, agent/task, selected provider/model, operation, estimate, actual amount when known, reserved liability, unit, status and timestamp. Earlier entries are never edited. The request record is the current projection of that same history, not another independent balance store. Runtime commit failure prevents publication and provider submission when reservation has not committed.

- Rejection before dispatch consumes no budget and never reads a credential or calls an adapter.
- Known usage on a failed call is charged; failure is not assumed free.
- Cancellation before submission releases the reservation.
- Failure, timeout or cancellation after possible submission with unknown usage retains the reservation. No automatic retry follows an ambiguous call.
- Late authoritative usage may append reconciliation after cancellation/disconnection, changing accounting only. It cannot revive output, a task or an agent.
- Explicit host reconciliation resolves unknown charges with a unique assertion/evidence reference. It is not an independent billing verification mechanism, and this phase does not permit arbitrary edits to already settled bills.

Execution IDs retain ToolExecutor's first-invocation idempotency: repeated calls reuse the original input/result rather than call again. Reuse across another agent/task/tool is rejected. Accounting commands reject conflicting fingerprints or replacement settlements. Restored snapshots validate safe metadata, relationships, charges and ledger history. Retained active work is never automatically replayed; crash recovery remains an explicit host responsibility.

Only availability-related preflight denials are marked retryable. Submitted, cancelled, unknown-charge and reconciled requests are never implicitly retryable. Retrieval or restoration cannot change that advice.

## Fallback policy

Fallback is opt-in per invocation and uses only the primary descriptor's ordered, bounded routes. Each candidate independently rechecks model/capability, agent authority, request limits, availability, credential presence and budget. Unsupported or unauthorized routes fail closed. There is no recursive search, random provider choice, hidden model substitution or fallback after an adapter has possibly submitted work.

Selection and reasons are preserved in runtime metadata and `PROVIDER_FALLBACK_SELECTED`. Budget/quota denial and unavailable services produce their respective structured audit events. The configured chain ends in a blocked task/Manager attention when no approved route can run.

## Runtime, artifact, memory and 3D integration

Provider reservation/outcome, fallback, denial, budget, unresolved charges, reconciliation and usage use the existing event/activity infrastructure. Ledger deltas in event changes are appended in committed order; other domain changes remain canonical after-images. No polling or additional per-agent event subscriptions are introduced.

The existing ToolExecutor failure path blocks unresolved work and informs the Manager. Success leaves task progress/completion/verification unchanged. The normal runtime bridge drives working, waiting or blocked presentation; provider code never touches Three.js. Supplied workers, calm headband-free Manager, worker-only headbands, navigation and camera behavior are unchanged.

When optional artifact storage is injected, safe output can be staged as immutable bytes and the tool result returns its exact receipt. Staging is not artifact creation. An explicit `ArtifactService.create` operation retains the successful tool execution, task, agent and hash as provenance. It remains completed/unverified until the existing QA policy passes for that exact version. No automatic output or artifact verification is added.

An explicit MemoryService write can retain a useful finding with existing tool provenance and unverified trust. Provider success, a content hash or QA success grants no memory verification authority. Context stays bounded and uses the existing memory/artifact access rules.

## Development preview and validation

Open `/?providers=preview` in development, then connect explicitly. It reuses the existing loopback/Origin/session-protected `/__tools-preview` action transport and read-only client snapshot cache. A strict named mode selects the provider session; callers cannot submit adapters, grants, secret references or arbitrary host commands.

Named scenarios cover success, permission denial, budget denial, unavailable service, approved fallback, exhausted routes, provider failure with unknown billing, unsafe output, missing credential and unknown provider. Separate buttons explicitly capture an output artifact or an unverified memory finding. The preview shows safe configuration presence, limits, estimates/actual charges, ledger and runtime attention; it never renders a credential value. Production remains disconnected and query parameters cannot enable these fixtures.

Validation on Node 24.21.0 / npm 11.19.0:

- **833 automated tests in 51 files pass:** all 738 prior tests plus 95 additions. New coverage includes 13 cost-policy tests, 24 runtime accounting tests, 26 broker tests, 19 security/integration tests, ten host-session tests, one UI test, one Vite source-isolation test and one additional transport test. Full log/JSON are retained locally under `test-results/phase11-tests-final.*`.
- **42 targeted Chromium checks pass:** 37 development checks in [provider browser evidence](validation/phase11-provider-browser.json), plus five [production isolation checks](validation/phase11-provider-production-browser.json). All 19 recorded product source hashes match the accepted source. No console/page errors, unexpected failed requests or hot reloads occurred in the final runs.
- Actual seated worker/headband, calm dedicated Manager without a headband, selection, camera focus/reset and open-top overview were inspected. The five canonical GLBs each loaded once. Idle transport message/subscriber counts did not grow.
- Safe execution, permission/budget/availability denials, fallback, unresolved billing, explicit artifact/memory capture and unsafe-response rejection were exercised. Known fixture credentials were absent from DOM, public state, context, artifacts, memory and event responses. Direct/raw/filesystem host-source and temporary-config HTTP probes were denied. Production query parameters cannot activate fixtures or the host execution endpoint.
- Typecheck, lint, formatting and production build pass. Five pre-existing lint warnings remain in `WorkstationScreen.tsx` / `OfficeContext.tsx`; existing native-config-loader and large-chunk build warnings remain. `git diff --check` passes.
- Production JavaScript remains **byte-identical to Phase 10**: 1,382,420 bytes, SHA-256 `2a7e2d41527e60c570deddcac5a710f352fea0bbee5e26a5e7a3edb8567d4bb7`. No provider SDK or host fixture is included.

Security review caught and fixed raw dependency-error propagation during provider preflight/final output validation and unsafe restored usage-event metadata. Regressions exercise these paths without printing credential values. The Vite source-isolation test now uses a separate optimizer cache; sharing the active development cache initially caused stale-module 504s. Its focused regression passed after isolation, the development server was restarted, and the final browser runs above were clean. A premature blank worker screenshot was discarded and replaced after actual presentation; no scene code was changed.

This is targeted Phase 11 browser validation, not a rerun of every historical browser harness or a GPU/100-agent benchmark. Automated regressions preserve the previous phase suite. No live API, financial transaction or production secret vault was tested.

## Changed-file manifest

Provider contracts, accounting and runtime integration:

- `src/providers/providerTypes.ts`
- `src/providers/costPolicy.ts`
- `src/providers/costPolicy.test.ts`
- `src/runtime/providerRuntime.ts`
- `src/runtime/providerRuntime.test.ts`
- `src/runtime/officeRuntime.ts`
- `src/runtime/runtimeTypes.ts`
- `src/runtime/officeRuntimeBridge.test.ts`
- `src/orchestration/capabilityMatcher.test.ts`
- `src/orchestration/planValidation.test.ts`
- `src/tools/ToolExecutor.ts`

Host-only registry, broker, secrets and security tests:

- `tools-host/providers/ProviderRegistry.ts`
- `tools-host/providers/ProviderBroker.ts`
- `tools-host/providers/SecretStore.ts`
- `tools-host/providers/ProviderBroker.test.ts`
- `tools-host/providers/providerSecurity.test.ts`

Development transport, preview and isolation:

- `tools-host/preview/plugin.ts`
- `tools-host/preview/plugin.test.ts`
- `tools-host/preview/session.ts`
- `tools-host/preview/feedback.ts`
- `tools-host/preview/providerSession.ts`
- `tools-host/preview/providerSession.test.ts`
- `tools-host/preview/sourceIsolation.test.ts`
- `src/dev/toolPreviewProtocol.ts`
- `src/dev/toolPreviewClient.ts`
- `src/dev/ProviderCostPreview.tsx`
- `src/dev/ProviderCostPreview.test.tsx`
- `src/App.tsx`
- `vite.config.ts`

Documentation and retained browser evidence:

- `docs/PHASE11_API_SECRETS_COST.md`
- `docs/validation/phase11-provider-browser.json`
- `docs/validation/phase11-provider-production-browser.json`
- `BUILD_PLAN.md`
- `CODEX_HANDOFF.md`
- `README.md`

## Performance and limits

Provider operations occur only on explicit commands. There are no frame-driven requests, status polls, balance recalculations in animations, new GLBs or external SDK dependencies. Registry/secret objects are shared per host session. Accounting scans session requests on a reservation; very large histories need future indexing/retention. Existing runtime history and in-memory ledger are not durable, cross-process or multi-tenant accounting.

The initial pricing/usage fixture contract must be replaced by authoritative model-specific metering before live billing. Unknown charges need explicit reconciliation. No real provider, production vault, durable credit repository, billing settlement, authentication, realtime, Supabase, communication, deployment or autonomous execution is included. Stop after Phase 11.
