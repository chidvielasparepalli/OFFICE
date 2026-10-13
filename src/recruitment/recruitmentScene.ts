import {
  createOfficeNavigation,
  preserveNavigationDeparture,
} from '../office/officeNavigation'
import type { AgentSpatialSnapshot, WorldPosition } from '../office/officeState'
import type { AgentPlacement } from '../office/workerPresentation'
import type { RuntimeState } from '../runtime/runtimeTypes'
import { currentProposal } from './recruitmentTypes'
import type { RecruitmentSession } from './recruitmentTypes'

const distance = (a: WorldPosition, b: WorldPosition) =>
  Math.hypot(a[0] - b[0], a[2] - b[2])

/** Candidate-only read model. Animation acknowledgements never activate an employee. */
export function createRecruitmentScene() {
  const cached = new Map<
    string,
    { intent: string; placement: AgentPlacement }
  >()
  return (
    state: Pick<RuntimeState, 'agents' | 'workstations'> & {
      recruitments: Readonly<Record<string, RecruitmentSession>>
    },
    views: ReadonlyMap<string, AgentSpatialSnapshot> = new Map(),
  ): AgentPlacement[] => {
    const visible = Object.values(state.recruitments).filter(
      (session) =>
        session.scene &&
        session.state !== 'hired' &&
        session.scene.phase !== 'departed' &&
        !state.agents[session.candidateId],
    )
    const visibleIds = new Set(visible.map((session) => session.candidateId))
    for (const id of cached.keys()) if (!visibleIds.has(id)) cached.delete(id)
    const stations = Object.values(state.workstations).map((station) => ({
      ...station,
      id: station.id,
    }))
    const navigation = visible.some(
      (session) =>
        !session.scene!.arrived &&
        cached.get(session.candidateId)?.intent !== session.scene!.intentId,
    )
      ? createOfficeNavigation(stations)
      : null
    return visible.map((session) => {
      const scene = session.scene!,
        spec = currentProposal(session).spec
      const previous = cached.get(session.candidateId)
      let motion = scene.arrived
        ? undefined
        : previous?.intent === scene.intentId
          ? previous.placement.motion
          : undefined
      let diagnostic: string | undefined
      if (!scene.arrived && previous?.intent !== scene.intentId) {
        const current = views.get(session.candidateId)?.position ?? scene.from
        const target = navigation!.nodes.find(
          (node) => distance(node.position, scene.to) < 0.001,
        )
        const route = target
          ? navigation!.planNavigation(current, target.id)
          : null
        if (route?.ok)
          motion = {
            id: scene.intentId,
            points: preserveNavigationDeparture(
              navigation!,
              route,
              current,
              previous?.placement.motion?.points,
            ).points,
            speedMetersPerSecond: 0.85,
            destination: { id: target!.id, position: scene.to },
          }
        else
          diagnostic =
            route && !route.ok
              ? route.diagnostic
              : 'The authored recruitment destination is unavailable.'
      } else diagnostic = previous?.placement.navigationDiagnostic
      const placement: AgentPlacement = {
        id: session.candidateId,
        kind: 'standard-worker',
        label: `${spec.name} — candidate for ${spec.role}`,
        role: spec.role,
        departmentId: spec.departmentId,
        candidateLabel: `${session.state.replaceAll('_', ' ')} · ${spec.adapterMode === 'openai' ? 'live assessment requested' : 'SIMULATION — not a production employee'}`,
        recruitmentFile: true,
        position: scene.arrived ? scene.to : scene.from,
        headingRadians: scene.headingRadians,
        status: !scene.arrived
          ? 'walking'
          : scene.phase === 'interview'
            ? 'collaborating'
            : 'queued',
        motion,
        navigationDiagnostic: diagnostic,
      }
      cached.set(session.candidateId, { intent: scene.intentId, placement })
      return placement
    })
  }
}
