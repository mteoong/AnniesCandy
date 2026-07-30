'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  calcKingPay, calcSpPay, calcCoinsPay, candyPerPerson, formatPeso, todayString,
} from '@/lib/payroll'
import { Toaster } from '@/components/ui/toast'
import { CANDY_CONFIG, PIECEWISE_PREFIXES, nameInlineFormat, type Employee, type PayrollConfig, type HolidayType, type PiecewiseType } from '@/lib/types'

type Props = {
  initialEmployees: Employee[]
  config: PayrollConfig
  configError?: string | null
}

type DailyRate = '0' | 'Half' | 'Full'

const HOLIDAY_OPTIONS: HolidayType[] = ['Regular Day', '30%', '100%']

function Spinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}

function getPiecewiseType(job: string): PiecewiseType | null {
  for (const p of PIECEWISE_PREFIXES) {
    if (job.startsWith(p + ' #')) return p
  }
  return null
}

function calcPay(
  type: PiecewiseType,
  worker: Employee,
  totalCandy: number,
  presentCount: number,
  holiday: HolidayType,
  config: PayrollConfig,
): number {
  if (type === 'KING' || type === 'JR') return calcKingPay(worker, totalCandy, presentCount, holiday, config)
  if (type === 'SP') return calcSpPay(worker, totalCandy, presentCount, holiday, config)
  return calcCoinsPay(worker, totalCandy, presentCount, holiday, config)
}

function getDailyMultiplier(rate: DailyRate): number {
  if (rate === 'Full') return 1
  if (rate === 'Half') return 0.5
  return 0
}

function hoursFromRate(rate: DailyRate): number {
  if (rate === 'Full') return 8
  if (rate === 'Half') return 4
  return 0
}

function rateFromHours(hours: number): DailyRate {
  if (hours >= 8) return 'Full'
  if (hours >= 4) return 'Half'
  return '0'
}

// ── Group Card ────────────────────────────────────────────────────────────────
function PiecewiseGroupCard({
  jobCode,
  type,
  workers,
  candy,
  presentMap,
  dailyRateMap,
  config,
  holiday,
  saving,
  onCandyChange,
  onToggle,
  onDailyRateChange,
}: {
  jobCode: string
  type: PiecewiseType
  workers: Employee[]
  candy: number
  presentMap: Map<number, boolean>
  dailyRateMap: Map<number, DailyRate>
  config: PayrollConfig
  holiday: HolidayType
  saving: boolean
  onCandyChange: (val: number) => void
  onToggle: (id: number, present: boolean) => void
  onDailyRateChange: (id: number, rate: DailyRate) => void
}) {
  const cfg = CANDY_CONFIG[type === 'JR' ? 'JR' : type === 'COINS' ? 'COINS' : type as 'KING' | 'SP']
  const [candyInput, setCandyInput] = useState(candy.toString())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => setCandyInput(candy.toString()), [candy])

  const handleCandyInput = (val: string) => {
    setCandyInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onCandyChange(parseFloat(val) || 0), 500)
  }

  const presentCount = workers.filter((w) => presentMap.get(w.employee_id)).length
  const cpp = candyPerPerson(candy, presentCount)

  return (
    <div className={cn(
      'bg-white rounded-2xl border shadow-sm overflow-hidden w-72 flex-shrink-0',
      cfg.border,
    )}>
      {/* Header */}
      <div className={cn('flex items-center justify-between pl-3 pr-2 py-2.5 border-b', cfg.headerBg, cfg.border)}>
        <span className={cn('font-mono text-sm font-semibold tracking-wide', cfg.text)}>
          {jobCode}
        </span>
        <div className="flex items-center gap-1.5">
          {saving && <span className={cfg.text}><Spinner /></span>}
          <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-md font-sans', cfg.badge)}>
            {presentCount}/{workers.length}
          </span>
        </div>
      </div>

      {/* Candy count input */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-50">
        <label className="text-xs text-stone-400 font-sans flex-shrink-0">Candy</label>
        <input
          type="number"
          value={candyInput}
          onChange={(e) => handleCandyInput(e.target.value)}
          min={0}
          className="flex-1 px-2 py-1 text-sm font-mono text-right border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-200 bg-white text-stone-700"
        />
        {presentCount > 0 && (
          <span className="text-[10px] text-stone-300 font-mono flex-shrink-0">
            /{cpp.toFixed(0)}ea
          </span>
        )}
      </div>

      {/* Workers */}
      {workers.map((worker) => {
        const present = presentMap.get(worker.employee_id) ?? false
        const rate = dailyRateMap.get(worker.employee_id) ?? '0'
        const piecewisePay = present ? calcPay(type, worker, candy, presentCount, holiday, config) : 0
        const totalPay = piecewisePay + worker.daily_salary * getDailyMultiplier(rate)
        const hasAnyPay = totalPay > 0

        return (
          <div
            key={worker.employee_id}
            className={cn(
              'flex items-center gap-2 px-3 py-2 border-b border-stone-50 last:border-0',
              present ? 'bg-white' : 'bg-stone-50/60',
            )}
          >
            {/* Checkbox */}
            <button
              onClick={() => onToggle(worker.employee_id, !present)}
              className={cn(
                'w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors cursor-pointer',
                present ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-stone-300 hover:border-stone-400',
              )}
            >
              {present && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 3.5l2.5 2.5 4.5-5" />
                </svg>
              )}
            </button>

            {/* Name */}
            <span className={cn(
              'flex-1 text-xs font-medium font-sans truncate min-w-0',
              present ? 'text-stone-700' : 'text-stone-400',
            )}>
              {nameInlineFormat(worker)}
            </span>

            {/* Daily rate selector */}
            <div className="flex text-[10px] font-mono rounded overflow-hidden border border-stone-200 flex-shrink-0">
              {(['0', 'Half', 'Full'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => onDailyRateChange(worker.employee_id, r)}
                  className={cn(
                    'px-1.5 py-0.5 transition-colors leading-none cursor-pointer',
                    rate === r ? 'bg-stone-700 text-white' : 'text-stone-400 hover:bg-stone-50',
                  )}
                >
                  {r === 'Half' ? '½' : r === 'Full' ? '1' : '0'}
                </button>
              ))}
            </div>

            {/* Pay */}
            <span className={cn(
              'text-xs font-mono font-semibold flex-shrink-0 w-14 text-right',
              hasAnyPay ? 'text-stone-700' : 'text-stone-300',
            )}>
              {formatPeso(totalPay)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function PiecewisePage({ initialEmployees, config, configError }: Props) {
  const [date, setDate] = useState(todayString())
  const [holiday, setHoliday] = useState<HolidayType>('Regular Day')
  const [candyMap, setCandyMap] = useState<Map<string, number>>(new Map())
  const [presentMap, setPresentMap] = useState<Map<number, boolean>>(new Map())
  const [dailyRateMap, setDailyRateMap] = useState<Map<number, DailyRate>>(new Map())
  const [savingGroups, setSavingGroups] = useState<Set<string>>(new Set())

  const companies = useMemo(
    () => [...new Set(initialEmployees.map((e) => e.company))].sort(),
    [initialEmployees],
  )
  const [selectedCompany, setSelectedCompany] = useState<string>(() => companies[0] ?? '')

  // Group by piecewise type → job code, filtered by company
  const byType = useMemo(() => {
    const acc = new Map<PiecewiseType, Map<string, Employee[]>>()
    for (const emp of initialEmployees) {
      if (emp.company !== selectedCompany) continue
      const type = getPiecewiseType(emp.job)
      if (!type) continue
      if (!acc.has(type)) acc.set(type, new Map())
      const byJob = acc.get(type)!
      if (!byJob.has(emp.job)) byJob.set(emp.job, [])
      byJob.get(emp.job)!.push(emp)
    }
    return acc
  }, [initialEmployees, selectedCompany])

  const fetchRecords = useCallback(async (d: string) => {
    const ids = initialEmployees.map((e) => e.employee_id)
    if (!ids.length) return
    const { data } = await supabase
      .from('daily_records')
      .select('employee_id, daily_pay, holiday, hours, pieces')
      .eq('date', d)
      .in('employee_id', ids)

    const nextPresent = new Map<number, boolean>()
    const nextDailyRate = new Map<number, DailyRate>()
    initialEmployees.forEach((e) => {
      nextPresent.set(e.employee_id, false)
      nextDailyRate.set(e.employee_id, '0')
    })
    if (data) {
      data.forEach((r: { employee_id: number; daily_pay: number; holiday: HolidayType; hours: number; pieces: number }) => {
        const rate = rateFromHours(r.hours ?? 0)
        const present = r.pieces > 0 || rate !== '0'
        nextPresent.set(r.employee_id, present)
        nextDailyRate.set(r.employee_id, rate)
        if (r.holiday) setHoliday(r.holiday)
      })
    }
    setPresentMap(nextPresent)
    setDailyRateMap(nextDailyRate)
  }, [initialEmployees])

  useEffect(() => { fetchRecords(date) }, [date, fetchRecords])

  const upsertGroup = async (
    jobCode: string,
    type: PiecewiseType,
    workers: Employee[],
    currentCandy: number,
    currentPresent: Map<number, boolean>,
    currentDailyRate: Map<number, DailyRate>,
    currentHoliday: HolidayType,
  ) => {
    setSavingGroups((prev) => new Set(prev).add(jobCode))
    const presentCount = workers.filter((w) => currentPresent.get(w.employee_id)).length
    const cpp = candyPerPerson(currentCandy, presentCount)

    const records = workers.map((w) => {
      const present = currentPresent.get(w.employee_id) ?? false
      const rate = currentDailyRate.get(w.employee_id) ?? '0'
      const piecewisePay = present ? calcPay(type, w, currentCandy, presentCount, currentHoliday, config) : 0
      const totalPay = piecewisePay + w.daily_salary * getDailyMultiplier(rate)
      return {
        employee_id: w.employee_id,
        date,
        job: w.job,
        hours: hoursFromRate(rate),
        pieces: present ? Math.round(cpp) : 0,
        daily_pay: totalPay,
        nightshift: w.nightshift,
        holiday: currentHoliday,
      }
    })
    await supabase.from('daily_records').upsert(records, { onConflict: 'employee_id,date' })
    setSavingGroups((prev) => { const s = new Set(prev); s.delete(jobCode); return s })
  }

  const handleCandyChange = (jobCode: string, type: PiecewiseType, workers: Employee[], val: number) => {
    setCandyMap((prev) => new Map(prev).set(jobCode, val))
    upsertGroup(jobCode, type, workers, val, presentMap, dailyRateMap, holiday)
  }

  const handleToggle = (jobCode: string, type: PiecewiseType, workers: Employee[], empId: number, present: boolean) => {
    const nextPresent = new Map(presentMap).set(empId, present)
    const nextDailyRate = new Map(dailyRateMap).set(empId, present ? 'Full' : '0')
    setPresentMap(nextPresent)
    setDailyRateMap(nextDailyRate)
    upsertGroup(jobCode, type, workers, candyMap.get(jobCode) ?? 0, nextPresent, nextDailyRate, holiday)
  }

  const handleDailyRateChange = (jobCode: string, type: PiecewiseType, workers: Employee[], empId: number, rate: DailyRate) => {
    const nextDailyRate = new Map(dailyRateMap).set(empId, rate)
    setDailyRateMap(nextDailyRate)
    upsertGroup(jobCode, type, workers, candyMap.get(jobCode) ?? 0, presentMap, nextDailyRate, holiday)
  }

  const handleHolidayChange = async (h: HolidayType) => {
    setHoliday(h)
    for (const [type, byJob] of byType) {
      for (const [jobCode, workers] of byJob) {
        await upsertGroup(jobCode, type, workers, candyMap.get(jobCode) ?? 0, presentMap, dailyRateMap, h)
      }
    }
  }

  const CompanyTabs = companies.length > 1 ? (
    <div className="max-w-7xl mx-auto px-6 pb-3 flex items-center gap-1">
      {companies.map((company) => (
        <button
          key={company}
          onClick={() => setSelectedCompany(company)}
          className={cn(
            'px-3.5 py-1.5 rounded-lg text-sm font-sans font-medium transition-all duration-150 cursor-pointer',
            selectedCompany === company
              ? 'bg-stone-800 text-white'
              : 'text-stone-500 hover:text-stone-800 hover:bg-black/8',
          )}
        >
          {company as string}
        </button>
      ))}
    </div>
  ) : null

  const SECTION_LABELS: Record<PiecewiseType, string> = {
    KING: 'King',
    JR: 'JR',
    SP: 'SP',
    COINS: 'Coins',
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Toaster />

      {/* Header */}
      <div className="sticky top-12 z-30 bg-canvas border-b border-stone-200/60 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3 flex flex-wrap items-center gap-4">
          <h1 className="font-display text-xl font-semibold text-stone-800 tracking-tight">Piecewise</h1>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-1.5 text-sm font-sans border border-stone-200 rounded-lg bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-300 cursor-pointer"
            />
            <div className="flex rounded-lg border border-stone-200 overflow-hidden bg-white">
              {HOLIDAY_OPTIONS.map((h) => (
                <button key={h} onClick={() => handleHolidayChange(h)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium font-sans transition-colors',
                    holiday === h ? 'bg-stone-800 text-white' : 'text-stone-500 hover:bg-stone-50',
                  )}>
                  {h}
                </button>
              ))}
            </div>
          </div>
        </div>
        {CompanyTabs}
      </div>

      {configError && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 font-sans">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            <span><strong>Config table error:</strong> {configError} — seed the config table in Supabase.</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-10">
        {PIECEWISE_PREFIXES.map((type) => {
          const byJob = byType.get(type)
          if (!byJob || byJob.size === 0) return null
          const cfg = CANDY_CONFIG[type === 'JR' ? 'JR' : type === 'COINS' ? 'COINS' : type as 'KING' | 'SP']
          return (
            <div key={type}>
              <div className="flex items-center gap-3 mb-4">
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot)} />
                <span className={cn('text-sm font-mono font-semibold uppercase tracking-wider', cfg.text)}>
                  {SECTION_LABELS[type]}
                </span>
                <div className="flex-1 h-px bg-stone-200" />
              </div>
              <div className="flex flex-wrap gap-4">
                {Array.from(byJob.entries()).map(([jobCode, workers]: [string, Employee[]]) => (
                  <PiecewiseGroupCard
                    key={jobCode}
                    jobCode={jobCode}
                    type={type}
                    workers={workers}
                    candy={candyMap.get(jobCode) ?? 0}
                    presentMap={presentMap}
                    dailyRateMap={dailyRateMap}
                    config={config}
                    holiday={holiday}
                    saving={savingGroups.has(jobCode)}
                    onCandyChange={(val) => handleCandyChange(jobCode, type, workers, val)}
                    onToggle={(id, present) => handleToggle(jobCode, type, workers, id, present)}
                    onDailyRateChange={(id, rate) => handleDailyRateChange(jobCode, type, workers, id, rate)}
                  />
                ))}
              </div>
            </div>
          )
        })}
        {byType.size === 0 && (
          <div className="text-center py-20 text-stone-300 font-sans text-sm">
            No piecewise groups found for {selectedCompany}.
          </div>
        )}
      </div>
    </div>
  )
}
