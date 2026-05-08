'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'

function formatWed(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type Props = {
  value: string
  options: string[]
  onChange: (v: string) => void
}

export function WednesdayPicker({ value, options, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-sm font-sans text-stone-700 hover:border-stone-300 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span>Week of {formatWed(value)}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={cn('transition-transform duration-150', open && 'rotate-180')}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 bg-white border border-stone-200 rounded-xl shadow-xl py-1.5 min-w-52 z-50">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false) }}
              className={cn(
                'block w-full text-left px-3.5 py-2 text-sm font-sans transition-colors',
                opt === value
                  ? 'text-stone-900 font-semibold bg-stone-50'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50',
              )}
            >
              {formatWed(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
