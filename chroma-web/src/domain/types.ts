// Mirrors com.jpagdi.cromascheduler.data.entity.* from the Android app, so the same
// CSV files (teachers/subjects/rooms/sections/sessions/availability) work here unchanged.

export interface Teacher {
  id: string
  name: string
  subjectIds: string[]
  maxLoadPerDay?: number
}

export interface Subject {
  id: string
  name: string
  code: string
}

export interface Room {
  id: string
  name: string
  capacity: number
  /** Free-form, not a fixed enum — e.g. STANDARD, GYM, LAB, HALL. A session's
   * roomTypeRequired (if set) must match some room's type exactly. */
  type: string
}

export interface Section {
  id: string
  name: string
  studentCount: number
}

export type SessionType = 'CLASS' | 'EXAM' | 'LAB'

export interface Session {
  id: string
  type: SessionType
  /** Only id and type are truly required — a self-study/EXAM session can have a
   * teacherId (so it still blocks that teacher elsewhere) with no subject/section. */
  subjectId?: string
  teacherId?: string
  sectionId?: string
  roomTypeRequired?: string
  durationPeriods: number
}

export type AvailabilityEntityType = 'TEACHER' | 'ROOM'

/** Each row is a BLOCKED slot (an exception), not a whitelist — a mostly-available
 * teacher/room needs only a handful of rows. */
export interface AvailabilityBlock {
  entityType: AvailabilityEntityType
  entityId: string
  /** 1=Monday .. 7=Sunday (java.time.DayOfWeek convention, kept identical to Android). */
  dayOfWeek: number
  periodIndex: number
}

export interface Timeslot {
  dayOfWeek: number
  periodIndex: number
}

export function timeslotKey(t: Timeslot): string {
  return `${t.dayOfWeek}:${t.periodIndex}`
}

/** One defined period on the timetable grid — where "period 3" actually falls in the day. */
export interface PeriodDefinition {
  dayOfWeek: number
  periodIndex: number
  startTime: string
  endTime: string
}

/** A named block of consecutive periods (e.g. "AM", "PM") applied to a set of weekdays.
 * This is the web app's period-configuration model — conceptually equivalent to the
 * Android app's period-block config, not a byte-for-byte port of its internal encoding. */
export interface PeriodBlockConfig {
  id: string
  label: string
  days: number[]
  periodsCount: number
  startTime: string
  periodDurationMinutes: number
  breakAfterPeriod?: number
  breakDurationMinutes?: number
}

export const ConstraintViolationTypes = [
  'TEACHER_DOUBLE_BOOKED',
  'ROOM_DOUBLE_BOOKED',
  'SECTION_DOUBLE_BOOKED',
  'SUBJECT_DOUBLE_BOOKED',
  'TEACHER_UNAVAILABLE',
  'ROOM_UNAVAILABLE',
  'ROOM_CAPACITY_EXCEEDED',
  'DURATION_EXCEEDS_AVAILABLE_PERIODS',
] as const
export type ConstraintViolationType = (typeof ConstraintViolationTypes)[number]

/** sessionBId is undefined for violations involving only one session (availability,
 * capacity, duration-fit) and set for pairwise ones (double-booking). */
export interface ConstraintViolation {
  type: ConstraintViolationType
  sessionAId: string
  sessionBId?: string
  message: string
}

/** A session as the engine sees it — a value copy taken at scheduling-input build time,
 * so a guided-Repair identity override can remap teacherId/subjectId/sectionId here
 * without ever touching the underlying roster Session. */
export interface EngineSession {
  id: string
  teacherId?: string
  subjectId?: string
  sectionId?: string
  roomTypeRequired?: string
  durationPeriods: number
}

export interface SchedulingInput {
  sessions: EngineSession[]
  rooms: Room[]
  sectionStudentCounts: Record<string, number>
  /** teacherId -> set of blocked "day:period" keys. */
  blockedTeacherSlots: Record<string, Set<string>>
  /** roomId -> set of blocked "day:period" keys. */
  blockedRoomSlots: Record<string, Set<string>>
  /** dayOfWeek -> sorted period indices actually defined that day (drives duration-fit checks). */
  definedPeriodsByDay: Record<number, number[]>
}

export type ScheduleMode = 'GENERATE' | 'REPAIR' | 'OPTIMIZE'

/** One version in a timetable's lineage — the original Generate run plus every
 * Validate/Repair/Optimize built from it. */
export interface ScheduleRun {
  id: string
  name: string
  createdAtEpochMillis: number
  algorithmUsed: string
  mode: ScheduleMode
  executionTimeMillis: number
  sessionType: SessionType
  rootRunId: string
  periodBlocks: PeriodBlockConfig[]
  activeDays: number[]
}

/** A per-run identity override — lets the guided Repair workflow swap ONLY Class,
 * Subject, or Teacher (independent of day/period/room) for one session in one run,
 * without ever mutating the shared roster Session. undefined means "use the
 * session's own roster identity". */
export interface IdentityOverride {
  teacherId?: string
  subjectId?: string
  sectionId?: string
}

export interface ScheduleAssignment {
  scheduleRunId: string
  sessionId: string
  dayOfWeek: number
  periodIndex: number
  roomId?: string
  override?: IdentityOverride
}

export interface ConflictRecord {
  scheduleRunId: string
  sessionAId: string
  sessionBId?: string
  conflictType: ConstraintViolationType
  reason: string
}

/** The full roster data set a timetable was generated from — snapshotted per run so a
 * historical version's meaning never drifts if the roster is edited later. */
export interface RosterSnapshot {
  teachers: Teacher[]
  subjects: Subject[]
  rooms: Room[]
  sections: Section[]
  sessions: Session[]
  availability: AvailabilityBlock[]
}

export const DAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

export function dayLabelFor(day: number): string {
  return DAY_NAMES[day] ?? `Day ${day}`
}
