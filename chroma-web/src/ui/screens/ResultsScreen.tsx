import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { TopBar } from '../components/Brand'
import { exportTimetable, getConflicts, getRun, getRunSessionStates, type RunSessionState } from '../../data/repository'
import type { ConflictRecord, ScheduleRun } from '../../domain/types'

type GroupTab = 'teacher' | 'class' | 'subject' | 'period' | 'room'
const TABS: { key: GroupTab; label: string }[] = [
  { key: 'teacher', label: 'Teacher' },
  { key: 'class', label: 'Class' },
  { key: 'subject', label: 'Subject' },
  { key: 'period', label: 'Period' },
  { key: 'room', label: 'Room' },
]

export default function ResultsScreen() {
  const { runId } = useParams<{ runId: string }>()
  const [run, setRun] = useState<ScheduleRun | null>(null)
  const [rows, setRows] = useState<RunSessionState[]>([])
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([])
  const [tab, setTab] = useState<GroupTab>('teacher')

  useEffect(() => {
    if (!runId) return
    getRun(runId).then(setRun)
    getRunSessionStates(runId).then(setRows)
    getConflicts(runId).then(setConflicts)
  }, [runId])

  const groups = useMemo(() => groupRows(rows, tab), [rows, tab])

  async function handleExport() {
    if (!runId) return
    const blob = await exportTimetable(runId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(run?.name ?? 'timetable').replace(/[^a-z0-9-_ ]/gi, '')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!run) {
    return (
      <div className="app-shell">
        <TopBar backTo="/" />
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <TopBar title={run.name} backTo={`/timetable/${run.rootRunId}`} />

      <div className="stat-box">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Statistics</div>
        <div className="row">
          <span>Conflicts</span>
          <span>{conflicts.length === 0 ? '0 (none)' : conflicts.length}</span>
        </div>
        <div className="row">
          <span>Execution time</span>
          <span>{run.executionTimeMillis} ms</span>
        </div>
        <div className="row">
          <span>Sessions scheduled</span>
          <span>{rows.length}</span>
        </div>
      </div>

      <div className="tab-row">
        {TABS.map((t) => (
          <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {groups.map(([groupName, groupRows]) => (
        <div key={groupName} style={{ marginBottom: 20 }}>
          <div style={{ color: 'var(--gold)', fontWeight: 600, marginBottom: 8 }}>{groupName}</div>
          <div className="card-list">
            {groupRows.map((row) => (
              <div className="card" key={row.sessionId}>
                <div>{row.subjectName ?? '—'}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                  {row.teacherName ?? '—'} · {row.sectionName ?? '—'} · {row.roomName ?? 'Unassigned'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                  {row.dayLabel}, {row.startTime}
                  {row.endTime ? `–${row.endTime}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="button-row">
        <button className="button primary" onClick={handleExport}>
          Export
        </button>
      </div>
    </div>
  )
}

function groupRows(rows: RunSessionState[], tab: GroupTab): [string, RunSessionState[]][] {
  const keyOf = (r: RunSessionState): string => {
    switch (tab) {
      case 'teacher':
        return r.teacherName ?? 'Unassigned'
      case 'class':
        return r.sectionName ?? 'Unassigned'
      case 'subject':
        return r.subjectName ?? 'Unassigned'
      case 'period':
        return `${r.dayLabel}, ${r.startTime}`
      case 'room':
        return r.roomName ?? 'Unassigned'
    }
  }
  const map = new Map<string, RunSessionState[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}
