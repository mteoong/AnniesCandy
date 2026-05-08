'use client'

import { useRouter, usePathname } from 'next/navigation'

export function DayPicker({ date }: { date: string }) {
  const router   = useRouter()
  const pathname = usePathname()

  function go(delta: number) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    router.push(`${pathname}?date=${d.toLocaleDateString('en-CA')}`)
  }

  function handleDateInput(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) router.push(`${pathname}?date=${value}`)
  }

  const label = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => go(-1)}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
        aria-label="Previous day"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {/* Styled label with transparent date input overlaid for the native calendar picker */}
      <div className="relative">
        <span className="block px-2 py-1 text-sm font-sans font-medium text-stone-700 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer select-none">
          {label}
        </span>
        <input
          type="date"
          value={date}
          onChange={e => handleDateInput(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full"
        />
      </div>

      <button
        onClick={() => go(1)}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
        aria-label="Next day"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  )
}
