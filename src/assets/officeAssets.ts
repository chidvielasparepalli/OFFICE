import warehouse from '../../assets/warehouse/conversion.json'
import layout from '../../assets/warehouse/open-layout.json'
import workerConversion from '../../assets/workers/conversion.json'
import deskManager from '../../assets/desk-manager/conversion.json'
import characterAnimation from '../../assets/animation/conversion.json'
import headband from '../../assets/headband/conversion.json'

export const RedHeadbandAsset = {
  id: 'accessory.red-headband.v1',
  productionUrl: '/assets/3d/accessories/red-headband.glb',
  provenance: 'assets/headband/README.md',
  ...headband,
} as const

export const StandardWorkerAsset = {
  id: 'agent.standard-stickman.v1',
  status: 'canonical-registered',
  provenance: 'assets/workers/README.md',
  ...workerConversion.standardWorker,
  ...characterAnimation.worker,
  animations: Object.keys(characterAnimation.worker.clips),
  pose: 'Rigged; state-driven seated, standing and walking clips',
  previewUrl: '/assets/3d/characters/standard-worker-animated.glb',
  productionUrl: '/assets/3d/characters/standard-worker-animated.glb',
} as const

// A missing Manager asset must never fall back to StandardWorkerAsset.
export const ManagerAsset = {
  id: 'agent.manager',
  status: 'canonical-registered',
  provenance: 'assets/desk-manager/README.md',
  ...deskManager.manager,
  ...characterAnimation.manager,
  animations: Object.keys(characterAnimation.manager.clips),
  pose: 'Rigged; state-driven seated, standing and walking clips',
  previewUrl: '/assets/3d/characters/primary-manager-animated.glb',
  productionUrl: '/assets/3d/characters/primary-manager-animated.glb',
} as const

export const WorkstationAsset = {
  id: 'workstation.standard-modern-desk.v1',
  previewUrl: '/assets/3d/workstations/standard-workstation.glb',
  productionUrl: '/assets/3d/workstations/standard-workstation.glb',
  status: 'canonical-registered',
  provenance: 'assets/desk-manager/README.md',
  ...deskManager.workstation,
} as const

export const officeAssets = {
  warehouse: {
    id: warehouse.asset_id,
    status: 'candidate-local-preview',
    productionUrl: null,
    previewUrl: `/${warehouse.file}`,
    releaseBlockers: [
      'Creator, license and redistribution permission are unverified.',
      'Original MTL files and textures are missing; materials are neutral replacements.',
      'Source units are inferred from stairs and need author confirmation.',
    ],
    layout,
    // Frame future standing workers as well as the flat floor.
    bounds: {
      width:
        2 * Math.max(...warehouse.bounds.map((point) => Math.abs(point[0]))),
      depth:
        2 * Math.max(...warehouse.bounds.map((point) => Math.abs(point[2]))),
      height: layout.workerEnvelopeHeight,
    },
    anchors: warehouse.anchors,
  },
} as const
