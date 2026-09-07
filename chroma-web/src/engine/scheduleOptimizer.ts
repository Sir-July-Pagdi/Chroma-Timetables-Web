import type { ConstraintViolation, SchedulingInput, Timeslot } from '../domain/types'
import { validateAssignmentMap } from './constraintValidator'
import { repairWithinScope } from './repairEngine'

export interface OptimizeResult {
  assignments: Map<string, Timeslot>
  roomBySession: Map<string, string | undefined>
  violations: ConstraintViolation[]
  focusSessionIds: Set<string>
}

export function optimizeSchedule(
  input: SchedulingInput,
  assignments: Map<string, Timeslot>,
  roomBySession: Map<string, string | undefined>,
): OptimizeResult {
  const violations = validateAssignmentMap(input, assignments, roomBySession)
  const focusSessionIds = new Set<string>()
  for (const v of violations) {
    focusSessionIds.add(v.sessionAId)
    if (v.sessionBId) focusSessionIds.add(v.sessionBId)
  }
  if (focusSessionIds.size === 0) {
    return { assignments, roomBySession, violations, focusSessionIds }
  }
  const result = repairWithinScope(input, assignments, roomBySession, focusSessionIds)
  return {
    assignments: result.assignments,
    roomBySession: result.roomBySession,
    violations: result.remainingViolations,
    focusSessionIds,
  }
}
