import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/Brand'
import { parseRosterCsvs, createTimetable, type ImportedCsvBundle } from '../../data/repository'
import { DEFAULT_PERIOD_BLOCKS } from '../../domain/periods'
import type { PeriodBlockConfig, RosterSnapshot } from '../../domain/types'

const FILES: { key: keyof FileState; label: string }[] = [
  { key: 'teachers', label: 'teachers.csv' },
  { key: 'subjects', label: 'subjects.csv' },
  { key: 'rooms', label: 'rooms.csv' },
  { key: 'sections', label: 'sections.csv' },
  { key: 'sessions', label: 'sessions.csv' },
  { key: 'availability', label: 'availability.csv' },
]

interface FileState {
  teachers?: File
  subjects?: File
  rooms?: File
  sections?: File
  sessions?: File
  availability?: File
}

export default function ImportScreen() {
  const [files, setFiles] = useState<FileState>({})
  const [bundle, setBundle] = useState<ImportedCsvBundle | null>(null)
  const [periodBlocks, setPeriodBlocks] = useState<PeriodBlockConfig[]>(DEFAULT_PERIOD_BLOCKS)
  const [name, setName] = useState('Class Schedule')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const allSelected = FILES.every((f) => files[f.key])

  async function handleParse() {
    setError(null)
    setBusy(true)
    try {
      const texts = await Promise.all(FILES.map((f) => files[f.key]!.text()))
      const parsed = parseRosterCsvs({
        teachers: texts[0],
        subjects: texts[1],
        rooms: texts[2],
        sections: texts[3],
        sessions: texts[4],
        availability: texts[5],
      })
      setBundle(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read those files')
    } finally {
      setBusy(false)
    }
  }

  async function handleGenerate(roster: RosterSnapshot) {
    setBusy(true)
    setError(null)
    try {
      const run = await createTimetable(name.trim() || 'Class Schedule', roster, periodBlocks)
      navigate(`/timetable/${run.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate this timetable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <TopBar title="Import roster" backTo="/" />

      {!bundle && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Select all six CSV files: teachers, subjects, rooms, sections, sessions, and availability.
          </p>
          {FILES.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFiles((prev) => ({ ...prev, [f.key]: e.target.files?.[0] }))}
              />
            </div>
          ))}
          {error && <div className="error-box">{error}</div>}
          <div className="button-row">
            <button className="button primary" disabled={!allSelected || busy} onClick={handleParse}>
              {busy ? 'Reading…' : 'Read files'}
            </button>
          </div>
        </>
      )}

      {bundle && bundle.errors.length > 0 && (
        <>
          <div className="error-box">
            <strong>
              {bundle.errors.length} problem{bundle.errors.length === 1 ? '' : 's'} found — fix these and re-import.
            </strong>
            <ul>
              {bundle.errors.slice(0, 50).map((e, i) => (
                <li key={i}>
                  {e.fileName}
                  {e.rowNumber > 0 ? ` (row ${e.rowNumber})` : ''}: {e.message}
                </li>
              ))}
            </ul>
            {bundle.errors.length > 50 && <p>…and {bundle.errors.length - 50} more.</p>}
          </div>
          <div className="button-row">
            <button className="button" onClick={() => setBundle(null)}>
              Choose different files
            </button>
          </div>
        </>
      )}

      {bundle && bundle.errors.length === 0 && (
        <>
          <div className="stat-box">
            <div className="row">
              <span>Teachers</span>
              <span>{bundle.roster.teachers.length}</span>
            </div>
            <div className="row">
              <span>Subjects</span>
              <span>{bundle.roster.subjects.length}</span>
            </div>
            <div className="row">
              <span>Rooms</span>
              <span>{bundle.roster.rooms.length}</span>
            </div>
            <div className="row">
              <span>Sections</span>
              <span>{bundle.roster.sections.length}</span>
            </div>
            <div className="row">
              <span>Sessions</span>
              <span>{bundle.roster.sessions.length}</span>
            </div>
          </div>

          <div className="field">
            <label>Timetable name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <PeriodBlockEditor blocks={periodBlocks} onChange={setPeriodBlocks} />

          {error && <div className="error-box">{error}</div>}

          <div className="button-row">
            <button className="button primary" disabled={busy} onClick={() => handleGenerate(bundle.roster)}>
              {busy ? 'Generating…' : 'Generate timetable'}
            </button>
            <button className="button" onClick={() => setBundle(null)}>
              Choose different files
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const WEEKDAY_LABELS: { day: number; label: string }[] = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 7, label: 'Sun' },
]

function PeriodBlockEditor({ blocks, onChange }: { blocks: PeriodBlockConfig[]; onChange: (b: PeriodBlockConfig[]) => void }) {
  function update(id: string, patch: Partial<PeriodBlockConfig>) {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }
  function toggleDay(id: string, day: number) {
    const block = blocks.find((b) => b.id === id)!
    const days = block.days.includes(day) ? block.days.filter((d) => d !== day) : [...block.days, day].sort()
    update(id, { days })
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>Period blocks</label>
      {blocks.map((block) => (
        <div className="card" key={block.id}>
          <div className="field">
            <label>Label</label>
            <input type="text" value={block.label} onChange={(e) => update(block.id, { label: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Periods count</label>
              <input
                type="number"
                min={1}
                value={block.periodsCount}
                onChange={(e) => update(block.id, { periodsCount: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Period length (min)</label>
              <input
                type="number"
                min={1}
                value={block.periodDurationMinutes}
                onChange={(e) => update(block.id, { periodDurationMinutes: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="field">
            <label>Start time</label>
            <input type="text" placeholder="06:00" value={block.startTime} onChange={(e) => update(block.id, { startTime: e.target.value })} />
          </div>
          <div className="field">
            <label>Days</label>
            <div className="chip-row">
              {WEEKDAY_LABELS.map((w) => (
                <button
                  key={w.day}
                  type="button"
                  className={`chip${block.days.includes(w.day) ? ' selected' : ''}`}
                  onClick={() => toggleDay(block.id, w.day)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
