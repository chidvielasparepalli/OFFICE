import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PropertyBinding,
} from 'three'
import type { Object3D } from 'three'

// One small placeholder prop; the actual application file lives in the accessible inspector.
const coverGeometry = new BoxGeometry(0.27, 0.34, 0.024)
const paperGeometry = new BoxGeometry(0.245, 0.3, 0.012)
const coverMaterial = new MeshStandardMaterial({
  color: '#967b50',
  roughness: 0.9,
})
const paperMaterial = new MeshStandardMaterial({
  color: '#f7f4e9',
  roughness: 1,
})

export function attachRecruitmentFolder(model: Object3D) {
  // GLTFLoader uses PropertyBinding's sanitized names for imported rig nodes.
  const hand = model.getObjectByName(PropertyBinding.sanitizeNodeName('hand.R'))
  if (!hand) return null
  const folder = new Group()
  folder.name = 'recruitment-application-file'
  folder.add(new Mesh(coverGeometry, coverMaterial))
  const paper = new Mesh(paperGeometry, paperMaterial)
  paper.position.set(0, 0.025, 0.015)
  folder.add(paper)
  folder.position.set(0, 0.13, 0.01)
  folder.rotation.set(Math.PI / 2, 0, 0)
  hand.add(folder)
  return folder
}
