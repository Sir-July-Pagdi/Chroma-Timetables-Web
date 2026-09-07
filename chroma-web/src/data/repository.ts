import { getDb, assignmentKey } from './db'
import { parseTeachersCsv, parseSubjectsCsv, parseRoomsCsv, parseSectionsCsv, parseSessionsCsv, parseAvailabilityCsv } from './csv/entityParsers'
import { validateCrossFileReferences } from './csv/crossFileValidator'
import type { CsvValidationError } from './csv/validation'
import { buildSchedulingInput, applyIdentityOverrides } from './buildSchedulingInput'
import { generateSchedule } from '../engine/schedulingEngine'
import { validateAssignmentMap } from '../engine/constraintValidator'
import { optimizeSchedule } from '../engine/scheduleOptimizer'
import { repairWithinScope, type RepairResult } from '../engine/repairEngine'
import { generatePeriodDefinitions, DEFAULT_PERIOD_BLOCKS } from '../domain/periods'
import type {
  ConflictRecord,
  ConstraintViolation,
  IdentityOverride,
  PeriodBlockConfig,
  RosterSnapshot,
  ScheduleAssignment,
  ScheduleRun,
  Timeslot,
} from '../domain/types'
import { dayLabelFor } from '../domain/types'

export interface RunSessionState {
  sessionId: string
  teacherId?: string
  teacherName?: string
  roomId?: string
  roomName?: string
  sectionId?: string
  sectionName?: string
  subjectId?: string
  subjectName?: string
  day: number
  period: number
  startTime: string
  endTime: string
  dayLabel: string
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export interface ImportedCsvBundle {
  roster: RosterSnapshot
  errors: CsvValidationError[]
}

export function parseRosterCsvs(files: {
  teachers: string
  subjects: string
  rooms: string
  sections: string
  sessions: string
  availability: string
}): ImportedCsvBundle {
  const teachers = parseTeachersCsv(files.teachers)
  const subjects = parseSubjectsCsv(files.subjects)
  const rooms = parseRoomsCsv(files.rooms)
  const sections = parseSectionsCsv(files.sections)
  const sessions = parseSessionsCsv(files.sessions)
  const availability = parseAvailabilityCsv(files.availability)

  const errors = [
    ...teachers.errors,
    ...subjects.errors,
    ...rooms.errors,
    ...sections.errors,
    ...sessions.errors,
    ...availability.errors,
    ...validateCrossFileReferences(teachers.records, subjects.records, rooms.records, sections.records, sessions.records, availability.records),
  ]

  return {
    roster: {
      teachers: teachers.records,
      subjects: subjects.records,
      rooms: rooms.records,
      sections: sections.records,
      sessions: sessions.records,
      availability: availability.records,
    },
    errors,
  }
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export async function createTimetable(
  name: string,
  roster: RosterSnapshot,
  periodBlocks: PeriodBlockConfig[] = DEFAULT_PERIOD_BLOCKS,
): Promise<ScheduleRun> {
  const input = buildSchedulingInput(roster, periodBlocks)
  const result = generateSchedule(input)

  const id = crypto.randomUUID()
  const run: ScheduleRun = {
    id,
    name,
    createdAtEpochMillis: Date.now(),
    algorithmUsed: 'dsatur',
    mode: 'GENERATE',
    executionTimeMillis: result.executionTimeMillis,
    sessionType: roster.sessions[0]?.type ?? 'CLASS',
    rootRunId: id,
    periodBlocks,
    activeDays: [...new Set(periodBlocks.flatMap((b) => b.days))].sort(),
  }

  const db = await getDb()
  const tx = db.transaction(['runs', 'assignments', 'conflicts', 'rosterSnapshots', 'periodBlocks'], 'readwrite')
  await tx.objectStore('runs').put(run)
  await tx.objectStore('rosterSnapshots').put(roster, id)
  await tx.objectStore('periodBlocks').put(periodBlocks, id)
  await persistAssignmentsAndConflicts(tx, run.id, result.assignments, result.roomBySession, result.violations)
  await tx.done
  return run
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getRootRuns(): Promise<ScheduleRun[]> {
  const db = await getDb()
  const all = await db.getAll('runs')
  return all.filter((r) => r.id === r.rootRunId).sort((a, b) => b.createdAtEpochMillis - a.createdAtEpochMillis)
}

export async function getLineage(rootRunId: string): Promise<ScheduleRun[]> {
  const db = await getDb()
  const all = await db.getAllFromIndex('runs', 'rootRunId', rootRunId)
  return all.sort((a, b) => a.createdAtEpochMillis - b.createdAtEpochMillis)
}

export async function getRun(runId: string): Promise<ScheduleRun | undefined> {
  const db = await getDb()
  return db.get('runs', runId)
}

export async function getRoster(rootRunId: string): Promise<RosterSnapshot | undefined> {
  const db = await getDb()
  return db.get('rosterSnapshots', rootRunId)
}

export async function getPeriodBlocks(rootRunId: string): Promise<PeriodBlockConfig[]> {
  const db = await getDb()
  return (await db.get('periodBlocks', rootRunId)) ?? DEFAULT_PERIOD_BLOCKS
}

export async function getAssignments(runId: string): Promise<ScheduleAssignment[]> {
  const db = await getDb()
  return db.getAllFromIndex('assignments', 'scheduleRunId', runId)
}

export async function getConflicts(runId: string): Promise<ConflictRecord[]> {
  const db = await getDb()
  return db.getAllFromIndex('conflicts', 'scheduleRunId', runId)
}

export async function getRunSessionStates(runId: string): Promise<RunSessionState[]> {
  const run = await getRun(runId)
  if (!run) return []
  const roster = await getRoster(run.rootRunId)
  if (!roster) return []
  const assignments = await getAssignments(runId)
  const periods = generatePeriodDefinitions(run.periodBlocks)

  const teacherById = new Map(roster.teachers.map((t) => [t.id, t]))
  const subjectById = new Map(roster.subjects.map((s) => [s.id, s]))
  const sectionById = new Map(roster.sections.map((s) => [s.id, s]))
  const roomById = new Map(roster.rooms.map((r) => [r.id, r]))
  const sessionById = new Map(roster.sessions.map((s) => [s.id, s]))
  const periodByKey = new Map(periods.map((p) => [`${p.dayOfWeek}:${p.periodIndex}`, p]))

  return assignments
    .map((a): RunSessionState | undefined => {
      const session = sessionById.get(a.sessionId)
      if (!session) return undefined
      const effectiveTeacherId = a.override?.teacherId ?? session.teacherId
      const effectiveSubjectId = a.override?.subjectId ?? session.subjectId
      const effectiveSectionId = a.override?.sectionId ?? session.sectionId
      const slot = periodByKey.get(`${a.dayOfWeek}:${a.periodIndex}`)
      return {
        sessionId: session.id,
        teacherId: effectiveTeacherId,
        teacherName: effectiveTeacherId ? teacherById.get(effectiveTeacherId)?.name : undefined,
        roomId: a.roomId,
        roomName: a.roomId ? roomById.get(a.roomId)?.name : undefined,
        sectionId: effectiveSectionId,
        sectionName: effectiveSectionId ? sectionById.get(effectiveSectionId)?.name : undefined,
        subjectId: effectiveSubjectId,
        subjectName: effectiveSubjectId ? subjectById.get(effectiveSubjectId)?.name : undefined,
        day: a.dayOfWeek,
        period: a.periodIndex,
        startTime: slot?.startTime ?? `Period ${a.periodIndex}`,
        endTime: slot?.endTime ?? '',
        dayLabel: dayLabelFor(a.dayOfWeek),
      }
    })
    .filter((r): r is RunSessionState => r !== undefined)
}

// ---------------------------------------------------------------------------
// Validate / Optimize (standalone entry points — act on the run's OWN persisted state)
// ---------------------------------------------------------------------------

async function loadInputFor(rootRunId: string, periodBlocks: PeriodBlockConfig[]) {
  const roster = await getRoster(rootRunId)
  if (!roster) throw new Error('Roster snapshot not found for this timetable')
  return buildSchedulingInput(roster, periodBlocks)
}

export async function validateRun(runId: string): Promise<ConstraintViolation[]> {
  const run = await getRun(runId)
  if (!run) throw new Error('Timetable not found')
  const input = await loadInputFor(run.rootRunId, run.periodBlocks)
  const assignments = await getAssignments(runId)
  const assignmentMap = new Map(assignments.map((a) => [a.sessionId, { dayOfWeek: a.dayOfWeek, periodIndex: a.periodIndex }]))
  const roomBySession = new Map(assignments.map((a) => [a.sessionId, a.roomId]))
  const overrides = overridesFromAssignments(assignments)
  const violations = validateAssignmentMap(applyIdentityOverrides(input, overrides), assignmentMap, roomBySession)

  const db = await getDb()
  const tx = db.transaction('conflicts', 'readwrite')
  await replaceConflicts(tx, runId, violations)
  await tx.done
  return violations
}

export async function optimizeRun(runId: string): Promise<{ run: ScheduleRun; violations: ConstraintViolation[] }> {
  const source = await getRun(runId)
  if (!source) throw new Error('Timetable not found')
  const input = await loadInputFor(source.rootRunId, source.periodBlocks)
  const assignments = await getAssignments(runId)
  const assignmentMap = new Map(assignments.map((a) => [a.sessionId, { dayOfWeek: a.dayOfWeek, periodIndex: a.periodIndex }]))
  const roomBySession = new Map(assignments.map((a) => [a.sessionId, a.roomId]))
  const overrides = overridesFromAssignments(assignments)
  const overriddenInput = applyIdentityOverrides(input, overrides)

  const result = optimizeSchedule(overriddenInput, assignmentMap, roomBySession)
  const newRun = await createVersion(source, 'optimize-focused', result.assignments, result.roomBySession, result.violations, overridesToMap(overrides))
  return { run: newRun, violations: result.violations }
}

// ---------------------------------------------------------------------------
// Guided Repair workflow
// ---------------------------------------------------------------------------

export async function validateWorkingCopy(
  sourceRunId: string,
  assignments: Map<string, Timeslot>,
  roomBySession: Map<string, string | undefined>,
  identityOverrides: Map<string, IdentityOverride> = new Map(),
): Promise<ConstraintViolation[]> {
  const source = await getRun(sourceRunId)
  if (!source) throw new Error('Timetable not found')
  const input = await loadInputFor(source.rootRunId, source.periodBlocks)
  return validateAssignmentMap(applyIdentityOverrides(input, identityOverrides), assignments, roomBySession)
}

export async function repairWorkingCopyWithinScope(
  sourceRunId: string,
  assignments: Map<string, Timeslot>,
  roomBySession: Map<string, string | undefined>,
  selectedSessionIds: Set<string>,
  identityOverrides: Map<string, IdentityOverride> = new Map(),
): Promise<RepairResult> {
  const source = await getRun(sourceRunId)
  if (!source) throw new Error('Timetable not found')
  const input = await loadInputFor(source.rootRunId, source.periodBlocks)
  return repairWithinScope(applyIdentityOverrides(input, identityOverrides), assignments, roomBySession, selectedSessionIds)
}

export async function commitRepairWorkflow(
  sourceRunId: string,
  assignments: Map<string, Timeslot>,
  roomBySession: Map<string, string | undefined>,
  violations: ConstraintViolation[],
  optimized: boolean,
  identityOverrides: Map<string, IdentityOverride> = new Map(),
): Promise<string> {
  const source = await getRun(sourceRunId)
  if (!source) throw new Error('Timetable not found')
  const newRun = await createVersion(
    source,
    optimized ? 'manual-repair-scoped' : 'manual-adjustment',
    assignments,
    roomBySession,
    violations,
    identityOverrides,
    optimized ? '(repaired)' : '(adjusted)',
  )

  // Persistence invariant: re-read what was just written and confirm it exactly matches
  // the working copy that was supposed to be saved. A silent mismatch is worse than a
  // failed save — this is the same guard the Android app's guided Repair uses.
  const persisted = await getAssignments(newRun.id)
  if (!guidedRepairPersistenceMatches(persisted, assignments, roomBySession, identityOverrides)) {
    throw new Error('Guided Repair persistence mismatch: saved timetable differs from working draft')
  }
  return newRun.id
}

export function guidedRepairPersistenceMatches(
  persistedRows: ScheduleAssignment[],
  assignments: Map<string, Timeslot>,
  roomBySession: Map<string, string | undefined>,
  identityOverrides: Map<string, IdentityOverride> = new Map(),
): boolean {
  if (persistedRows.length !== assignments.size) return false
  const persistedById = new Map(persistedRows.map((r) => [r.sessionId, r]))
  for (const [sessionId, ts] of assignments) {
    const row = persistedById.get(sessionId)
    if (!row) return false
    if (row.dayOfWeek !== ts.dayOfWeek || row.periodIndex !== ts.periodIndex) return false
    if ((row.roomId ?? undefined) !== (roomBySession.get(sessionId) ?? undefined)) return false
    const expectedOverride = identityOverrides.get(sessionId)
    const actualOverride = row.override
    const teacherOk = (expectedOverride?.teacherId ?? undefined) === (actualOverride?.teacherId ?? undefined)
    const subjectOk = (expectedOverride?.subjectId ?? undefined) === (actualOverride?.subjectId ?? undefined)
    const sectionOk = (expectedOverride?.sectionId ?? undefined) === (actualOverride?.sectionId ?? undefined)
    if (!teacherOk || !subjectOk || !sectionOk) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Lineage management
// ---------------------------------------------------------------------------

export async function deleteLineage(anyRunIdInLineage: string): Promise<void> {
  const run = await getRun(anyRunIdInLineage)
  if (!run) return
  const lineage = await getLineage(run.rootRunId)
  const db = await getDb()
  const tx = db.transaction(['runs', 'assignments', 'conflicts', 'rosterSnapshots', 'periodBlocks'], 'readwrite')
  for (const r of lineage) {
    const assignments = await tx.objectStore('assignments').index('scheduleRunId').getAllKeys(r.id)
    for (const key of assignments) await tx.objectStore('assignments').delete(key)
    const conflicts = await tx.objectStore('conflicts').index('scheduleRunId').getAllKeys(r.id)
    for (const key of conflicts) await tx.objectStore('conflicts').delete(key)
    await tx.objectStore('runs').delete(r.id)
  }
  await tx.objectStore('rosterSnapshots').delete(run.rootRunId)
  await tx.objectStore('periodBlocks').delete(run.rootRunId)
  await tx.done
}

/** Deletes exactly one version, leaving the rest of the lineage untouched. Only valid for
 * a non-root version — nothing else in the schema references a run by id (assignments and
 * conflicts are looked up by scheduleRunId, never chained run-to-run), so removing one
 * version's rows is genuinely self-contained. The root can't be deleted this way because
 * every other version's rootRunId points at it; deleting just the root would orphan them,
 * so that case always goes through deleteLineage (delete everything) instead. */
export async function deleteVersion(runId: string): Promise<void> {
  const run = await getRun(runId)
  if (!run) return
  if (run.id === run.rootRunId) {
    await deleteLineage(runId)
    return
  }
  const db = await getDb()
  const tx = db.transaction(['runs', 'assignments', 'conflicts'], 'readwrite')
  const assignmentKeys = await tx.objectStore('assignments').index('scheduleRunId').getAllKeys(runId)
  for (const key of assignmentKeys) await tx.objectStore('assignments').delete(key)
  const conflictKeys = await tx.objectStore('conflicts').index('scheduleRunId').getAllKeys(runId)
  for (const key of conflictKeys) await tx.objectStore('conflicts').delete(key)
  await tx.objectStore('runs').delete(runId)
  await tx.done
}

export async function renameRun(runId: string, name: string): Promise<void> {
  const db = await getDb()
  const run = await db.get('runs', runId)
  if (!run) return
  await db.put('runs', { ...run, name })
}

// ---------------------------------------------------------------------------
// Export / Import — the cross-device bridge, since each device keeps its own local data
// ---------------------------------------------------------------------------

interface ExportedTimetable {
  formatVersion: 1
  roster: RosterSnapshot
  periodBlocks: PeriodBlockConfig[]
  lineage: ScheduleRun[]
  assignmentsByRun: Record<string, ScheduleAssignment[]>
  conflictsByRun: Record<string, ConflictRecord[]>
}

export async function exportTimetable(anyRunIdInLineage: string): Promise<Blob> {
  const run = await getRun(anyRunIdInLineage)
  if (!run) throw new Error('Timetable not found')
  const roster = await getRoster(run.rootRunId)
  const periodBlocks = await getPeriodBlocks(run.rootRunId)
  if (!roster) throw new Error('Roster snapshot not found')
  const lineage = await getLineage(run.rootRunId)

  const assignmentsByRun: Record<string, ScheduleAssignment[]> = {}
  const conflictsByRun: Record<string, ConflictRecord[]> = {}
  for (const r of lineage) {
    assignmentsByRun[r.id] = await getAssignments(r.id)
    conflictsByRun[r.id] = await getConflicts(r.id)
  }

  const payload: ExportedTimetable = { formatVersion: 1, roster, periodBlocks, lineage, assignmentsByRun, conflictsByRun }
  return new Blob([JSON.stringify(payload, mapReplacer)], { type: 'application/json' })
}

/** Restores an exported timetable as a brand-new, independent lineage (fresh ids for every
 * run), so importing the same file twice — or importing on a device that already has other
 * timetables — never collides with existing data. */
export async function importTimetable(jsonText: string): Promise<ScheduleRun> {
  const payload = JSON.parse(jsonText) as ExportedTimetable
  if (payload.formatVersion !== 1) throw new Error('Unrecognized export format')
  if (payload.lineage.length === 0) throw new Error('Export contains no timetable versions')

  const idMap = new Map<string, string>()
  for (const run of payload.lineage) idMap.set(run.id, crypto.randomUUID())

  const sortedLineage = [...payload.lineage].sort((a, b) => a.createdAtEpochMillis - b.createdAtEpochMillis)
  const newRootId = idMap.get(sortedLineage[0].id)!

  const db = await getDb()
  const tx = db.transaction(['runs', 'assignments', 'conflicts', 'rosterSnapshots', 'periodBlocks'], 'readwrite')
  await tx.objectStore('rosterSnapshots').put(payload.roster, newRootId)
  await tx.objectStore('periodBlocks').put(payload.periodBlocks, newRootId)

  for (const oldRun of sortedLineage) {
    const newId = idMap.get(oldRun.id)!
    const newRun: ScheduleRun = { ...oldRun, id: newId, rootRunId: newRootId }
    await tx.objectStore('runs').put(newRun)

    for (const a of payload.assignmentsByRun[oldRun.id] ?? []) {
      const remapped: ScheduleAssignment = { ...a, scheduleRunId: newId }
      await tx.objectStore('assignments').put(remapped, assignmentKey(newId, a.sessionId))
    }
    for (const c of payload.conflictsByRun[oldRun.id] ?? []) {
      const remapped: ConflictRecord = { ...c, scheduleRunId: newId }
      await tx.objectStore('conflicts').add(remapped)
    }
  }
  await tx.done

  const newRootRun = await getRun(newRootId)
  return newRootRun!
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function overridesFromAssignments(assignments: ScheduleAssignment[]): Map<string, IdentityOverride> {
  const map = new Map<string, IdentityOverride>()
  for (const a of assignments) {
    if (a.override) map.set(a.sessionId, a.override)
  }
  return map
}

function overridesToMap(overrides: Map<string, IdentityOverride>): Map<string, IdentityOverride> {
  return overrides
}

async function createVersion(
  source: ScheduleRun,
  algorithmUsed: string,
  assignments: Map<string, Timeslot>,
  roomBySession: Map<string, string | undefined>,
  violations: ConstraintViolation[],
  identityOverrides: Map<string, IdentityOverride>,
  suffix = '(optimized)',
): Promise<ScheduleRun> {
  const db = await getDb()
  const lineage = await getLineage(source.rootRunId)
  const latestTimestamp = lineage.reduce((max, r) => Math.max(max, r.createdAtEpochMillis), 0)
  // Guarantee strict lineage ordering even when a save happens within the same
  // millisecond as its source, so the detail view's "latest" entry is always this one.
  const createdAtEpochMillis = Math.max(Date.now(), latestTimestamp + 1)

  const newRun: ScheduleRun = {
    id: crypto.randomUUID(),
    name: `${source.name} ${suffix}`,
    createdAtEpochMillis,
    algorithmUsed,
    mode: algorithmUsed.startsWith('manual') ? 'REPAIR' : 'OPTIMIZE',
    executionTimeMillis: 0,
    sessionType: source.sessionType,
    rootRunId: source.rootRunId,
    periodBlocks: source.periodBlocks,
    activeDays: source.activeDays,
  }

  const tx = db.transaction(['runs', 'assignments', 'conflicts'], 'readwrite')
  await tx.objectStore('runs').put(newRun)
  await persistAssignmentsAndConflicts(tx, newRun.id, assignments, roomBySession, violations, identityOverrides)
  await tx.done
  return newRun
}

async function persistAssignmentsAndConflicts(
  tx: ReturnType<Awaited<ReturnType<typeof getDb>>['transaction']>,
  runId: string,
  assignments: Map<string, Timeslot>,
  roomBySession: Map<string, string | undefined>,
  violations: ConstraintViolation[],
  identityOverrides: Map<string, IdentityOverride> = new Map(),
) {
  const assignmentsStore = tx.objectStore('assignments')
  for (const [sessionId, ts] of assignments) {
    const row: ScheduleAssignment = {
      scheduleRunId: runId,
      sessionId,
      dayOfWeek: ts.dayOfWeek,
      periodIndex: ts.periodIndex,
      roomId: roomBySession.get(sessionId),
      override: identityOverrides.get(sessionId),
    }
    await assignmentsStore.put(row, assignmentKey(runId, sessionId))
  }
  await replaceConflicts(tx, runId, violations)
}

async function replaceConflicts(
  tx: ReturnType<Awaited<ReturnType<typeof getDb>>['transaction']>,
  runId: string,
  violations: ConstraintViolation[],
) {
  const conflictsStore = tx.objectStore('conflicts')
  const existingKeys = await conflictsStore.index('scheduleRunId').getAllKeys(runId)
  for (const key of existingKeys) await conflictsStore.delete(key)
  for (const v of violations) {
    const record: ConflictRecord = {
      scheduleRunId: runId,
      sessionAId: v.sessionAId,
      sessionBId: v.sessionBId,
      conflictType: v.type,
      reason: v.message,
    }
    await conflictsStore.add(record)
  }
}

function mapReplacer(_key: string, value: unknown) {
  if (value instanceof Map) return Object.fromEntries(value)
  return value
}
