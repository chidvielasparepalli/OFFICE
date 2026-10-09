# Canonical worker and workstation intake — 2026-10-09

> Historical intake report. The stickman geometry below remains canonical and unchanged. The [subsequent desk + Manager intake](../desk-manager/README.md) supersedes the workstation, empty Manager slot, renderer filename and runtime distribution details. Only this report's supplied chair is reused in the new workstation.

The supplied stickman is the **only canonical model for normal workers**. It is integrated as a local asset candidate, with a development-only 30-instance inspection scene. No Manager model is supplied, substituted or rendered. This is the authorized worker asset phase, not Phase 4 runtime implementation.

## Exact source inventory and provenance

| Source file                                                    |      Bytes | Finding                                                                 |
| -------------------------------------------------------------- | ---------: | ----------------------------------------------------------------------- |
| `A:\New folder\Stickman\model_0.obj`                           |  1,193,706 | Single worker OBJ                                                       |
| `A:\New folder\Stickman\x.png`                                 |      7,167 | Supplied 512 × 512 color atlas                                          |
| `A:\New folder\office-desk\source\Office Desk\Office Desk.obj` | 19,456,127 | Desk, chair, monitor, keyboard, mouse and decorative items              |
| `A:\New folder\office-desk\source\Office Desk.zip`             | 19,456,271 | One entry, `Office Desk.obj`; its SHA-256 exactly matches the loose OBJ |

The ZIP was found while checking the desk package for companions. It contains no additional material, texture or licensing data. No archives were extracted into the source directories. Exact hashes, object/group names, source bounds and references are in [worker-source.json](worker-source.json) and [workstation-source.json](workstation-source.json). [verification.json](verification.json) confirms all four source hashes remain unchanged.

Both packages were supplied by the user. **Creator, source URL, license, attribution and redistribution/modification terms are unverified.** The desk OBJ names its 3ds Max exporter and a 2022 export date; this is software metadata, not proof of authorship or license. The user's canonical-worker designation is recorded as a product decision, not inferred third-party licensing evidence.

Working Blender/GLB files are ignored under `assets/working/workers/`, outside `public/`. Production asset URLs remain null. They are not committed, published or included in the production build.

## Materials, hierarchy and animation

- Worker: one OBJ object `model_0`, no groups, no `usemtl` assignments; references missing **`model_0.mtl`**. It has 5,039 UV coordinates and 5,039 normals. `x.png` is not linked by an available MTL. The conversion explicitly assigns that supplied image to the existing UVs; Blender and Chromium confirm the black body/blue eyes and joints. Original shader properties are unknown, so a simple rough PBR material is used. The image is packed unchanged into the GLB and checked against the original bytes.
- Workstation: 131 flat mesh objects, grouped by nine source name prefixes. It references missing **`Office Desk.mtl`** and has eight material assignment names but no material definitions. It has 48,632 UV coordinates and 125,917 normals in the OBJ; individual meshes vary in UV availability. No texture files exist in the package or ZIP. Five named neutral PBR materials replace the missing finishes; these are not claimed to reproduce the author's colors.
- Neither package contains an armature, skin, vertex groups, animation actions or clips. There is one worker appearance and one workstation arrangement, with no supplied character variants. Both are static meshes. OBJ cannot carry a skeletal animation rig; none was supplied in companion files either.

Inspection used Blender **5.2.1 LTS** (`9e2066aef7ef`), with isolated background processes. Full inspection copies are `worker-inspected.blend` and `workstation-inspected.blend`. Reports are [worker-inspection.json](worker-inspection.json) and [workstation-inspection.json](workstation-inspection.json). The user's live Blender scene was not modified.

## Dimensions, axes and pivot

All source dimensions below are in **undeclared source units**. The assets' real-world source units cannot be recovered from the supplied files. Y-up is supported by geometric inspection of feet/legs and furniture; the worker's face points toward source +Z. Neither has an authored semantic pivot at the worker's feet or desk center.

| Asset                 | Original XYZ dimensions           | Final XYZ dimensions, meters                               | Normalization                                                  |
| --------------------- | --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| Stickman              | 64.745384 × 65.003920 × 13.238502 | **1.743040 × 1.750000 × 0.356400**                         | Uniform factor **0.0269214535**, chosen 1.75 m height          |
| Complete desk package | 90.150200 × 48.087400 × 75.157100 | **2.253484 × 1.194732 × 1.878702** for retained components | Uniform factor **0.0249969984**, chosen desk-top height 0.75 m |

The worker's wide span is its original T-pose. It is not stretched or made into a different character. The worker pivot is the horizontal midpoint of the feet, at ground Y=0; the source origin was 28.289301 units above its lowest point. Source feet are translated and uniformly scaled only. Exported workers face **+Z** at heading 0.

The workstation pivot is the desk plan center at ground Y=0. Desk and chair ground offsets are corrected independently after simplification. The desk top is approximately 0.75 m, the chair is approximately 1.05 m high, and the monitor top is approximately 1.19 m. This provides a sensible scale reference for the 1.75 m worker. **These dimensions are chosen application calibration, not a claim that the original units are meters, inches or centimeters.** No laptop exists in this package; its supplied monitor is used.

Blender stores the working scenes Z-up with metric units. GLB exports are Y-up/meters. No per-worker runtime rescaling is needed. Final bounds and exact factors are in [conversion.json](conversion.json).

## Geometry and optimization

| Asset       | Raw OBJ vertices / polygons / triangles | Blender imported triangles | Final Blender vertices | GLB vertices / triangles |
| ----------- | --------------------------------------- | -------------------------: | ---------------------: | ------------------------ |
| Worker      | 5,039 / 7,903 / 7,903                   |                      3,700 |                  5,039 | **5,079 / 3,700**        |
| Workstation | 164,472 / 150,888 / 311,645             |                    311,440 |                 11,879 | **12,969 / 20,065**      |

The worker source contains **4,203 faces with repeated vertex indices**; Blender discards those invalid faces during import, leaving 3,700. This difference is not character decimation. The working conversion retains all imported worker faces, positions and UVs apart from the uniform normalization. A weld attempt was rejected by a topology guard; no seam welding or character collapse decimation is present in the final process. glTF vertex counts can exceed Blender counts because normals/UV seams require separate GPU vertices.

Workstation cleanup retains these source components:

| Output mesh | Source prefix         | Final triangles |
| ----------- | --------------------- | --------------: |
| `DESK`      | `archmodels53_20`     |           7,160 |
| `CHAIR`     | `objArmchair_07_Mesh` |           6,992 |
| `MONITOR`   | `Arch35_020`          |           2,418 |
| `KEYBOARD`  | `Arch35_051`          |           2,797 |
| `MOUSE`     | `Arch35_025`          |             698 |

The other four decorative batches are excluded from runtime and remain in the full working inspection. Furniture cleanup welds coincident vertices, removes degenerate data, dissolves near-coplanar edges with a surface-area guard, and applies bounded collapse simplification to dense curved parts. Desk panels and other small desk components are preserved. Resulting vertices are constrained to their measured source envelopes, merged by semantic component, and mesh validity is repaired before export. Source topology detail remains available for future comparison. The retained workstation is approximately **93.6% fewer triangles** than the complete imported set; this reduction includes omitted decoration.

The worker atlas stays at 512 × 512 and is shared; no unnecessary texture enlargement, compression decoder, external texture requests, per-agent material copies, animation mixers or postprocessing are added.

## Final files and registration

| Artifact                    | Location                                          |       Bytes |
| --------------------------- | ------------------------------------------------- | ----------: |
| Worker GLB                  | `assets/working/workers/standard-worker.glb`      | **193,324** |
| Workstation GLB             | `assets/working/workers/office-workstation.glb`   | **512,288** |
| Worker conversion copy      | `assets/working/workers/standard-worker.blend`    |     244,315 |
| Workstation conversion copy | `assets/working/workers/office-workstation.blend` |     633,851 |

Both GLBs are self-contained, with no external resources. `src/assets/officeAssets.ts` exports **`StandardWorkerAsset`** (`agent.standard-stickman.v1`), **`WorkstationAsset`** (`workstation.office-desk.v1`) and the separate **`ManagerAsset`** slot. Missing source rights are a distribution gate, not a reason to swap in another worker.

## Shared rendering and selection

`src/components/3d/StandardWorkers.tsx` loads each URL through cached `useGLTF`. The static worker is one `InstancedMesh`; the workstation is five instanced component meshes. Thirty workers/desks therefore use **six shared draw batches**, one worker geometry/material/texture and one copy of each furniture component. Only instance transform buffers vary. Cached geometry/materials are not disposed on unmount; instance buffers are disposed. Bounds are recomputed after pose updates. No per-frame React state updates or animation mixers are used. This follows [R3F caching/instancing guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) and [Three.js instance bounds requirements](https://threejs.org/docs/pages/InstancedMesh.html).

`AgentContext.kind` explicitly distinguishes `standard-worker` from `manager`. `standardWorkers()` in `src/office/workerPresentation.ts` accepts only normal-worker records with finite ground poses. Roles do not select different character models. `headingRadians` controls heading. Optional `workstation` pose remains fixed while an agent's position changes; the desk does not follow a walking worker.

Raycast `instanceId` maps to the current placement's agent ID and calls `OfficeSelectionHandler({ kind: 'agent', id })`. The existing `OfficeContextPanel` reads that ID from the supplied normalized snapshot, clearing stale context when the record disappears. Its task, progress, dependency, collaborator, blocker, next-action and activity fields remain supplied data, never generated by this renderer. Selection also focuses the sole camera controller. Keyboard-accessible worker buttons provide the same selection path.

All nine existing statuses remain input values. Text/icon markers distinguish them without changing the canonical model or inventing motion. Screen-space markers remain 22 CSS pixels and are deterministically separated when crowded; a 44-pixel-minimum accessible list is also available. Department surface selection and navigation remain available; large floating department labels are omitted while workers are present so they cannot cover workers. The colored floor uses depth bias to avoid flickering.

The old `AgentCharacter.tsx` is preserved for isolated prototype/rollback work. Its sole existing caller is the unmounted prototype `Workstation.tsx`. Neither is imported by the active world or the new worker renderer, and lint prevents the active rendering modules from importing that old chain. There is one canonical worker system in the active integration path.

## Development inspection and browser validation

Run `npm run dev`, then open **`http://127.0.0.1:5173/?workers=preview`**. `src/dev/WorkerAssetPreview.tsx` is loaded only in development. It supplies thirty explicitly labeled static asset placements across six open zones; the executive area is left empty. It supplies **no runtime snapshot, role assignments, statuses, tasks, metrics or fake activity**. Selection shows a sample ID and asset measurements, not a fabricated agent profile. Normal startup still has no workers without actual supplied state. The production build cannot enable this inspection via the query parameter.

Chromium **151.0.7922.34** verified:

- all 30 worker instances and 30 five-component workstation sets;
- Y=0 foot contact and 1.75 m worker height, the supplied embedded atlas and neutral furniture materials;
- direct mesh click → correct instance ID → context, plus keyboard selection;
- company overview → department focus → workstation zoom → individual worker inspection and reset;
- all 30 worker heads in frame with unobstructed sightlines at overview and 390/320 px mobile widths;
- no roof, ceiling, enclosing walls or Manager model;
- one request per GLB, six instanced asset batches, and idle render suspension;
- no console errors or failed requests during normal operation.

The overview records **14 draw calls / 712,976 triangles** including floor and zones. This is an actual 30-instance browser rendering check, not a physical-device FPS guarantee or a 100-worker benchmark. Local scripts, screenshots and evidence are under ignored `test-results/workers-*` and `test-results/verify-worker-browser.mjs`.

Final repository gates passed: typecheck, lint, **40 tests**, formatting, production build and dependency audit (**zero vulnerabilities**). Five existing unmounted-prototype lint warnings remain; the build reports its existing large-chunk warning (current JavaScript approximately 1.32 MB / 374 kB gzip). Additional Chromium checks confirm desk/chair contact, worker clearance, non-overlapping mobile markers, reduced-motion selection, wheel zoom, pan/orbit bounds, reset, and an explicit missing-asset error with no substitute character. Production verification confirms no sample placements or asset binaries are included and `?workers=preview` cannot activate the development scene. The default built application still renders and passes its camera/resize checks without console or request errors.

## Reproduction and remaining limitations

Run the existing inventory script for each supplied root, then the following with the pinned Blender installation:

```powershell
& 'D:\blendertest\Blender\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/inspect_worker_assets.py
& 'D:\blendertest\Blender\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/convert_worker_assets.py
& 'D:\blendertest\Blender\5.2\python\bin\python.exe' scripts/verify_worker_assets.py
```

Stop if an assertion fails. Source files are read-only inputs. Conversion writes only the ignored working directory and tracked metadata. Re-run the repository typecheck, lint, tests, format check and production build after code changes.

The static source T-pose cannot sit, type, gesture or walk anatomically. Position/heading changes and state indicators are safe; skeletal deformation, rigging, clips and deterministic navigation are later work. The sample worker stands behind the supplied chair with physical clearance; it does not pretend to sit or work. At the smallest whole-company view, markers carry identity while close inspection exposes the exact geometry. Original furniture finishes, source units and licensing remain unverified. No 100-worker FPS or physical mobile-device benchmark is claimed.

**Future Manager integration:** populate `ManagerAsset` in `src/assets/officeAssets.ts` only after the separate Manager source completes intake; add its own renderer for `AgentContext.kind === 'manager'`. The current slot has `status: 'awaiting-source'` and both URLs null. `standardWorkers()` excludes it and has no worker fallback. No Manager appearance, provider, backend, task engine, reasoning or Phase 4 runtime was implemented.
