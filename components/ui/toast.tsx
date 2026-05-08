'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type ToastItem = { id: number; message: string; type: 'success' | 'error' }

let listeners: ((t: ToastItem) => void)[] = []
let counter = 0

export function toast(message: string, type: 'success' | 'error' = 'success') {
  const item: ToastItem = { id: ++counter, message, type }
  listeners.forEach((fn) => fn(item))
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const handler = (item: ToastItem) => {
      setItems((prev) => [...prev, item])
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== item.id)), 2500)
    }
    listeners.push(handler)
    return () => { listeners = listeners.filter((l) => l !== handler) }
  }, [])

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm font-sans font-medium',
            'animate-in slide-in-from-bottom-2 fade-in duration-200',
            item.type === 'success'
              ? 'bg-stone-800 text-white'
              : 'bg-red-600 text-white',
          )}
        >
          {item.type === 'success' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          )}
          {item.message}
        </div>
      ))}
    </div>
  )
}
