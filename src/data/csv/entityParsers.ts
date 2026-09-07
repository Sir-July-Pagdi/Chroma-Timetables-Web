import { parseTable } from './csvParser'
import { CsvValidation, type CsvValidationError, type ParsedFile } from './validation'
import type {
  AvailabilityBlock,
  AvailabilityEntityType,
  Room,
  Section,
  Session,
  SessionType,
  Subject,
  Teacher,
} from '../../domain/types'

/** teachers.csv: id, name, subjectIds, maxLoadPerDay (optional).
 * subjectIds is semicolon-separated within the field (comma is the CSV delimiter itself). */
export function parseTeachersCsv(text: string, fileName = 'teachers.csv'): ParsedFile<Teacher> {
  const errors: CsvValidationError[] = []
  const records: Teacher[] = []
  const seenIds = new Set<string>()

  parseTable(text).forEach((row, index) => {
    const rowNumber = index + 1
    const id = CsvValidation.requireField(row, 'id', fileName, rowNumber, errors)
    if (!id) return
    const name = CsvValidation.requireField(row, 'name', fileName, rowNumber, errors)
    if (!name) return
    if (seenIds.has(id)) {
      errors.push({ fileName, rowNumber, message: `Duplicate teacher id "${id}"` })
      return
    }
    seenIds.add(id)
    const subjectIds = (row.subjectIds ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    const maxLoadPerDay = CsvValidation.optionalInt(row, 'maxLoadPerDay', fileName, rowNumber, errors)
    records.push({ id, name, subjectIds, maxLoadPerDay })
  })
  return { records, errors }
}

/** subjects.csv: id, name, code */
export function parseSubjectsCsv(text: string, fileName = 'subjects.csv'): ParsedFile<Subject> {
  const errors: CsvValidationError[] = []
  const records: Subject[] = []
  const seenIds = new Set<string>()

  parseTable(text).forEach((row, index) => {
    const rowNumber = index + 1
    const id = CsvValidation.requireField(row, 'id', fileName, rowNumber, errors)
    if (!id) return
    const name = CsvValidation.requireField(row, 'name', fileName, rowNumber, errors)
    if (!name) return
    const code = CsvValidation.requireField(row, 'code', fileName, rowNumber, errors)
    if (!code) return
    if (seenIds.has(id)) {
      errors.push({ fileName, rowNumber, message: `Duplicate subject id "${id}"` })
      return
    }
    seenIds.add(id)
    records.push({ id, name, code })
  })
  return { records, errors }
}

/** rooms.csv: id, name, capacity, type (free-form, not a fixed enum) */
export function parseRoomsCsv(text: string, fileName = 'rooms.csv'): ParsedFile<Room> {
  const errors: CsvValidationError[] = []
  const records: Room[] = []
  const seenIds = new Set<string>()

  parseTable(text).forEach((row, index) => {
    const rowNumber = index + 1
    const id = CsvValidation.requireField(row, 'id', fileName, rowNumber, errors)
    if (!id) return
    const name = CsvValidation.requireField(row, 'name', fileName, rowNumber, errors)
    if (!name) return
    const capacity = CsvValidation.requireInt(row, 'capacity', fileName, rowNumber, errors)
    if (capacity === undefined) return
    const type = CsvValidation.requireField(row, 'type', fileName, rowNumber, errors)
    if (!type) return
    if (seenIds.has(id)) {
      errors.push({ fileName, rowNumber, message: `Duplicate room id "${id}"` })
      return
    }
    seenIds.add(id)
    records.push({ id, name, capacity, type })
  })
  return { records, errors }
}

/** sections.csv: id, name, studentCount */
export function parseSectionsCsv(text: string, fileName = 'sections.csv'): ParsedFile<Section> {
  const errors: CsvValidationError[] = []
  const records: Section[] = []
  const seenIds = new Set<string>()

  parseTable(text).forEach((row, index) => {
    const rowNumber = index + 1
    const id = CsvValidation.requireField(row, 'id', fileName, rowNumber, errors)
    if (!id) return
    const name = CsvValidation.requireField(row, 'name', fileName, rowNumber, errors)
    if (!name) return
    const studentCount = CsvValidation.requireInt(row, 'studentCount', fileName, rowNumber, errors)
    if (studentCount === undefined) return
    if (seenIds.has(id)) {
      errors.push({ fileName, rowNumber, message: `Duplicate section id "${id}"` })
      return
    }
    seenIds.add(id)
    records.push({ id, name, studentCount })
  })
  return { records, errors }
}

const SESSION_TYPES: SessionType[] = ['CLASS', 'EXAM', 'LAB']

/** sessions.csv: id, type, subjectId (optional), teacherId (optional), sectionId
 * (optional), roomTypeRequired (optional), durationPeriods (optional, default 1).
 * Only id and type are truly required — an EXAM/self-study session commonly has a
 * teacherId but no subject/section. */
export function parseSessionsCsv(text: string, fileName = 'sessions.csv'): ParsedFile<Session> {
  const errors: CsvValidationError[] = []
  const records: Session[] = []
  const seenIds = new Set<string>()

  parseTable(text).forEach((row, index) => {
    const rowNumber = index + 1
    const id = CsvValidation.requireField(row, 'id', fileName, rowNumber, errors)
    if (!id) return
    const typeRaw = CsvValidation.requireField(row, 'type', fileName, rowNumber, errors)
    if (!typeRaw) return
    if (seenIds.has(id)) {
      errors.push({ fileName, rowNumber, message: `Duplicate session id "${id}"` })
      return
    }
    seenIds.add(id)
    const type = SESSION_TYPES.find((t) => t === typeRaw.trim().toUpperCase())
    if (!type) {
      errors.push({ fileName, rowNumber, message: `Column "type" must be one of CLASS, EXAM, LAB — got "${typeRaw}"` })
      return
    }
    const subjectId = row.subjectId?.trim() || undefined
    const teacherId = row.teacherId?.trim() || undefined
    const sectionId = row.sectionId?.trim() || undefined
    const roomTypeRequired = row.roomTypeRequired?.trim() || undefined
    const durationPeriods = CsvValidation.optionalInt(row, 'durationPeriods', fileName, rowNumber, errors) ?? 1
    if (durationPeriods < 1) {
      errors.push({ fileName, rowNumber, message: `Column "durationPeriods" must be at least 1, got ${durationPeriods}` })
      return
    }
    records.push({ id, type, subjectId, teacherId, sectionId, roomTypeRequired, durationPeriods })
  })
  return { records, errors }
}

const AVAILABILITY_ENTITY_TYPES: AvailabilityEntityType[] = ['TEACHER', 'ROOM']

/** availability.csv: entityType (TEACHER or ROOM), entityId, dayOfWeek (1-7), periodIndex.
 * Each row is a BLOCKED slot — the table only stores exceptions. */
export function parseAvailabilityCsv(text: string, fileName = 'availability.csv'): ParsedFile<AvailabilityBlock> {
  const errors: CsvValidationError[] = []
  const records: AvailabilityBlock[] = []

  parseTable(text).forEach((row, index) => {
    const rowNumber = index + 1
    const entityTypeRaw = CsvValidation.requireField(row, 'entityType', fileName, rowNumber, errors)
    if (!entityTypeRaw) return
    const entityId = CsvValidation.requireField(row, 'entityId', fileName, rowNumber, errors)
    if (!entityId) return
    const dayOfWeek = CsvValidation.requireInt(row, 'dayOfWeek', fileName, rowNumber, errors)
    if (dayOfWeek === undefined) return
    const periodIndex = CsvValidation.requireInt(row, 'periodIndex', fileName, rowNumber, errors)
    if (periodIndex === undefined) return

    const entityType = AVAILABILITY_ENTITY_TYPES.find((t) => t === entityTypeRaw.trim().toUpperCase())
    if (!entityType) {
      errors.push({ fileName, rowNumber, message: `Column "entityType" must be TEACHER or ROOM — got "${entityTypeRaw}"` })
      return
    }
    if (dayOfWeek < 1 || dayOfWeek > 7) {
      errors.push({ fileName, rowNumber, message: `Column "dayOfWeek" must be 1-7, got ${dayOfWeek}` })
      return
    }
    if (periodIndex < 0) {
      errors.push({ fileName, rowNumber, message: `Column "periodIndex" must be 0 or greater, got ${periodIndex}` })
      return
    }
    records.push({ entityType, entityId, dayOfWeek, periodIndex })
  })
  return { records, errors }
}
