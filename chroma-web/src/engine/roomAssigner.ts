import type { EngineSession, SchedulingInput, Timeslot } from '../domain/types'
import { isBlocked, sessionSpan, spanOverlaps, type SlotSpan } from './slots'

export function assignRooms(
  input: SchedulingInput,
  sessions: EngineSession[],
  timeslots: Map<string, Timeslot>,
  fixedRoomBySession?: Map<string, string | undefined>,
): Map<string, string | undefined> {
  const roomBySession = new Map<string, string | undefined>(fixedRoomBySession ?? [])
  const occupiedByRoom = new Map<string, SlotSpan[]>()

  // Seed occupancy from any pre-fixed room assignments.
  if (fixedRoomBySession) {
    for (const [sessionId, roomId] of fixedRoomBySession) {
      if (!roomId) continue
      const session = sessions.find((s) => s.id === sessionId)
      const ts = timeslots.get(sessionId)
      if (!session || !ts) continue
      const span = sessionSpan(session, ts.dayOfWeek, ts.periodIndex)
      occupiedByRoom.set(roomId, [...(occupiedByRoom.get(roomId) ?? []), span])
    }
  }

  const candidateRoomsFor = (session: EngineSession) =>
    input.rooms.filter((r) => {
      if (session.roomTypeRequired && r.type !== session.roomTypeRequired) return false
      const studentCount = session.sectionId ? input.sectionStudentCounts[session.sectionId] : undefined
      if (studentCount !== undefined && r.capacity < studentCount) return false
      return true
    })

  const toAssign = sessions.filter((s) => !roomBySession.has(s.id) && timeslots.has(s.id))
  // Most-constrained-first: sessions with fewer eligible rooms get first pick.
  toAssign.sort((a, b) => candidateRoomsFor(a).length - candidateRoomsFor(b).length)

  for (const session of toAssign) {
    const ts = timeslots.get(session.id)!
    const span = sessionSpan(session, ts.dayOfWeek, ts.periodIndex)
    const candidates = candidateRoomsFor(session).sort((a, b) => a.capacity - b.capacity) // smallest sufficient room first

    let chosen: string | undefined
    for (const room of candidates) {
      const blocked = input.blockedRoomSlots[room.id]
      const occupied = occupiedByRoom.get(room.id) ?? []
      const free = !isBlocked(blocked, span) && !occupied.some((o) => spanOverlaps(o, span))
      if (free) {
        chosen = room.id
        break
      }
    }
    // Fall back to any matching room even if occupied/blocked, so Validate can report the
    // real conflict rather than the session silently getting no room at all.
    if (!chosen) chosen = candidates[0]?.id ?? input.rooms[0]?.id

    roomBySession.set(session.id, chosen)
    if (chosen) {
      occupiedByRoom.set(chosen, [...(occupiedByRoom.get(chosen) ?? []), span])
    }
  }

  return roomBySession
}
