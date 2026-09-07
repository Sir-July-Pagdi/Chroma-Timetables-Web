import type { EngineSession } from '../domain/types'

/** Two sessions conflict (can never share an overlapping timeslot) if they'd occupy the
 * same teacher's or the same section's time at once — a teacher/section can only be in
 * one place at a time. Room conflicts are handled separately by the room assigner, since
 * which room a session gets is chosen dynamically rather than fixed per session. */
export function buildConflictGraph(sessions: EngineSession[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  sessions.forEach((s) => graph.set(s.id, new Set()))

  const byTeacher = new Map<string, EngineSession[]>()
  const bySection = new Map<string, EngineSession[]>()
  for (const s of sessions) {
    if (s.teacherId) {
      const list = byTeacher.get(s.teacherId) ?? []
      list.push(s)
      byTeacher.set(s.teacherId, list)
    }
    if (s.sectionId) {
      const list = bySection.get(s.sectionId) ?? []
      list.push(s)
      bySection.set(s.sectionId, list)
    }
  }

  const addEdge = (a: string, b: string) => {
    if (a === b) return
    graph.get(a)?.add(b)
    graph.get(b)?.add(a)
  }

  for (const list of byTeacher.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) addEdge(list[i].id, list[j].id)
    }
  }
  for (const list of bySection.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) addEdge(list[i].id, list[j].id)
    }
  }

  return graph
}
