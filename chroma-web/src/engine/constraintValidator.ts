import type { ConstraintViolation, EngineSession, SchedulingInput, Timeslot } from '../domain/types'
import { fitsDefinedPeriods, isBlocked, sessionSpan, spanOverlaps } from './slots'

/**
 * Confirmed against the Android app's real ConstraintValidator.kt: SUBJECT_DOUBLE_BOOKED
 * is deliberately NOT grouped by subjectId alone — two different sections legitimately
 * studying the same subject (e.g. both taking Math) at the same time is normal, not a
 * conflict, and grouping by subject alone used to flood real timetables with violations
 * that can't be fixed and shouldn't be. It groups by the (sectionId, subjectId) pair
 * instead: the real anomaly is the SAME section double-booked into the SAME subject
 * twice (e.g. a duplicate/erroneous session row).
 */
export function validateAssignmentMap(
  input: SchedulingInput,
  assignments: Map<string, Timeslot>,
  roomBySession: Map<string, string | undefined>,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = []
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]))
  const roomById = new Map(input.rooms.map((r) => [r.id, r]))

  const spans = new Map<string, ReturnType<typeof sessionSpan>>()
  for (const [sessionId, ts] of assignments) {
    const session = sessionById.get(sessionId)
    if (!session) continue
    const span = sessionSpan(session, ts.dayOfWeek, ts.periodIndex)
    if (!fitsDefinedPeriods(input, span)) {
      // Matches the Android engine: a session whose duration doesn't fit the day skips
      // every other check entirely (there's no valid occupied run to check against).
      violations.push({
        type: 'DURATION_EXCEEDS_AVAILABLE_PERIODS',
        sessionAId: session.id,
        message: `Session "${session.id}" (duration ${session.durationPeriods}) doesn't fit within day ${ts.dayOfWeek}'s defined periods starting at period ${ts.periodIndex}`,
      })
      continue
    }
    spans.set(sessionId, span)
  }

  const pairwiseCheck = (
    keyOf: (s: EngineSession) => string | undefined,
    type: ConstraintViolation['type'],
  ) => {
    const byKey = new Map<string, EngineSession[]>()
    for (const session of input.sessions) {
      const key = keyOf(session)
      if (!key || !assignments.has(session.id)) continue
      const list = byKey.get(key) ?? []
      list.push(session)
      byKey.set(key, list)
    }
    for (const list of byKey.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]
          const b = list[j]
          const spanA = spans.get(a.id)
          const spanB = spans.get(b.id)
          if (spanA && spanB && spanOverlaps(spanA, spanB)) {
            violations.push({
              type,
              sessionAId: a.id,
              sessionBId: b.id,
              message: describeConflict(type, a, b, type === 'ROOM_DOUBLE_BOOKED' ? roomBySession.get(a.id) : undefined),
            })
          }
        }
      }
    }
  }

  const roomKeyOf = (session: EngineSession) => roomBySession.get(session.id)
  pairwiseCheck((s) => s.teacherId, 'TEACHER_DOUBLE_BOOKED')
  pairwiseCheck(roomKeyOf, 'ROOM_DOUBLE_BOOKED')
  pairwiseCheck((s) => s.sectionId, 'SECTION_DOUBLE_BOOKED')
  // Composite (sectionId, subjectId) key, matching the Android engine exactly — NOT
  // grouped by subjectId alone, since two different sections legitimately studying the
  // same subject at the same time is normal, not a conflict.
  pairwiseCheck((s) => (s.sectionId && s.subjectId ? `${s.sectionId}::${s.subjectId}` : undefined), 'SUBJECT_DOUBLE_BOOKED')

  for (const session of input.sessions) {
    const span = spans.get(session.id)
    if (!span) continue

    if (session.teacherId && isBlocked(input.blockedTeacherSlots[session.teacherId], span)) {
      violations.push({
        type: 'TEACHER_UNAVAILABLE',
        sessionAId: session.id,
        message: `Session "${session.id}" is scheduled during a period teacher "${session.teacherId}" marked unavailable`,
      })
    }

    const roomId = roomBySession.get(session.id)
    if (roomId && isBlocked(input.blockedRoomSlots[roomId], span)) {
      violations.push({
        type: 'ROOM_UNAVAILABLE',
        sessionAId: session.id,
        message: `Session "${session.id}" is scheduled during a period room "${roomId}" is marked unavailable`,
      })
    }
  }

  // Independent of the duration-fit check above, matching the Android engine's
  // checkRoomCapacity — a session with a broken duration still gets its capacity checked.
  for (const session of input.sessions) {
    const sectionId = session.sectionId
    if (!sectionId) continue
    const roomId = roomBySession.get(session.id)
    if (!roomId) continue
    const room = roomById.get(roomId)
    if (!room) continue
    const studentCount = input.sectionStudentCounts[sectionId]
    if (studentCount === undefined) continue
    if (studentCount > room.capacity) {
      violations.push({
        type: 'ROOM_CAPACITY_EXCEEDED',
        sessionAId: session.id,
        message: `Session "${session.id}" has ${studentCount} students but room "${roomId}" capacity is ${room.capacity}`,
      })
    }
  }

  return violations
}

function describeConflict(type: ConstraintViolation['type'], a: EngineSession, b: EngineSession, roomId?: string): string {
  switch (type) {
    case 'TEACHER_DOUBLE_BOOKED':
      return `Sessions "${a.id}" and "${b.id}" overlap on teacher "${a.teacherId}"`
    case 'ROOM_DOUBLE_BOOKED':
      return `Sessions "${a.id}" and "${b.id}" are both booked in room "${roomId}" at an overlapping time`
    case 'SECTION_DOUBLE_BOOKED':
      return `Sessions "${a.id}" and "${b.id}" overlap on section "${a.sectionId}"`
    case 'SUBJECT_DOUBLE_BOOKED':
      return `Sessions "${a.id}" and "${b.id}" overlap on subject "${a.subjectId}"`
    default:
      return `Conflict between "${a.id}" and "${b.id}"`
  }
}
