'use client'

import { useRef, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { ConfigRow } from '@/lib/types'

type Props = { initialRows: ConfigRow[] }

type StepTable = { headers: string[]; rows: string[][] }
type Step = { title: string; math: string; note?: string; table?: StepTable }

type FormulaConfig = {
  id: string
  title: string
  appliesTo: string
  dotColor: string
  textColor: string
  borderColor: string
  badgeColor: string
  headerBg: string
  summary: string
  steps: Step[]
  finalFormula: string
  configKeys: string[]
  configMeta?: Record<string, string>
}

const FORMULAS: FormulaConfig[] = [
  {
    id: 'daily',
    title: 'Daily Pay',
    appliesTo: 'Office · Production',
    dotColor: 'bg-indigo-500',
    textColor: 'text-indigo-700',
    borderColor: 'border-indigo-200',
    badgeColor: 'bg-indigo-100 text-indigo-700',
    headerBg: 'bg-indigo-50',
    summary: 'Fixed daily wage plus nightshift and holiday bonuses',
    steps: [
      {
        title: 'Start with the base daily salary',
        math: 'base = daily_salary',
      },
      {
        title: 'Add any extra pay (overtime, manual adjustments)',
        math: 'base = base + extra',
      },
      {
        title: 'Add nightshift bonus if employee works nights',
        math: 'nightshift_bonus = daily_salary × NIGHTSHIFT_BONUS_RATE',
      },
      {
        title: 'Add holiday bonus based on the day type',
        math: 'holiday_bonus = daily_salary × holiday_rate',
        table: {
          headers: ['Day Type', 'Multiplier'],
          rows: [
            ['Regular Day', '0%'],
            ['30% Holiday', '30%'],
            ['100% Holiday', '100%'],
          ],
        },
      },
    ],
    finalFormula: 'daily_pay = daily_salary + extra + nightshift_bonus + holiday_bonus',
    configKeys: ['NIGHTSHIFT_BONUS_RATE'],
  },
  {
    id: 'king',
    title: 'King / JR Pay',
    appliesTo: 'KING · JR',
    dotColor: 'bg-red-500',
    textColor: 'text-red-600',
    borderColor: 'border-red-200',
    badgeColor: 'bg-red-100 text-red-700',
    headerBg: 'bg-red-50',
    summary: '2-tier rate on candy per person, plus quota bonus',
    steps: [
      {
        title: 'Calculate candy per person (cpp)',
        math: 'cpp = total_candy ÷ people_present',
      },
      {
        title: 'Apply rate based on which bucket cpp falls in',
        math: 'base = cpp × rate',
        table: {
          headers: ['Condition', 'Rate Used'],
          rows: [
            ['cpp < KING_THRESHOLD', 'KING_RATE_LOW'],
            ['cpp ≥ KING_THRESHOLD', 'KING_RATE_HIGH'],
          ],
        },
      },
      {
        title: 'Add quota bonus — higher if cpp clears the target',
        math: 'quota = KING_JR_SP_QUOTA_HIGH  if cpp ≥ KING_JR_SP_QUOTA_THRESHOLD\nquota = KING_JR_SP_QUOTA_LOW   if cpp < KING_JR_SP_QUOTA_THRESHOLD',
      },
      {
        title: 'Add nightshift and holiday bonuses',
        math: 'nightshift_bonus = daily_salary × NIGHTSHIFT_BONUS_RATE\nholiday_bonus   = daily_salary × holiday_rate',
      },
    ],
    finalFormula: 'daily_pay = base + quota + nightshift_bonus + holiday_bonus',
    configKeys: [
      'KING_THRESHOLD', 'KING_RATE_LOW', 'KING_RATE_HIGH', 'NIGHTSHIFT_BONUS_RATE',
      'KING_JR_SP_QUOTA_THRESHOLD', 'KING_JR_SP_QUOTA_HIGH', 'KING_JR_SP_QUOTA_LOW',
    ],
    configMeta: {
      KING_JR_SP_QUOTA_THRESHOLD: 'cpp must reach this to earn the high quota',
      KING_JR_SP_QUOTA_HIGH: 'quota bonus added when cpp ≥ threshold',
      KING_JR_SP_QUOTA_LOW: 'quota bonus added when cpp < threshold',
    },
  },
  {
    id: 'sp',
    title: 'SP Pay',
    appliesTo: 'SP',
    dotColor: 'bg-emerald-600',
    textColor: 'text-emerald-700',
    borderColor: 'border-emerald-200',
    badgeColor: 'bg-emerald-100 text-emerald-700',
    headerBg: 'bg-emerald-50',
    summary: '3-tier rate on candy per person, plus quota bonus',
    steps: [
      {
        title: 'Calculate candy per person (cpp)',
        math: 'cpp = total_candy ÷ people_present',
      },
      {
        title: 'Apply rate based on which tier cpp falls in',
        math: 'base = cpp × rate',
        table: {
          headers: ['Condition', 'Rate Used'],
          rows: [
            ['cpp < SP_THRESHOLD_1', 'SP_RATE_1'],
            ['SP_THRESHOLD_1 ≤ cpp < SP_THRESHOLD_2', 'SP_RATE_2'],
            ['cpp ≥ SP_THRESHOLD_2', 'SP_RATE_3'],
          ],
        },
      },
      {
        title: 'Add quota bonus — same thresholds as King/JR',
        math: 'quota = KING_JR_SP_QUOTA_HIGH  if cpp ≥ KING_JR_SP_QUOTA_THRESHOLD\nquota = KING_JR_SP_QUOTA_LOW   if cpp < KING_JR_SP_QUOTA_THRESHOLD',
      },
      {
        title: 'Add nightshift and holiday bonuses',
        math: 'nightshift_bonus = daily_salary × NIGHTSHIFT_BONUS_RATE\nholiday_bonus   = daily_salary × holiday_rate',
      },
    ],
    finalFormula: 'daily_pay = base + quota + nightshift_bonus + holiday_bonus',
    configKeys: [
      'SP_THRESHOLD_1', 'SP_THRESHOLD_2', 'SP_RATE_1', 'SP_RATE_2', 'SP_RATE_3', 'NIGHTSHIFT_BONUS_RATE',
      'KING_JR_SP_QUOTA_THRESHOLD', 'KING_JR_SP_QUOTA_HIGH', 'KING_JR_SP_QUOTA_LOW',
    ],
    configMeta: {
      KING_JR_SP_QUOTA_THRESHOLD: 'cpp must reach this to earn the high quota',
      KING_JR_SP_QUOTA_HIGH: 'quota bonus added when cpp ≥ threshold',
      KING_JR_SP_QUOTA_LOW: 'quota bonus added when cpp < threshold',
    },
  },
  {
    id: 'coins',
    title: 'Coins Pay',
    appliesTo: 'COINS',
    dotColor: 'bg-amber-500',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-200',
    badgeColor: 'bg-amber-100 text-amber-700',
    headerBg: 'bg-amber-50',
    summary: 'Flat rate on candy per person, plus separate quota bonus',
    steps: [
      {
        title: 'Calculate candy per person (cpp)',
        math: 'cpp = total_candy ÷ people_present',
      },
      {
        title: 'Multiply cpp by the coin rate',
        math: 'base = cpp × COIN_RATE',
      },
      {
        title: 'Add quota bonus — higher threshold than King/JR/SP',
        math: 'quota = COIN_QUOTA_HIGH  if cpp ≥ COIN_QUOTA_THRESHOLD\nquota = COIN_QUOTA_LOW   if cpp < COIN_QUOTA_THRESHOLD',
      },
      {
        title: 'Add nightshift and holiday bonuses',
        math: 'nightshift_bonus = daily_salary × NIGHTSHIFT_BONUS_RATE\nholiday_bonus   = daily_salary × holiday_rate',
      },
    ],
    finalFormula: 'daily_pay = base + quota + nightshift_bonus + holiday_bonus',
    configKeys: ['COIN_RATE', 'NIGHTSHIFT_BONUS_RATE', 'COIN_QUOTA_THRESHOLD', 'COIN_QUOTA_HIGH', 'COIN_QUOTA_LOW'],
    configMeta: {
      COIN_QUOTA_THRESHOLD: 'cpp must reach this to earn the high quota',
      COIN_QUOTA_HIGH: 'quota bonus added when cpp ≥ threshold',
      COIN_QUOTA_LOW: 'quota bonus added when cpp < threshold',
    },
  },
  {
    id: 'combo',
    title: 'Combo Pay',
    appliesTo: 'COMBO',
    dotColor: 'bg-violet-600',
    textColor: 'text-violet-700',
    borderColor: 'border-violet-200',
    badgeColor: 'bg-violet-100 text-violet-700',
    headerBg: 'bg-violet-50',
    summary: 'Excess-boxes formula: total minus per-person allowance, divided by 2, plus constant',
    steps: [
      {
        title: 'Count total boxes produced and people present',
        math: 'boxes          = total boxes counted\npeople_present = workers marked present',
      },
      {
        title: 'Subtract the per-person allowance (10 boxes each), then halve the excess and add the constant',
        math: 'base = (boxes − people_present × 10) ÷ 2 + COMBO_CONSTANT',
        note: 'Each person "accounts for" 10 boxes. Boxes beyond that are split in half, then COMBO_CONSTANT is added.',
      },
      {
        title: 'Add nightshift and holiday bonuses',
        math: 'nightshift_bonus = daily_salary × NIGHTSHIFT_BONUS_RATE\nholiday_bonus   = daily_salary × holiday_rate',
      },
    ],
    finalFormula: 'daily_pay = base + nightshift_bonus + holiday_bonus',
    configKeys: ['COMBO_CONSTANT', 'NIGHTSHIFT_BONUS_RATE'],
  },
]

// ── Variable editor row ───────────────────────────────────────────────────────
function VarRow({
  keyName,
  row,
  fallbackDescription,
  onSave,
}: {
  keyName: string
  row: ConfigRow | undefined
  fallbackDescription?: string
  onSave: (key: string, value: string) => void
}) {
  const [val, setVal] = useState(row?.value ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const handleChange = (next: string) => {
    setVal(next)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onSave(keyName, next), 500)
  }

  const description = row?.description ?? fallbackDescription ?? ''

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-stone-100 last:border-0">
      <span className="font-mono text-xs font-semibold text-stone-500 w-52 flex-shrink-0 truncate">
        {keyName}
      </span>
      <input
        type="text"
        value={val}
        onChange={(e) => handleChange(e.target.value)}
        className="w-28 px-2 py-1 text-sm font-mono text-right border border-stone-200 rounded-lg bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-200"
      />
      <span className="text-xs text-stone-400 truncate">{description}</span>
    </div>
  )
}

// ── Formula card ──────────────────────────────────────────────────────────────
function FormulaCard({
  formula,
  rows,
  expanded,
  onToggle,
  onSave,
}: {
  formula: FormulaConfig
  rows: ConfigRow[]
  expanded: boolean
  onToggle: () => void
  onSave: (key: string, value: string) => void
}) {
  return (
    <div className={cn('bg-white rounded-2xl border shadow-sm overflow-hidden', formula.borderColor)}>
      {/* Header */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-3 px-5 py-4 text-left transition-colors',
          expanded ? formula.headerBg : 'hover:bg-stone-50',
        )}
      >
        <div className={cn('w-2 h-2 rounded-full flex-shrink-0', formula.dotColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-display font-semibold text-stone-800 text-base tracking-tight">
              {formula.title}
            </span>
            <span className={cn('text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-md', formula.badgeColor)}>
              {formula.appliesTo}
            </span>
          </div>
          <p className="text-xs text-stone-400 font-sans mt-0.5">{formula.summary}</p>
        </div>
        <svg
          className={cn('flex-shrink-0 text-stone-300 transition-transform duration-200', expanded && 'rotate-180')}
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-stone-100">
          {/* Steps */}
          <div className="px-5 py-5 space-y-5">
            {formula.steps.map((step, i) => (
              <div key={i} className="flex gap-4">
                <div className={cn(
                  'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold mt-0.5',
                  formula.badgeColor,
                )}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-sm font-medium text-stone-700">{step.title}</p>
                  <pre className="text-xs font-mono text-stone-600 bg-stone-50 border border-stone-100 rounded-xl px-3.5 py-2.5 whitespace-pre-wrap leading-relaxed">
                    {step.math}
                  </pre>
                  {step.table && (
                    <table className="w-full text-xs border-collapse mt-1">
                      <thead>
                        <tr>
                          {step.table.headers.map((h) => (
                            <th key={h} className="text-left font-semibold text-stone-400 px-3 py-1.5 bg-stone-50 border border-stone-100 first:rounded-tl-lg last:rounded-tr-lg">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {step.table.rows.map((row, ri) => (
                          <tr key={ri} className="border-b border-stone-100 last:border-0">
                            {row.map((cell, ci) => (
                              <td key={ci} className={cn(
                                'px-3 py-1.5 border border-stone-100 font-mono',
                                ci === 0 ? 'text-stone-500' : `font-semibold ${formula.textColor}`,
                              )}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {step.note && (
                    <p className="text-[11px] text-stone-400 italic font-sans">{step.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Final formula */}
          <div className={cn('mx-5 mb-5 px-4 py-3 rounded-xl border', formula.borderColor, formula.headerBg)}>
            <p className="text-[10px] font-sans font-semibold text-stone-400 uppercase tracking-wider mb-1">Result</p>
            <pre className={cn('text-sm font-mono font-semibold', formula.textColor)}>
              {formula.finalFormula}
            </pre>
          </div>

          {/* Variables */}
          <div className="border-t border-stone-100 px-5 py-4">
            <p className="text-[10px] font-sans font-semibold text-stone-400 uppercase tracking-wider mb-3">
              Variables
            </p>
            <div>
              {formula.configKeys.map((key) => (
                <VarRow
                  key={key}
                  keyName={key}
                  row={rows.find((r) => r.key === key)}
                  fallbackDescription={formula.configMeta?.[key]}
                  onSave={onSave}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function FormulasPage({ initialRows }: Props) {
  const [rows, setRows] = useState<ConfigRow[]>(initialRows)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const timerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const handleSave = useCallback((key: string, value: string) => {
    setRows((prev) => {
      const exists = prev.some((r) => r.key === key)
      if (exists) return prev.map((r) => r.key === key ? { ...r, value } : r)
      return [...prev, { key, value, description: null, updated_at: new Date().toISOString() }]
    })
    setSaving(true)
    const existing = timerRef.current.get(key)
    if (existing) clearTimeout(existing)
    timerRef.current.set(key, setTimeout(async () => {
      timerRef.current.delete(key)
      await supabase.from('config').upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )
      if (timerRef.current.size === 0) setSaving(false)
    }, 500))
  }, [])

  return (
    <div className="min-h-screen bg-canvas">
      <div className="sticky top-12 z-30 bg-canvas border-b border-stone-200/60 shadow-sm px-6 py-3 flex items-center gap-4">
        <h1 className="font-display text-xl font-semibold text-stone-800 tracking-tight">Formulas</h1>
        {saving && <span className="text-stone-400 text-xs font-mono ml-auto">saving…</span>}
      </div>
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-3">
        {FORMULAS.map((formula) => (
          <FormulaCard
            key={formula.id}
            formula={formula}
            rows={rows}
            expanded={expanded === formula.id}
            onToggle={() => setExpanded(expanded === formula.id ? null : formula.id)}
            onSave={handleSave}
          />
        ))}
      </div>
    </div>
  )
}
