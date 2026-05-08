'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast, Toaster } from '@/components/ui/toast'
import type { ConfigRow } from '@/lib/types'

type Props = { initialRows: ConfigRow[] }

export function ConfigPage({ initialRows }: Props) {
  const [values, setValues] = useState<Map<string, string>>(
    new Map(initialRows.map((r) => [r.key, r.value])),
  )
  const [saving, setSaving] = useState<Set<string>>(new Set())

  const handleSave = async (row: ConfigRow) => {
    const newValue = values.get(row.key) ?? row.value
    setSaving((prev) => new Set(prev).add(row.key))
    const { error } = await supabase.from('config').upsert({
      key: row.key,
      value: newValue,
      description: row.description,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    setSaving((prev) => { const s = new Set(prev); s.delete(row.key); return s })
    if (error) {
      toast('Failed to save ' + row.key, 'error')
    } else {
      toast('Saved ' + row.key)
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Toaster />

      {/* Header */}
      <div className="sticky top-12 z-30 bg-canvas border-b border-stone-200/60 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-3">
          <h1 className="font-display text-xl font-semibold text-stone-800 tracking-tight">Config</h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden divide-y divide-stone-50">
          {initialRows.map((row) => {
            const isSaving = saving.has(row.key)
            return (
              <div key={row.key} className="flex items-center gap-4 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm font-semibold text-stone-700">{row.key}</div>
                  {row.description && (
                    <div className="text-xs text-stone-400 font-sans mt-0.5 truncate">{row.description}</div>
                  )}
                </div>
                <input
                  type="number"
                  value={values.get(row.key) ?? row.value}
                  onChange={(e) =>
                    setValues((prev) => new Map(prev).set(row.key, e.target.value))
                  }
                  step="any"
                  className="w-32 px-3 py-1.5 text-sm font-mono text-right border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white text-stone-700"
                />
                <button
                  onClick={() => handleSave(row)}
                  disabled={isSaving}
                  className={cn(
                    'px-3.5 py-1.5 text-xs font-medium font-sans rounded-lg transition-colors cursor-pointer',
                    isSaving
                      ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
                      : 'bg-stone-800 text-white hover:bg-stone-700',
                  )}
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )
          })}
          {initialRows.length === 0 && (
            <div className="text-center py-16 text-stone-300 font-sans text-sm">
              No config rows found. Seed the config table first.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
