# 3D Asset Library — AI Corporate Office OS

> **Supplied red headband, 2026-10-09:** `A:\New folder\Prop118 Red Headband` contains one OBJ and two PNGs, with a missing MTL. The original files are preserved. One normalized 646,796-byte GLB retains all 10,552 valid triangles and shares embedded textures across standard workers only. The Manager never loads or wears this accessory. `RedHeadbandAsset` registers `accessory.red-headband.v1`. Historical fits, exact hashes, shader reconstruction and unverified rights are documented in `assets/headband/README.md`; current worker-only attachment behavior is in `assets/headband/ANIMATION.md`.

> **Character animation derivatives, 2026-10-09:** Both supplied canonical characters now have separate Blender rigs and proportion-fitted office clips. Meshes/materials remain unchanged. The registry uses `standard-worker-animated.glb` and `primary-manager-animated.glb`; original static working copies remain available. See `assets/animation/README.md` for source hashes, rigging, shared-resource playback and limitations. Original rights remain unverified.

> Curated starter library for the OFFICE 3D world.
>
> **Rule:** keep a record of the source URL, creator, format, license, and any attribution requirement for every external asset before adding it to the app.

## Asset strategy

Use a small number of reusable, optimized assets rather than hundreds of heavy unique models.

Priority:

1. GLB/glTF
2. Low/medium polygon count
3. Rigged/animated for characters
4. Easy to recolor/variant
5. Clear redistribution/use license
6. Reusable across many employees/workstations

---

## A. Employees / Characters

### 1. Office Worker 1 — Animated
**Source:** Fab / Tony Flanagan  
**URL:** https://www.fab.com/listings/c8b735b5-5f3f-499b-8e83-d53291f7303c  
**Status:** Candidate / free  
**Formats:** FBX, converted GLB, glTF, USDZ  
**Useful for:** seated office worker, desk/workstation state  
**Notes:** tagged Sitting, Office, Worker, Computer, Desk; listing currently marks it free and allows AI use. Verify the final license terms on download.

### 2. Office Worker 2 — Animated
**Source:** Fab / Tony Flanagan  
**URL:** https://www.fab.com/listings/b6377a19-a0aa-413e-bb58-32c679e1f839  
**Status:** Candidate / free  
**Formats:** Blender, GLB, glTF, USDZ  
**Useful for:** alternate employee/manager  
**Notes:** described as a Ready Player Me model rigged/animated in Mixamo and tweaked in Blender.

### 3. Office Worker 3 — Animated
**Source:** Fab / Tony Flanagan  
**URL:** https://www.fab.com/listings/007f9793-e57c-47dd-9ee0-0829a57bf1e4  
**Status:** Candidate / free  
**Formats:** GLB, glTF, USDZ  
**Useful for:** additional male employee variation

### 4. Office Worker 4 — Animated
**Source:** Fab / Tony Flanagan  
**URL:** https://www.fab.com/listings/1f38e404-0322-42d6-897d-5cec85c06175  
**Status:** Candidate / free  
**Formats:** FBX, GLB, glTF, USDZ  
**Useful for:** walking employee / meeting transitions  
**Notes:** listing includes walk-cycle, rigged and animated tags.

### 5. Office Worker 5 — Animated
**Source:** Fab / Tony Flanagan  
**URL:** https://www.fab.com/listings/3ec9acf7-1f4a-463d-b752-252f709bba68  
**Status:** Candidate / free  
**Formats:** FBX, GLB, glTF, USDZ  
**Useful for:** seated talking/collaboration variation

### 6. Office Worker 6 — Animated
**Source:** Fab / Tony Flanagan  
**URL:** https://www.fab.com/listings/c16b3db0-90ab-4e8d-b390-50a98403c651  
**Status:** Candidate / free  
**Formats:** FBX, GLB, glTF, USDZ  
**Useful for:** female employee variation

### 7. Office Worker 7 — Animated
**Source:** Fab / Tony Flanagan  
**URL:** https://www.fab.com/listings/15d304a9-e259-4f12-b95e-553e0b7b4609  
**Status:** Candidate / free  
**Formats:** GLB, glTF, USDZ  
**Useful for:** female/walk-cycle employee variation

### Character animation fallback
**Mixamo / Adobe**  
**URL:** https://www.mixamo.com/  
**Status:** Recommended  
**Use for:** idle, walk, run, sit, talk and other biped humanoid motion clips.  
**Notes:** Adobe states Mixamo is free with an Adobe ID and that its characters and animations can be used royalty-free for personal, commercial, and non-profit projects subject to its terms.

---

## B. Building / Office Environment

### 1. Office Building
**Source:** Sketchfab / Nikitos & 3130  
**URL:** https://sketchfab.com/3d-models/office-building-af9782245c134c21ae0c8df7f57077e6  
**License shown:** CC Attribution  
**Triangles:** ~644.7k  
**Status:** Reference / possible source  
**Notes:** attractive office environment, but too heavy to blindly use as the entire runtime scene. Prefer extracting ideas or optimizing parts in Blender.

### 2. Modern Office Building
**Source:** Sketchfab / Bl4ckGh0st  
**URL:** https://sketchfab.com/3d-models/modern-office-building-c6b0308c2ebb4842ae49aff70ce14ad0  
**License shown:** CC Attribution  
**Triangles:** ~9.1k  
**Status:** Strong candidate for exterior shell/reference  
**Notes:** very lightweight compared with many office scenes.

### 3. Office Building
**Source:** Sketchfab / TheRealDenzel98  
**URL:** https://sketchfab.com/3d-models/office-building-b3cdda652b49469bb24bf2e4e7ea69dc  
**License shown:** CC Attribution  
**Triangles:** ~3.2k  
**Status:** Strong low-poly reference/candidate  
**Notes:** intentionally simple and untextured, useful as a base for custom Blender editing.

### 4. Office Interior
**Source:** Sketchfab / Duder7563  
**URL:** https://sketchfab.com/3d-models/office-interior-51c660185fc0402cb34b10bf5f053001  
**License shown:** CC Attribution  
**Triangles:** ~505.7k  
**Status:** Reference / selective asset extraction

---

## C. Desks

### 1. Free Low Poly Office Desk
**Source:** Sketchfab / PolyDavid  
**URL:** https://sketchfab.com/3d-models/free-low-poly-office-desk-141c6024eb274976a378281e074178fe  
**License shown:** CC Attribution  
**Triangles:** ~330  
**Status:** Excellent performance candidate

### 2. FREE Shared Office Desk
**Source:** Sketchfab / Daniel Quaresma  
**URL:** https://sketchfab.com/3d-models/free-3d-model-shared-office-desk-204cf9e210c34d908e92c89afe4f1dc3  
**License shown:** CC Attribution  
**Triangles:** ~3.4k  
**Status:** Strong candidate  
**Notes:** low poly, PBR and game-ready.

### 3. Office Desk 140x60
**Source:** Sketchfab / AleixoAlonso  
**URL:** https://sketchfab.com/3d-models/office-desk-140x60-9262f311271c4c4390341e526d3fe103  
**License shown:** CC Attribution  
**Triangles:** ~7.1k  
**Status:** Good realistic desk candidate

### 4. Office Desk and Chair
**Source:** Sketchfab / Kasugamon  
**URL:** https://sketchfab.com/3d-models/office-desk-and-chair-0f246384414b4bde8c7e080d51e99a22  
**License shown:** CC Attribution  
**Triangles:** ~1.3k  
**Status:** Excellent stylized-office candidate

---

## D. Chairs

### 1. Office Chair
**Source:** Sketchfab / Tomaso  
**URL:** https://sketchfab.com/3d-models/office-chair-69208f9465c346308a2bf423c7e5b8f6  
**License shown:** CC Attribution  
**Triangles:** ~5k  
**Status:** Strong candidate

### 2. Low Poly Office Chair
**Source:** Sketchfab / AJVFX  
**URL:** https://sketchfab.com/3d-models/low-poly-office-chair-15b7a4b05f474236a6b10e762e823fc0  
**License shown:** CC Attribution  
**Triangles:** ~10.1k  
**Status:** Candidate, but heavier than the simpler chair above

### 3. Office Chair — low poly
**Source:** Sketchfab / kreems  
**URL:** https://sketchfab.com/3d-models/office-chair-low-poly-f353bbc60e6744e5e810115532e16cc05  
**License shown:** CC Attribution  
**Triangles:** ~2k  
**Status:** Excellent candidate

---

## E. Laptop / Computer

### 1. Low Poly Laptop
**Source:** Sketchfab / XX-Alias Neal  
**URL:** https://sketchfab.com/3d-models/low-poly-laptop-a9c2e21a123542fdaf8edfdac4c22869  
**License shown:** Free Standard  
**Triangles:** ~944  
**Status:** Excellent candidate  
**Notes:** CC0-style permissions are stated in the listing description.

### 2. Laptop
**Source:** Sketchfab / Aullwen  
**URL:** https://sketchfab.com/3d-models/laptop-7d870e900889481395b4a575b9fa8c3e  
**License shown:** CC Attribution  
**Triangles:** ~8.3k  
**Status:** Strong candidate  
**Notes:** screen is a separate object and can be animated/opened easily.

### 3. LowPoly 3D Laptop
**Source:** Sketchfab / Manix3D  
**URL:** https://sketchfab.com/3d-models/3d-laptop-lowpoly-model-free-b3971e50e9b84239babe22e28d98272d  
**License shown:** Free  
**Triangles:** ~35.5k  
**Status:** Reference only unless optimized.

---

## F. Monitors

### 1. Monitor — Blender / GLB / FBX
**Source:** Sketchfab / Juan111  
**URL:** https://sketchfab.com/3d-models/monitor-blender-glb-fbx-c378c509e8c24188a291be19ca284006  
**License shown:** CC Attribution  
**Triangles:** ~9.2k  
**Status:** Strong candidate

### 2. Monitor
**Source:** Sketchfab / Superenforcer_xp  
**URL:** https://sketchfab.com/3d-models/monitor-0b178000ef2344febd4c9846b0842b90  
**License shown:** CC Attribution  
**Triangles:** ~404  
**Status:** Excellent lightweight candidate

---

## G. Complete Workstation Packs

### 1. Low Poly Office Desk Set — 12 Models
**Source:** Sketchfab / santradragon  
**URL:** https://sketchfab.com/3d-models/low-poly-office-desk-set-12-models-game-read-bcd8fda8ceca41898d6ad148d4ee1472  
**License shown:** CC Attribution-NonCommercial  
**Status:** Reference/candidate only  
**Includes:** laptop, monitor, keyboard, mouse, mousepad, mug, pen holder, notebook, lamp, plant, headphones, photo frame.  
**Important:** NonCommercial means this is fine for personal experimentation but should not be treated as a default asset for a later commercial product.

### 2. Modern Desk Setup
**Source:** Sketchfab / mandeeprao10576  
**URL:** https://sketchfab.com/3d-models/modern-desk-setup-game-ready-3d-model-346abd870f044ccf955a68bae0365c4a  
**License shown:** CC Attribution  
**Status:** Strong workstation reference/candidate  
**Includes:** wooden desk, PC, monitor, laptop, keyboard, mouse, plant, mug, notebook, webcam and stationery.

---

## H. Meeting / Collaboration

### 1. Meeting Table
**Source:** Sketchfab / koppers  
**URL:** https://sketchfab.com/3d-models/meeting-table-76d2308357134270a1e08f50c50fa3af  
**License shown:** CC Attribution  
**Status:** Candidate  
**Notes:** heavy (~112k triangles), so optimize before repeating.

---

## I. Office Plants / Props

### 1. Office Plant
**Source:** Sketchfab / Gumiie  
**URL:** https://sketchfab.com/3d-models/office-plant-85c03c01a73a45de9bd9f92e0f48c942  
**License shown:** CC Attribution  
**Triangles:** ~18k  
**Status:** Candidate

### Poly Haven
**URL:** https://polyhaven.com/models  
**Status:** Preferred source for office props/furniture where suitable.  
**Notes:** Poly Haven provides a large public 3D asset library with categories including furniture, electronics, office/stationery, architecture and more.

---

# 2. Recommended V1 Asset Set

Do NOT download everything.

Start with:

## Character

- Office Worker 1
- Office Worker 2
- Office Worker 4
- Office Worker 6
- Office Worker 7

Then reuse/variant them for all agents.

## Environment

- custom Blender office shell
- Modern Office Building reference
- low-poly office interior elements

## Workstation

- Free Low Poly Office Desk
- Office Chair by Tomaso
- Low Poly Laptop
- Lightweight Monitor

## Props

- Office Plant
- coffee mug
- notebook
- keyboard
- mouse
- desk lamp

## Collaboration

- Meeting table
- 4–8 chairs
- whiteboard
- presentation screen

---

# 3. Asset Rules for Codex

When integrating assets:

1. Prefer GLB/glTF.
2. Inspect triangle count before importing.
3. Optimize models in Blender.
4. Generate lower LODs where necessary.
5. Reuse identical models.
6. Cache loaded assets.
7. Do not load duplicate files for identical employees.
8. Remove unused textures/materials.
9. Cap texture resolution when appropriate.
10. Keep attribution/license metadata in this file.

Recommended runtime asset paths:

```
public/assets/3d/
├── characters/
├── building/
├── furniture/
├── electronics/
├── props/
├── meeting/
└── animations/
```

---

# 4. License Rules

Before committing any external asset to the repository:

- record creator
- record source URL
- record exact license
- preserve required attribution
- check whether commercial use is allowed
- check whether modifications are allowed
- check whether redistribution is allowed
- avoid NoAI assets when the project's future AI-training/tooling use could create ambiguity
- avoid NonCommercial assets in code intended for later commercial distribution

For CC Attribution assets, create a future `THIRD_PARTY_ASSETS.md` attribution page before deployment.

---

# 5. Current Best Starting Combination

### People
Fab Office Worker 1/2/4/6/7

### Desk
Sketchfab Free Low Poly Office Desk

### Chair
Sketchfab Office Chair by Tomaso

### Laptop
Sketchfab Low Poly Laptop

### Monitor
Sketchfab Monitor by Superenforcer_xp

### Props
Poly Haven + Sketchfab CC-licensed props

### Animation
Mixamo

### Building
Custom Blender-built shell using the collected office models as reference, rather than shipping a huge third-party building unchanged.

---

# 6. Important Performance Target

The 3D office may eventually contain 40–100 agents.

Therefore:

**Do not use photorealistic 500k–1M triangle characters for every employee.**

Target a reusable, optimized character around the lowest practical triangle/texture budget while keeping close-up quality acceptable.

Use:

```
ONE MODEL
   ↓
many instances/variants
   ↓
LOD
   ↓
selective animation
```

The office should look richer as the camera gets closer without forcing maximum detail on the whole building.

---

# 7. Next Asset Collection Step

The next step after downloading the starter assets is:

1. Put the raw downloads in `assets/source/`.
2. Open them in Blender.
3. Normalize scale/orientation.
4. Remove unnecessary objects.
5. Optimize geometry.
6. Optimize textures.
7. Export production GLBs into `public/assets/3d/`.
8. Record the optimized file name against this manifest.
9. Build the R3F asset registry around the optimized files.
## Warehouse intake update — 2026-10-09

The user-provided `A:\New folder\office_WAREHOUSE` package has been inspected in Blender. Its 257 OBJs lack MTL files, UVs, textures and licensing evidence. The approved design is an open, single-level corporate workspace; the complete warehouse shell conflicts with that design. Only a connected ground slab from `model_3.obj` is reused, deliberately resized to 36 × 36 m. The Y-up, meter-based `office-open.glb` is 4,404 bytes, with one mesh, 12 triangles and 22 named spatial anchors. Roofs, ceilings, upper slabs, enclosing walls and overhead services are excluded.

Seven open department zones and a state-selection interface are prepared without workers or fabricated business state. The candidate is registered for development preview only; the production procedural shell remains active pending provenance/licensing. See [the measured intake report](assets/warehouse/README.md), [exact source inventory](assets/warehouse/source-inventory.json), [open-office contract](docs/OPEN_OFFICE_CONTRACT.md), and [provenance record](THIRD_PARTY_ASSETS.md). Phase 4 has not started. Earlier asset candidates remain references, not accepted production assets.

## Canonical worker decision — 2026-10-09

The supplied `A:\New folder\Stickman` is now the sole canonical normal-worker appearance; earlier character candidates are not substitutes. The Manager will have a distinct future asset and currently has no model. The supplied `A:\New folder\office-desk\source\Office Desk` provides the desk/chair and computer workstation. Both were inspected in Blender and converted into local GLBs, with originals preserved and licensing recorded as unverified. Thirty static asset samples are validated using shared GPU instances, without a runtime snapshot or fabricated activity. See [the full worker asset report](assets/workers/README.md). This is the user-authorized worker asset phase, not Phase 4 runtime implementation.

## Official desk + Manager decision — 2026-10-09

The latest request supersedes the previous desk and empty Manager slot. `A:\New folder\Modern Desk Setup – Game Ready 3D Model` is the canonical standard workstation; `A:\New folder\Indian Man in suit` is the dedicated Manager. The stickman remains the sole normal-worker model. The new desk contains no chair; only the previously supplied chair is reused in its GLB. Blender inspection removes 66 duplicate Manager meshes; originals remain unchanged. Runtime GLBs are registered under `public/assets/3d/` after validation of 30 stickmen, one Manager and 31 shared desks. Exact measurements, files, texture mappings, hashes and unverified licensing are in [the current report](assets/desk-manager/README.md). No commit/deployment or Phase 4 runtime is added.
