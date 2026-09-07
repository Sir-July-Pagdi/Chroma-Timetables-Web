import type { PeriodBlockConfig, PeriodDefinition } from './types'

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Periods number sequentially per day, continuing across blocks in the order given — e.g.
 * an "AM" block (7 periods) followed by a "PM" block (7 periods) on the same weekday
 * produces periodIndex 0-6 for AM and 7-13 for PM. Blocks assigned to the same day are
 * assumed not to overlap in real time; that's a scheduling-setup responsibility, not
 * something this function tries to detect. */
export function generatePeriodDefinitions(blocks: PeriodBlockConfig[]): PeriodDefinition[] {
  const byDay = new Map<number, PeriodBlockConfig[]>()
  for (const block of blocks) {
    for (const day of block.days) {
      const list = byDay.get(day) ?? []
      list.push(block)
      byDay.set(day, list)
    }
  }

  const result: PeriodDefinition[] = []
  for (const [day, dayBlocks] of byDay) {
    let periodIndex = 0
    for (const block of dayBlocks) {
      let cursor = parseTime(block.startTime)
      for (let p = 0; p < block.periodsCount; p++) {
        const start = cursor
        const end = cursor + block.periodDurationMinutes
        result.push({ dayOfWeek: day, periodIndex, startTime: formatTime(start), endTime: formatTime(end) })
        cursor = end
        if (block.breakAfterPeriod !== undefined && p === block.breakAfterPeriod && block.breakDurationMinutes) {
          cursor += block.breakDurationMinutes
        }
        periodIndex++
      }
    }
  }
  return result.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.periodIndex - b.periodIndex)
}

export function definedPeriodsByDayFrom(periods: PeriodDefinition[]): Record<number, number[]> {
  const byDay: Record<number, number[]> = {}
  for (const p of periods) {
    if (!byDay[p.dayOfWeek]) byDay[p.dayOfWeek] = []
    byDay[p.dayOfWeek].push(p.periodIndex)
  }
  for (const day of Object.keys(byDay)) {
    byDay[Number(day)] = [...new Set(byDay[Number(day)])].sort((a, b) => a - b)
  }
  return byDay
}

export const DEFAULT_PERIOD_BLOCKS: PeriodBlockConfig[] = [
  { id: 'am', label: 'AM', days: [1, 2, 3, 4, 5], periodsCount: 7, startTime: '06:00', periodDurationMinutes: 45 },
  { id: 'pm', label: 'PM', days: [1, 2, 3, 4, 5], periodsCount: 7, startTime: '12:00', periodDurationMinutes: 45 },
]
