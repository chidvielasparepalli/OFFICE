# Phase 12 — Realtime

Phase 12 extends the accepted Phase 11 checkpoint `159c70a` on `codex/phase12-realtime`. The canonical runtime remains authoritative. A recipient-filtered publication stream and read-only client cache make accepted runtime changes visible without a page refresh. There is no new task engine, event bus, business reducer or persistence store.

The development entry point is `/?realtime=preview`. Production still starts empty and disconnected. Acceptance passed: **937 tests and 37 Chromium checks**, with typecheck, lint, formatting and production build passing. See the validation evidence and limitations below.

## Architecture and ownership

```text
Explicit host command / existing ToolExecutor / existing QA
    → OfficeRuntime transaction and repository commit
    → one runtime subscription
    → recipient-bound host projection
    → RealtimePublisher snapshot or atomic delta
    → transport
    → validated RealtimeStore materialized view
    → existing RuntimeOffice / runtime-to-3D bridge / context panels
```

`RealtimePublisher` consumes `getSnapshot()` and `subscribe()` from the existing runtime. `createRealtimeProjection()` applies the host-selected recipient's memory and artifact permissions. `RealtimeStore` owns only a last accepted materialized view, transport lifecycle and diagnostic counters. It cannot assign tasks, execute tools, promote memory trust, verify artifacts or change credits.

The canonical runtime commits its repository before notifying subscribers. Rejected commands, no-ops and failed persistence do not publish successful state changes. An accepted command can emit several canonical events; the realtime publisher publishes the resulting complete committed state as one update. Selection-only commits still advance the revision even when they contain no business events.

No runtime, orchestration, tool, memory, QA, artifact or provider implementation was replaced for this phase.

## Channel and wire contract

Protocol version `1` uses one normalized channel, `office:runtime`, scoped to a host-issued `streamId`. A recipient has one coherent stream rather than a connection per agent or domain.

Every envelope contains `protocol`, `channel`, `streamId`, `revision` and `kind`:

- A snapshot contains the complete authorized `RealtimeView` for that revision.
- A delta contains `baseRevision`, `revision` and changed fields. Its revision must be exactly `baseRevision + 1`.
- Entity maps carry complete changed records or `null` tombstones. Tombstones remove deleted or newly inaccessible records.
- Scalar and array fields are replacements, including the bounded public event/activity/credit-ledger windows. This wire representation does not change the canonical runtime's append-only ledger semantics.

The view contains the existing `RuntimeState` shape plus derived notifications, artifact handoffs and cost totals. Published entity maps cover agents, tasks, workstations, departments, requests, plans, tool executions, memories, QA requests, repairs, artifacts and provider requests. It also carries selection, runtime connection state and bounded history.

Canonical events are inspectable descriptors, not commands replayed by the browser. Their payloads and internal after-images are withheld. Client state changes come only from validated snapshots and deltas.

## Atomicity and reentrant commits

The publisher compares complete projected states after accepted commits. For adjacent revisions it emits an atomic delta. Consumers validate the entire candidate state, including cross-record links, before exposing any part of that update.

Existing runtime listeners can synchronously dispatch another command. A later listener may consequently observe a newer revision while intermediate callbacks are coalesced. When the publisher sees a revision gap, it emits a complete authoritative snapshot instead of guessing missing deltas. Subsequent duplicate callbacks for the already published revision are ignored. The canonical runtime's commit behavior remains unchanged.

Unchanged entity references are preserved when the client installs a view. Updating task progress therefore does not recreate an unchanged agent's spatial intent or restart navigation. This is a read-only projection optimization, not optimistic business state.

## Connection and recovery

The transport installs its live subscription before requesting the initial snapshot. Messages arriving during that handshake are bounded and replayed against the accepted snapshot. Stream identity and a local generation counter prevent callbacks from an obsolete connection from overwriting a newer one.

The store exposes `disconnected`, `connecting`, `connected`, `reconnecting`, `resyncing` and `degraded`. Transport connection health is separate from runtime business state. Disconnecting does not mark tasks completed or failed.

- Older messages are stale and ignored; exact duplicate messages do not apply twice.
- A delta whose base does not match the accepted revision triggers snapshot recovery without applying a partial update.
- Conflicting same-revision data, invalid schemas and cross-record inconsistencies fail closed.
- Recovery uses one in-flight snapshot synchronization. Snapshot/replay attempts and pending messages are bounded.
- Automatic reconnect defaults to three attempts, starting at 250 ms with exponential backoff capped at 30 seconds. There is no continuous polling.
- Explicit reconnect and browser visibility/online resume request an authoritative snapshot. No tool or task command is automatically replayed.
- Explicit disconnect cancels connection/retry work. Disposal closes the transport and removes subscribers. React StrictMode cleanup uses reusable disconnect.

On connection loss the UI retains and labels its last accepted view as stale. These previously delivered records cannot be retroactively erased from a disconnected browser. A successful resynchronization reapplies current access and tombstones; the cache is never treated as a write authority.

## Host publication and access control

`tools-host/realtime/publication.ts` binds `principalAgentId`, memory policy and artifact policy on the host. Browser selection, snapshot requests and stream requests cannot choose an authority, supply grants or broaden filters. This development office exposes public agent/task metadata to the fixed viewer; it is not a multi-tenant privacy or authentication system.

Existing memory and artifact access checks remain authoritative:

| Published area     | Boundary                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory             | Only active, unexpired, readable records. Content, actual trust, source and verification remain intact. Arbitrary metadata becomes `{}`; invisible succession links are removed.                                      |
| Artifacts          | Only readable metadata and opaque content/hash references. No content bytes or user-provided reference paths. Arbitrary metadata becomes `{}`; inaccessible ancestry, supersession and QA links are removed.          |
| Task/context links | Input/output artifact IDs and verification references are filtered to the visible records. Private artifact inspection/repair tasks use generic public descriptions.                                                  |
| Tools              | Private artifact/QA source executions are excluded. Other tool bodies and input summaries are `null`, arbitrary metadata is empty, and permission/error descriptions are fixed safe values.                           |
| QA                 | Hidden artifact attempts and related repairs are excluded. Tool inputs, assertion paths and comparison values are withheld; retained result/evidence records must satisfy the public-data boundary.                   |
| Providers/costs    | Safe requests and usage/pricing/ledger metadata are visible only with their public tool executions. Reconciliation evidence is withheld. No credential, secret-provider object or adapter response body is published. |
| Events/activity    | Only relevant authorized event descriptors survive; payload and changes are `{}`. Fixed labels derive from accepted event types. Hidden source-event links are removed.                                               |

Every retained entity passes the existing Phase 8 `memorySafeJson` credential-like validation plus the realtime structural allowlist and absolute host-path rejection. Safe HTTPS citations remain valid; Windows drive paths, UNC paths, private absolute filesystem paths and file URLs are rejected. A host may additionally supply `assertPublic` to reject known secret values. Unsafe retained content rejects the projection and closes its consumers with a generic error; raw content and parser errors are not sent as diagnostics. Stripping is explicit policy, not a credential-redaction substitute.

Memory expiry uses the last accepted runtime event timestamp, falling back to the epoch for empty history. Projection is deterministic for a committed revision and fixed audience. Time passing alone does not generate another view at the same revision: expiry becomes visible after a later accepted runtime event. There is no memory polling timer.

Memory retrieval, source identity, trust progression, supersession and verification semantics remain unchanged. Recent or frequently streamed memory does not gain trust. Pattern-based credential detection is not universal secret detection, and an authorized memory verification assertion is not independently proven by this system.

## Notifications, handoffs and costs

Notifications are a bounded read-only list derived from actual visible runtime event descriptors. They have stable event IDs, timestamps, task/agent references and fixed severity/labels. There is no notification delivery service, separate unread state, email, chat or fabricated activity.

Handoffs derive from actual canonical task `inputArtifactIds`, artifact provenance and the receiving task's assignee. Their IDs and links disappear when the artifact is no longer readable. Realtime does not invent handoff tasks or a second workflow model.

Cost totals derive from the visible provider request records with the Phase 11 cost policy. Unknown liability, later usage reconciliation and immutable ledger history retain their original semantics. Streaming never reserves, spends, settles or refunds credit.

## Guarded development transport

The Vite development plugin adds persistent newline-delimited JSON over a **POST stream** under `/__tools-preview/`. It shares the existing local preview guard:

- Loopback socket address and exact loopback `Host` at the bound development port.
- Exact same-origin HTTP `Origin`, `X-Tools-Preview: 1`, JSON content type and POST method.
- No forwarded-host headers, arbitrary browser authority, subscription filters or tool arguments.
- Opaque session identity in `X-Tools-Session` after connection.
- Request bodies limited to 16,384 bytes.

The server owns one disposable development session at a time. Connecting a new session replaces the prior one; the realtime session has a fixed Manager principal from the existing artifact fixture. This is a single-session development viewer, not user authentication or production authorization. Its host actions are an allowlist; stream/snapshot requests accept only empty objects.

The stream subscribes before sending `realtime-ready`, so the client can safely request its snapshot. Backpressure has a bounded queue and closes slow consumers for snapshot recovery. An idle session expires after 30 minutes on its next request. The host limits a session to 100 explicit scenario actions; selection/spatial feedback uses a separate narrow validated grammar.

There is no WebSocket/Supabase deployment, external provider call, hosted realtime service or production endpoint. `src/App.tsx` loads the preview only behind `import.meta.env.DEV` and the `realtime=preview` query parameter.

## Existing office integration

`RealtimePreviewClient` implements the existing `RuntimeOfficePort` by forwarding reads and subscriptions to the shared `RealtimeStore`. `RuntimeOffice` and its existing runtime bridge own rendering, exact-ID selection, camera focus, deterministic navigation and animation as before.

Scene feedback is limited to exact selection and discrete arrival/rejected-movement commands validated by the host. Pending spatial feedback is bounded to 100 agents, deduplicated by agent/intent and rechecked against the recovered snapshot before delivery. Stale intents are discarded. If a valid movement acknowledgement arrives after a host transition replaced its intent, an exact accepted agent/intent after-image must prove it was previously issued before the host acknowledges it as an obsolete no-op. This creates no position, revision or event change. Unknown, wrong-agent and invalid current intents remain rejected. Business commands do not gain an offline replay queue.

The supplied worker, dedicated Manager, workstation and headband assets are unchanged. Cached geometry/materials and shared accessories are reused. The Manager stays calm and never mounts the worker headband; realtime does not introduce another animation system or alter floor, camera or open-top composition.

## Development scenarios

The preview reuses the existing host artifact scenario, its canonical runtime, ToolExecutor and QA engine. Controls are explicit developer operations:

1. Connect, prepare a task and start it; observe agent/task state, selection and navigation without refresh.
2. Update progress, block or resume the task; the host decides each accepted state change.
3. Run the fixture's actual bounded write tool, explicitly create an artifact, complete the task, request QA and run QA. Worker completion remains distinct from artifact verification.
4. Link the real artifact as a receiving task input and inspect the derived handoff.
5. Inject a duplicate, stale message or skipped delivery; inspect the store's rejection/recovery counters.
6. Drop, disconnect, reconnect or resume the stream; recover the authoritative snapshot without recreating tasks or replaying execution.

The UI shows actual task/agent/artifact/QA state, visible history, notifications, handoffs, costs and connection health. Production has no seeded employees, artifacts, fabricated credit usage or scenario timers.

## Bounds and performance

There is one host runtime subscription per recipient publisher and one browser stream/cache per preview client. Domain objects do not query memory, run tools, hash artifacts or poll per frame. Metrics are sampled explicitly in the preview rather than updated by a timer.

Publisher counters expose published messages, subscribers and disposal. Store counters expose received/applied/duplicate/stale/gap/invalid messages, accepted snapshots, reconnects, subscriber count and pending messages; the preview adds pending spatial feedback. These are diagnostics, not business state or hardware benchmarks.

The protocol validates a view at no more than 4,000,000 UTF-8 bytes; record maps are capped at 1,000 entries and each public record has a 65,536-byte validation budget. Visible event/activity/notification windows hold at most 100 entries, ledger history at most 1,000, and derived handoffs at most 1,000. Full authoritative history remains on the host. Over-limit views fail closed; pagination is not implemented.

Handshake buffering is limited to 128 envelopes. Recovery allows three snapshot attempts and bounded replay of 256 messages. Server backpressure permits at most 128 queued lines within 4,000,000 bytes; one oversized line closes the stream. This protects memory but does not guarantee delivery to a slow client; recovery uses snapshots.

Projection, structural validation and diffing visit the bounded view on accepted commits. They are not per-frame work. They have not been benchmarked for a production-scale database. Preserving unchanged records limits downstream renderer churn, but no new RTX/hardware FPS claim is made. The historical headless SwiftShader measurement remains a software-renderer observation.

## Validation

The complete suite passes **937 tests in 59 files**: all **833 Phase 11 tests** remain, with **104 additional tests**. `npm test -- --maxWorkers=2` limits host contention without skipping tests or weakening assertions/timeouts. Typecheck, lint, formatting and production build pass. Lint retains five pre-existing warnings in `WorkstationScreen.tsx` and `OfficeContext.tsx`; Vite retains its existing native-config extension and large-chunk warnings.

Coverage includes 40 transport/store tests, 37 publication/security tests and 12 cross-system integration tests, plus preview UI/client/host/HTTP/backpressure regressions. They exercise accepted/rejected/no-op/failed-commit behavior, atomic dependencies, selection-only revisions, unchanged spatial references, reentrant snapshot fallback, artifact access removal and handoffs, memory trust/access/security, actual QA repair/history, provider reservation/unknown-liability/reconciliation, disposal, reconnect races, malformed envelopes, limits and obsolete scene feedback.

**37 Chromium checks pass**: [32 development checks](validation/phase12-realtime-browser.json) and [five production-isolation checks](validation/phase12-realtime-production-browser.json). The final development run used a freshly started isolated loopback server on port 5174, frozen product-source hashes and one Chromium page. It verified actual worker walking/sitting/headband behavior, separate calm Manager selection, host-driven updates, tool/artifact/QA provenance, notifications/handoffs, duplicate/stale/gap recovery, disconnect/reconnect/resume, unchanged cached assets, and publication security. Console errors, unexpected failed requests and hot reloads were zero. Two deliberately cancelled streams are recorded separately with their explicit lifecycle causes; no action or snapshot request was aborted in the final run.

All five canonical GLBs loaded once across reconnections. Idle observation generated no polling requests. The final cache had zero invalid messages, pending messages or pending spatial feedback. Production remains empty/disconnected with no development controls, endpoint or host modules. Its JavaScript is **byte-identical to Phase 11**: 1,382,420 bytes, SHA-256 `2a7e2d41527e60c570deddcac5a710f352fea0bbee5e26a5e7a3edb8567d4bb7`.

Screenshots were inspected at `test-results/phase12-worker-working.png`, `phase12-manager.png`, `phase12-artifact-notifications.png` and `phase12-overview.png`. Generated screenshots and command logs remain local ignored validation output; the committed JSON receipts include checks, source hashes, request counts and limitations. No hardware GPU benchmark or hosted multi-user service is claimed.

## Changed-file manifest

Exact Phase 12 source, test, documentation and evidence manifest:

Modified:

```text
BUILD_PLAN.md
CODEX_HANDOFF.md
README.md
src/App.tsx
tools-host/preview/feedback.ts
tools-host/preview/plugin.ts
tools-host/preview/sourceIsolation.test.ts
```

Added:

```text
docs/PHASE12_REALTIME.md
docs/validation/phase12-realtime-browser.json
docs/validation/phase12-realtime-production-browser.json
src/dev/RealtimePreview.test.tsx
src/dev/RealtimePreview.tsx
src/dev/realtimePreviewClient.test.ts
src/dev/realtimePreviewClient.ts
src/dev/realtimePreviewProtocol.ts
src/realtime/LocalRealtimeTransport.ts
src/realtime/RealtimePublisher.ts
src/realtime/RealtimeStore.test.ts
src/realtime/RealtimeStore.ts
src/realtime/realtimeCodec.ts
src/realtime/realtimeIntegration.test.ts
src/realtime/realtimeTypes.ts
src/realtime/realtimeValidation.ts
tools-host/preview/realtimeSession.test.ts
tools-host/preview/realtimeSession.ts
tools-host/preview/realtimeStream.test.ts
tools-host/preview/realtimeStream.ts
tools-host/preview/realtimeTransport.test.ts
tools-host/realtime/publication.test.ts
tools-host/realtime/publication.ts
```

## Remaining limitations and stop boundary

- Transport is local development only, with one host-selected Manager viewer. There is no hosted Supabase, production authentication, tenant isolation or durable session.
- A disconnected client retains already delivered data until resynchronization/reset. Permission revocation cannot retroactively remove information previously observed by a recipient.
- Expiring memory waits for the next accepted runtime event timestamp; no wall-clock expiry service was added.
- Public events and derived notifications are bounded descriptors, not an exhaustive audit export or notification system. Raw tool/QA inputs and private source details are intentionally unavailable in this viewer.
- Broad public office agent/task metadata follows the existing development office visibility policy; private memory/artifacts still use their existing access policy.
- Credential rejection remains pattern-based, with an optional host-known-secret assertion. This is not universal content classification or independent verification of memory assertions.
- Bounded snapshots have no pagination or durable replay log. Slow or invalid streams recover through snapshots, and sustained failure degrades visibly.
- No new provider, autonomous agent loop, communication channel, deployment, advanced animation redesign or production persistence is authorized by this phase.

Stop after Phase 12 validation and its branch checkpoint. Future hosted transport/authentication work must preserve this recipient-bound publication contract and the authoritative runtime boundary.
