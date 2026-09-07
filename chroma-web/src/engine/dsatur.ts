import type { EngineSession, SchedulingInput, Timeslot } from '../domain/types'
import { buildConflictGraph } from './graphBuilder'
import { possibleSpans, isBlocked, type SlotSpan, spanOverlaps } from './slots'

export interface ColoringResult {
  assignments: Map<string, Timeslot>
  /** Sessions the algorithm could not place without at least one conflict — Validate will
   * surface exactly why; this is just bookkeeping for the caller. */
  forcedConflictSessionIds: Set<string>
}

/** DSATUR-flavored greedy coloring, adapted for variable-duration sessions: "saturation" is
 * approximated as the count of already-placed neighboring sessions (an exact per-slot
 * saturation count isn't meaningful here since each session's own candidate slots differ
 * by its duration), which keeps the same "place the most-constrained session first"
 * heuristic DSATUR is built on. */
export function colorSchedule(
  input: SchedulingInput,
  sessions: EngineSession[],
  fixedAssignments?: Map<string, Timeslot>,
): ColoringResult {
  const graph = buildConflictGraph(sessions)
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const assigned = new Map<string, SlotSpan>()
  const forcedConflictSessionIds = new Set<string>()

  // Seed with any fixed (frozen) assignments so their occupied periods are respected
  // immediately by every session colored afterward.
  if (fixedAssignments) {
    for (const [sessionId, ts] of fixedAssignments) {
      const session = sessionById.get(sessionId)
      if (!session) continue
      const periods: number[] = []
      for (let i = 0; i < session.durationPeriods; i++) periods.push(ts.periodIndex + i)
      assigned.set(sessionId, { dayOfWeek: ts.dayOfWeek, periods })
    }
  }

  const remaining = new Set(sessions.map((s) => s.id).filter((id) => !assigned.has(id)))

  const neighborSpans = (sessionId: string): SlotSpan[] => {
    const neighbors = graph.get(sessionId) ?? new Set()
    const spans: SlotSpan[] = []
    for (const n of neighbors) {
      const span = assigned.get(n)
      if (span) spans.push(span)
    }
    return spans
  }

  while (remaining.size > 0) {
    // Pick the most-constrained remaining session: most already-placed neighbors first,
    // then highest total degree, then id for determinism.
    let bestId: string | null = null
    let bestSaturation = -1
    let bestDegree = -1
    for (const id of remaining) {
      const neighbors = graph.get(id) ?? new Set()
      const saturation = [...neighbors].filter((n) => assigned.has(n)).length
      const degree = neighbors.size
      if (
        saturation > bestSaturation ||
        (saturation === bestSaturation && degree > bestDegree) ||
        (saturation === bestSaturation && degree === bestDegree && (bestId === null || id < bestId))
      ) {
        bestId = id
        bestSaturation = saturation
        bestDegree = degree
      }
    }
    const sessionId = bestId!
    remaining.delete(sessionId)
    const session = sessionById.get(sessionId)!
    const blocked = session.teacherId ? input.blockedTeacherSlots[session.teacherId] : undefined
    const candidates = possibleSpans(input, session.durationPeriods)
    const conflicts = neighborSpans(sessionId)

    // Preference order: a slot with zero conflicts and not blocked; then a slot with zero
    // conflicts even if we can't verify availability; then the slot with the fewest
    // conflicting neighbors, so the session is always placed somewhere.
    let chosen: SlotSpan | undefined
    let bestConflictCount = Infinity
    for (const span of candidates) {
      const blockedHere = isBlocked(blocked, span)
      const conflictCount = conflicts.filter((c) => spanOverlaps(c, span)).length
      const score = conflictCount * 2 + (blockedHere ? 1 : 0)
      if (score < bestConflictCount) {
        bestConflictCount = score
        chosen = span
        if (score === 0) break
      }
    }
    if (!chosen && candidates.length > 0) chosen = candidates[0]
    if (chosen) {
      assigned.set(sessionId, chosen)
      if (bestConflictCount > 0) forcedConflictSessionIds.add(sessionId)
    }
  }

  const result = new Map<string, Timeslot>()
  for (const [id, span] of assigned) {
    result.set(id, { dayOfWeek: span.dayOfWeek, periodIndex: span.periods[0] })
  }
  return { assignments: result, forcedConflictSessionIds }
}
