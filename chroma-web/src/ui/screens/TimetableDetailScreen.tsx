import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/Brand'
import {
  deleteLineage,
  deleteVersion,
  exportTimetable,
  getLineage,
  getRun,
  optimizeRun,
  renameRun,
  validateRun,
} from '../../data/repository'
import type { ScheduleRun } from '../../domain/types'

export default function TimetableDetailScreen() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const [root, setRoot] = useState<ScheduleRun | null>(null)
  const [entries, setEntries] = useState<ScheduleRun[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [renameTarget, setRenameTarget] = useState<ScheduleRun | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<ScheduleRun | null>(null)

  async function reload() {
    if (!runId) return
    const run = await getRun(runId)
    if (!run) return
    const lineage = await getLineage(run.rootRunId)
    setRoot(lineage.find((r) => r.id === r.rootRunId) ?? run)
    setEntries(lineage)
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const latest = entries[entries.length - 1]

  async function handleValidate() {
    if (!latest) return
    setBusy(true)
    setMessage(null)
    try {
      const violations = await validateRun(latest.id)
      setMessage(violations.length === 0 ? 'No conflicts found.' : `${violations.length} conflict(s) found.`)
    } finally {
      setBusy(false)
    }
  }

  async function handleOptimize() {
    if (!latest) return
    setBusy(true)
    setMessage(null)
    try {
      const { run, violations } = await optimizeRun(latest.id)
      setMessage(violations.length === 0 ? 'Optimized — no conflicts remain.' : `Optimized — ${violations.length} conflict(s) remain.`)
      await reload()
      navigate(`/timetable/${run.id}`, { replace: true })
    } finally {
      setBusy(false)
    }
  }

  async function handleExport() {
    if (!latest) return
    const blob = await exportTimetable(latest.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(root?.name ?? 'timetable').replace(/[^a-z0-9-_ ]/gi, '')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleDeleteAll() {
    if (!latest) return
    await deleteLineage(latest.id)
    navigate('/', { replace: true })
  }

  async function handleRenameConfirm() {
    if (!renameTarget) return
    await renameRun(renameTarget.id, renameValue.trim() || renameTarget.name)
    setRenameTarget(null)
    await reload()
  }

  async function handleDeleteVersionConfirm() {
    if (!confirmDeleteVersion) return
    if (confirmDeleteVersion.id === confirmDeleteVersion.rootRunId) {
      // Deleting the root is really "delete everything" — every other version's
      // rootRunId points at it, so it can't be removed on its own without orphaning them.
      await handleDeleteAll()
      return
    }
    await deleteVersion(confirmDeleteVersion.id)
    setConfirmDeleteVersion(null)
    await reload()
  }

  if (!root || !latest) {
    return (
      <div className="app-shell">
        <TopBar backTo="/" />
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <TopBar
        title={root.name}
        backTo="/"
        right={
          <button className="back-link" onClick={() => setShowMore(true)} aria-label="More">
            ⋯
          </button>
        }
      />

      {message && <div className="stat-box">{message}</div>}

      <div className="card-list">
        {entries.map((entry) => (
          <div className="card" key={entry.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{entry.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {entry.mode} · {new Date(entry.createdAtEpochMillis).toLocaleString()}
                </div>
              </div>
              <button
                className="back-link"
                style={{ fontSize: 14 }}
                onClick={() => {
                  setRenameTarget(entry)
                  setRenameValue(entry.name)
                }}
                aria-label="Rename"
              >
                ✎
              </button>
            </div>
            <div className="button-row" style={{ marginTop: 12 }}>
              <Link to={`/timetable/${entry.id}/results`} className="button">
                View
              </Link>
              {entries.length > 1 && (
                <button className="button danger" onClick={() => setConfirmDeleteVersion(entry)}>
                  {entry.id === entry.rootRunId ? 'Delete timetable' : 'Delete this version'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="button-row">
        <button className="button" disabled={busy} onClick={handleValidate}>
          Validate latest
        </button>
        <button className="button" disabled={busy} onClick={handleOptimize}>
          Optimize latest
        </button>
        <Link to={`/timetable/${latest.id}/repair`} className="button">
          Repair schedule
        </Link>
      </div>

      {showMore && (
        <div className="dialog-backdrop" onClick={() => setShowMore(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Timetable actions</h3>
            <div className="button-row">
              <button className="button" style={{ textAlign: 'left' }} onClick={handleExport}>
                Export a version
              </button>
              <button
                className="button danger"
                style={{ textAlign: 'left' }}
                onClick={() => {
                  setShowMore(false)
                  setConfirmDeleteAll(true)
                }}
              >
                Delete timetable
              </button>
              <button className="button" onClick={() => setShowMore(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="dialog-backdrop" onClick={() => setRenameTarget(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Rename</h3>
            <div className="field">
              <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
            </div>
            <div className="button-row">
              <button className="button primary" onClick={handleRenameConfirm}>
                Save
              </button>
              <button className="button" onClick={() => setRenameTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteVersion && (
        <div className="dialog-backdrop" onClick={() => setConfirmDeleteVersion(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{confirmDeleteVersion.id === confirmDeleteVersion.rootRunId ? 'Delete this timetable?' : 'Delete this version?'}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {confirmDeleteVersion.id === confirmDeleteVersion.rootRunId
                ? 'This removes the whole lineage — every Validate/Repair/Optimize version built from it — permanently.'
                : 'Only this version is removed; the rest of the lineage is untouched.'}
            </p>
            <div className="button-row">
              <button className="button danger" onClick={handleDeleteVersionConfirm}>
                Delete
              </button>
              <button className="button" onClick={() => setConfirmDeleteVersion(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteAll && (
        <div className="dialog-backdrop" onClick={() => setConfirmDeleteAll(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this timetable?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              This removes the whole lineage — every Validate/Repair/Optimize version built from it — permanently.
            </p>
            <div className="button-row">
              <button className="button danger" onClick={handleDeleteAll}>
                Delete everything
              </button>
              <button className="button" onClick={() => setConfirmDeleteAll(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
