import type { EngineSession, IdentityOverride, RosterSnapshot, SchedulingInput } from '../domain/types'
import { definedPeriodsByDayFrom, generatePeriodDefinitions } from '../domain/periods'
import type { PeriodBlockConfig } from '../domain/types'
import { timeslotKey } from '../domain/types'

export function buildSchedulingInput(roster: RosterSnapshot, periodBlocks: PeriodBlockConfig[]): SchedulingInput {
  const sessions: EngineSession[] = roster.sessions.map((s) => ({
    id: s.id,
    teacherId: s.teacherId,
    subjectId: s.subjectId,
    sectionId: s.sectionId,
    roomTypeRequired: s.roomTypeRequired,
    durationPeriods: s.durationPeriods,
  }))

  const sectionStudentCounts: Record<string, number> = {}
  for (const section of roster.sections) sectionStudentCounts[section.id] = section.studentCount

  const blockedTeacherSlots: Record<string, Set<string>> = {}
  const blockedRoomSlots: Record<string, Set<string>> = {}
  for (const block of roster.availability) {
    const key = timeslotKey({ dayOfWeek: block.dayOfWeek, periodIndex: block.periodIndex })
    const target = block.entityType === 'TEACHER' ? blockedTeacherSlots : blockedRoomSlots
    if (!target[block.entityId]) target[block.entityId] = new Set()
    target[block.entityId].add(key)
  }

  const periods = generatePeriodDefinitions(periodBlocks)
  const definedPeriodsByDay = definedPeriodsByDayFrom(periods)

  return { sessions, rooms: roster.rooms, sectionStudentCounts, blockedTeacherSlots, blockedRoomSlots, definedPeriodsByDay }
}

/** Applies guided-Repair identity overrides to a scheduling input's sessions before
 * validating/repairing, so a "swap Class" (etc.) is checked against what the timetable
 * would ACTUALLY look like, not each session's original unswapped roster identity. */
export function applyIdentityOverrides(input: SchedulingInput, overrides: Map<string, IdentityOverride>): SchedulingInput {
  if (overrides.size === 0) return input
  const sessions = input.sessions.map((s) => {
    const o = overrides.get(s.id)
    if (!o) return s
    return {
      ...s,
      teacherId: o.teacherId ?? s.teacherId,
      subjectId: o.subjectId ?? s.subjectId,
      sectionId: o.sectionId ?? s.sectionId,
    }
  })
  return { ...input, sessions }
}
