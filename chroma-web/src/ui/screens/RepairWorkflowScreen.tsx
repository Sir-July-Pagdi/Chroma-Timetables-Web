import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/Brand'
import {
  commitRepairWorkflow,
  getRoster,
  getRun,
  getRunSessionStates,
  repairWorkingCopyWithinScope,
  validateWorkingCopy,
  type RunSessionState,
} from '../../data/repository'
import { generatePeriodDefinitions } from '../../domain/periods'
import type { ConstraintViolation, IdentityOverride, PeriodDefinition, RosterSnapshot, ScheduleRun, Timeslot } from '../../domain/types'
import { dayLabelFor } from '../../domain/types'

type RepairDimension = 'TEACHER' | 'ROOM' | 'CLASS' | 'SUBJECT' | 'PERIOD'
const DIMENSIONS: { key: RepairDimension; label: string }[] = [
  { key: 'TEACHER', label: 'Teacher' },
  { key: 'ROOM', label: 'Room' },
  { key: 'CLASS', label: 'Class' },
  { key: 'SUBJECT', label: 'Subject' },
  { key: 'PERIOD', label: 'Period' },
]

type Step = 'PICK_TYPE' | 'PICK_ENTITIES' | 'PREVIEW'

export default function RepairWorkflowScreen() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()

  const [source, setSource] = useState<ScheduleRun | null>(null)
  const [roster, setRoster] = useState<RosterSnapshot | null>(null)
  const [periods, setPeriods] = useState<PeriodDefinition[]>([])
  const [allSessions, setAllSessions] = useState<RunSessionState[]>([])

  const [step, setStep] = useState<Step>('PICK_TYPE')
  const [dimension, setDimension] = useState<RepairDimension>('TEACHER')
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set())

  const [workingTimeslots, setWorkingTimeslots] = useState<Map<string, Timeslot>>(new Map())
  const [workingRooms, setWorkingRooms] = useState<Map<string, string | undefined>>(new Map())
  const [workingTeacherOverride, setWorkingTeacherOverride] = useState<Map<string, string | undefined>>(new Map())
  const [workingSubjectOverride, setWorkingSubjectOverride] = useState<Map<string, string | undefined>>(new Map())
  const [workingSectionOverride, setWorkingSectionOverride] = useState<Map<string, string | undefined>>(new Map())

  const [adjustBy, setAdjustBy] = useState<Set<RepairDimension>>(new Set())
  const [pickerForSession, setPickerForSession] = useState<string | null>(null)
  const [scopeSessionIds, setScopeSessionIds] = useState<Set<string>>(new Set())
  const [pendingChanges, setPendingChanges] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [violations, setViolations] = useState<ConstraintViolation[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!runId) return
    getRun(runId).then(async (run) => {
      if (!run) return
      setSource(run)
      const r = await getRoster(run.rootRunId)
      setRoster(r ?? null)
      setPeriods(generatePeriodDefinitions(run.periodBlocks))
      const states = await getRunSessionStates(run.id)
      setAllSessions(states)
      setWorkingTimeslots(new Map(states.map((s) => [s.sessionId, { dayOfWeek: s.day, periodIndex: s.period }])))
      setWorkingRooms(new Map(states.map((s) => [s.sessionId, s.roomId])))
      setWorkingTeacherOverride(new Map(states.map((s) => [s.sessionId, s.teacherId])))
      setWorkingSubjectOverride(new Map(states.map((s) => [s.sessionId, s.subjectId])))
      setWorkingSectionOverride(new Map(states.map((s) => [s.sessionId, s.sectionId])))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const originalBySessionId = useMemo(() => new Map(allSessions.map((s) => [s.sessionId, s])), [allSessions])

  const entityOptions = useMemo(() => {
    if (!roster) return [] as { id: string; label: string }[]
    switch (dimension) {
      case 'TEACHER':
        return roster.teachers.map((t) => ({ id: t.id, label: t.name }))
      case 'ROOM':
        return roster.rooms.map((r) => ({ id: r.id, label: r.name }))
      case 'CLASS':
        return roster.sections.map((s) => ({ id: s.id, label: s.name }))
      case 'SUBJECT':
        return roster.subjects.map((s) => ({ id: s.id, label: s.name }))
      case 'PERIOD':
        return periods.map((p) => ({ id: `${p.dayOfWeek}:${p.periodIndex}`, label: `${dayLabelFor(p.dayOfWeek)}, ${p.startTime}` }))
    }
  }, [dimension, roster, periods])

  function currentRowForDisplay(base: RunSessionState): RunSessionState {
    const ts = workingTimeslots.get(base.sessionId) ?? { dayOfWeek: base.day, periodIndex: base.period }
    const roomId = workingRooms.get(base.sessionId)
    const teacherId = workingTeacherOverride.get(base.sessionId) ?? base.teacherId
    const subjectId = workingSubjectOverride.get(base.sessionId) ?? base.subjectId
    const sectionId = workingSectionOverride.get(base.sessionId) ?? base.sectionId
    const slot = periods.find((p) => p.dayOfWeek === ts.dayOfWeek && p.periodIndex === ts.periodIndex)
    const roomName = roomId ? roster?.rooms.find((r) => r.id === roomId)?.name ?? base.roomName : undefined
    const teacherName = teacherId ? roster?.teachers.find((t) => t.id === teacherId)?.name ?? base.teacherName : undefined
    const subjectName = subjectId ? roster?.subjects.find((s) => s.id === subjectId)?.name ?? base.subjectName : undefined
    const sectionName = sectionId ? roster?.sections.find((s) => s.id === sectionId)?.name ?? base.sectionName : undefined
    return {
      ...base,
      day: ts.dayOfWeek,
      period: ts.periodIndex,
      startTime: slot?.startTime ?? base.startTime,
      endTime: slot?.endTime ?? base.endTime,
      dayLabel: dayLabelFor(ts.dayOfWeek),
      roomId,
      roomName,
      teacherId,
      teacherName,
      subjectId,
      subjectName,
      sectionId,
      sectionName,
    }
  }

  const scopedSessions = useMemo(() => {
    return allSessions
      .filter((s) => {
        const current = currentRowForDisplay(s)
        switch (dimension) {
          case 'TEACHER':
            return current.teacherId && selectedEntityIds.has(current.teacherId)
          case 'ROOM':
            return current.roomId && selectedEntityIds.has(current.roomId)
          case 'CLASS':
            return current.sectionId && selectedEntityIds.has(current.sectionId)
          case 'SUBJECT':
            return current.subjectId && selectedEntityIds.has(current.subjectId)
          case 'PERIOD':
            return selectedEntityIds.has(`${current.day}:${current.period}`)
        }
      })
      .map(currentRowForDisplay)
      .sort((a, b) => a.day - b.day || a.period - b.period || (a.teacherName ?? '').localeCompare(b.teacherName ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSessions, dimension, selectedEntityIds, workingTimeslots, workingRooms, workingTeacherOverride, workingSubjectOverride, workingSectionOverride])

  function isTimeslotChanged(sessionId: string) {
    const original = originalBySessionId.get(sessionId)
    if (!original) return false
    const ts = workingTimeslots.get(sessionId)
    return !!ts && (ts.dayOfWeek !== original.day || ts.periodIndex !== original.period)
  }
  function isRoomChanged(sessionId: string) {
    const original = originalBySessionId.get(sessionId)
    return !!original && workingRooms.get(sessionId) !== original.roomId
  }
  function isTeacherChanged(sessionId: string) {
    const original = originalBySessionId.get(sessionId)
    return !!original && workingTeacherOverride.get(sessionId) !== original.teacherId
  }
  function isSubjectChanged(sessionId: string) {
    const original = originalBySessionId.get(sessionId)
    return !!original && workingSubjectOverride.get(sessionId) !== original.subjectId
  }
  function isClassChanged(sessionId: string) {
    const original = originalBySessionId.get(sessionId)
    return !!original && workingSectionOverride.get(sessionId) !== original.sectionId
  }
  function isSessionChanged(sessionId: string) {
    return (
      isTimeslotChanged(sessionId) ||
      isRoomChanged(sessionId) ||
      isTeacherChanged(sessionId) ||
      isSubjectChanged(sessionId) ||
      isClassChanged(sessionId)
    )
  }

  function performSwap(aId: string, bId: string, by: Set<RepairDimension>) {
    if (by.has('PERIOD')) {
      const a = workingTimeslots.get(aId)
      const b = workingTimeslots.get(bId)
      if (a && b) {
        const next = new Map(workingTimeslots)
        next.set(aId, b)
        next.set(bId, a)
        setWorkingTimeslots(next)
      }
    }
    if (by.has('ROOM')) {
      const next = new Map(workingRooms)
      const a = next.get(aId)
      const b = next.get(bId)
      next.set(aId, b)
      next.set(bId, a)
      setWorkingRooms(next)
    }
    if (by.has('TEACHER')) {
      const next = new Map(workingTeacherOverride)
      const a = next.get(aId)
      const b = next.get(bId)
      next.set(aId, b)
      next.set(bId, a)
      setWorkingTeacherOverride(next)
    }
    if (by.has('SUBJECT')) {
      const next = new Map(workingSubjectOverride)
      const a = next.get(aId)
      const b = next.get(bId)
      next.set(aId, b)
      next.set(bId, a)
      setWorkingSubjectOverride(next)
    }
    if (by.has('CLASS')) {
      const next = new Map(workingSectionOverride)
      const a = next.get(aId)
      const b = next.get(bId)
      next.set(aId, b)
      next.set(bId, a)
      setWorkingSectionOverride(next)
    }
    setScopeSessionIds((prev) => new Set(prev).add(aId).add(bId))
    setPendingChanges((n) => n + 1)
    setMessage(null)
    setViolations([])
  }

  function currentIdentityOverrides(): Map<string, IdentityOverride> {
    const result = new Map<string, IdentityOverride>()
    for (const original of allSessions) {
      const teacherId = workingTeacherOverride.get(original.sessionId)
      const subjectId = workingSubjectOverride.get(original.sessionId)
      const sectionId = workingSectionOverride.get(original.sessionId)
      const teacherChanged = teacherId !== original.teacherId
      const subjectChanged = subjectId !== original.subjectId
      const sectionChanged = sectionId !== original.sectionId
      if (teacherChanged || subjectChanged || sectionChanged) {
        result.set(original.sessionId, {
          teacherId: teacherChanged ? teacherId : undefined,
          subjectId: subjectChanged ? subjectId : undefined,
          sectionId: sectionChanged ? sectionId : undefined,
        })
      }
    }
    return result
  }

  async function handleValidate() {
    if (!source) return
    setBusy(true)
    try {
      const result = await validateWorkingCopy(source.id, workingTimeslots, workingRooms, currentIdentityOverrides())
      setViolations(result)
      setMessage(result.length === 0 ? 'Current adjustments are clean.' : `${result.length} conflict(s) remain in the current adjustments.`)
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!source) return
    setBusy(true)
    setMessage(null)
    try {
      const overrides = currentIdentityOverrides()
      const currentViolations = await validateWorkingCopy(source.id, workingTimeslots, workingRooms, overrides)
      if (currentViolations.length === 0) {
        const newRunId = await commitRepairWorkflow(source.id, workingTimeslots, workingRooms, currentViolations, false, overrides)
        navigate(`/timetable/${newRunId}`, { replace: true })
        return
      }
      // Conflicted: attempt a repair scoped to exactly the sessions you've touched via
      // swaps so far — everything else in the timetable stays frozen. The swapped values
      // are kept as the starting point; the repair only adjusts what's needed within that
      // scope to resolve the conflict.
      const result = await repairWorkingCopyWithinScope(source.id, workingTimeslots, workingRooms, scopeSessionIds, overrides)
      if (result.remainingViolations.length > 0) {
        setViolations(result.remainingViolations)
        setMessage(
          `Repair needs a wider scope — ${result.remainingViolations.length} conflict(s) involve schedules outside what you've adjusted so far. Swap in the sessions listed below, or adjust your selection, then try again.`,
        )
        return
      }
      setViolations([])
      const newRunId = await commitRepairWorkflow(source.id, result.assignments, result.roomBySession, result.remainingViolations, true, overrides)
      navigate(`/timetable/${newRunId}`, { replace: true })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save this repair')
    } finally {
      setBusy(false)
    }
  }

  if (!source || !roster) {
    return (
      <div className="app-shell">
        <TopBar backTo="/" />
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <TopBar title="Repair schedule" backTo={`/timetable/${source.rootRunId}`} />

      <div className="workflow-tags">
        <span className={`workflow-tag${step === 'PICK_TYPE' ? ' active-plan' : ''}`}>PLAN</span>
        <span className={`workflow-tag${step === 'PICK_ENTITIES' ? ' active-validate' : ''}`}>VALIDATE</span>
        <span className={`workflow-tag${step === 'PREVIEW' ? ' active-optimize' : ''}`}>OPTIMIZE</span>
      </div>

      {step === 'PICK_TYPE' && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>What kind of conflict are you resolving?</p>
          <div className="chip-row" style={{ marginBottom: 20 }}>
            {DIMENSIONS.map((d) => (
              <button key={d.key} className={`chip${dimension === d.key ? ' selected' : ''}`} onClick={() => setDimension(d.key)}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() => {
                setSelectedEntityIds(new Set())
                setStep('PICK_ENTITIES')
              }}
            >
              Continue
            </button>
          </div>
        </>
      )}

      {step === 'PICK_ENTITIES' && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Which {dimension === 'PERIOD' ? 'period(s)' : dimension.toLowerCase() + '(s)'} are involved?
          </p>
          <div className="chip-row" style={{ marginBottom: 20 }}>
            {entityOptions.map((opt) => (
              <button
                key={opt.id}
                className={`chip${selectedEntityIds.has(opt.id) ? ' selected' : ''}`}
                onClick={() => {
                  const next = new Set(selectedEntityIds)
                  if (next.has(opt.id)) next.delete(opt.id)
                  else next.add(opt.id)
                  setSelectedEntityIds(next)
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button className="button primary" disabled={selectedEntityIds.size === 0} onClick={() => setStep('PREVIEW')}>
              Continue
            </button>
            <button className="button" onClick={() => setStep('PICK_TYPE')}>
              Back
            </button>
          </div>
        </>
      )}

      {step === 'PREVIEW' && (
        <PreviewStep
          dimension={dimension}
          scopedSessions={scopedSessions}
          adjustBy={adjustBy}
          setAdjustBy={setAdjustBy}
          isSessionChanged={isSessionChanged}
          isTimeslotChanged={isTimeslotChanged}
          isRoomChanged={isRoomChanged}
          isTeacherChanged={isTeacherChanged}
          isSubjectChanged={isSubjectChanged}
          isClassChanged={isClassChanged}
          pickerForSession={pickerForSession}
          setPickerForSession={setPickerForSession}
          onSwap={(a, b) => performSwap(a, b, adjustBy)}
          pendingChanges={pendingChanges}
          message={message}
          violations={violations}
          busy={busy}
          onValidate={handleValidate}
          onSave={handleSave}
          onBack={() => setStep('PICK_ENTITIES')}
        />
      )}
    </div>
  )
}

function PreviewStep(props: {
  dimension: RepairDimension
  scopedSessions: RunSessionState[]
  adjustBy: Set<RepairDimension>
  setAdjustBy: (s: Set<RepairDimension>) => void
  isSessionChanged: (id: string) => boolean
  isTimeslotChanged: (id: string) => boolean
  isRoomChanged: (id: string) => boolean
  isTeacherChanged: (id: string) => boolean
  isSubjectChanged: (id: string) => boolean
  isClassChanged: (id: string) => boolean
  pickerForSession: string | null
  setPickerForSession: (id: string | null) => void
  onSwap: (a: string, b: string) => void
  pendingChanges: number
  message: string | null
  violations: ConstraintViolation[]
  busy: boolean
  onValidate: () => void
  onSave: () => void
  onBack: () => void
}) {
  const otherDimensions = DIMENSIONS.filter((d) => d.key !== props.dimension)
  const tapped = props.scopedSessions.find((s) => s.sessionId === props.pickerForSession)
  const conflictedSessionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const v of props.violations) {
      ids.add(v.sessionAId)
      if (v.sessionBId) ids.add(v.sessionBId)
    }
    return ids
  }, [props.violations])
  const sessionLabel = useMemo(() => {
    const byId = new Map(props.scopedSessions.map((s) => [s.sessionId, s]))
    return (id: string) => {
      const s = byId.get(id)
      return s ? `${s.teacherName ?? '—'} • ${s.subjectName ?? '—'} • ${s.dayLabel}, ${s.startTime}` : id
    }
  }, [props.scopedSessions])

  function toggle(d: RepairDimension) {
    const next = new Set(props.adjustBy)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    props.setAdjustBy(next)
  }

  return (
    <>
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Previewing the current schedule for the selected {props.dimension.toLowerCase()}(s).</p>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
          {props.adjustBy.size === 0 ? 'Adjust by — tap a field below to check what should trade' : 'Adjust by'}
        </label>
        <div className="chip-row">
          {otherDimensions.map((d) => (
            <button key={d.key} className={`chip${props.adjustBy.has(d.key) ? ' selected' : ''}`} onClick={() => toggle(d.key)}>
              {d.label}
            </button>
          ))}
        </div>
        {props.adjustBy.size > 0 && (
          <p style={{ color: 'var(--gold)', fontSize: 13, marginTop: 8 }}>
            {[...props.adjustBy].map((d) => DIMENSIONS.find((x) => x.key === d)!.label).join(' + ')} will trade between the two rows you tap.
            Everything else stays where it is.
          </p>
        )}
      </div>

      {props.message && <div className="stat-box">{props.message}</div>}
      {props.violations.length > 0 && (
        <div className="error-box">
          <strong>
            {props.violations.length} conflict{props.violations.length === 1 ? '' : 's'} — swap these to resolve them:
          </strong>
          <ul>
            {props.violations.map((v, i) => (
              <li key={i}>
                {sessionLabel(v.sessionAId)}
                {v.sessionBId ? ` ↔ ${sessionLabel(v.sessionBId)}` : ''} — {v.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {props.pendingChanges > 0 && (
        <p style={{ color: 'var(--gold)', fontSize: 13 }}>
          {props.pendingChanges} adjustment{props.pendingChanges === 1 ? '' : 's'} made — not yet saved.
        </p>
      )}

      <div className="card-list">
        {props.scopedSessions.map((row) => (
          <div
            key={row.sessionId}
            className={`card${props.isSessionChanged(row.sessionId) ? ' changed' : ''}`}
            style={{
              cursor: props.adjustBy.size > 0 ? 'pointer' : 'default',
              borderColor: conflictedSessionIds.has(row.sessionId) ? 'var(--error)' : undefined,
            }}
            onClick={() => props.adjustBy.size > 0 && props.setPickerForSession(row.sessionId)}
          >
            <div>
              <Field
                text={`${row.dayLabel}, ${row.startTime}`}
                active={props.adjustBy.has('PERIOD')}
                changed={props.isTimeslotChanged(row.sessionId)}
              />
              {' • '}
              <Field text={row.subjectName ?? '—'} active={props.adjustBy.has('SUBJECT')} changed={props.isSubjectChanged(row.sessionId)} />
            </div>
            <div style={{ marginTop: 4 }}>
              <Field text={row.teacherName ?? '—'} active={props.adjustBy.has('TEACHER')} changed={props.isTeacherChanged(row.sessionId)} />
              {' • '}
              <Field text={row.sectionName ?? '—'} active={props.adjustBy.has('CLASS')} changed={props.isClassChanged(row.sessionId)} />
              {' • '}
              <Field text={row.roomName ?? 'Unassigned'} active={props.adjustBy.has('ROOM')} changed={props.isRoomChanged(row.sessionId)} />
            </div>
          </div>
        ))}
      </div>

      <div className="button-row">
        <button className="button" onClick={props.onBack}>
          Back
        </button>
        <button className="button" disabled={props.busy} onClick={props.onValidate}>
          Validate
        </button>
        <button className="button primary" disabled={props.busy} onClick={props.onSave}>
          Save &amp; Repair
        </button>
      </div>

      {tapped && props.adjustBy.size > 0 && (
        <div className="dialog-backdrop" onClick={() => props.setPickerForSession(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Swap {[...props.adjustBy].map((d) => DIMENSIONS.find((x) => x.key === d)!.label.toLowerCase()).join(' + ')} with…</h3>
            {props.scopedSessions
              .filter((o) => o.sessionId !== tapped.sessionId)
              .map((option) => (
                <div
                  key={option.sessionId}
                  className="option-row"
                  onClick={() => {
                    props.onSwap(tapped.sessionId, option.sessionId)
                    props.setPickerForSession(null)
                  }}
                >
                  {option.teacherName ?? '—'} • {option.subjectName ?? '—'} • {option.sectionName ?? '—'} • {option.dayLabel}, {option.startTime} •{' '}
                  {option.roomName ?? 'Unassigned'}
                </div>
              ))}
            <div className="button-row">
              <button className="button" onClick={() => props.setPickerForSession(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Field({ text, active, changed }: { text: string; active: boolean; changed: boolean }) {
  const className = changed ? 'highlight-changed' : active ? 'highlight-active' : undefined
  return <span className={className}>{text}</span>
}
