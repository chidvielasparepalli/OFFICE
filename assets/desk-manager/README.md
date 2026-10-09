# Desk + Manager asset intake — 2026-10-09

> The later user-authorized [animation extension](../animation/README.md) supersedes this report's static-character limitations and character runtime filenames. This remains the original intake record. Desk geometry and instancing remain unchanged.

The newly supplied Modern Desk Setup is the canonical standard workstation. The Indian Man in suit is the dedicated Manager. The existing stickman remains byte-for-byte unchanged for normal workers. This completes the separately authorized asset phase; it does not start Phase 4 or introduce runtime activity.

## Exact source inventory and provenance

| Package | Original location                                       | Discovered files                                                     |       Bytes |
| ------- | ------------------------------------------------------- | -------------------------------------------------------------------- | ----------: |
| Desk    | `A:\New folder\Modern Desk Setup – Game Ready 3D Model` | `model_0.obj` through `model_37.obj`, inclusive; five PNGs below     |  22,078,288 |
| Manager | `A:\New folder\Indian Man in suit`                      | `model_0.obj` through `model_76.obj`, inclusive; thirteen PNGs below | 106,064,183 |

The exhaustive, individually hashed lists are [workstation-source.json](workstation-source.json) and [manager-source.json](manager-source.json). No MTL, rig, animation, readme, license, source URL or other companion file was found in either folder. Every OBJ references its own missing `model_N.mtl`; no `usemtl` assignments or named groups are supplied. Object names are `model_N`, with one flat mesh per OBJ and no parent hierarchy. Normals and UVs exist.

Desk images: `download (20)_0.png` (512×1024 wood), `download (21)_1.png` (512×1024 fabric/mat), `Homscreen_setup_2.png` (512×1024 phone screenshot), `notebook-kali-2024.1-4K_3.png` (2048×2048 desktop screenshot), `IMG_20250724_185544_716_4.png` (1024×512 desktop/chat screenshot).

Manager images: `ARARAT_Color_1K.png`, `ARARAT_Normal_1K.png`, `AvatarBodyMale_Color_1K.png`, `AvatarBodyMale_Normal1_1K.png`, `AvatarHeadMale_Color_1K.png`, `AvatarHeadMale_Normal1_1K.png`, `AvatarTeeth_Color_1K.png`, `AvatarTeeth_Normal1_1K.png` (all 1024×1024); `AvatarEyes_Color_512.png`, `AvatarEyes_Normal_512.png`, `AvatarLeftCornea_Color_512.png`, `AvatarRightCornea_Color_512.png` (512×512); `glasses_10_Color_256.png` (256×256). Actual dimensions were decoded, not inferred from names. All source images have fully opaque alpha.

Creator, original website, license, commercial use, modification/redistribution permission and attribution requirements remain **unverified**. The user's official-asset designation determines model identity; it does not establish third-party license terms. Local runtime registration is implemented as requested; no commit, upload or deployment was performed. Resolve rights before redistribution. See [THIRD_PARTY_ASSETS.md](../../THIRD_PARTY_ASSETS.md).

All 133 originals were SHA-256 checked after conversion. Separate exact copies live under ignored `assets/working/desk-manager/{workstation,manager}-source/`. Full unoptimized inspection scenes are `workstation-inspected.blend` and `manager-inspected.blend` in that working directory. Originals were never written.

## Blender inspection and measurements

Blender **5.2.1 LTS**, isolated factory-startup/background processes. Inspection scenes, complete and per-object renders, texture contact sheets, mesh/UV duplicate hashes and per-object bounds are retained locally. Machine-readable evidence: [workstation-inspection.json](workstation-inspection.json), [manager-inspection.json](manager-inspection.json).

| Measurement                                 |                                      Desk package |                                          Manager package |
| ------------------------------------------- | ------------------------------------------------: | -------------------------------------------------------: |
| Original extent X×Y×Z, undeclared units     |                        4.452413×3.036054×2.000000 |                               1.760850×1.811972×0.323895 |
| Original vertices                           |                                            86,844 | 338,338 across 77 meshes; 48,334 across 11 unique meshes |
| Original triangular polygons                |                                           138,431 |                   837,109; 119,587 across one unique set |
| Blender accepted triangles                  |                                            51,863 |                  549,444 across 77 meshes; 78,492 unique |
| Exact coincident geometry/UV duplicates     |                                    0 whole meshes |    66 meshes: seven copies of the same 11-part character |
| Final extent X×Y×Z, meters                  | 2.086241×1.422586×1.758726 including reused chair |                               1.749216×1.800000×0.321755 |
| Final mesh vertices / exported GLB vertices |                                   16,193 / 16,803 |                                          34,297 / 35,757 |
| Final triangles                             |            30,144 including 6,992 chair triangles |                                                   58,751 |
| Runtime meshes / materials / images         |                                         6 / 6 / 2 |                                             11 / 11 / 13 |

Both packages are visually confirmed Y-up, with characters/desk fronts originally toward +Z. OBJ does not declare units. Neither scale is claimed to be an authored real-world measurement. Source coordinates use the global origin rather than a useful ground pivot: desk bounds start at `[-1.985133,-1.515957,-2.397151]`; Manager at `[-0.880173,-0.000813,-0.147798]`.

Desk normalization uniformly scales by **0.4685640344**, calibrating the top to **0.75 m**, centers the desk footprint at the origin, grounds its feet at Y=0, and turns the desk 180° so its user side faces −Z. A worker at negative Z faces +Z toward its screens. Manager normalization uniformly scales by **0.9933928925** to **1.80 m**, uses a feet-center ground pivot, and preserves its +Z facing direction. Scale is baked into geometry; runtime placements use meters with no corrective scale.

Both characters are static T-poses: no armature, skin weights, morph animation or animation clips were supplied. The Manager is one character repeated seven times, not seven variants. No replacement model or procedural Manager was created.

## Actual workstation contents and cleanup

Visible components include a desk top and two support legs, monitor with stand/webcam, open laptop, separate keyboard, mouse/scroll wheel, PC tower/fans, phone, desk mat, notebook, pens/holders, mug and crumpled-paper accessory. **No chair is present in the new package.** Small trim/buttons share anonymous source batches; absent MTLs prevent recovering the author's original material grouping.

The chair is reused from the earlier user-supplied `A:\New folder\office-desk\source\Office Desk\Office Desk.obj`, via the previously verified `assets/working/workers/office-workstation.blend:CHAIR`. Only that chair geometry is appended; the previous desk/monitor/keyboard/mouse are not loaded. Its existing 1.05 m height and neutral material remain. Its ground pivot is recentered and placed at `[0,0,-0.88]` relative to the new desk. The previous package's source hashes/provenance remain in [the worker report](../workers/README.md).

Blender discarded invalid source faces on import. Direct parsing found **86,380 repeated-index degenerate desk faces**, plus 188 other faces not retained by Blender, and **287,665 repeated-index degenerate Manager faces** across the seven copies. These raw-face counts are not valid rendered triangle budgets.

Desk cleanup welds coincident geometry while retaining face-corner UVs, removes degenerate/unused geometry, and bounds simplification to the original component envelopes. Dense keys, pen holders, the mouse wheel, mug and frames are reduced; the useful full workstation is retained. Materials are merged into `WOOD_TOP`, `DESK_MAT`, `FRAME_ELECTRONICS`, `KEYS_ACCESSORIES`, `SCREENS_OFF`, plus the supplied `CHAIR`. No procedural furniture is added.

Manager cleanup removes 66 verified coincident geometry/UV copies, reduces suit/shoes from 40,540 to 24,499 triangles and eyelashes from 4,900 to 1,200. Head, hands, eye surfaces, teeth and glasses keep their accepted triangle topology. Semantic names are `HANDS`, `EYELASHES`, `HEAD`, `CORNEA_LEFT`, `EYE_LEFT`, `CORNEA_RIGHT`, `EYE_RIGHT`, `TEETH_LOWER`, `TEETH_UPPER`, `SUIT_SHOES`, `GLASSES` under `PRIMARY_MANAGER_ROOT`. Full source T-pose and identity remain.

Missing MTLs mean original shader settings cannot be recovered. Material assignments are explicitly reconstructed from anatomy, image content and existing UVs, then visually checked. Wood and pad use the two supplied textures; remaining desk/chair finishes are documented neutral materials. Screens are powered-off surfaces; the three source screenshots are preserved in the source copy but not presented as live business activity. Manager uses all thirteen supplied images, including normal maps with non-color interpretation. Colors use quality-90 JPEG without chroma subsampling; normal maps remain lossless RGB PNG. Eye/cornea images are capped at 256px, teeth at 512px, pad at 512px; remaining images are at most 1024px. [textures.json](textures.json) records every derivative. No external decoder, texture request or postprocessing is required.

## Runtime files, registry and reuse

| Registry entry        | Stable ID                             | Canonical runtime GLB                                    |      Exact size |
| --------------------- | ------------------------------------- | -------------------------------------------------------- | --------------: |
| `StandardWorkerAsset` | `agent.standard-stickman.v1`          | `public/assets/3d/characters/standard-worker.glb`        |   193,324 bytes |
| `WorkstationAsset`    | `workstation.standard-modern-desk.v1` | `public/assets/3d/workstations/standard-workstation.glb` |   754,004 bytes |
| `ManagerAsset`        | `agent.manager`                       | `public/assets/3d/characters/primary-manager.glb`        | 5,363,896 bytes |

Registry: [src/assets/officeAssets.ts](../../src/assets/officeAssets.ts). Conversion copies remain at `assets/working/desk-manager/standard-workstation.{blend,glb}` and `primary-manager.{blend,glb}`. Dimensions, hashes, exact source-to-component mapping and per-part optimization are in [conversion.json](conversion.json). GLBs are self-contained. [verification.json](verification.json) proves source preservation, embedded dependencies, final counts and unchanged stickman hash.

[OfficeCharacters.tsx](../../src/components/3d/OfficeCharacters.tsx) uses the existing cached `useGLTF`/GPU instancing path. Normal records enter the stickman batch, Manager records enter only the dedicated Manager batches, and all assigned workstation poses share the same six desk/chair batches. Geometry, materials and textures are cached once, not cloned per employee. Each instance owns only its transform and entity-ID mapping; instance buffers are disposed separately from cached resources. A load failure reports the affected asset and never substitutes another model. Each asset has an independent error boundary.

The old procedural `Workstation.tsx` and `AgentCharacter.tsx` remain preserved solely in the unmounted prototype. Neither is imported by the active scene. The prior supplied desk GLB is also retired from active loading; its chair is now incorporated in the one canonical workstation GLB. There are no competing production workstation systems.

## Composition, Manager workspace and selection

The developer-only `/?workers=preview` scene contains **30 static stickman samples, one Manager sample, and 31 canonical workstations**, with no runtime snapshot or invented statuses. The Manager occupies the dedicated open executive zone. It uses its own desk instance and spatial anchors; the supplied desk is a standard workstation, not claimed to be a separately authored executive desk.

The standard standing inspection anchor is `[0,0,-1.62]` relative to its desk. The Manager sample stands at `[0,0,-11.8]`; its desk is `[0,0,-10.18]`. Both models stand behind the chair with clearance, facing the desk. No limbs or body dimensions are distorted to manufacture a seated pose. A genuine seated/typing pose requires later rigging/animation work and is not implemented here.

The existing input boundary remains `OfficeWorld({ runtime: OfficeRuntimeSnapshot | null })`. `AgentContext.kind` selects the asset (`standard-worker` or `manager`); roles and proximity never select a model. `presentedAgents()` in [workerPresentation.ts](../../src/office/workerPresentation.ts) validates finite grounded transforms, preserves supplied status and ID, and keeps assigned workstation poses independent of character movement.

Raycast `instanceId` resolves against the clicked asset batch's own IDs, then emits `onSelect({kind:'agent', id})`. Manager clicks resolve to the Manager ID, never a nearby worker. The same selection flows through accessible buttons, camera focus and `OfficeContextPanel`, which looks up current supplied context by ID. Static samples show only asset identity, height and pose, never tasks/costs/progress. Future real Manager request/plan/delegation/approval fields belong in the normalized runtime contract when that runtime is implemented; no fake versions are added now. Desk placement is spatial metadata, not a fabricated business entity.

Default production remains disconnected with no sample workforce. Registered binaries are available to the production renderer when a real snapshot is supplied. Preview samples are development-only. The warehouse retains its separate existing intake gate; no roof, ceiling or enclosing wall was added.

## Validation

- Chromium 151.0.7922.34 rendered actual GLBs. Thirty normal workers use one batch; 31 desks use six batches; the single Manager uses eleven batches. Overview measured **26 draw calls / 1,104,241 triangles**. Rendering stops while idle.
- Numerical browser bounds verify 1.75 m stickmen, 1.80 m Manager, 0.75 m desktop, desk/chair floor contact, and no character bounding-box overlap with assigned desk, electronics frame or chair.
- All 31 heads are in frame and have clear raycast sightlines at desktop overview and 390/320px mobile widths. All 31 selection markers remain visible and non-overlapping. No roof/wall/ceiling geometry exists in this view.
- Actual mesh clicks select the Manager and a worker independently. Keyboard selection, department focus, workstation focus, executive area focus, individual inspection, wheel zoom, right-drag pan, constrained orbit, reset, responsive resize and reduced motion pass.
- Each GLB is requested once. The retired workstation is not requested. Runtime image maps decode at expected dimensions; no external image/material requests, broken references, observed z-fighting, console errors or failed requests in the successful scene.
- Local screenshots/results are in ignored `test-results/desk-manager-*`. These are browser-emulation checks, not a physical-device or 100-agent frame-rate certification.

Final project checks pass: `npm run typecheck`, `npm run lint` (five existing unmounted-prototype warnings), `npm test` (**41 tests**), `npm run format:check`, `npm run build`, and `npm audit --audit-level=high` (**zero vulnerabilities**). `git diff --check` is clean. The JavaScript build is 1,336.84 kB / 376.61 kB gzip and retains Vite's existing large-chunk warning.

Production Chromium verification confirms that the preview query cannot mount samples, sample placements are absent from the bundle, and the disconnected scene requests no GLBs. All three registered runtime files are served by the production preview with bytes matching the validated exports. Deliberate 404 tests verify independent failure handling: missing Manager leaves 30 worker markers; missing stickman leaves the Manager; missing desk leaves all 31 characters. No fallback model is substituted. Expected errors in those deliberate failure tests are separate from the error-free successful scene. Summary evidence is in [validation.json](validation.json).

## Reproduction and remaining limits

Use the repository's pinned Node 24.21.0/npm 11.19.0. Inventory each original directory with `scripts/warehouse_inventory.py`. Run `scripts/inspect_desk_manager.py` through Blender's isolated background CLI. Run `scripts/prepare_desk_manager_textures.py` with Python/Pillow, then `scripts/convert_desk_manager.py` through Blender. Run `scripts/verify_desk_manager.py`; after visual/browser validation, `--stage-runtime` stages byte-verified runtime files into `public/assets/3d/`. The canonical stickman is checked, not regenerated.

Remaining limits: unknown original units/licenses/creator, reconstructed shaders, static T-poses without sitting/walking clips, no LOD yet, and 100-agent hardware performance not certified. No backend, Supabase, provider, reasoning, task execution, cost engine or workflow system was added. No Phase 4 work was started.
