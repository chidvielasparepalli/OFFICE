import { describe, expect, it } from 'vitest'
import { Bone, Group, Mesh } from 'three'
import { attachRecruitmentFolder } from './recruitmentFolder'

describe('shared candidate application prop', () => {
  it('attaches independent transforms to each hand while sharing all geometry and materials', () => {
    const model = () => {
      const root = new Group(),
        hand = new Bone()
      hand.name = 'handR'
      root.add(hand)
      return root
    }
    const a = model(),
      b = model()
    const first = attachRecruitmentFolder(a)!,
      second = attachRecruitmentFolder(b)!
    expect(first.parent).toBe(a.getObjectByName('handR'))
    expect(second.parent).toBe(b.getObjectByName('handR'))
    expect(first).not.toBe(second)
    first.children.forEach((part, index) => {
      expect((part as Mesh).geometry).toBe(
        (second.children[index] as Mesh).geometry,
      )
      expect((part as Mesh).material).toBe(
        (second.children[index] as Mesh).material,
      )
    })
    first.removeFromParent()
    expect(a.getObjectByName('recruitment-application-file')).toBeUndefined()
    expect(b.getObjectByName('recruitment-application-file')).toBe(second)
  })
  it('does not invent a replacement rig when the hand is absent', () => {
    expect(attachRecruitmentFolder(new Group())).toBeNull()
  })
})
