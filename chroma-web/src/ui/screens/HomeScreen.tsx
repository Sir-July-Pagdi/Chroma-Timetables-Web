import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TopBar } from '../components/Brand'
import { getRootRuns, importTimetable } from '../../data/repository'
import type { ScheduleRun } from '../../domain/types'

export default function HomeScreen() {
  const [runs, setRuns] = useState<ScheduleRun[] | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    getRootRuns().then(setRuns)
  }, [])

  async function handleRestoreFile(file: File) {
    setImportError(null)
    try {
      const text = await file.text()
      const run = await importTimetable(text)
      navigate(`/timetable/${run.id}`)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not restore this file')
    }
  }

  return (
    <div className="app-shell">
      <TopBar
        title="Your timetables"
        right={
          <Link to="/about" className="back-link" aria-label="About">
            ⓘ
          </Link>
        }
      />

      {importError && <div className="error-box">{importError}</div>}

      {runs === null && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

      {runs !== null && runs.length === 0 && (
        <div className="empty-state">
          <p>No timetables yet.</p>
          <p>Import your roster to generate the first one.</p>
        </div>
      )}

      <div className="card-list">
        {runs?.map((run) => (
          <Link key={run.id} to={`/timetable/${run.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div style={{ fontWeight: 600 }}>{run.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{new Date(run.createdAtEpochMillis).toLocaleString()}</div>
          </Link>
        ))}
      </div>

      <div className="button-row">
        <Link to="/import" className="button primary">
          Import roster &amp; generate
        </Link>
        <label className="button" style={{ cursor: 'pointer' }}>
          Restore from file
          <input
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleRestoreFile(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>
    </div>
  )
}
