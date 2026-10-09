import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentPlacement } from '../office/workerPresentation'
import { seatedWorkstationAnchor } from '../office/characterMotion'
import WorkerAssetPreview from './WorkerAssetPreview'

vi.mock('../components/3d/OfficeWorld', () => ({
  OfficeWorld: (props: { inspectionSamples: AgentPlacement[] }) => (
    <output data-testid="preview-input">{JSON.stringify(props)}</output>
  ),
}))

afterEach(cleanup)

function previewInput() {
  return JSON.parse(screen.getByTestId('preview-input').textContent!) as {
    inspectionSamples: AgentPlacement[]
    runtime?: unknown
  }
}

describe('explicit development animation controls', () => {
  it('passes 30 working worker samples and a distinct Manager, never a runtime snapshot', () => {
    render(<WorkerAssetPreview />)
    const { inspectionSamples, runtime } = previewInput()
    expect(runtime).toBeUndefined()
    expect(inspectionSamples).toHaveLength(31)
    expect(
      inspectionSamples.filter((sample) => sample.kind === 'manager'),
    ).toEqual([
      expect.objectContaining({
        id: 'asset-manager-primary',
        status: 'working',
      }),
    ])
    expect(
      inspectionSamples.every((sample) => sample.status === 'working'),
    ).toBe(true)
    for (const sample of inspectionSamples)
      expect(sample.position).toEqual(
        seatedWorkstationAnchor(sample.workstation!),
      )
    expect(screen.getByText(/animation test states only/)).toBeDefined()
  })

  it('requests working without inventing a return path, and completion without invented task data', () => {
    render(<WorkerAssetPreview />)
    fireEvent.click(screen.getByRole('button', { name: 'Walk test route' }))
    expect(previewInput().inspectionSamples[0].motion).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: 'Work at assigned desk' }),
    )
    const working = previewInput().inspectionSamples[0]
    expect(working.status).toBe('working')
    expect(working.motion).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Complete test work' }))
    expect(previewInput().inspectionSamples[0].status).toBe('completed')
    expect(previewInput().runtime).toBeUndefined()
    expect(previewInput().inspectionSamples[1].status).toBe('working')
  })

  it('issues reversible routes for only the chosen character while preserving workstation anchors', () => {
    render(<WorkerAssetPreview />)
    fireEvent.change(screen.getByLabelText('Character'), {
      target: { value: 'asset-manager-primary' },
    })
    const before = previewInput().inspectionSamples
    fireEvent.click(screen.getByRole('button', { name: 'Walk test route' }))
    const walking = previewInput().inspectionSamples
    const manager = walking.at(-1)!
    expect(walking.slice(0, 30)).toEqual(before.slice(0, 30))
    expect(manager.status).toBe('walking')
    expect(manager.workstation).toEqual(before.at(-1)!.workstation)
    expect(manager.motion?.points).toHaveLength(3)
    expect(manager.motion!.points[1][0]).toBe(1.2)
    expect(manager.motion!.points[1][2]).toBeCloseTo(-11.68)
    expect(manager.motion!.points[2][0]).toBe(1.2)
    expect(manager.motion!.points[2][2]).toBeCloseTo(-12.68)
    fireEvent.change(screen.getByLabelText('Test state'), {
      target: { value: 'blocked' },
    })
    expect(previewInput().inspectionSamples.at(-1)!.motion).toEqual(
      manager.motion,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Return to workstation' }),
    )
    const returned = previewInput().inspectionSamples.at(-1)!
    expect(returned.status).toBe('working')
    expect(returned.motion?.points).toEqual(
      [...manager.motion!.points].reverse(),
    )
    expect(returned.motion?.id).not.toBe(manager.motion?.id)
  })

  it('exposes all nine explicit inputs and cheap sleeping inspection for all samples', () => {
    render(<WorkerAssetPreview />)
    for (const status of [
      'sleeping',
      'queued',
      'working',
      'walking',
      'collaborating',
      'waiting',
      'completed',
      'blocked',
      'repair',
    ]) {
      fireEvent.change(screen.getByLabelText('Test state'), {
        target: { value: status },
      })
      expect(previewInput().inspectionSamples[0].status).toBe(status)
    }
    fireEvent.click(screen.getByRole('button', { name: 'All sleeping' }))
    expect(
      previewInput().inspectionSamples.every(
        (sample) => sample.status === 'sleeping',
      ),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'All working' }))
    expect(
      previewInput().inspectionSamples.every(
        (sample) => sample.status === 'working',
      ),
    ).toBe(true)
    expect(
      previewInput().inspectionSamples.every((sample) => !sample.motion),
    ).toBe(true)
  })
})
