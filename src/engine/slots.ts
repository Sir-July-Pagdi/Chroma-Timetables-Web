import type { EngineSession, SchedulingInput } from '../domain/types'

export interface SlotSpan {
  dayOfWeek: number
  /** The periods this session would occupy, e.g. [3,4] for a 2-period session starting at 3. */
  periods: number[]
}

export function slotKey(day: number, period: number): string {
  return `${day}:${period}`
}

/** Every (day, startPeriod) span where a session's full duration fits inside that day's
 * consecutively-defined periods — assumes a day's defined periods are contiguous, which
 * holds for every period-block layout this app can generate. */
export function possibleSpans(input: SchedulingInput, durationPeriods: number): SlotSpan[] {
  const spans: SlotSpan[] = []
  for (const [dayStr, periods] of Object.entries(input.definedPeriodsByDay)) {
    const day = Number(dayStr)
    const sorted = [...periods].sort((a, b) => a - b)
    for (let i = 0; i + durationPeriods <= sorted.length; i++) {
      const window = sorted.slice(i, i + durationPeriods)
      const contiguous = window.every((p, idx) => idx === 0 || p === window[idx - 1] + 1)
      if (contiguous) spans.push({ dayOfWeek: day, periods: window })
    }
  }
  return spans
}

export function spanOverlaps(a: SlotSpan, b: SlotSpan): boolean {
  return a.dayOfWeek === b.dayOfWeek && a.periods.some((p) => b.periods.includes(p))
}

export function isBlocked(blockedSlots: Set<string> | undefined, span: SlotSpan): boolean {
  if (!blockedSlots || blockedSlots.size === 0) return false
  return span.periods.some((p) => blockedSlots.has(slotKey(span.dayOfWeek, p)))
}

export function sessionSpan(session: EngineSession, dayOfWeek: number, periodIndex: number): SlotSpan {
  const periods: number[] = []
  for (let i = 0; i < session.durationPeriods; i++) periods.push(periodIndex + i)
  return { dayOfWeek, periods }
}

/** Whether every period this session would occupy is actually a defined period that day
 * (backs DURATION_EXCEEDS_AVAILABLE_PERIODS). */
export function fitsDefinedPeriods(input: SchedulingInput, span: SlotSpan): boolean {
  const defined = input.definedPeriodsByDay[span.dayOfWeek]
  if (!defined) return false
  const definedSet = new Set(defined)
  return span.periods.every((p) => definedSet.has(p))
}
