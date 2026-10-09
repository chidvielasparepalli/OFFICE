# Supplied character animation — 2026-10-09

> The subsequent [working-hard headband extension](../headband/ANIMATION.md) adds a non-deforming accessory helper and three clips to each rig. Current exports have 21 bones and ten clips; current sizes/hashes and mesh-preservation results are in `conversion.json` and `verification.json`. The original seven-clip validation below is historical; new acceptance evidence is under `assets/headband/`.

This is the separately authorized animation extension to the asset phase. The canonical stickman and the dedicated Indian Man in suit remain separate visual assets. The application shares their motion/state controller and clip names, while each model has a proportion-specific rig and animation data. This work does not start Phase 4 or add an agent runtime.

**Validation status: completed on the final exported files.** Typecheck, lint, all 69 tests, formatting, production build and dependency audit pass. Chromium verifies both character types and thirty simultaneous workers. Measured contact tolerances and performance limits are recorded below; this does not certify general physics or arbitrary future poses.

## Source inspection and preservation

The original supplied packages are static OBJ meshes. Neither contains a skeleton, skin weights or animation clips. Their original hierarchy, material reconstruction, file inventory, hashes and unresolved licensing are documented in the [worker report](../workers/README.md) and [desk + Manager report](../desk-manager/README.md). Those reports describe the earlier static intake; the new animation derivatives supersede their current-behavior statements about T-poses.

The animation pipeline reads the accepted, separate Blender working copies:

- Worker: `assets/working/workers/standard-worker.blend`, one `STANDARD_WORKER` mesh and `Stickman_supplied_atlas` material.
- Manager: `assets/working/desk-manager/primary-manager.blend`, eleven meshes/materials: `HANDS`, `EYELASHES`, `HEAD`, `CORNEA_LEFT`, `EYE_LEFT`, `CORNEA_RIGHT`, `EYE_RIGHT`, `TEETH_LOWER`, `TEETH_UPPER`, `SUIT_SHOES`, `GLASSES`.

`scripts/rig_office_characters.py` opens these files in Blender, verifies the absence of an existing armature, vertex groups and actions, and saves new derivatives under ignored `assets/working/animation/`. It never writes the user-provided source directories or replaces the earlier accepted working copies. Vertex positions, polygons and UV layers are hashed before and after binding to assert that the canonical mesh geometry is unchanged. Materials and textures are retained.

The worker remains 1.75 m tall in its reference pose; the Manager remains 1.80 m. Both use meters, Y-up, +Z facing at heading zero and a ground-level character root. Posing changes the visible bounds without rescaling or redesigning either character.

| Final asset       | Reference height | Exported vertices | Triangles | GLB bytes |
| ----------------- | ---------------: | ----------------: | --------: | --------: |
| Standard worker   |           1.75 m |             5,079 |     3,700 |   454,844 |
| Dedicated Manager |           1.80 m |            35,757 |    58,751 | 6,242,096 |

The exported position, UV, index, image and material data match the static canonical GLBs; normals differ only by floating-point rounding below 0.00000012. All 92 original character-package files retain their recorded hashes.

## Blender rig and authored poses

Both assets receive a twenty-bone `OfficeRig`: root, hips, spine, chest, neck, head, and left/right thighs, shins, feet, clavicles, upper arms, forearms and hands. Each GLB contains one skin. Worker components bind rigidly to their corresponding bones, retaining the supplied segmented appearance. The Manager uses anatomical region/capsule weights with up to three influences per vertex; head accessories remain attached to the head. Weights are checked for normalization.

The seated pose solves hips, thighs, bent knees, planted feet, spine, shoulders, elbows, wrists and hands. It does not merely lower a standing model. Chosen seated pelvis heights are 0.465 m for the worker and 0.51 m for the Manager. Working wrists target roughly 0.82 m above the floor, with hands directed toward the supplied keyboard on the 0.75 m desk. The Manager uses more restrained upper-body motion than the stickman.

The same seven semantic clips exist separately in each character GLB:

| Clip           | Purpose                                      |
| -------------- | -------------------------------------------- |
| `stand_idle`   | Arms lowered, standing rest                  |
| `seated_idle`  | Seated waiting/rest pose                     |
| `seated_sleep` | Quiet seated/resting presentation            |
| `seated_work`  | Four-second restrained typing/work loop      |
| `walk`         | One-second in-place walking cycle            |
| `stand_up`     | Authored rise and side exit from the chair   |
| `sit_down`     | Reverse of the seated-to-standing transition |

The authored clips are sampled at 30 Hz for export. Static rest clips contain endpoint keys only. The walk clip has no navigation root translation; deterministic application motion owns world travel. Current durations, mesh hashes, bone names, sizes and GLB hashes are recorded in [conversion.json](conversion.json). Working `.blend` files retain the armature and actions for further editing.

After the earlier intake scripts have produced the normalized working `.blend` files, reproduce the derivatives with:

```powershell
& 'D:\blendertest\Blender\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/rig_office_characters.py
& 'D:\blendertest\Blender\5.2\python\bin\python.exe' scripts/verify_character_animation.py
& 'D:\blendertest\Blender\5.2\python\bin\python.exe' scripts/verify_desk_manager.py --stage-runtime
```

The first command writes separate working derivatives; the final command stages only verified runtime GLBs. Source packages and earlier static working copies are required locally and remain unchanged.

## Workstation anchors and movement

`src/office/characterMotion.ts` owns reusable desk-local anchors:

- Seat root: `[0, 0, -0.73]`.
- Standing exit: `[0.65, 0, -1.35]`.

`workstationAnchor()` rotates and translates these offsets with the assigned workstation. The desk and electronics remain fixed. The supplied chair rolls back 0.40 m with the seated character over the first 0.6 seconds, followed by a two-second rise and side exit. Returning reverses that sequence, including rolling back toward the desk after sitting. Only the shared `CHAIR` instance matrix moves. This avoids the desk and armrests without deforming the furniture or replacing either character. Feet, ground-root motion and chair offset use the same 2.6-second contract.

`AgentContext.motion` is an optional explicit command with `{ id, points, speedMetersPerSecond }`. Points are finite, grounded world positions; a command has at least two points and a positive speed no greater than 3 m/s. A new ID issues a command. Repeating an ID does not restart it. Removing the command stops at the current location. Position seeds mounting; subsequent travel requires a supplied path. New standing heading inputs can turn the character without moving its root.

The controller rises before walking. At a returning workstation it reaches the standing anchor, turns to face the desk, then sits and enters the requested seated state. A replacement route may reverse an occupied segment without teleporting. Off-route commands are rejected with a diagnostic; the renderer does not invent a cross-office connector or find routes through furniture.

| Supplied status       | Physical presentation                                                           |
| --------------------- | ------------------------------------------------------------------------------- |
| `working`             | Seated work/typing, once at the assigned workstation                            |
| `waiting`             | Quiet seated idle                                                               |
| `sleeping`            | Quiet seated/rest pose                                                          |
| `walking`             | Stand, then follow an unfinished explicit path; otherwise remain idle           |
| `collaborating`       | Stand; move only when an explicit path is supplied                              |
| `queued`, `completed` | Preserve an appropriate seated or standing idle pose                            |
| `blocked`, `repair`   | Freeze the current physical pose and movement time; retain the status indicator |

Completing a path or playing a clip never changes business status, creates a task or emits invented activity. Working away from a desk without a return path remains idle and reports the missing path.

## Runtime reuse, selection and visibility

Registry entries remain `agent.standard-stickman.v1`, `agent.manager` and `workstation.standard-modern-desk.v1` in `src/assets/officeAssets.ts`. Character URLs are:

- `public/assets/3d/characters/standard-worker-animated.glb`.
- `public/assets/3d/characters/primary-manager-animated.glb`.

The workstation remains `public/assets/3d/workstations/standard-workstation.glb`. It is shared across standard workers and the Manager's executive-zone placement. Neither character GLB embeds furniture.

`AnimatedCharacter.tsx` loads each character URL through cached `useGLTF`. Per-entity clones own their bone transforms, skeleton resources and mixer state; they share cached geometry, materials, textures and animation clips. This permits independent movement without downloading or duplicating a heavy model per worker. Desks remain GPU-instanced. No imported character uses the old procedural character path, and a failed Manager asset never falls back to the stickman.

`src/office/characterAnimation.ts` owns cloned skeleton resources and Three.js playback. Effect replay retains mixer bindings, and every completed blend samples its final pose before the demand loop stops. Pose evaluation is capped at 24 Hz for unselected characters; the selected character can update every rendered frame. Sleeping and idle characters stop advancing their mixers after their pose settles. The canvas uses a demand loop, and no React state is updated each animation frame. Skinned meshes currently use a conservative selection envelope and are not culled; distance-based mesh LOD and GPU-instanced skinning are not implemented.

Selection resolves each animated group directly to its supplied entity ID. `OfficeWorld` reads the current animated ground position for focus, and overview markers project the animated head position. The Manager remains independently selectable. The existing context panel still displays only supplied runtime context. The floor, visible circulation areas and open zones remain roofless and unobstructed by added architecture.

## Explicit development inspection

`/?workers=preview` is development-only. It supplies thirty worker samples, one Manager sample and thirty-one shared desks, with initial `working` **animation test inputs** and no `OfficeRuntimeSnapshot`. Controls choose Worker 1 or Manager, select any of the nine states, issue a walk/return command, or set all samples to working/sleeping. State and route changes happen only through these controls; no random movement or fabricated business activity is generated.

The calibrated test route uses the standing exit, then desk-local `[1.2, 0, -1.5]` and `[1.2, 0, -2.5]`; return retraces it. The context panel labels samples as animation inspection and shows the test input, not invented task details. The default disconnected production scene still mounts no workforce.

## Verification and remaining limits

The final [contact report](contact-verification.json) evaluates 97 poses per character, including all 79 authored transition frames. It finds no desk intersections and no chair intersections after the initial occupied-seat contact. Static cushion overlap is about 2.0 cm for the worker and 3.2 cm for the Manager; the supplied cushion does not deform. Seated and walking support feet are grounded. During the side-step both soles can briefly clear the floor by up to 9.44 mm. Independent exported-GLB interpolation checks record at most 0.604 mm of floor penetration. These are measured tolerances of authored animation, not a general physics/contact solver.

The pipeline has assert-based checks for source mesh preservation, normalized weights, one skin and the seven expected clips. `scripts/verify_character_animation.py` passes on the final hashes and checks original source hashes, exported geometry/UV/material/image preservation, clip tracks, loop closure, reversed sit/stand data, grounded sampled poses and seated joint measurements. See [independent GLB verification](verification.json) and [browser verification](browser-verification.json).

The motion controller has 19 tests for explicit paths, frame partitioning, cancellation, interruptions, blocked/repair pauses, invalid commands, rotated anchors, chair rollback and orientation before sitting. Six real Three.js player tests cover shared resources, independent skeletons, StrictMode replay, clip blending, sleeping, pause and throttling. Preview/context tests preserve isolated animation inputs and Manager identity without a runtime snapshot. The complete suite has 69 passing tests. Lint has only the five existing prototype warnings; Vite retains its large-chunk advisory (about 1.357 MB JavaScript / 383 kB gzip). Audit reports zero vulnerabilities.

Chromium verified 30 workers plus the dedicated Manager and 31 shared desks: actual seated hips/knees/ankles, hands at the keyboard, visible work motion, standing, explicit walking, blocked-state freezing, return/sit, chair rollback and restoration, independent mesh selection, department/workstation/character focus, zoom, pan, constrained orbit, reset and mobile resize. All heads are visible in the open overview. The rendered scene uses 55 draw calls, shared worker geometry/materials and independent skeletons; each of the worker, Manager, workstation and open-floor GLBs loads once. Sleeping stops continuous rendering. There are no console errors or failed requests in the normal run. A separate intentional Manager-404 test confirms that workers remain selectable and no stickman substitutes for the Manager.

The final production build also renders its default canvas, serves both final GLB hashes, excludes development sample IDs/controls, and mounts no fabricated workforce. Full local browser scripts, JSON records and screenshots are retained under ignored `test-results/animation-*` and `test-results/verify-character-animation-browser.mjs`; the compact acceptance record is linked above.

These are authored skeletal office motions, not motion-captured performances. There is no finger rig, facial animation, live keyboard IK, cloth collision or general collision avoidance. The seated pose is calibrated to this canonical desk/chair configuration; other furniture requires new calibration. Some supplied suit/hand geometry may need weight refinement for future poses beyond these clips. One hundred simultaneous animated characters and physical mobile hardware performance are not certified. Creator, source license, attribution and redistribution rights remain unverified as recorded in the earlier provenance reports. No backend, provider integration, task execution or real AI behavior is added.
