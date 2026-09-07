import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ConflictRecord, PeriodBlockConfig, RosterSnapshot, ScheduleAssignment, ScheduleRun } from '../domain/types'

export interface ChromaDB extends DBSchema {
  runs: {
    key: string
    value: ScheduleRun
    indexes: { rootRunId: string }
  }
  assignments: {
    key: string // `${scheduleRunId}:${sessionId}`
    value: ScheduleAssignment
    indexes: { scheduleRunId: string }
  }
  conflicts: {
    key: number
    value: ConflictRecord
    indexes: { scheduleRunId: string }
  }
  rosterSnapshots: {
    key: string // rootRunId
    value: RosterSnapshot
  }
  periodBlocks: {
    key: string // rootRunId
    value: PeriodBlockConfig[]
  }
}

let dbPromise: Promise<IDBPDatabase<ChromaDB>> | null = null

export function getDb(): Promise<IDBPDatabase<ChromaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ChromaDB>('chroma-timetables', 1, {
      upgrade(db) {
        const runs = db.createObjectStore('runs', { keyPath: 'id' })
        runs.createIndex('rootRunId', 'rootRunId')

        const assignments = db.createObjectStore('assignments')
        assignments.createIndex('scheduleRunId', 'scheduleRunId')

        const conflicts = db.createObjectStore('conflicts', { keyPath: 'id', autoIncrement: true })
        conflicts.createIndex('scheduleRunId', 'scheduleRunId')

        db.createObjectStore('rosterSnapshots')
        db.createObjectStore('periodBlocks')
      },
    })
  }
  return dbPromise
}

export function assignmentKey(scheduleRunId: string, sessionId: string): string {
  return `${scheduleRunId}:${sessionId}`
}
