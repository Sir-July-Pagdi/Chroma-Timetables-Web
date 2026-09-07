import type { ConstraintViolation, SchedulingInput, Timeslot } from '../domain/types'
import { colorSchedule } from './dsatur'
import { assignRooms } from './roomAssigner'
import { validateAssignmentMap } from './constraintValidator'

export interface RepairResult {
  assignments: Map<string, Timeslot>
  roomBySession: Map<string, string | undefined>
  remainingViolations: ConstraintViolation[]
  /** Sessions whose placement actually changed from what was passed in — used to decide
   * whether a repair silently touched something outside its authorized scope. */
  recoloredSessionIds: Set<string>
}

export function repairWithinScope(
  input: SchedulingInput,
  existingAssignments: Map<string, Timeslot>,
  existingRoomBySession: Map<string, string | undefined>,
  selectedSessionIds: Set<string>,
): RepairResult {
  const frozenAssignments = new Map<string, Timeslot>()
  const frozenRooms = new Map<string, string | undefined>()
  for (const [sessionId, ts] of existingAssignments) {
    if (!selectedSessionIds.has(sessionId)) frozenAssignments.set(sessionId, ts)
  }
  for (const [sessionId, roomId] of existingRoomBySession) {
    if (!selectedSessionIds.has(sessionId)) frozenRooms.set(sessionId, roomId)
  }

  // colorSchedule/assignRooms build the FULL conflict graph (so edges to frozen sessions
  // are respected) but only produce fresh output for ids not already present in the
  // seeded maps above — i.e. exactly the selected scope.
  const { assignments: colored } = colorSchedule(input, input.sessions, frozenAssignments)
  const roomBySession = assignRooms(input, input.sessions, colored, frozenRooms)

  const recoloredSessionIds = new Set<string>()
  for (const sessionId of selectedSessionIds) {
    const before = existingAssignments.get(sessionId)
    const after = colored.get(sessionId)
    const beforeRoom = existingRoomBySession.get(sessionId)
    const afterRoom = roomBySession.get(sessionId)
    const changed =
      !before || !after || before.dayOfWeek !== after.dayOfWeek || before.periodIndex !== after.periodIndex || beforeRoom !== afterRoom
    if (changed) recoloredSessionIds.add(sessionId)
  }

  const remainingViolations = validateAssignmentMap(input, colored, roomBySession)
  return { assignments: colored, roomBySession, remainingViolations, recoloredSessionIds }
}
