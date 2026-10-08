# OFFICE

The frontend foundation for the **AI Corporate Office OS**: a real multi-agent company represented by an interactive 3D office.

- Application source: `/mnt/a/MYOFFICE`
- Canonical repository: <https://github.com/chidvielasparepalli/OFFICE>
- Architecture and milestones: [BUILD_PLAN.md](BUILD_PLAN.md)
- Repository rules: [AGENTS.md](AGENTS.md)
- Asset candidates and intake rules: [3D_ASSET_LIBRARY.md](3D_ASSET_LIBRARY.md)

## Current implementation

The application uses **React + Vite + TypeScript**. Its minimal shell identifies the project, explicitly reports that the agent runtime is not connected, and provides an inventory of the preserved 3D prototype.

There is no backend, Supabase connection, real agent execution, or mounted 3D scene yet. No service credentials or environment variables are required.

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

| Path                            | Responsibility                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `src/main.tsx`                  | React entry point with StrictMode                                                     |
| `src/App.tsx`                   | Truthful, disconnected OFFICE shell                                                   |
| `src/App.test.tsx`              | Shell identity, no simulated activity/provider requests, and repository/source access |
| `src/components/3d/`            | Preserved department, workstation, character, screen, and camera components           |
| `src/context/OfficeContext.tsx` | Unmounted prototype simulation provider, not authoritative business state             |
| `src/data/mockOfficeData.ts`    | Synthetic prototype/test fixtures                                                     |
| `src/types/index.ts`            | Existing prototype and camera contracts                                               |
| `vitest.config.ts`              | Vitest with jsdom and React transforms                                                |

The production entry points must not import the simulation provider or mock fixtures. Oxlint enforces this direct-import boundary. The shell tests also verify that corrupt prototype storage does not affect startup and that startup initiates no simulation timers, storage writes, or provider requests.

TypeScript checks the entire source tree, including the preserved prototype. Strict mode, unused-code checks, and type-only import requirements remain enabled.

## Known prototype follow-ups

The unmounted prototype still needs integration work before it can represent the real office:

- consistent department-local versus world coordinates;
- effective camera pan bounds and application of target FOV;
- monitor-screen placement and texture lifecycle;
- an actual styling pipeline for the prototype's Tailwind classes;
- lifecycle and department mapping against a future verified backend contract;
- navigation, animation, asset loading, and measured performance.

Oxlint currently reports five existing prototype warnings: four React Compiler/ref/memoization warnings in `WorkstationScreen.tsx` and one mixed-export Fast Refresh warning in `OfficeContext.tsx`. They are not disabled. React Compiler is not enabled, and neither module is mounted by the shell.

## Next milestone

Phase 2 introduces the R3F engine foundation: a viewport, lighting, floor, simple building shell, and one deterministic camera controller. It will reuse the existing camera work without mounting the simulation provider. Backend connections and real agents remain later milestones in `BUILD_PLAN.md`.
