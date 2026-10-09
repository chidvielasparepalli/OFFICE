# OFFICE

The frontend foundation for the **AI Corporate Office OS**: a real multi-agent company represented by an interactive 3D office.

- Current Windows checkout: `C:\Users\chidv\OFFICE` (original Linux checkout: `/mnt/a/MYOFFICE`)
- Canonical repository: <https://github.com/chidvielasparepalli/OFFICE>
- Architecture and milestones: [BUILD_PLAN.md](BUILD_PLAN.md)
- Repository rules: [AGENTS.md](AGENTS.md)
- Asset candidates and intake rules: [3D_ASSET_LIBRARY.md](3D_ASSET_LIBRARY.md)

## Current implementation

Phase 4 interaction/navigation is implemented: exact-ID selection, truthful context, camera focus, deterministic waypoint routes and isolated development scenarios for 30 workers plus the dedicated Manager. Use `/?office=scenarios` with the development server. The [Phase 4 contract](docs/PHASE4_INTERACTIONS.md) records architecture and limitations.

The supplied red headband follows a deterministic waist pickup → head placement → faster working → removal sequence for standard workers only. The Manager never loads or wears it and uses calm seated work at normal speed. Interruptions are reversible, and workers share one accessory GLB. The [headband animation contract](assets/headband/ANIMATION.md) documents the current ownership rule and validation: 132 automated tests and 22 targeted Chromium checks pass.

The character animation foundation preserves the supplied stickman and dedicated Manager, with separate rigs, seated working loops, standing/walking and return-to-seat transitions. Development `/?workers=preview` retains animation test controls for 30 workers and one Manager. Shared resources and asset evidence are documented in [the animation report](assets/animation/README.md). No real runtime is implemented.

The application uses **React + Vite + TypeScript**. Phase 2 mounts a real React Three Fiber viewport with a procedural floor, an open-roof temporary shell, deterministic lighting, and one camera controller. The disconnected-runtime notice remains accessible HTML outside the canvas.

There is no backend, Supabase connection, real agent execution, or simulated business activity in the mounted scene. No service credentials, external models, or environment variables are required. The department, workstation, character, screen, simulation provider, and mock fixtures remain preserved and unmounted.

## Windows setup

Use **Node 24.21.0** and **npm 11.19.0**. This checkout has a checksum-verified official portable Node distribution in the ignored `.toolchain.local/` directory. Activate it for each PowerShell session:

```powershell
$env:Path = "$PWD\.toolchain.local\node-v24.21.0-win-x64;$env:Path"
node --version
npm.cmd --version
npm.cmd ci
```

On a fresh checkout, install those same versions using your Node version manager or the official Node distribution first. The portable toolchain is not committed, and the machine-wide Node installation is unchanged. On Windows, use `npm.cmd` for the commands below if PowerShell blocks `npm.ps1`. `.gitattributes` keeps text files at LF to match Prettier on both operating systems; the Phase 2 checkout normalization changed no prototype code.

## Native Linux setup

Use **Node 24.21.0** and **npm 11.19.0**. With nvm already installed:

```bash
nvm install
nvm use
node --version
npm --version
node -p 'process.platform'
npm ci
```

The expected platform is `linux`. Install dependencies within Linux; do not reuse a Windows-generated `node_modules` directory or its npm shims inside WSL. `npm ci` recreates the dependency tree from the committed lockfile. Keep separate dependency installations when using both operating systems.

The `.env.example` contains explanatory comments only. Do not add real provider credentials to frontend configuration. Vite exposes `VITE_*` values to the browser.

## Development and validation

```bash
npm ci
npm ls --depth=0
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
npm audit --audit-level=high
```

Start the development server:

```bash
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open <http://127.0.0.1:5173>. To inspect a production build:

```bash
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open <http://127.0.0.1:4173>. The preview server serves `dist`; run the build first.

`npm run format` applies Prettier formatting. Canonical architecture documents, assets, the lockfile, and generated output are excluded from automatic formatting.

## Source map

| Path                                     | Responsibility                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/main.tsx`                           | React entry point with StrictMode                                                     |
| `src/App.tsx`                            | OFFICE shell, 3D viewport, and disconnected-runtime notice                            |
| `src/App.test.tsx`                       | Shell identity, viewport boundary, no simulation/provider activity, repository access |
| `src/components/3d/OfficeWorld.tsx`      | Canvas, reset UI, focused keyboard controls, and viewport composition                 |
| `src/components/3d/OfficeBuilding.tsx`   | Procedural floor and temporary open-roof shell                                        |
| `src/components/3d/OfficeLighting.tsx`   | Hemisphere fill and one directional shadow-casting light                              |
| `src/components/3d/CameraController.tsx` | Sole camera controller; independent of OfficeContext                                  |
| `src/components/3d/officeCamera.ts`      | Shared dimensions, limits, overview framing, and pan constraints                      |
| `src/components/3d/officeCamera.test.ts` | Frustum fitting and pan-boundary regression tests                                     |
| `src/context/OfficeContext.tsx`          | Unmounted prototype simulation provider, not authoritative business state             |
| `src/data/mockOfficeData.ts`             | Synthetic prototype/test fixtures                                                     |
| `src/types/index.ts`                     | Existing prototype and camera contracts                                               |
| `vitest.config.ts`                       | Vitest with jsdom and React transforms                                                |

The production entry points and mounted 3D modules must not import the simulation provider or mock fixtures. Oxlint enforces this direct-import boundary. Shell tests isolate WebGL and verify that corrupt prototype storage does not affect startup and that the HTML shell initiates no simulation timers, storage writes, or provider requests. Actual rendering and camera interactions are verified in Chromium.

TypeScript checks the entire source tree, including the preserved prototype. Strict mode, unused-code checks, and type-only import requirements remain enabled.

## World coordinates and camera

- One world unit is one meter; **Y is up**. X runs left/right, positive Z faces the entrance, negative Z is the back wall.
- Building center, floor surface, and overview target are **`[0, 0, 0]`**.
- Floor footprint: **24 × 18 meters**, X `[-12, 12]`, Z `[-9, 9]`; slab extends down to Y `-0.3`.
- Back and left walls are **2.8 meters** tall. Front and right walls are cut down to **0.3 meters** to reveal the floor. The entrance is centered on positive Z.
- Perspective FOV: **40°**; near/far planes: **0.1 / 250**. Overview uses the direction `[26, 30, 34]`, fitting the shell to the narrower vertical/horizontal field of view with padding.
- Camera distance: **8–120 meters** from the target. Polar angle: **22.5–64.29°** from the up axis; azimuth is unrestricted. At minimum distance and maximum pitch, the camera stays above the walls.
- Pan target stays on Y `0`, within the floor footprint. Camera and target translate together at boundaries, preserving viewing angle and distance.
- Canvas resize reframes the overview to fit its new aspect ratio. These axes, units, and origin must be reused by future assets and anchors.

Drag to orbit, scroll to zoom, and right-drag to pan. Touch supports one-finger orbit and two-finger pinch/pan. Use **Reset view**, or **Space/Escape while the viewport is focused**, to restore the overview. Keyboard shortcuts do not intercept buttons or other page controls.

Drei owns control updates and disposal; CameraController applies bounds after those updates. GSAP interpolates wheel zoom and reset, and user interaction cancels a running transition. Reduced motion disables damping and uses immediate zoom/reset. The scene renders on demand, caps pixel ratio at 1.5, and stops rendering once camera motion settles. No external fonts, textures, models, or environment presets are fetched.

## Known prototype follow-ups

The unmounted prototype still needs integration work before it can represent the real office:

- consistent department-local versus world coordinates;
- monitor-screen placement and texture lifecycle;
- an actual styling pipeline for the prototype's Tailwind classes;
- lifecycle and department mapping against a future verified backend contract;
- navigation, animation, asset loading, and measured performance.

Oxlint currently reports five existing prototype warnings: four React Compiler/ref/memoization warnings in `WorkstationScreen.tsx` and one mixed-export Fast Refresh warning in `OfficeContext.tsx`. They are not disabled. React Compiler is not enabled, and neither module is mounted by the shell.

## Phase 2 verification

Verified on Windows with the pinned toolchain and Chromium 151.0.7922.34. Eleven unit tests cover the shell and camera math. Browser assertions cover visible canvas/floor/walls/lighting, overview framing, interpolated wheel zoom, zoom/pan/pitch bounds, button and focused keyboard reset, idle render suspension, reduced motion, and resize at 1440×1000, 1440×900, 390×844, and 320×740. Mobile emulation covers orbit, pinch, pan, and DPR capping. No console errors, failed requests, external requests, or simulation imports were observed in the development scene.

Final validation passed: typecheck, lint (the five existing prototype warnings), all 11 tests, formatting, production build, and `npm audit --audit-level=high` (zero vulnerabilities). Production preview was also verified in Chromium: the canvas rendered, zoom changed its pixels, reset restored the original image, mobile resize worked, and the disconnected notice remained visible. There were no console errors, failed requests, or external requests.

Local browser scripts, JSON results, and screenshots are in ignored `test-results/phase2-*` and `test-results/verify-*.mjs` files. Browser emulation is not a physical-device performance benchmark. The build includes a roughly 1.23 MB / 345 kB gzip JavaScript bundle and reports Vite's large-chunk warning; code splitting is deferred to later loading/performance work.

## Next milestone

This checkpoint stops after Phase 4 and the worker-only headband correction. Backend connections and real agents require separate approval. The warehouse floor remains a development candidate with unresolved provenance/licensing and source-scale limitations; it is included so previews work from a fresh clone, without changing its production-adoption gate.

## Phase 3 warehouse intake

The warehouse has a verified **open-office preview** at `http://127.0.0.1:5173/?warehouse=preview` while `npm run dev` is running. Only its ground slab is reused, resized to a 36 × 36 m single-level plan. Roofs, ceilings, upper floors and enclosing walls are excluded. The 4,404-byte GLB has 12 triangles and 22 named anchors; seven flat department zones provide visible organization and circulation space.

Click a department to select its context and focus the camera, then inspect its reserved workstation area. The [open-office contract](docs/OPEN_OFFICE_CONTRACT.md) defines runtime input, selection and the nine future statuses without fake employees or activity. Worker/workstation readability is now verified in the separate asset preview below. The default application preserves the Phase 2 shell; the warehouse retains its separate intake gate.

See [the intake report](assets/warehouse/README.md) for Blender measurements, source hashes, coordinate conversion, retained components, anchors, export paths, reproduction steps and remaining acceptance limits. [Third-party provenance](THIRD_PARTY_ASSETS.md) records the unresolved rights information. No employees or Phase 4 systems were added.

## Canonical worker asset phase

The supplied stickman is the canonical **normal-worker** model at 1.75 m reference height with its original atlas. **Indian Man in suit** is the dedicated 1.80 m Manager, and **Modern Desk Setup** is the canonical workstation. The desk package has no chair, so its GLB incorporates the earlier supplied chair. Both character derivatives are now rigged and animated without replacing their original meshes.

Open `http://127.0.0.1:5173/?workers=preview` during development for **30 stickman samples, one Manager and 31 shared workstations**, with direct mesh/keyboard selection and department/workstation/character focus. Controls supply labeled animation test states and explicit walk/return paths, with no runtime snapshot, tasks, costs or business activity. Production cannot enable this sample scene through the query parameter.

`OfficeCharacters.tsx` keeps six instanced desk/chair parts and uses shared-resource skeletal characters. `workerPresentation.ts` preserves supplied kinds and IDs; Managers always use their dedicated model. `src/assets/officeAssets.ts` registers distinct runtime GLBs. The old procedural `AgentCharacter` and `Workstation` remain unmounted. [The animation report](assets/animation/README.md) records rigging, reuse, state/selection contracts, validation and limits. Licenses/creator/source URLs remain unverified. No Phase 4 runtime or deployment was performed.
