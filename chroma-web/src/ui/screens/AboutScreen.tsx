import { TopBar } from '../components/Brand'

export default function AboutScreen() {
  return (
    <div className="app-shell">
      <TopBar backTo="/" />
      <div className="card">
        <div style={{ fontWeight: 600, color: 'var(--gold)' }}>Chroma Engine v1.0.0-web</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 12 }}>
          On-device scheduling — every timetable lives only in this browser's local storage. Use Export/Import to move a timetable between
          devices.
        </p>
      </div>
    </div>
  )
}
