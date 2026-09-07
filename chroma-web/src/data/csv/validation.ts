import type { CsvRow } from './csvParser'

export interface CsvValidationError {
  fileName: string
  rowNumber: number
  message: string
}

export interface ParsedFile<T> {
  records: T[]
  errors: CsvValidationError[]
}

export const CsvValidation = {
  requireField(row: CsvRow, field: string, fileName: string, rowNumber: number, errors: CsvValidationError[]): string | undefined {
    const value = row[field]?.trim()
    if (!value) {
      errors.push({ fileName, rowNumber, message: `Column "${field}" is required but was empty` })
      return undefined
    }
    return value
  },

  requireInt(row: CsvRow, field: string, fileName: string, rowNumber: number, errors: CsvValidationError[]): number | undefined {
    const raw = row[field]?.trim()
    if (!raw) {
      errors.push({ fileName, rowNumber, message: `Column "${field}" is required but was empty` })
      return undefined
    }
    const n = Number(raw)
    if (!Number.isInteger(n)) {
      errors.push({ fileName, rowNumber, message: `Column "${field}" must be a whole number, got "${raw}"` })
      return undefined
    }
    return n
  },

  optionalInt(row: CsvRow, field: string, fileName: string, rowNumber: number, errors: CsvValidationError[]): number | undefined {
    const raw = row[field]?.trim()
    if (!raw) return undefined
    const n = Number(raw)
    if (!Number.isInteger(n)) {
      errors.push({ fileName, rowNumber, message: `Column "${field}" must be a whole number, got "${raw}"` })
      return undefined
    }
    return n
  },
}
