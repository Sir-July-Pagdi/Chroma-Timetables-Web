import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function BrandWordmark() {
  return (
    <div className="brand-wordmark">
      <span className="chroma">CHROMA</span>
      <span className="timetables">TIMETABLES</span>
    </div>
  )
}

export function TopBar({ title, backTo, right }: { title?: string; backTo?: string; right?: ReactNode }) {
  return (
    <div className="top-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {backTo && (
          <Link to={backTo} className="back-link" aria-label="Back">
            ←
          </Link>
        )}
        <div>
          <BrandWordmark />
          {title && <div className="subtitle">{title}</div>}
        </div>
      </div>
      {right}
    </div>
  )
}
