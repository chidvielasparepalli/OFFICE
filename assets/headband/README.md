# Supplied red headband

This is the user's `A:\New folder\Prop118 Red Headband` accessory, reused by both canonical character assets. The worker and Manager remain separate characters. Original files are untouched; SHA-256 hashes and sizes are in [source-inventory.json](source-inventory.json).

## Source inspection

| File                     |            Size | Contents                                                                                         |
| ------------------------ | --------------: | ------------------------------------------------------------------------------------------------ |
| `model_0.obj`            | 1,780,152 bytes | One object, 5,839 positions, 5,839 normals, 5,839 UV coordinates, 17,549 triangular face records |
| `Headband_BaseColor.png` |   825,592 bytes | 2048 × 2048 color map                                                                            |
| `Headband_Roughness.png` |   710,636 bytes | 2048 × 2048 roughness map                                                                        |

The OBJ references absent `model_0.mtl`, with no `usemtl` statement. No companion documentation, skeleton, skin weights, animation, license, creator, source URL, or attribution instructions were supplied. Licensing, redistribution permission and attribution requirements remain **unverified**. Original shader settings are unknown. The working material uses the two explicitly named supplied maps, sRGB color, linear roughness, and metallic zero.

Blender 5.2.1 LTS inspection identifies six connected pieces within the one mesh: the ring, central knot, two bow loops and two hanging tails. There are no duplicate complete meshes. Exactly 6,997 source face records have zero area, including 71 repeated degenerate face records. Blender discards those faces, leaving **10,552 valid triangles and 5,839 vertices**. All valid triangles and UVs are retained; there is no silhouette redesign or decimation.

Source bounding dimensions are **80.875839 × 112.576927 × 85.185678 unspecified units**. The vertical cloth and tails establish Z-up; the bow/tails are toward source +Y, with the unobstructed front toward source −Y. Original units are unspecified, not inferred as centimeters or meters.

## Normalization and runtime asset

The canonical ring opening has outer width **0.200 m**, depth **0.259128 m**, and height **0.067631 m**. Its origin is the ring bounds center; including bow/tails, complete dimensions are **0.211536 × 0.222809 × 0.294453 m** in runtime X/Y/Z order. The source center is `[0.026172638, -2.618165970, -2.097146034]`, with uniform conversion scale `0.002615570659440216`.

The explicit conversion is `[(x-centerX)*s, (z-centerZ)*s, -(y-centerY)*s]`: runtime Y-up, meters, front +Z and rear bow −Z. Blender's incidental OBJ object rotation is removed before normalization.

The working GLB is `assets/working/headband/red-headband.glb`; after render verification its runtime copy is `public/assets/3d/accessories/red-headband.glb`. It contains **one mesh, one primitive, one material, two embedded PNG images**, with no external texture requests, skin or animation. Base color is reduced to 1024²; roughness to 512². The initial verified export is **646,796 bytes**; [conversion.json](conversion.json) records the authoritative current hash and size.

## Attachment contract

[conversion.json](conversion.json) and [fits.json](fits.json) contain independently calibrated worker and Manager fits. `headOffset` is measured in the existing `head` bone's local frame; its rest orientation matches runtime X/Y/Z. The dedicated nondeforming `headband_anchor` helper rests at `head + headOffset`. Its child receives **only `scale`**, with zero translation/rotation, because the helper already incorporates the offset. Applying the offset twice is incorrect.

`grips` are two physical supplied ring-surface locations, in **fit-scaled meters relative to the accessory helper origin**, ordered right (negative X), then left (positive X). They do not require another scale multiplication. `grips_asset_local` are the unscaled canonical equivalents. `grips_head_local` include the head offset for diagnostics. `full_bounds` and `full_dimensions` include the bow/tails and support carry-path clearance checks.

Every instance uses the same GLB geometry and material resources. Fit transforms affect the accessory only. Canonical character geometry, appearance and materials remain unchanged. The accessory itself stores no business state or character identity. External helper-bone clips and the application's state boundary own wearing/removal behavior.

## Validation and limitations

Inspection renders are in ignored `assets/working/headband/`: normalized front/back/top/isometric views, plus front/side/back/isometric fits for both supplied heads. The fitted ring remains above the eyes/glasses; rear bow and tails remain recognizable. Initial clipping was corrected by measured accessory transforms before runtime staging.

The supplied cloth shape is rigid. A single ring cannot conform perfectly to both the spherical worker and human skull using scale alone; the fitting prioritizes a continuous visible band without cutting through faces/hair. Small nonuniform gaps around the folded ring remain. No cloth simulation, new textures, replacement character, backend or runtime business activity is introduced. Application state transitions and browser validation are covered by the main animation integration task.

Reproduce with isolated Blender: `blender --background --factory-startup --python-exit-code 1 --python scripts/intake_headband.py`. The script copies source files to ignored working storage, measures them, creates the normalized GLB, reloads that GLB to render both fits, writes metadata, and rechecks all original hashes. Runtime staging occurs only after reviewing those renders.
