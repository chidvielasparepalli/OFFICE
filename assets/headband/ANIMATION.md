# State-driven working-hard accessory

This extends the authorized asset/animation phase only. It introduces no runtime, tasks, providers or business-state simulation. The original stickman and dedicated Manager retain their own geometry, materials and proportions. The supplied headband is an external shared accessory; its inspection and provenance are in [README.md](README.md).

## Sequence and interruption contract

`AgentContext.kind`, `status`, `workstation` and optional validated `motion` feed `characterMotion.ts`. Only a `standard-worker` in working state follows its supplied route, turns toward the desk, sits, then plays `headband_on` for 3.6 seconds. The right hand reaches the waist before the band becomes visible; both hands carry it above the crown, lower it to the forehead and return to the keyboard. `seated_work_hard` uses a dedicated four-second loop with 3.5 wrist taps/second, compared with the retained normal clip's 2 taps/second. Only working motion becomes faster; navigation and posture transitions retain their own timing.

The Manager never equips, attaches or displays this accessory in any state. Working uses the existing calm `seated_work` clip at its authored speed after normal navigation and seating. Manager completion returns to calm idle without accessory gestures. The shared state/navigation/selection architecture is unchanged. Historical Manager accessory clips and the unused helper remain in the supplied derivative GLB to preserve asset bytes; the application never selects those clips for a Manager.

For standard workers, leaving working plays the exact reverse `headband_off` before idle or movement. The band stays attached to the animated helper throughout, becoming hidden only after reaching the waist. Mid-sequence changes reverse the same progress value. Blocked/repair finishes safe removal and settles seated idle before pausing; an already unaccessorized walking/posture pose retains the existing pause behavior. No timer changes an application status or invents task completion.

Each character has its original 20 skeletal bones plus one non-deforming `headband_anchor`. Blender authors the helper and both hands together. During hard work the helper remains fixed relative to the head. Accessory fitting changes only the accessory scale. The ring, bow and tails remain the supplied mesh.

## Workstation return boundary

`workstationReturn.ts` retraces the last accepted route to the assigned standing anchor when an agent re-enters working without a new path. It verifies that the route includes the current position and ends at that workstation. An unknown location requires an explicit safe route from navigation; it produces a diagnostic instead of teleporting or inventing a straight path through furniture. A fresh seated snapshot must use the seat anchor. Changed position fields do not teleport mounted characters.

## Shared resources and selection

- `RedHeadbandAsset` in `src/assets/officeAssets.ts`: stable ID `accessory.red-headband.v1`, runtime `/assets/3d/accessories/red-headband.glb`.
- `AnimatedCharacter.tsx` mounts its cached `useGLTF` accessory loader only for standard workers. `CharacterAnimationPlayer` clones accessory transforms; geometry, material and embedded textures remain shared across workers. Manager rendering receives no accessory and cannot initiate a headband request.
- The helper belongs to each independent skeleton. Accessory visibility and pose require both standard-worker identity and the appropriate visual state, never task truth.
- Band and character raycasts bubble to the same entity group and selection ID. The Manager retains its own ID and dedicated model.
- Visible unselected characters sample bones at 24 Hz; selected characters sample each active frame. Offscreen skeleton evaluation stops while deterministic motion timing continues; re-entry samples the current pose. Sleeping/idle actors stop updates after settling. No React state updates run per frame. Hidden bands are excluded from raycasts.

## Reproduction and validation

The measurements and browser report below preserve the original asset milestone, which allowed both models to wear the band. That Manager behavior is superseded by the worker-only ownership rule above. [Current behavior evidence](../../docs/validation/worker-only-headband-browser.json) records 22 passing Chromium checks: a fresh Manager-only world makes no worker/headband requests and has no attachment in any of the nine states, while the mixed preview preserves 30 shared worker accessories, completion removal and independent selection. Manager departure/return resumes the normal working clip without accessory gestures. No console errors, failed requests or hot reloads occurred. Typecheck, lint, all 132 automated tests, formatting and production build pass; existing lint warnings and the bundle-size advisory remain. Asset hashes are unchanged and no conversion was rerun.

Run `scripts/intake_headband.py` in Blender first, then `scripts/rig_office_characters.py`. `scripts/verify_character_animation.py` checks unchanged canonical mesh buffers, normalized weights, ten clips, reversible on/off motion and head attachment. `scripts/verify_desk_manager.py --stage-runtime` stages verified character derivatives. The separate headband intake stages its verified shared GLB. `scripts/verify_headband_sequence.py` checks the exported physical trajectories and contact.

Development `/?workers=preview` provides explicitly labeled test input for thirty workers and one Manager: work, complete, state interruptions, an outbound route and return. These samples are excluded from the production bundle. Default production remains disconnected with no fabricated workforce.

Final physical checks cover 51 samples per accessory clip, four crossfade pairs at five blend weights for each character, and the existing dense posture review. They find no sampled character/desktop, visible-band/desktop, or visible-band/chair intersections. Maximum hand-to-grip separation is 1.935 mm for the worker and 3.586 mm for the Manager. Mesh/image/material preservation checks pass for both characters and all original source hashes remain unchanged. Exact export hashes and measurements are in [sequence-verification.json](sequence-verification.json) and [character verification](../animation/verification.json).

Chromium passes 44 behavior checks with thirty workers and one distinct Manager: pickup, placement, faster work, completion removal, interrupted/reversed sequences, route return, selection, hidden-band raycast exclusion, offscreen movement/re-entry, cameras and responsive resize. There are no console errors or failed requests, and the five shared GLBs each load once. [Browser verification](browser-verification.json) records loaded-byte hashes and production checks; production excludes development employees/controls and verifies the final character/accessory hashes. Project typecheck, lint, all 92 tests, formatting and production build pass; lint retains five pre-existing prototype warnings, and the build retains its large-chunk advisory.

## Limits

The band is rigid cloth with proportion-specific scaling, not a cloth simulation. Hands have no finger articulation, so pickup uses the existing hand surface rather than a finger grip. A tied ring is carried as one intact supplied object; no folding/untying is simulated. Unknown locations need a supplied safe path. Source units and rights remain unverified. Thirty-worker validation does not certify performance on every GPU or with 100 simultaneously selected-quality characters.
