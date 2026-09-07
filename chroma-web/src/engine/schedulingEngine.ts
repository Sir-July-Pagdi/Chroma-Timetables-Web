import type { ConstraintViolation, SchedulingInput, Timeslot } from '../domain/types'
import { colorSchedule } from './dsatur'
import { assignRooms } from './roomAssigner'
import { validateAssignmentMap } from './constraintValidator'

export interface GenerateResult {
  assignments: Map<string, Timeslot>
  roomBySession: Map<string, string | undefined>
  violations: ConstraintViolation[]
  executionTimeMillis: number
}

export function generateSchedule(input: SchedulingInput): GenerateResult {
  const start = performance.now()
  const { assignments } = colorSchedule(input, input.sessions)
  const roomBySession = assignRooms(input, input.sessions, assignments)
  const violations = validateAssignmentMap(input, assignments, roomBySession)
  return { assignments, roomBySession, violations, executionTimeMillis: Math.round(performance.now() - start) }
}
