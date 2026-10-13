import type { RecruitmentSpec } from './recruitmentTypes'
import { recruitmentInstructions } from './recruitmentTypes'

/** Conservative onboarding ceiling, not a provider invoice or capability guarantee. */
export function estimateRecruitmentCost(spec: RecruitmentSpec): number | null {
  if (spec.adapterMode !== 'openai') return 0
  if (!Number.isSafeInteger(spec.maxOutputUnits) || spec.maxOutputUnits < 1)
    return null
  const encoder = new TextEncoder()
  const estimate = spec.skills.reduce((total, skill) => {
    const input = {
      instructions: recruitmentInstructions(spec),
      prompt: skill.prompt,
    }
    return (
      total +
      BigInt(encoder.encode(JSON.stringify(input)).byteLength + 4096) * 13n +
      BigInt(spec.maxOutputUnits) * 50n
    )
  }, 0n)
  return estimate <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(estimate) : null
}
