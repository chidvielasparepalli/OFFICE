import type {
  ManagerRequest,
  Planner,
  PlanningContext,
} from './orchestrationTypes'

export type ProposalFactory = (
  request: Readonly<ManagerRequest>,
  context: Readonly<PlanningContext>,
) => unknown

/** Explicitly injected deterministic proposals; no templates or runtime side effects. */
export class DeterministicPlanner implements Planner {
  private readonly factory: ProposalFactory

  constructor(factory: ProposalFactory) {
    this.factory = factory
  }

  async plan(
    request: Readonly<ManagerRequest>,
    context: Readonly<PlanningContext>,
  ): Promise<unknown> {
    // Validation and committing are separate boundaries owned by the runtime.
    return this.factory(request, context)
  }
}
