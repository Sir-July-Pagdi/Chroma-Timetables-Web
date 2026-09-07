import type { CsvValidationError } from './validation'
import type { AvailabilityBlock, Room, Section, Session, Subject, Teacher } from '../../domain/types'

/** Per-file parsers only catch problems visible within a single row of a single file —
 * a well-formed but nonexistent teacherId on a session row parses fine on its own. This
 * pass runs after every file is parsed and catches dangling references across files.
 * Read-only — never mutates or drops records, only reports. */
export function validateCrossFileReferences(
  teachers: Teacher[],
  subjects: Subject[],
  rooms: Room[],
  sections: Section[],
  sessions: Session[],
  availability: AvailabilityBlock[],
): CsvValidationError[] {
  const errors: CsvValidationError[] = []
  const subjectIds = new Set(subjects.map((s) => s.id))
  const teacherIds = new Set(teachers.map((t) => t.id))
  const sectionIds = new Set(sections.map((s) => s.id))
  const roomIds = new Set(rooms.map((r) => r.id))
  const roomTypes = new Set(rooms.map((r) => r.type))

  teachers.forEach((teacher) => {
    teacher.subjectIds.forEach((subjectId) => {
      if (!subjectIds.has(subjectId)) {
        errors.push({ fileName: 'teachers.csv', rowNumber: 0, message: `Teacher "${teacher.id}" references unknown subject "${subjectId}"` })
      }
    })
  })

  sessions.forEach((session) => {
    if (session.subjectId && !subjectIds.has(session.subjectId)) {
      errors.push({ fileName: 'sessions.csv', rowNumber: 0, message: `Session "${session.id}" references unknown subject "${session.subjectId}"` })
    }
    if (session.teacherId && !teacherIds.has(session.teacherId)) {
      errors.push({ fileName: 'sessions.csv', rowNumber: 0, message: `Session "${session.id}" references unknown teacher "${session.teacherId}"` })
    }
    if (session.sectionId && !sectionIds.has(session.sectionId)) {
      errors.push({ fileName: 'sessions.csv', rowNumber: 0, message: `Session "${session.id}" references unknown section "${session.sectionId}"` })
    }
    if (session.roomTypeRequired && !roomTypes.has(session.roomTypeRequired)) {
      errors.push({
        fileName: 'sessions.csv',
        rowNumber: 0,
        message: `Session "${session.id}" requires room type "${session.roomTypeRequired}" but no imported room has that type`,
      })
    }
  })

  availability.forEach((block) => {
    const known = block.entityType === 'TEACHER' ? teacherIds.has(block.entityId) : roomIds.has(block.entityId)
    if (!known) {
      errors.push({
        fileName: 'availability.csv',
        rowNumber: 0,
        message: `Availability block references unknown ${block.entityType.toLowerCase()} "${block.entityId}"`,
      })
    }
  })

  return errors
}
