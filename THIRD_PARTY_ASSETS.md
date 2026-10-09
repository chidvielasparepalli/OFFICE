# Third-party assets

## Supplied Prop118 Red Headband

Source: `A:\New folder\Prop118 Red Headband\model_0.obj`, `Headband_BaseColor.png` and `Headband_Roughness.png`. The referenced MTL is absent. Creator, source URL, license, attribution and use/modification/redistribution terms are unverified. The reconstructed cloth material uses the supplied maps. One runtime derivative, `public/assets/3d/accessories/red-headband.glb`, is reused by standard workers only; the Manager never loads or wears it. Exact source hashes, conversion and verification: [headband report](assets/headband/README.md). No external animation or replacement accessory was used.

The user-authorized character animation derivatives are `public/assets/3d/characters/standard-worker-animated.glb` and `primary-manager-animated.glb`. Static conversion copies remain under ignored `assets/working/` for rollback. Rigging preserves mesh positions, UVs, topology, materials and embedded images. No replacement character or external animation was used. The original provenance and unverified licensing terms below still apply. See [animation evidence](assets/animation/README.md).

## Office Warehouse — local intake candidate only

- Supplied by the user at `A:\New folder\office_WAREHOUSE`.
- 257 OBJ files; exact names, sizes and SHA-256 hashes: [source inventory](assets/warehouse/source-inventory.json).
- Historical source reference: [Sketchfab Office Warehouse](https://sketchfab.com/3d-models/office-warehouse-e3988ea169c446dfa06da8600381fb84). The link and package relationship could not be verified; the page returned HTTP 403.
- Creator: unknown. License: unknown. Attribution, modification and redistribution terms: unknown.
- No MTL, textures or license file accompanied the supplied OBJs.
- Raw sources, enclosed derivatives and Blender working files remain ignored. The small open-floor GLB is included in the checkpoint so development previews work from a fresh clone; it remains outside `public/` and is not shipped by the production build.
- Current derivative: `world.office-open.v1`, `assets/working/warehouse/office-open.glb` (4,404 bytes). It reuses only the foundation from `model_3.obj`, resized to a 36 × 36 m open plan. The earlier enclosed warehouse export is no longer registered or loaded.
- Do not treat this entry as permission or completed attribution. Resolve provenance and license terms before production adoption, redistribution or deployment.

Technical intake, conversion and limitations: [warehouse report](assets/warehouse/README.md).

## Stickman standard worker and earlier Office Desk

- Canonical normal-worker source: `A:\New folder\Stickman\model_0.obj` and `x.png`; missing `model_0.mtl`.
- Workstation source: `A:\New folder\office-desk\source\Office Desk\Office Desk.obj`; its companion ZIP contains the identical OBJ only. `Office Desk.mtl` is missing; no textures were supplied.
- Creator, external source URL, license, attribution, modification and redistribution terms are **unverified for both packages**. No license was inferred from filenames, OBJ exporter metadata or the user's canonical-model designation.
- Working derivatives: `assets/working/workers/standard-worker.glb` and `office-workstation.glb`. The stickman's animated derivative is registered at `public/assets/3d/characters/standard-worker-animated.glb`. The earlier desk is retired; only its chair is incorporated in the new workstation below.
- The dedicated Manager is now supplied and registered separately; it never uses the stickman.

Exact hashes and asset processing: [worker/workstation report](assets/workers/README.md).

## Official Modern Desk Setup and Indian Man in suit

- User-provided sources: `A:\New folder\Modern Desk Setup – Game Ready 3D Model` and `A:\New folder\Indian Man in suit`.
- Exact names/hashes: [desk inventory](assets/desk-manager/workstation-source.json), [Manager inventory](assets/desk-manager/manager-source.json).
- Neither folder contains a license, creator credit, source URL or MTL. Creator, website, license, attribution and use/modification/redistribution terms are **unverified**. Official designation establishes the chosen visual identity, not inferred licensing terms.
- Canonical runtime files: `public/assets/3d/workstations/standard-workstation.glb` and `public/assets/3d/characters/primary-manager-animated.glb`. These are included in local production builds as requested after validation; the default disconnected scene mounts no workforce.
- The accepted runtime derivatives are included in the user-requested GitHub checkpoint. Licensing remains unverified; this provenance record is not a license grant or production deployment approval.
- [Full intake evidence](assets/desk-manager/README.md) documents original preservation, reconstructed shaders, optimization and limitations.
