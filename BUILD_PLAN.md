# AI Corporate Office OS — Master Build Plan

> **Repository:** `chidvielasparepalli/OFFICE`  
> **Goal:** Build a complete, personal AI Corporate Office OS where autonomous AI employees live and work inside an interactive 3D office.  
> **Primary builder:** Codex / GPT-6 Astra + Claude Code as needed.  
> **Development philosophy:** AI-assisted, open-source first, near-zero development cost, incremental implementation, real backend state driving the 3D world.

---

## 0. Product Definition

The AI Corporate Office OS is not a normal dashboard with a 3D background.

It is an **interactive digital company**.

The user should be able to enter a miniature corporate headquarters, see departments, observe AI employees at desks, zoom into the building, inspect individual employees, watch active workers move around, see collaboration and handoffs, and interact with the Manager.

The visual world is a representation of the real agent operating system.

### Core principle

```
USER REQUEST
   ↓
MANAGER
   ↓
PLAN
   ↓
TASK GRAPH
   ↓
AI EMPLOYEES
   ↓
QA / REPAIR
   ↓
ARTIFACTS / RESULTS
   ↓
MANAGER
   ↓
USER
```

At the same time:

```
REAL BACKEND STATE
   ↓
EVENTS / REALTIME
   ↓
3D OFFICE STATE
   ↓
EMPLOYEE MOVEMENT + ANIMATION
   ↓
USER OBSERVES THE COMPANY
```

The 3D office must never invent fake business state in production.

---

# 1. Product Experience

The finished product should feel like:

**"A miniature autonomous AI company that I can enter, observe, control and manage."**

### User can:

- See the entire office from an overhead/isometric-style view.
- Zoom in and out smoothly.
- Pan around the building.
- Focus on a department.
- Click an employee.
- Smoothly fly the camera to that employee.
- See the employee, desk and laptop.
- Open a compact employee inspector.
- Watch employees stand, walk, work, collaborate and return to their desks.
- Observe only active employees becoming visually active.
- See sleeping/idle employees remain mostly still.
- Submit a new task to the Manager.
- Watch the Manager delegate work.
- Watch workers wake as needed.
- Observe handoffs and task progress.
- See QA and Repair activate only when relevant.
- See blocked states and escalation.
- Inspect artifacts and task dependencies.
- Observe company health, active agents, tasks and cost.

---

# 2. Non-Negotiable Principles

1. **Backend is the source of truth.**
2. **3D is a visualization layer over real state.**
3. **Manager is the single responsible owner.**
4. **Only required employees are active.**
5. **Idle employees sleep.**
6. **Do not create fake task completion.**
7. **Do not expose secrets to the browser or agents.**
8. **Do not rewrite working backend systems without a reason.**
9. **Do not build the whole product in one massive change.**
10. **Every milestone must typecheck, build and be testable.**
11. **Prefer open-source/free tools and assets first.**
12. **Use AI for reasoning/code generation, but keep deterministic systems deterministic.**

---

# 3. Technology Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS or existing project styling
- Zustand only where client-side state actually benefits from it

## 3D

- Three.js
- React Three Fiber
- @react-three/drei
- GLB / GLTF assets
- AnimationMixer
- OrbitControls or custom controls
- PBR materials
- WebGL
- LOD
- Instancing
- Asset caching
- Draco/Meshopt where appropriate

## Animation

- GSAP
- Three.js frame-based animation
- GLTF animation clips
- AnimationMixer / AnimationAction
- Smooth camera easing
- Procedural path movement

## Application / Backend Foundation

- React + Vite is the approved Phase 1 application foundation.
- TypeScript
- Node.js tooling
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Realtime
- Existing agent runtime

### Framework decision

The current application is a React/Vite SPA. **Keep Vite for Phase 1.**

Do not migrate to Next.js merely because an earlier version of this document mentioned Next.js.

When real server-only functionality is introduced (provider credentials, protected agent execution, server-side APIs, webhooks, etc.), evaluate the cleanest architecture based on the actual runtime:
- extend the existing Vite SPA with a separate server/service, or
- migrate to a full-stack framework if the benefits clearly outweigh migration cost.

Do not perform a framework migration without an explicit architectural decision and migration plan.

## Deployment

- Vercel for the Vite frontend/app during the initial phases
- Supabase for database/auth/realtime
- GitHub for source control
- Add a protected server/runtime deployment only when real server-side execution is implemented

## 3D Asset Creation

- Blender
- Free/open assets initially
- GLB/GLTF as production runtime format

---

# 4. Installed AI/Development Skills

The coding environment should use the existing skills where relevant:

- react-three-fiber
- threejs-controls
- threejs-camera
- threejs-materials
- threejs-loaders
- threejs-animation
- threejs-perf-loading
- r3f-best-practices
- gsap-core
- frontend-design
- web-design-guidelines
- ui-ux-pro-max
- design-taste-frontend
- systematic-debugging
- improve
- improve-codebase-architecture
- review-loop
- wayfinder
- impeccable

Do not install more skills unless a concrete missing capability appears.

---

# 5. High-Level Architecture

```
                              USER
                               │
                               ▼
                    ┌─────────────────────┐
                    │  3D OFFICE CLIENT   │
                    │                     │
                    │ Three.js / R3F      │
                    │ Camera / Animation  │
                    │ HUD / Inspector     │
                    └──────────┬──────────┘
                               │
                       API / Realtime
                               │
                               ▼
                    ┌─────────────────────┐
                    │ OFFICE STATE LAYER  │
                    │                     │
                    │ Agent state         │
                    │ Task state          │
                    │ Handoff state       │
                    │ Artifact state      │
                    │ Event stream        │
                    └──────────┬──────────┘
                               │
                               ▼
                ┌─────────────────────────────────┐
                │      AI CORPORATE OS            │
                │                                 │
                │ Manager                         │
                │ Planner                         │
                │ Dispatcher                      │
                │ Task Graph                      │
                │ Agent Runtime                   │
                │ QA / Repair                     │
                │ Memory                          │
                │ Skill Broker                    │
                │ API / Secrets Broker             │
                │ Cost Controller                 │
                │ Communication                   │
                │ Scheduler / Monitor             │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │       SUPABASE         │
                    │                        │
                    │ PostgreSQL             │
                    │ Auth                   │
                    │ Realtime               │
                    │ Storage                │
                    └────────────────────────┘
```

---

# 6. Corporate Departments

## Executive

- Manager
- Planner
- Dispatcher
- Scheduler
- Memory Agent
- Approval Agent
- Audit Agent

## Engineering

- Frontend Engineer
- Backend Engineer
- Fullstack Engineer
- Python Engineer
- Java Engineer
- C++ Engineer
- C# Engineer
- Go Engineer
- Rust Engineer
- JavaScript Engineer
- PHP Engineer
- Ruby Engineer
- Mobile Engineer
- Database Engineer
- Authentication Engineer
- DevOps Engineer
- Git Agent
- Deployment Agent

## Research

- Web Research Agent
- Academic Research Agent
- Factcheck Agent
- Data Research Agent
- AI Research Agent

## Creative

- UI/UX Agent
- Graphics Designer
- Color/Palette Agent
- Image Generation Agent
- Animation Agent
- Video Agent
- Video Editor
- Audio Agent

## Business

- Marketing Agent
- Content Agent
- SEO Agent
- Sales Agent
- Product Agent

## Quality

- QA Agent
- Repair Agent
- Security Agent
- Performance Agent
- Accessibility Agent

## Operations

- API / Secrets Agent
- Skill Broker Agent
- Cost Controller
- Artifact Manager
- Communication Agent
- Monitoring Agent

The registry must be data-driven so more departments and employees can be added without rewriting the core system.

---

# 7. Agent Lifecycle

Canonical state machine:

```
SLEEPING
  ↓
QUEUED
  ↓
WORKING
  ↓
WALKING
  ↓
COLLABORATING
  ↓
WAITING
  ↓
COMPLETED
  ↓
SLEEPING
```

Failure path:

```
WORKING
  ↓
FAILED
  ↓
BLOCKED
  ↓
REPAIR
  ↓
WORKING
```

Rules:

- SLEEPING agents do not perform unnecessary expensive work.
- WORKING agents can display active work.
- WALKING means a real task/handoff requires movement.
- COLLABORATING means the agent is actively participating in collaboration.
- BLOCKED means execution cannot continue.
- COMPLETED leads back to SLEEPING unless immediately assigned new work.

---

# 8. AI Manager Responsibilities

The Manager is the single responsible owner of user goals.

Manager must:

1. Understand the user's request.
2. Determine whether the task is simple or needs decomposition.
3. Build a task plan.
4. Create dependencies.
5. Delegate to exact registered agent IDs.
6. Track task progress.
7. Monitor handoffs.
8. Verify outputs.
9. Trigger QA where appropriate.
10. Trigger Repair when needed.
11. Manage API/provider routing through the broker.
12. Respect company credit/budget.
13. Request approval for sensitive actions.
14. Escalate blockers.
15. Deliver the final result to the user.

---

# 9. Agent Delegation

Delegation should use a controlled interface:

```ts
delegate_to_subagent({
  agent_id: string,
  task: string
})
```

Delegation must:

1. Validate the agent ID.
2. Create a durable office task.
3. Assign the task to the agent.
4. Wake the agent.
5. Set working state.
6. Set current task.
7. Create the runtime subagent run.
8. Emit an `agent_awakened` event.
9. Execute the worker.
10. Resolve success/failure.
11. Return the worker to sleeping/blocked state.

Never accept arbitrary unregistered agent IDs.

---

# 10. Task Graph

Complex requests must use dependencies.

Example:

```
MANAGER
   ↓
PLANNER
   ↓
DESIGN ──────────┐
   ↓             │
IMAGE AGENT      │
   ↓             │
FRONTEND <───────┘
   ↓
QA
   ├── PASS → MANAGER
   └── FAIL → REPAIR → QA
```

A task must not run until its required dependencies are satisfied.

Required data:

- task ID
- parent task
- assignee
- status
- priority
- dependencies
- input artifacts
- output artifacts
- created timestamp
- started timestamp
- completed timestamp
- failure reason
- retry count

---

# 11. Handoff System

Agents communicate using explicit handoffs rather than hidden shared state.

```ts
handoff_to_employee({
  from_agent_id,
  to_agent_id,
  task_id,
  artifact_id,
  message
})
```

Example:

```
DESIGNER
  ↓
Design Artifact
  ↓
FRONTEND ENGINEER
  ↓
Implementation
  ↓
QA
```

A handoff should generate an event.

The 3D office may visualize a meaningful handoff as movement to a collaboration location.

---

# 12. Artifact System

Everything important can become an artifact.

Examples:

- code
- image
- document
- dataset
- video
- design
- test report
- deployment
- research output
- generated asset

Recommended shape:

```ts
type Artifact = {
  id: string;
  taskId: string;
  creatorAgentId: string;
  type: string;
  title: string;
  location: string;
  metadata: Record<string, unknown>;
};
```

Artifacts belong to tasks and can be handed between agents.

---

# 13. Skill Broker

Agents should request capabilities from a centralized Skill Broker.

Flow:

```
WORKER
  ↓
request_skill()
  ↓
SKILL BROKER
  ↓
SKILL REGISTRY
  ↓
GRANT
  ↓
WORKER
```

The system should track:

- skill ID
- version
- enabled/disabled
- eligible agents
- assignment/grant
- usage where useful

---

# 14. API / Secrets Architecture

This is security-critical.

Workers MUST NOT receive raw provider secrets.

Correct flow:

```
WORKER
  ↓
request_api_access(provider)
  ↓
API / SECRETS AGENT
  ↓
CREDENTIAL VAULT
  ↓
QUOTA / BUDGET CHECK
  ↓
SCOPED ACCESS / SERVER PROXY
  ↓
PROVIDER
```

Store metadata and references, not plaintext keys.

The browser must never receive provider secrets.

---

# 15. Provider Abstraction

Use a provider registry rather than hardcoding one AI model.

Potential providers:

- OpenAI
- Google Gemini
- Anthropic
- Image generation
- Video generation

Use a provider abstraction similar to:

```ts
interface AIProvider {
  id: string;
  generateText(input: unknown): Promise<unknown>;
  generateStructuredOutput(input: unknown): Promise<unknown>;
}
```

The runtime can route expensive reasoning to a stronger model and simple tasks to cheaper/local models.

---

# 16. Cost Controller

Every provider request should be accounted for.

Flow:

```
TASK
 ↓
COST ESTIMATE
 ↓
BUDGET CHECK
 ↓
PROVIDER REQUEST
 ↓
ACTUAL USAGE
 ↓
CREDIT LEDGER
```

Record:

- agent
- provider
- task
- operation
- estimated cost
- actual cost when available
- timestamp
- status

Avoid:

- runaway retries
- infinite loops
- duplicate LLM calls
- unnecessary polling
- expensive models for deterministic visual behavior

---

# 17. AI Runtime vs Deterministic Runtime

Use AI only where reasoning is necessary.

## AI-heavy

- Manager reasoning
- Planning
- Research
- Complex coding
- QA reasoning
- Repair reasoning
- User communication generation

## Deterministic

- camera movement
- 3D rendering
- employee walking
- sitting/standing
- animation playback
- state transitions
- interpolation
- database synchronization
- task counters
- HUD updates
- navigation
- asset loading

Do not call an LLM every time an employee walks, sits or types.

---

# 18. 3D Office Structure

```
OfficeWorld
├── Building
│   ├── Floor
│   ├── Walls
│   ├── Corridors
│   ├── Doors
│   └── Windows
│
├── Departments
│   ├── Executive
│   ├── Engineering
│   ├── Research
│   ├── Creative
│   ├── Business
│   ├── Quality
│   └── Operations
│
├── Workstations
│   ├── Desk
│   ├── Chair
│   ├── Monitor
│   ├── Keyboard
│   └── Laptop
│
├── Employees
├── CollaborationAreas
├── MeetingRooms
├── Props
├── Lighting
└── Environment
```

The visual style is a premium miniature corporate-office scene inspired by the supplied reference video:

- top-down/isometric-like view
- light architectural environment
- pastel department identities
- small realistic/stylized people
- desks and workstations
- soft shadows
- floating labels
- smooth movement
- subtle HUD

Do not build a flat CSS imitation as the final implementation.

---

# 19. 3D Character System

Use a reusable base character system.

Prefer:

```
BaseEmployee.glb
  ├── Manager
  ├── Engineer
  ├── Designer
  ├── Researcher
  ├── Marketing
  ├── QA
  ├── DevOps
  └── Operations
```

Variants may be created through:

- clothing
- hair
- colors
- accessories
- department badge
- headband
- workstation
- material variations

Do not load 50 totally unique heavy models when one optimized base can be reused.

---

# 20. Employee Data Model

Recommended client-normalized shape:

```ts
type OfficeAgent = {
  id: string;
  departmentId: string;
  name: string;
  role: string;

  status:
    | "sleeping"
    | "queued"
    | "working"
    | "walking"
    | "collaborating"
    | "waiting"
    | "blocked"
    | "completed";

  currentTaskId?: string;

  deskPosition: [number, number, number];
  targetPosition?: [number, number, number];

  animation:
    | "idle"
    | "sit"
    | "type"
    | "stand"
    | "walk"
    | "talk"
    | "think"
    | "celebrate"
    | "error";

  active: boolean;
};
```

Server state and visual state must remain conceptually separate.

---

# 21. Camera System

Camera modes:

1. Overview
2. Department focus
3. Agent focus
4. Workstation inspection

Capabilities:

- mouse-wheel zoom
- pan
- controlled orbit
- damping
- camera boundaries
- focus-to-department
- focus-to-agent
- focus-to-task
- focus-to-workstation
- reset-to-office

Create a single camera controller:

```ts
OfficeCameraController
├── overview()
├── focusDepartment(id)
├── focusAgent(id)
├── focusTask(id)
├── focusWorkstation(id)
└── reset()
```

Never allow many unrelated components to directly own camera motion.

---

# 22. Employee Navigation

Agents need deterministic navigation targets.

Example:

```
Engineering Desk 04
   ├── Engineering Hub
   ├── Meeting Room
   └── QA Room
```

Collaboration flow:

```
WORKING
  ↓
STAND
  ↓
WALK
  ↓
COLLABORATION AREA
  ↓
TALK / WORK
  ↓
WALK BACK
  ↓
SIT
  ↓
WORKING
```

Do not randomly move employees.

Movement must be caused by task/handoff/collaboration state.

---

# 23. Animation System

Required clips/behaviors:

- idle
- sitting
- typing
- standing
- walking
- talking
- thinking
- looking at screen
- celebrating
- error/blocked

Use AnimationMixer for GLTF clips.

Transitions should crossfade instead of snapping.

Use procedural animation only where it makes sense.

---

# 24. Agent Visual State Rules

## Sleeping

- seated
- subtle idle
- no aggressive movement
- no expensive animation

## Working

- active headband
- typing / screen interaction
- focused posture

## Walking

- path movement
- walking animation
- target destination

## Collaborating

- meet in collaboration area
- face relevant participants
- talking / working animation

## Blocked

- clear but subtle blocked indicator
- no fake progress

## Completed

- finish action
- return to desk
- transition to sleeping

---

# 25. Headband System

The headband is the visual "active employee" indicator.

- Sleeping: inactive
- Working: active
- Collaborating: active
- Blocked: warning state
- Critical: alert state

Keep the visual treatment subtle and professional.

---

# 26. Laptop / Workstation Inspection

When the camera is close to an employee, the workstation should become readable.

Examples:

### Frontend

```
components/
app/
styles/
tests/
```

### Research

```
Sources
Findings
Confidence
References
```

### QA

```
TEST RUN
128 passed
3 failed
```

### Marketing

```
Campaign
CTR
Audience
Content
```

These are visual representations, not a place to render actual secrets.

---

# 27. Office HUD

The 3D world remains primary.

Minimal HUD:

- company name
- live indicator
- active agents
- sleeping agents
- active tasks
- completed tasks
- cost/credits
- system health
- selected employee
- notifications

Do not cover the scene with dashboard cards.

---

# 28. Employee Inspector

When an employee is selected:

- Name
- Role
- Department
- Status
- Current task
- Progress
- Current activity
- Dependencies
- Recent handoffs
- Latest artifact
- API usage
- Location

The panel should be compact and visually consistent with the miniature-office style.

---

# 29. Department Interaction

Click department:

1. Highlight department.
2. Fly camera to department.
3. Show department name.
4. Show active employees.
5. Show sleeping employees.
6. Show active tasks.
7. Show department activity.

---

# 30. Real-Time Event System

Normalized event examples:

- agent_awakened
- agent_started_task
- agent_sleeping
- agent_completed
- agent_failed
- agent_blocked
- agent_walk_started
- agent_collaboration_started
- handoff_created
- artifact_created
- qa_failed
- repair_started
- provider_exhausted
- approval_requested
- user_notified
- deployment_completed

Events should be usable by:

- backend
- monitoring
- 3D visualization
- notifications
- audit logging

---

# 31. Realtime / Polling

Use Supabase Realtime where practical.

Suggested channels:

- `office:agents`
- `office:tasks`
- `office:handoffs`
- `office:notifications`
- `office:events`

Polling is an acceptable fallback during early development.

The client should have one normalized OfficeStateProvider rather than one backend request per employee.

---

# 32. Existing Backend Tables to Preserve

Where already implemented, preserve and reuse:

- `office_departments`
- `office_agents`
- `office_tasks`
- `office_task_dependencies`
- `office_handoffs`
- `office_artifacts`
- `office_skills`
- `office_agent_skills`
- `office_api_providers`
- `office_api_credentials`
- `office_credit_ledger`
- `office_approvals`
- `office_notifications`
- `office_events`

Runtime tables:

- `agent_conversations`
- `agent_message_queue`
- `agent_messages`
- `agent_memories`
- `conversation_memory_reads`
- `standing_instructions`
- `agent_subagent_runs`
- `agent_subagent_messages`
- `remote_agents`
- `remote_agent_outbound_queue`
- `agent_pairing_invites`
- `agent_recurring_jobs`
- `agent_scheduled_followups`

Do not duplicate these systems without a clear migration reason.

---

# 33. Database Rules

The database/backend is authoritative for:

- task completion
- agent permissions
- API quota
- cost
- approvals
- credentials
- artifacts
- ownership
- state transitions that matter to business logic

The browser is NOT authoritative.

Use RLS/authorization appropriately.

---

# 34. Security Architecture

## Never expose:

- OpenAI secret keys
- Gemini secret keys
- Anthropic secret keys
- Supabase secret key
- GitHub PAT
- Vercel deployment token
- Composio master key
- WhatsApp access token
- Telegram bot token
- Twilio auth token
- email provider private keys

## Never store secrets in:

- React components
- public JavaScript
- `NEXT_PUBLIC_*` variables
- localStorage
- sessionStorage
- Git history
- public artifacts
- 3D assets
- laptop mockups

Provider access should be server-side and brokered.

---

# 35. Environment Variables

A local `.env.local` may include:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

SUPABASE_SECRET_KEY=

OPENAI_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
ANTHROPIC_API_KEY=

COMPOSIO_API_KEY=

RESEND_API_KEY=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
TELEGRAM_BOT_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

VERCEL_TOKEN=
GITHUB_TOKEN=
```

Only define variables for capabilities that are actually enabled.

Never commit secrets.

Maintain a safe `.env.example` with variable names only.

---

# 36. API Provider Strategy

The system should support a provider matrix.

Example:

| Capability | Preferred provider | Fallback |
|---|---|---|
| Manager reasoning | strongest available reasoning model | secondary LLM |
| Fast classification | cheaper model | local model |
| Research | web/search-enabled model/tool | fallback search |
| Image | image provider | secondary |
| Video | video provider | secondary |
| Code generation | coding model / agent runtime | secondary |

The Cost Controller chooses an appropriate model based on:

- task importance
- budget
- latency
- quota
- context size
- quality requirement

---

# 37. 3D Asset Pipeline

Preferred:

```
BLENDER
  ↓
GLB / GLTF
  ↓
Optimize
  ↓
Compress
  ↓
Validate
  ↓
WEB
  ↓
R3F / Three.js
```

Use:

- reusable models
- compressed textures
- optimized geometry
- animation clips
- caching

Avoid large raw FBX/OBJ runtime assets where GLB is practical.

---

# 38. Repository Structure

Start from the repository state that exists at implementation time. Do not blindly copy this tree.

Suggested target:

```
OFFICE/
├── app/
├── pages/
├── components/
│   ├── office3d/
│   │   ├── OfficeWorld.tsx
│   │   ├── Building.tsx
│   │   ├── Department.tsx
│   │   ├── Desk.tsx
│   │   ├── Workstation.tsx
│   │   ├── Employee.tsx
│   │   ├── EmployeeAnimator.tsx
│   │   ├── EmployeeNavigation.tsx
│   │   ├── CollaborationArea.tsx
│   │   ├── OfficeLighting.tsx
│   │   ├── OfficeEnvironment.tsx
│   │   └── AssetLoader.tsx
│   │
│   ├── office-ui/
│   │   ├── OfficeHUD.tsx
│   │   ├── AgentInspector.tsx
│   │   ├── DepartmentInspector.tsx
│   │   ├── TaskInspector.tsx
│   │   ├── NotificationCenter.tsx
│   │   └── CommandBar.tsx
│   │
│   └── camera/
│       ├── OfficeCameraController.ts
│       └── CameraTargets.ts
│
├── helpers/
│   ├── agentTools.ts
│   ├── agentToolExecutor.ts
│   ├── agentSubagentTools.ts
│   ├── agentSubagentUtils.ts
│   ├── agentTurnStep.ts
│   ├── agentSystemInstructions.ts
│   ├── realtimeChannels.ts
│   └── realtimePublish.ts
│
├── endpoints/
│   ├── messages/
│   ├── agent-api/
│   ├── office/
│   └── realtime/
│
├── lib/
│   ├── ai/
│   ├── providers/
│   ├── auth/
│   ├── tasks/
│   ├── artifacts/
│   └── secrets/
│
├── public/
│   └── assets/
│       └── 3d/
│           ├── building/
│           ├── characters/
│           ├── furniture/
│           ├── electronics/
│           └── props/
│
├── supabase/
│   └── migrations/
│
├── BUILD_PLAN.md
├── AGENTS.md
└── README.md
```

Only create files that the actual framework requires.

---

# 39. State Architecture

Separate:

## Server state

- agents
- tasks
- dependencies
- handoffs
- artifacts
- events
- notifications
- providers
- credits

## UI state

- selected agent
- selected department
- selected task
- inspector open
- camera mode
- zoom
- filters

## 3D runtime state

- agent world position
- target position
- animation state
- path state
- camera interpolation

Do not mix all state into one giant store.

---

# 40. Performance Requirements

Target smooth desktop interaction.

Optimize:

- draw calls
- geometry
- textures
- shadows
- animation updates
- React renders
- asset loading
- memory
- network transfer
- model reuse

Rules:

- no React setState every frame
- no database request per agent
- no duplicate full GLB per employee
- no expensive animation for sleeping employees
- lazy load detail where possible
- use LOD for large scenes
- use instancing for repeated props
- cache reusable models
- cap device pixel ratio when appropriate

Test at:

- 10 agents
- 25 agents
- 50 agents
- 100 agents

---

# 41. Visual Detail Levels

At overview distance:

- building
- departments
- activity
- signs

At medium distance:

- desks
- people
- rooms
- collaboration

At close distance:

- employee
- workstation
- laptop
- activity

The scene should increase perceived detail as the user zooms in.

---

# 42. Accessibility / Reduced Motion

Implement:

- keyboard navigation where practical
- readable side panels
- accessible labels
- reduced-motion mode
- non-3D fallback information
- selected-state clarity
- sufficient contrast

Motion must not be the only way to communicate important state.

---

# 43. Build Phases

## Phase 0 — Repository Audit

Goal: understand the starting point.

Tasks:

- inspect repository
- identify framework
- inspect existing code
- inspect package manager
- inspect Supabase integration
- inspect agent runtime
- inspect environment requirements
- inspect existing routes/endpoints
- document constraints

Output:

- architecture map
- risk list
- migration plan

**Exit criteria:** no code is rewritten blindly.

---

## Phase 1 — Project Foundation

Create or verify:

- package configuration
- TypeScript
- lint
- formatting
- testing
- `.env.example`
- basic app shell

**Exit criteria:**

- install succeeds
- dev server works
- production build works
- typecheck passes

---

## Phase 2 — 3D Engine

Implement:

- R3F Canvas
- Three.js scene
- camera
- controls
- lighting
- floor
- simple building shell

**Exit criteria:**

- office renders
- zoom works
- pan works
- no console errors
- responsive resize works

---

## Phase 3 — Corporate Building

Implement:

- departments
- walls
- corridors
- desks
- chairs
- monitors
- meeting rooms
- department signs
- lighting and materials

**Exit criteria:** miniature office clearly readable from overview.

---

## Phase 4 — First Employee

Implement exactly one high-quality employee.

Features:

- GLB loader
- idle
- sitting
- typing
- click selection
- camera focus
- inspector

Do not scale to dozens until this employee is stable.

**Exit criteria:** clicking employee smoothly moves camera and reveals workstation.

---

## Phase 5 — Employee Framework

Create:

- AgentRegistry
- AgentCharacter
- AgentAnimator
- AgentNavigation
- AgentStateMapper

Render employees from data.

**Exit criteria:** multiple employees use the same reusable component architecture.

---

## Phase 6 — Backend Synchronization

Connect the real office state.

Use:

- office_agents
- office_tasks
- office_handoffs
- office_artifacts
- office_events
- notifications

**Exit criteria:** changing real backend state changes the 3D office.

---

## Phase 7 — Movement

Implement:

- desk targets
- collaboration points
- meeting areas
- deterministic navigation
- standing
- walking
- sitting

**Exit criteria:** employees move only for meaningful reasons.

---

## Phase 8 — Manager Integration

Implement the user command flow:

```
USER
 ↓
MANAGER
 ↓
TASK
 ↓
DELEGATION
 ↓
WORKER
 ↓
RESULT
 ↓
MANAGER
```

**Exit criteria:** submit one real user request and observe the actual company execution in 3D.

---

## Phase 9 — Task Graph / Handoffs

Implement:

- dependencies
- handoffs
- artifact transfer
- task inspector
- collaboration visualization

**Exit criteria:** dependency-driven multi-agent workflow works end-to-end.

---

## Phase 10 — QA / Repair

Implement:

- QA activation
- failure state
- repair activation
- retry
- escalation

**Exit criteria:** intentionally inject a failure and verify the full repair loop.

---

## Phase 11 — API / Secrets / Cost

Implement:

- provider registry
- API broker
- secret isolation
- budget checks
- credit ledger
- fallback provider strategy

**Exit criteria:** worker can use a provider without seeing the raw credential.

---

## Phase 12 — Realtime

Implement:

- realtime channels
- live agent updates
- task updates
- notification updates
- event stream

**Exit criteria:** changes appear in the office without full-page refresh.

---

## Phase 13 — Advanced Animation

Add:

- smooth crossfades
- working motions
- walking
- talking
- collaboration
- subtle idle loops
- manager-specific behaviors

**Exit criteria:** no visible animation snapping for normal flows.

---

## Phase 14 — Performance

Benchmark:

- 10 agents
- 25 agents
- 50 agents
- 100 agents

Optimize:

- models
- draw calls
- LOD
- instancing
- shadows
- animation update rate
- React renders
- asset caching

**Exit criteria:** stable interaction at an acceptable frame rate on the development laptop.

---

## Phase 15 — Final Visual Polish

Only now invest in:

- refined architecture
- materials
- lighting
- shadows
- props
- department identity
- HUD polish
- camera easing
- labels
- transitions

**Exit criteria:** office looks intentional and premium rather than like a technical prototype.

---

## Phase 16 — Production Readiness

Verify:

- auth
- database policies
- API security
- no leaked secrets
- error boundaries
- loading states
- empty states
- mobile fallback
- build
- deployment
- monitoring

---

# 44. Testing Strategy

## Unit tests

Test:

- state mapping
- task dependencies
- cost calculation
- provider routing
- permissions
- handoff creation

## Integration tests

Test:

- user → manager
- manager → worker
- worker → artifact
- worker → QA
- QA → repair
- repair → QA
- manager → user

## 3D interaction tests

Test:

- camera focus
- zoom
- pan
- selection
- deselection
- department focus
- employee inspector

## Performance tests

Measure:

- FPS
- memory
- draw calls
- GPU usage
- load time

---

# 45. Failure Scenarios to Test

1. AI provider quota exhausted.
2. Provider unavailable.
3. Worker fails.
4. Worker times out.
5. QA fails.
6. Repair fails.
7. Dependency never completes.
8. Manager interrupted by user.
9. User cancels a task.
10. Realtime disconnects.
11. Asset fails to load.
12. WebGL unavailable.
13. Slow device.
14. Browser tab resumes after sleep.
15. Invalid agent ID.
16. Duplicate delegation.
17. Duplicate artifact.
18. Infinite retry attempt.

---

# 46. User Interruption Rules

If a user sends a new instruction while a workflow is running:

1. Manager receives the new instruction.
2. Manager evaluates priority.
3. Current tasks remain durable.
4. Relevant tasks can pause/cancel/reprioritize.
5. New tasks are created.
6. Employees change only as directed by real state.

Never fake an interruption merely for visual effect.

---

# 47. Notification System

Examples:

- Agent awakened.
- Worker completed.
- QA failed.
- Repair started.
- API quota low.
- Provider exhausted.
- Approval required.
- Deployment succeeded.
- Task blocked.
- User action required.

Notifications should originate from backend/runtime events.

---

# 48. Communication Agent

External communication is optional and can be added after the core system.

Potential channels:

- in-app
- email
- WhatsApp
- Telegram
- push
- SMS/voice where appropriate

Workers should not independently gain arbitrary external communication capabilities.

---

# 49. Local Development

Expected developer loop:

```
git pull
npm install
npm run dev

# build
npm run build

# typecheck
npm run typecheck

# lint
npm run lint

# tests
npm test
```

Use the actual repository scripts once established.

Do not invent package scripts without checking the project first.

---

# 50. AI Coding Agent Rules

When Codex or Claude Code works on this repository:

### Before coding

- inspect repository
- inspect current architecture
- inspect installed dependencies
- inspect existing environment variables
- inspect database assumptions
- inspect working endpoints
- inspect docs

### During coding

- implement one logical phase at a time
- reuse existing systems
- avoid unnecessary rewrites
- maintain type safety
- keep security boundaries intact
- keep components focused
- prefer deterministic systems over unnecessary AI calls

### After coding

Run:

- typecheck
- lint
- build
- tests

Then inspect:

- browser console
- network errors
- runtime errors
- 3D asset errors
- Supabase errors

Fix failures before moving on.

---

# 51. What the AI Must NOT Do

Do not:

- replace the whole app because the UI needs 3D
- create fake hardcoded employees for production
- create fake task completion
- expose API keys
- hardcode credentials
- create one database connection per component
- create one model file per identical employee
- update React state every animation frame
- add an LLM call for trivial animation
- introduce unnecessary libraries
- delete functioning backend features without migration
- assume the existing schema is wrong without inspection
- mark a milestone complete without testing it

---

# 52. Git Strategy

Use small, meaningful commits.

Recommended:

```
feat: initialize office 3d foundation
feat: add corporate building scene
feat: add reusable employee system
feat: connect office agents to 3d state
feat: add task-driven movement
feat: integrate manager delegation
feat: add task graph visualization
feat: add qa and repair visualization
feat: add provider broker
perf: optimize office rendering
fix: resolve agent navigation state
docs: update implementation notes
```

Do not put everything into one giant commit.

---

# 53. Definition of Done

The project is considered a strong V1 when:

- The building renders as a real 3D environment.
- Departments are physically represented.
- Employees are real 3D characters.
- Camera zoom/pan/focus work smoothly.
- Clicking an employee focuses them.
- Employee state comes from the backend.
- Working agents animate.
- Sleeping agents remain mostly inactive.
- Agents can walk between meaningful locations.
- Collaboration is visualized.
- Manager can receive user requests.
- Manager can delegate to workers.
- Tasks have dependencies.
- Handoffs are durable.
- Artifacts are durable.
- QA can fail work.
- Repair can retry work.
- API access is brokered.
- Secrets never reach the browser.
- Costs are tracked.
- Realtime/polling synchronizes the office.
- 3D performance is acceptable with many agents.
- Production build works.

---

# 54. V1 Target

Prioritize this exact experience first:

```
OPEN OFFICE
   ↓
SEE WHO IS ACTIVE
   ↓
ZOOM INTO DEPARTMENT
   ↓
CLICK EMPLOYEE
   ↓
CAMERA FLIES TO EMPLOYEE
   ↓
SEE LAPTOP + WORK
   ↓
SUBMIT USER TASK
   ↓
MANAGER WAKES
   ↓
EMPLOYEES WAKE
   ↓
EMPLOYEES WORK
   ↓
EMPLOYEES COLLABORATE
   ↓
QA
   ↓
MANAGER
   ↓
FINAL RESULT
```

If this loop works beautifully, the product already has the core magic.

---

# 55. V2 Ideas

Only after V1 is stable:

- richer procedural navigation
- meetings
- conference room scenes
- voice communication
- employee conversations
- dynamic office expansion
- multiple floors
- elevator/stairs
- company calendar
- live activity timeline
- replay mode
- task replay
- analytics
- department performance
- cost visualization
- agent personality visuals
- office customization
- user avatars
- multiple companies/workspaces
- remote agents
- scheduling
- external integrations

---

# 56. Cost Philosophy

This is a personal project, not a commercial client build.

Target development cost: **as close to ₹0 as practical**.

Prefer:

- open-source libraries
- free tiers
- existing AI-tool subscriptions/allowances
- Blender
- free 3D assets
- procedural geometry
- local development
- reusable assets
- efficient model usage

Avoid buying premium assets/services during V1 unless absolutely necessary.

AI runtime costs must be controlled through the Cost Controller.

Do not spend expensive AI calls on deterministic behavior.

---

# 57. Final Architecture Rule

The product must maintain this invariant:

```
AI DECISION
    ↓
TASK / EVENT
    ↓
DATABASE / RUNTIME
    ↓
3D VISUALIZATION
```

Never:

```
3D ANIMATION
    ↓
pretend the AI did something
```

The office must visualize what the company is actually doing.

---

# 58. Final Product Statement

The AI Corporate Office OS is:

**A real autonomous multi-agent operating system represented as a living 3D corporate headquarters.**

The user does not merely read that agents are working.

The user can **see them work**.

They can watch:

- the Manager plan,
- engineers build,
- researchers research,
- designers create,
- QA test,
- Repair fix,
- agents collaborate,
- tasks move,
- artifacts change hands,
- APIs get consumed,
- and the company return to sleep when the work is finished.

That is the target.

**Build the software first. Make the office beautiful second. Make the office truthful always.**


---

# 59. Codex / GPT-6 Astra Execution Strategy

Codex is the primary implementation agent for this repository.

The project should be built as a sequence of verified engineering milestones, not as one giant generation request.

## Operating loop

```
UNDERSTAND
   ↓
PLAN
   ↓
IMPLEMENT
   ↓
RUN
   ↓
INSPECT
   ↓
TEST
   ↓
FIX
   ↓
VERIFY
   ↓
COMMIT
```

For large changes, begin with a planning pass and then switch to implementation. Keep tasks scoped to a coherent unit of work, while allowing Codex to continue through testing and repair instead of stopping after the first code edit.

## Codex repository context

The permanent repository instruction file is:

```
AGENTS.md
```

It contains rules that apply throughout the repository.

Do not duplicate the entire architecture inside AGENTS.md. Keep architecture detail in BUILD_PLAN.md and point Codex to the specific section relevant to the task.

## Task prompts

Prompts should look like engineering issues.

A good prompt includes:

- goal
- relevant file paths
- current behavior
- desired behavior
- constraints
- acceptance criteria
- test requirements

Example:

```
Implement Phase 4 of BUILD_PLAN.md.

Goal:
Add one production-quality employee character.

Relevant areas:
- components/office3d/
- camera/
- public/assets/3d/characters/

Requirements:
- load one GLB
- support idle/sit/type
- click selection
- smooth camera focus
- employee inspector
- preserve existing backend behavior

Acceptance:
- employee renders correctly
- camera focus works
- inspector shows real agent data
- typecheck/build pass
- no console errors
```

## Context discipline

Do not force Codex to read every documentation file for every task.

Read the smallest relevant set:

- BUILD_PLAN.md for architecture and milestones
- 3D_ASSET_LIBRARY.md for asset work
- AGENTS.md for repository rules
- source files involved in the requested change
- migrations only for database work
- deployment documentation only for deployment work

## Decision boundaries

Codex may make normal implementation decisions that are consistent with the architecture.

Escalate to the user only when the decision materially changes:

- product behavior
- security model
- database contract
- provider/credential policy
- irreversible data behavior
- major UX direction
- asset licensing choice

Do not ask for permission for routine safe edits, tests, refactors directly required by the requested change, or disposable local debugging.

## Best-of-N thinking

For high-impact design decisions, especially:

- 3D scene architecture
- camera architecture
- employee rendering strategy
- asset optimization strategy
- state synchronization architecture

it is acceptable to explore multiple implementation approaches, compare them, then select the simplest robust solution.

Do not create parallel architecture branches unless there is a concrete reason.

---

# 60. 3D Warehouse Asset Intake — User-Provided OBJ

The user has an Office Warehouse 3D model in OBJ format.

The exact raw files have not yet been committed to the repository.

When the OBJ package is provided:

## Step 1 — Preserve source

Store the original files outside the production runtime directory:

```
assets/source/warehouse/
```

Keep:

- .obj
- .mtl
- textures
- any companion files

Do not alter the original source files.

## Step 2 — Inspect

Use Blender to determine:

- object hierarchy
- materials
- texture references
- dimensions
- unit scale
- origin/pivot
- triangle count
- duplicated geometry
- hidden geometry
- interior/exterior separation
- floor/wall structure
- possible walkable surfaces

## Step 3 — Clean

Remove:

- invisible junk geometry
- duplicate meshes
- unused materials
- unnecessary hidden objects
- excessive detail that provides no visible value

Preserve architectural features that contribute to the office experience.

## Step 4 — Normalize

Standardize:

- world scale
- orientation
- origin
- material conventions
- texture paths

## Step 5 — Divide the building

Where useful, split the warehouse into logical runtime assets:

```
office-shell.glb
office-floor.glb
office-walls.glb
office-doors.glb
office-details.glb
```

Do not split objects merely for the sake of splitting them. Split when it improves:

- loading
- culling
- editing
- navigation
- streaming
- maintainability

## Step 6 — Add simulation metadata

The Blender source scene should eventually contain named empty/marker objects for:

- department centers
- agent desks
- workstation anchors
- collaboration hubs
- meeting rooms
- camera focus points
- entrances
- exits
- navigation waypoints

Example naming:

```
DEPT_EXECUTIVE
DEPT_ENGINEERING
DESK_ENGINEERING_01
DESK_ENGINEERING_02
HUB_ENGINEERING
MEETING_ROOM_01
CAMERA_OVERVIEW
CAMERA_ENGINEERING
```

The application should be able to map these stable names to runtime IDs.

## Step 7 — Export

Export optimized GLB/glTF files.

Validate:

- scale
- materials
- textures
- normals
- pivots
- file sizes
- WebGL compatibility

## Step 8 — Register

Add the resulting files to the 3D asset registry.

Example:

```ts
export const officeAssets = {
  buildingShell: "/assets/3d/building/office-shell.glb",
  floor: "/assets/3d/building/office-floor.glb",
};
```

Never hardcode the same asset path in dozens of components.

---

# 61. Blender-to-R3F Contract

The Blender scene and runtime must share a predictable contract.

## Coordinate contract

Choose one project-wide convention and never silently change it.

At import time, validate:

- up axis
- forward direction
- meters/units
- character height
- floor elevation

## Named marker contract

Blender markers become application anchors.

Example:

```
DESK_ENGINEERING_01
        ↓
agent home position

HUB_ENGINEERING
        ↓
collaboration destination

CAMERA_ENGINEERING
        ↓
camera target
```

## Asset identity contract

Each production asset gets a stable ID.

Example:

```
building.office.v1
character.employee.base.v1
prop.desk.standard.v1
prop.laptop.standard.v1
```

Asset IDs should not be tied to arbitrary filenames when possible.

---

# 62. Agent-to-World Mapping

The database stores the logical agent.

The 3D layer stores the physical representation.

```
office_agents.id
        ↓
agentWorldRegistry
        ↓
desk anchor
        ↓
current world transform
        ↓
animation state
```

Never store rapidly-changing frame-by-frame visual coordinates in the primary business database unless there is a real product requirement.

Logical location can be durable:

```
WORKING_AT_DESK
WALKING_TO_ENGINEERING_HUB
COLLABORATING_IN_ROOM_01
```

The renderer interpolates the physical transform locally.

---

# 63. Reconciliation Model

Because the backend is authoritative, the 3D client needs reconciliation.

Example:

```
BACKEND:
agent = WORKING
target = DESK_04

3D:
agent walking

↓

new state arrives:
agent = COLLABORATING
target = HUB_ENGINEERING

↓

cancel obsolete movement
blend to new movement
continue from current transform
```

Never teleport an employee unnecessarily just because a new state event arrived.

Prefer smooth correction.

---

# 64. Realtime Event Contract

Each event should have enough information to reconcile state.

Suggested shape:

```ts
type OfficeEvent = {
  id: string;
  type: string;
  timestamp: string;
  agentId?: string;
  taskId?: string;
  sourceAgentId?: string;
  targetAgentId?: string;
  payload: Record<string, unknown>;
};
```

The event stream communicates what changed.

The normalized state remains the authoritative snapshot.

Do not build a system that depends entirely on receiving every historical event perfectly.

The client must be able to resynchronize from the current snapshot after reconnect.

---

# 65. 3D Selection and Camera Contract

Selection state:

```
none
department
agent
task
workstation
```

Only one primary focus target should control the camera at a time.

When an employee is selected:

1. resolve employee logical location
2. resolve world anchor
3. compute safe camera position
4. animate camera
5. preserve readable framing
6. open inspector
7. allow user to exit focus without losing overall context

Avoid camera motion that:

- clips through walls
- enters geometry
- loses the selected target
- moves outside building bounds

---

# 66. Agent Navigation Architecture

Start with authored navigation points.

Do not immediately build a complex general-purpose pathfinding engine.

V1:

```
desk
hub
meeting room
qa room
department entrance
```

Use known routes between these nodes.

Later, if needed:

- graph navigation
- obstacle avoidance
- navmesh
- dynamic routing

This staged approach reduces complexity while preserving the visual experience.

---

# 67. Character Rendering Budget

Use a quality budget by distance.

## Far

- low LOD
- simple animation
- minimal materials
- no unnecessary facial detail

## Medium

- standard character
- workstation visible
- normal animation

## Close

- highest available character detail
- laptop/monitor detail
- inspector
- detailed activity

The user should feel that zooming reveals detail rather than merely enlarging the same low-quality model.

---

# 68. Large-Agent Scaling Strategy

Target:

```
10 → 25 → 50 → 100
```

Do not optimize for 100 agents before 10 agents are correct.

For many agents:

- reuse geometry
- reuse materials
- reuse animation clips
- use LOD
- pause invisible/low-priority animation
- minimize React reconciliation
- avoid duplicate loaders
- cache assets
- batch repeated props

---

# 69. Observability

The system should expose developer diagnostics without polluting the production UI.

Developer diagnostics may include:

- FPS
- draw calls
- triangle count
- texture count
- loaded asset count
- active animated agents
- current camera target
- realtime connection status
- office state version
- task synchronization status

A development-only debug panel is acceptable.

---

# 70. Security / Secrets Final Rule

The project should distinguish three classes:

## Browser-safe configuration

Example:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Only expose values intentionally designed for client use.

## Server secrets

Examples:

```
SUPABASE_SECRET_KEY
OPENAI_API_KEY
GOOGLE_GENERATIVE_AI_API_KEY
ANTHROPIC_API_KEY
COMPOSIO_API_KEY
```

Server only.

## Deployment/integration credentials

Examples:

```
GITHUB_TOKEN
VERCEL_TOKEN
WHATSAPP_ACCESS_TOKEN
TELEGRAM_BOT_TOKEN
TWILIO_AUTH_TOKEN
```

Only in the narrow runtime/service that needs them.

Never give a worker agent the raw secret when a server-side broker can perform the operation.

---

# 71. Build Order Priority

The order below is intentional.

```
1. Repository audit
2. 3D foundation
3. Warehouse ingestion
4. Building metadata / anchors
5. One character
6. Camera focus
7. Workstation inspection
8. Reusable employee system
9. Real agent state
10. Movement
11. Manager integration
12. Task graph
13. Handoffs
14. QA / Repair
15. API / Secrets / Cost
16. Realtime
17. Performance
18. Visual polish
19. Deployment
```

Do not reverse this order by polishing dozens of characters before proving the runtime.

---

# 72. Milestone Evidence

Every milestone should leave evidence.

Examples:

### 3D foundation

- screenshot/video of office render
- build/typecheck result

### First employee

- employee selected
- camera focused
- inspector visible

### Real state

- backend state changed
- 3D state changed correspondingly

### Delegation

- Manager task exists
- worker wakes
- task executes
- worker returns to sleep

### QA/Repair

- forced failure
- repair execution
- QA pass

### Performance

- documented agent counts
- observed FPS
- asset size summary

Avoid marking phases complete from code inspection alone when behavior can be demonstrated.

---

# 73. First Codex Task

The first Codex task for this repository should NOT be "build the whole app."

Use:

```
Inspect the OFFICE repository and produce a concrete implementation plan for Phase 0 and Phase 1 of BUILD_PLAN.md.

Do not change application code yet.

Inspect:
- repository structure
- current dependencies
- existing source files
- Git state
- environment assumptions
- BUILD_PLAN.md
- AGENTS.md
- 3D_ASSET_LIBRARY.md

Determine:
1. current project framework
2. package manager
3. current app entry point
4. existing backend/runtime state
5. existing database integration
6. missing foundation
7. exact files that should be created/modified for Phase 1
8. test/build commands actually available

Do not invent files or scripts.

Return:
- current architecture summary
- risks
- Phase 1 implementation plan
- exact commands to validate the work
- questions only if a real product decision is unavoidable
```

After reviewing that plan, the next Codex task should implement only the agreed Phase 1.

---

# 74. Rule for the Warehouse Files

When the user uploads the OBJ/MTL/textures:

**Do not immediately code around them.**

First inspect and normalize them.

The asset conversion should be a documented, repeatable pipeline so that the final office can be rebuilt from source instead of depending on one manually edited binary.

---

# 75. Final Codex Doctrine

Codex is the implementation engine.

The repository documents are the architectural memory.

The database is the business truth.

The 3D world is the physical visualization.

The Manager is the company's responsible owner.

Employees are specialized workers.

Events connect business reality to physical activity.

The objective is not merely to generate a beautiful 3D scene.

The objective is to build a **working autonomous AI company that happens to be visible as a 3D office.**


---

# 76. Architecture Decision Record — Vite Foundation

**Status:** APPROVED for Phase 1

The existing `MYOFFICE` application is a React + Vite project with reusable R3F/Three.js prototype work.

For the first implementation milestone:

- preserve Vite
- repair the current foundation
- mount the existing 3D prototype
- avoid a premature Next.js migration
- establish a clean frontend boundary before adding protected backend/runtime functionality

A framework migration may be evaluated later when server-only execution becomes necessary.

**Reason:** the project already has working Vite/R3F dependencies and reusable 3D components. An immediate framework migration would add risk without being required to prove the core 3D office experience.

---

# 77. Phase 0 Audit Snapshot

The initial Phase 0 audit identified:

- reusable procedural 3D prototype components already exist
- the current Vite app is still mounted to the default starter screen
- no real backend/Supabase/agent runtime is implemented in the local application
- current office data is simulated and must remain isolated from production truth
- current TypeScript/build errors must be repaired before feature expansion
- Linux/Windows Node tooling needs normalization
- GitHub currently contains the canonical project documents while the application exists locally

The next implementation milestone is therefore:

**Git import baseline → native Linux dependency baseline → Phase 1 foundation repair → truthful OFFICE shell → validation → 3D scene mounting.**
