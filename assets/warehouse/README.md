# Warehouse intake — Phase 3

Status: **open-office candidate converted and verified locally; production adoption pending provenance**. This report records Phase 3 intake and supersedes the earlier enclosed warehouse candidate. Current interaction/navigation work is documented in [Phase 4](../../docs/PHASE4_INTERACTIONS.md). The default disconnected application still mounts the preserved Phase 2 procedural building.

## Source and provenance

- User-supplied directory: `A:\New folder\office_WAREHOUSE`.
- 257 files, `model_0.obj` through `model_256.obj`, totaling **1,291,445,036 bytes** (1.29 GB decimal).
- No MTL, texture, archive, license, attribution, or other companion files were supplied.
- Each OBJ references its corresponding missing `model_N.mtl`. No `usemtl` assignments or UV coordinates are present. Textures alone would not restore the original appearance.
- Historical source reference: [Sketchfab Office Warehouse](https://sketchfab.com/3d-models/office-warehouse-e3988ea169c446dfa06da8600381fb84). Fetching it returned HTTP 403. Its relationship to these generic OBJ files, creator, license, modification/redistribution permission, and attribution requirements remain **unverified**.
- Originals remain untouched. [source-inventory.json](source-inventory.json) records every relative filename, byte size, SHA-256 hash, object name, count, bound and missing material reference. All 257 hashes were rechecked after the open-office conversion.
- Source binaries and Blender working copies remain ignored. The 4,404-byte open-floor GLB is included in the GitHub checkpoint for reproducible development previews; it remains outside the production bundle.

## Blender inspection

Inspected with local Blender **5.2.1 LTS**, build `9e2066aef7ef`, in an isolated background process. The user's live Blender scene was not changed.

| Finding                       | Result                                                                     |
| ----------------------------- | -------------------------------------------------------------------------- |
| Source hierarchy              | Flat numbered objects; no authored room/department hierarchy               |
| OBJ triangle count            | 11,785,198                                                                 |
| Point-only file               | `model_15.obj`: vertices without faces or lines; excluded                  |
| Exact overlapping mesh copies | 152 duplicates, identified from imported vertex positions and face indices |
| Unique imported objects       | 104 meshes, 3,271,144 Blender triangles                                    |
| Source bounds                 | X 0–648.070923; Y −5.455190–965.669312; Z 0–493.197205                     |
| Source axes                   | Z-up, confirmed by slabs, walls and stairs                                 |
| Source units                  | Undeclared; inches inferred from stair geometry                            |
| Source materials / textures   | No usable materials, UV layers or textures available                       |
| Animation                     | None                                                                       |

[blender-inspection.json](blender-inspection.json) contains per-object measurements and duplicate mappings. OBJ and imported triangle counts differ because the importer removes invalid/repeated face data; both counts are retained.

The source contains a ground-level warehouse area, upper office floor, open entry/loading facade, stairs/landings, windows, columns, service ducts and upper partitions. Numbered objects do not identify authored departments or room purposes. Slabs and stairs are likely walkable surfaces, but no navigation mesh or collision-tested routes have been produced.

## Open-office cleanup and selection

The original complete inspection remains in `assets/working/warehouse/warehouse-inspected.blend` (**109,869,804 bytes**). A separate working copy, `assets/working/warehouse/office-open.blend` (**91,388 bytes**), contains the current candidate.

The selected component is the connected foundation slab inside **`model_3.obj`**: eight vertices and twelve triangles, source bounds `[0,0,0]` to `[648.070923,965.669312,12.585540]`. The converter welds coincident vertices only in the working copy, identifies this component by connectivity and measured bounds, and asserts that exactly one candidate exists before extraction.

The export excludes **every roof, ceiling, upper floor, enclosing wall, stair, overhead service and partial furniture batch**. Those remain available in the full inspection and untouched originals. There are no above-ground architectural occluders to cut away at runtime. The old enclosed `office-shell.glb` is only an ignored historical artifact and is no longer registered or loaded.

One explicitly named neutral PBR material replaces unavailable source finishes. No authored texture appearance is claimed. There are no textures, external decoder requests, employees, animation mixers or postprocessing. This clean, plain slab has no architectural detail to lose through decimation; it is a foundation for later furniture/worker assets, not a completed furnished office.

## Coordinate and scale result

- Export: **Y-up, meters**, with +Z designated as the entrance side.
- The source is Z-up. Source +Y maps toward runtime +Z and source X is reversed. Blender itself remains Z-up; glTF export performs the axis conversion.
- Inferred unit calibration is **0.0254 meters/source unit**. Repeated stair rises of approximately 6.3475 source units become 0.16123 m. This inference is not author-confirmed metadata.
- The selected slab at that calibration measures **16.461 × 24.528 m**, thickness **0.319673 m**.
- For the open campus plan, the plain slab was **deliberately resized horizontally to 36 × 36 m**. The X/Z plan factors are approximately 2.18699 and 1.46771. This design resize is separate from unit calibration; the candidate is not a dimensionally faithful warehouse reconstruction.
- The top-center origin and `OPEN_OFFICE_ROOT` are **`[0,0,0]`**. Bounds are `[-18,-0.319673,-18]` to `[18,0,18]`. No runtime scale/rotation correction is applied.
- Exact source bounds, resize factors and output coordinates are in [conversion.json](conversion.json).

[open-layout.json](open-layout.json) defines seven open department zones with at least four meters of separation and central circulation space. These are proposed spatial reservations, not business state. Flat colored zones and accessible labels are rendered by the application; the GLB contains only the floor and empty anchor nodes.

## Named anchors

`OPEN_OFFICE_ROOT` contains `OPEN_OFFICE_FLOOR` and `ANCHORS`. All **22 stable anchors** are exported as glTF nodes and recorded with meter coordinates in [conversion.json](conversion.json):

- Seven department centers: `DEPT_EXECUTIVE`, `DEPT_RESEARCH`, `DEPT_CREATIVE`, `DEPT_ENGINEERING`, `DEPT_BUSINESS`, `DEPT_QUALITY`, `DEPT_OPERATIONS`.
- Seven workstation-area centers: the same suffixes under `WORKSTATION_`.
- Entrance and circulation: `ENTRANCE_FRONT`, `CORRIDOR_CENTRAL`.
- Shared areas: `HUB_CENTRAL`, `MEETING_ROOM_01`. The latter is an **open meeting area**, not an enclosed room.
- Camera: `CAMERA_OVERVIEW`.
- Navigation candidates: `NAV_FRONT`, `NAV_CENTER`, `NAV_REAR`.

Every marker is ray-checked against the ground surface in Blender. They are not occupied desks, confirmed runtime department assignments, or validated navigation routes.

## Export and application boundary

| Item                 | Current result                                                                 |
| -------------------- | ------------------------------------------------------------------------------ |
| Stable asset ID      | `world.office-open.v1`                                                         |
| GLB                  | `assets/working/warehouse/office-open.glb`                                     |
| File size            | **4,404 bytes**                                                                |
| Geometry             | One mesh, 12 triangles                                                         |
| Materials / textures | One neutral material, zero textures                                            |
| Dependencies         | Embedded buffers only; no external resources                                   |
| Registry             | `src/assets/officeAssets.ts`; `productionUrl: null`, `candidate-local-preview` |

Run `npm run dev` and open `http://127.0.0.1:5173/?warehouse=preview`. The normal URL and production build keep the preserved procedural building. Missing-candidate errors show an open planning-floor fallback and a visible error notice. Production output contains no OBJ, Blender or candidate GLB files, and the query cannot enable the candidate in production.

The preview supports company overview, department surface/button selection, department camera focus, reserved workstation-area inspection, smooth zoom, pan, constrained orbit, damping, reset and responsive resize. Its camera includes a 2.1 m worker envelope in framing, with polar limits 2–60 degrees and distance limits 5–120 m. It renders on demand and stops after camera motion settles.

[The open-office contract](../../docs/OPEN_OFFICE_CONTRACT.md) documents the state/selection interface and all nine requested future statuses. The context panel accepts supplied runtime records; default input is null, with no fake agents, tasks, progress, costs or activity. Actual worker click/render/animation integration belongs to an authorized later phase.

## Reproduction

Run from the repository root with the same Blender installation; adjust executable paths on another machine:

```powershell
& 'D:\blendertest\Blender\5.2\python\bin\python.exe' scripts/warehouse_inventory.py 'A:\New folder\office_WAREHOUSE' assets/warehouse/source-inventory.json
& 'D:\blendertest\Blender\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/warehouse_inspect.py
& 'D:\blendertest\Blender\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/warehouse_convert.py
& 'D:\blendertest\Blender\5.2\python\bin\python.exe' scripts/verify_warehouse.py
```

Stop on failure. Format generated JSON with repository Prettier before committing metadata. Conversion asserts the unique source slab, twelve triangles, floor-only geometry and grounded markers. Verification checks all source hashes plus GLB header/size/hash, mesh/index counts, anchor names/transforms and embedded dependencies.

## Validation and remaining limits

Chromium verification covers real WebGL/GLB rendering, floor-only geometry, all department standing-worker envelopes in frame with clear sightlines, department surface selection/context, keyboard selection, workstation-area zoom, reset, wheel zoom, pan/orbit constraints, 390/320 px mobile resize, idle render suspension, console errors and failed requests. No console errors or failed requests occur during normal use. Local evidence is in ignored `test-results/open-office-*` and `test-results/verify-open-office.mjs`.

Final repository checks passed: typecheck, lint, **36 tests**, formatting, production build and `npm audit --audit-level=high` (**zero vulnerabilities**). Missing-file fallback and production isolation also passed in Chromium 151.0.7922.34. The production scene rendered, zoomed, reset and resized with no console errors or failed requests. Five existing prototype lint warnings and Vite's large Three.js bundle warning remain. This is not a physical-device or 50–100-agent performance benchmark.

Production adoption remains blocked by unverified creator/license/redistribution terms. Original finishes and author-confirmed scale are unavailable. Actual worker readability, desk/laptop close-up quality, real state-driven animation, navigation and runtime integration remain unimplemented and unverified. No Phase 4 work is included.
