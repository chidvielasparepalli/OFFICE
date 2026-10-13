import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  window.history.replaceState(null, '', '/?recruitment=office')
})
vi.mock('./recruitment/RecruitmentOffice', () => ({
  default: () => <section>Authenticated recruitment office</section>,
}))
vi.mock('./components/3d/OfficeWorld', () => ({
  OfficeWorld: () => <section>Disconnected office</section>,
}))
import App from './App'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

it('does not claim the runtime is disconnected when displaying the recruitment office', async () => {
  render(<App />)
  await screen.findByText('Authenticated recruitment office')
  expect(screen.queryByText('Agent runtime not connected')).toBeNull()
  expect(screen.queryByText(/No agents are running here/)).toBeNull()
})
