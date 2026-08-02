'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  calcDailyPay, calcComboPay, calcKingPay, calcSpPay, calcCoinsPay,
  formatPeso, todayString,
} from '@/lib/payroll'
import { Toaster } from '@/components/ui/toast'
import {
  JOB_COLOR_CONFIG, CANDY_CONFIG, PIECEWISE_PREFIXES, getPiecewiseTypeFromJob,
  getDailyJobColor, nameTableFormat,
  type Employee, type PayrollConfig, type HolidayType, type PiecewiseType,
} from '@/lib/types'
import { useCompany } from '@/lib/company-context'

type Attendance = 'present' | 'absent' | null
type DailyRate = '0' | 'Half' | 'Full'
type WorkerState = { attendance: Attendance; extra: number; dailyRate: DailyRate }
type CompletionStatus = 'none' | 'partial' | 'full'

function getDailyMultiplier(rate: DailyRate): number {
  if (rate === 'Full') return 1
  if (rate === 'Half') return 0.5
  return 0
}
function hoursFromRate(rate: DailyRate): number {
  return rate === 'Full' ? 8 : rate === 'Half' ? 4 : 0
}
function rateFromHours(hours: number): DailyRate {
  return hours >= 8 ? 'Full' : hours >= 4 ? 'Half' : '0'
}

type Props = {
  dailyWorkers: Employee[]
  comboWorkers: Employee[]
  piecewiseWorkers: Employee[]
  config: PayrollConfig
  configError?: string | null
}

type SidebarEntry = { id: string; label: string; workers: Employee[] }
type SidebarMode  = { id: string; label: string; entries: SidebarEntry[] }

const HOLIDAY_OPTIONS: HolidayType[] = ['Regular Day', '30%', '100%']
const SECTION_LABELS: Record<PiecewiseType, string> = { KING: 'King', JR: 'JR', SP: 'SP', COINS: 'Coins' }

function toScrollId(company: string, scope: string) {
  return `scroll-${company}-${scope}`.replace(/[^a-zA-Z0-9-]/g, '-')
}

function getStatus(workers: Employee[], states: Map<number, WorkerState>): CompletionStatus {
  const inputted = workers.filter((w) => states.get(w.employee_id)?.attendance !== null).length
  if (inputted === 0) return 'none'
  if (inputted === workers.length) return 'full'
  return 'partial'
}

function rollupStatus(statuses: CompletionStatus[]): CompletionStatus {
  if (!statuses.length) return 'none'
  if (statuses.every((s) => s === 'full')) return 'full'
  if (statuses.every((s) => s === 'none')) return 'none'
  return 'partial'
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}

// ── Status indicator ──────────────────────────────────────────────────────────
function StatusIndicator({ status }: { status: CompletionStatus }) {
  if (status === 'full') {
    return (
      <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6l3 3 5-5" />
        </svg>
      </span>
    )
  }
  if (status === 'partial') {
    return (
      <span className="w-3.5 h-3.5 rounded-full border-2 border-amber-400 bg-amber-50 flex items-center justify-center flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      </span>
    )
  }
  return <span className="w-3.5 h-3.5 rounded-full border-2 border-stone-200 flex-shrink-0" />
}

// ── Pill toggle — iOS-style segmented control ─────────────────────────────────
function PillToggle({ options, value, onChange }: {
  options: { value: string; label: string; activeClass: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div
      className="flex items-center p-0.5 rounded-full bg-stone-100 border border-stone-200 gap-0.5 flex-shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-2.5 py-1 rounded-full text-xs font-medium font-sans transition-all leading-none cursor-pointer whitespace-nowrap',
            value === opt.value ? opt.activeClass : 'text-stone-400 hover:text-stone-600',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Attendance control — stops propagation so clicks don't start a drag ───────
function AttendanceControl({ value, onChange }: { value: Attendance; onChange: (v: Attendance) => void }) {
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0" onPointerDown={(e) => e.stopPropagation()}>
      <button
        onClick={() => onChange(value === 'absent' ? null : 'absent')}
        className={cn(
          'w-7 h-6 rounded-md text-[10px] font-bold font-sans transition-colors',
          value === 'absent'
            ? 'bg-red-500 text-white'
            : 'bg-stone-100 text-stone-400 hover:bg-red-50 hover:text-red-400',
        )}
      >
        A
      </button>
      <button
        onClick={() => onChange(value === 'present' ? null : 'present')}
        className={cn(
          'w-7 h-6 rounded-md text-[10px] font-bold font-sans transition-colors',
          value === 'present'
            ? 'bg-emerald-500 text-white'
            : 'bg-stone-100 text-stone-400 hover:bg-emerald-50 hover:text-emerald-400',
        )}
      >
        P
      </button>
    </div>
  )
}

// ── Draggable worker row for combo / piecewise cards ──────────────────────────
function DraggableCandyWorkerRow({
  worker, attendance, pay, extra, onAttendance, onExtra, onNightshift,
}: {
  worker: Employee
  attendance: Attendance
  pay: number
  extra: number
  onAttendance: (v: Attendance) => void
  onExtra: (x: number) => void
  onNightshift: (nightshift: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `worker-${worker.employee_id}`,
    data: { worker },
  })
  const [extraInput, setExtraInput] = useState(extra === 0 ? '' : extra.toString())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => setExtraInput(extra === 0 ? '' : extra.toString()), [extra])

  const handleExtraInput = (val: string) => {
    setExtraInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onExtra(parseFloat(val) || 0), 500)
  }

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined
  const isPresent = attendance === 'present'

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'flex items-center gap-4 px-4 py-2 border-b border-stone-50 last:border-0 select-none',
        'cursor-grab active:cursor-grabbing transition-colors',
        isDragging && 'opacity-0',
        isPresent ? 'bg-emerald-50/60' : attendance === 'absent' ? 'bg-red-50/40' : 'bg-white',
      )}
    >
      <AttendanceControl value={attendance} onChange={onAttendance} />
      <span className={cn(
        'flex-1 min-w-0 text-sm font-medium font-sans truncate',
        isPresent ? 'text-stone-800' : 'text-stone-400',
      )}>
        {nameTableFormat(worker)}
      </span>
      <div className="w-[88px] flex justify-center">
        <PillToggle
          options={[
            { value: 'day',   label: 'Day',   activeClass: 'bg-amber-100 text-amber-700 shadow-sm' },
            { value: 'night', label: 'Night', activeClass: 'bg-violet-100 text-violet-700 shadow-sm' },
          ]}
          value={worker.nightshift ? 'night' : 'day'}
          onChange={(v) => onNightshift(v === 'night')}
        />
      </div>
      <div className="w-24 flex items-center justify-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
        <span className="text-stone-400 text-xs flex-shrink-0">₱</span>
        <input
          type="number" value={extraInput} onChange={(e) => handleExtraInput(e.target.value)}
          min={0}
          className="w-16 pr-1 py-1 text-sm font-sans text-right rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-300"
        />
      </div>
      <div className="w-24 text-right">
        <span className={cn('text-sm font-mono font-semibold', pay > 0 ? 'text-stone-800' : 'text-stone-300')}>
          {formatPeso(pay)}
        </span>
      </div>
    </div>
  )
}

// ── 3-dot group menu ──────────────────────────────────────────────────────────
function GroupDotMenu({ isNightShift, onChangeShift }: { isNightShift: boolean; onChangeShift: (n: boolean) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const handleToggle = () => {
    if (!menuOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setMenuOpen((v) => !v)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex items-center justify-center w-6 h-6 rounded-md text-stone-400 hover:text-stone-600 hover:bg-black/8 transition-colors cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>

      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
          className="bg-white border border-stone-200 rounded-xl shadow-xl py-1.5 min-w-44 text-sm font-sans"
        >
          <button
            onClick={() => { setMenuOpen(false); onChangeShift(!isNightShift) }}
            className="w-full text-left px-3.5 py-2 text-stone-600 hover:bg-stone-50 flex items-center gap-2.5 transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isNightShift
                ? <><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></>
                : <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              }
            </svg>
            Move to {isNightShift ? 'day' : 'night'} shift
          </button>
        </div>
      )}
    </>
  )
}

// ── Daily job card (no drag/drop) ─────────────────────────────────────────────
function DailyJobCard({
  job, workers, workerStates, config, holiday, saving, onAttendance, onRate, onExtra, onNightshift, onMarkAll,
}: {
  job: string
  workers: Employee[]
  workerStates: Map<number, WorkerState>
  config: PayrollConfig
  holiday: HolidayType
  saving: Set<number>
  onAttendance: (w: Employee, v: Attendance) => void
  onRate: (w: Employee, r: DailyRate) => void
  onExtra: (w: Employee, x: number) => void
  onNightshift: (w: Employee, nightshift: boolean) => void
  onMarkAll: () => void
}) {
  const cfg = JOB_COLOR_CONFIG[getDailyJobColor(job)]
  const inputtedCount = workers.filter((w) => workerStates.get(w.employee_id)?.attendance !== null).length

  return (
    <div className={cn('bg-white rounded-2xl border shadow-sm overflow-hidden', cfg.border)}>
      <div className={cn('flex items-center justify-between px-4 py-3 border-b', cfg.headerBg, cfg.border)}>
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', cfg.dot)} />
          <span className={cn('font-mono text-sm font-semibold tracking-wide', cfg.text)}>{job}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onMarkAll}
            className={cn('text-[10px] font-medium font-sans px-2 py-0.5 rounded-md transition-colors', cfg.badge, 'hover:opacity-80 cursor-pointer')}
          >
            All present
          </button>
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-md font-sans', cfg.badge)}>
            {inputtedCount}/{workers.length}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4 px-4 py-1.5 bg-stone-50/60 border-b border-stone-50 text-[10px] font-semibold text-stone-400 uppercase tracking-wider font-sans">
        <span className="w-[58px]" />
        <span className="flex-1 min-w-0">Name</span>
        <span className="w-[88px] text-center">Rate</span>
        <span className="w-[88px] text-center">Shift</span>
        <span className="w-24 text-center">Extra</span>
        <span className="w-24 text-right">Pay</span>
      </div>
      {workers.map((worker) => {
        const state = workerStates.get(worker.employee_id) ?? { attendance: null, extra: 0, dailyRate: '0' as DailyRate }
        const mult = getDailyMultiplier(state.dailyRate)
        const extra = state.extra
        const pay = mult === 0 ? extra
          : calcDailyPay({ ...worker, daily_salary: worker.daily_salary * mult }, extra, holiday, config)
        return (
          <DailyWorkerRow
            key={worker.employee_id}
            worker={worker}
            state={state}
            pay={pay}
            saving={saving.has(worker.employee_id)}
            onAttendance={(v) => onAttendance(worker, v)}
            onRate={(r) => onRate(worker, r)}
            onExtra={(x) => onExtra(worker, x)}
            onNightshift={(n) => onNightshift(worker, n)}
          />
        )
      })}
    </div>
  )
}

function DailyWorkerRow({
  worker, state, pay, saving, onAttendance, onRate, onExtra, onNightshift,
}: {
  worker: Employee
  state: WorkerState
  pay: number
  saving: boolean
  onAttendance: (v: Attendance) => void
  onRate: (r: DailyRate) => void
  onExtra: (x: number) => void
  onNightshift: (nightshift: boolean) => void
}) {
  const [extraInput, setExtraInput] = useState(state.extra === 0 ? '' : state.extra.toString())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => setExtraInput(state.extra === 0 ? '' : state.extra.toString()), [state.extra])

  const handleExtra = (val: string) => {
    setExtraInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onExtra(parseFloat(val) || 0), 500)
  }

  const isPresent = state.attendance === 'present'

  return (
    <div className={cn(
      'flex items-center gap-4 px-4 py-2 border-b border-stone-50 last:border-0 transition-colors',
      isPresent ? 'bg-emerald-50/60' : state.attendance === 'absent' ? 'bg-red-50/40' : 'bg-white',
    )}>
      {/* A / P attendance buttons */}
      <AttendanceControl value={state.attendance} onChange={onAttendance} />
      {/* Name */}
      <span className={cn('flex-1 min-w-0 text-sm font-medium font-sans truncate',
        isPresent ? 'text-stone-800' : state.attendance === 'absent' ? 'text-stone-400' : 'text-stone-400',
      )}>
        {nameTableFormat(worker)}
      </span>
      {/* Rate pill toggle */}
      <div className="w-[88px] flex justify-center">
        <PillToggle
          options={[
            { value: '0',    label: '0', activeClass: 'bg-red-100 text-red-600 shadow-sm' },
            { value: 'Half', label: '½', activeClass: 'bg-orange-100 text-orange-600 shadow-sm' },
            { value: 'Full', label: '1', activeClass: 'bg-emerald-100 text-emerald-700 shadow-sm' },
          ]}
          value={state.dailyRate}
          onChange={(v) => onRate(v as DailyRate)}
        />
      </div>
      {/* Nightshift pill toggle */}
      <div className="w-[88px] flex justify-center">
        <PillToggle
          options={[
            { value: 'day',   label: 'Day',   activeClass: 'bg-amber-100 text-amber-700 shadow-sm' },
            { value: 'night', label: 'Night', activeClass: 'bg-violet-100 text-violet-700 shadow-sm' },
          ]}
          value={worker.nightshift ? 'night' : 'day'}
          onChange={(v) => onNightshift(v === 'night')}
        />
      </div>
      {/* Extra */}
      <div className="w-24 flex items-center justify-center gap-0.5">
        <span className="text-stone-400 text-xs flex-shrink-0">₱</span>
        <input
          type="number" value={extraInput} onChange={(e) => handleExtra(e.target.value)}
          min={0}
          className="w-16 pr-1 py-1 text-sm font-sans text-right rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-300"
        />
      </div>
      {/* Pay */}
      <div className="w-24 text-right">
        {saving
          ? <span className="text-stone-300 text-xs font-mono">saving…</span>
          : <span className={cn('text-sm font-mono font-semibold', pay > 0 ? 'text-stone-800' : 'text-stone-300')}>{formatPeso(pay)}</span>
        }
      </div>
    </div>
  )
}

// ── Combo group card ──────────────────────────────────────────────────────────
function ComboCard({
  jobCode, workers, boxes, workerStates, config, holiday, saving,
  onBoxes, onAttendance, onMarkAll, onChangeShift, onExtra, onNightshift,
}: {
  jobCode: string; workers: Employee[]; boxes: number
  workerStates: Map<number, WorkerState>; config: PayrollConfig
  holiday: HolidayType; saving: boolean
  onBoxes: (v: number) => void
  onAttendance: (id: number, v: Attendance) => void
  onMarkAll: () => void
  onChangeShift: (toNight: boolean) => void
  onExtra: (id: number, x: number) => void
  onNightshift: (worker: Employee, nightshift: boolean) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: jobCode })
  const isNightShift = workers[0]?.nightshift ?? false
  const cfg = CANDY_CONFIG.COMBO

  const [boxInput, setBoxInput] = useState(boxes === 0 ? '' : boxes.toString())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => setBoxInput(boxes === 0 ? '' : boxes.toString()), [boxes])

  const handleBoxInput = (val: string) => {
    setBoxInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onBoxes(parseFloat(val) || 0), 500)
  }

  const presentCount = workers.filter((w) => workerStates.get(w.employee_id)?.attendance === 'present').length
  const inputtedCount = workers.filter((w) => workerStates.get(w.employee_id)?.attendance !== null).length

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-2xl border shadow-sm overflow-hidden bg-white border-violet-200 flex flex-col transition-all duration-150',
        isOver && `ring-2 ${cfg.ringColor} ring-offset-2`,
      )}
    >
      <div className={cn('flex items-center justify-between pl-3 pr-1.5 py-2.5 border-b', cfg.headerBg, cfg.border)}>
        <span className={cn('font-mono text-sm font-semibold tracking-wide', cfg.text)}>{jobCode}</span>
        <div className="flex items-center gap-1">
          {saving && <span className={cfg.text}><Spinner /></span>}
          <button onClick={onMarkAll} onPointerDown={(e) => e.stopPropagation()} className={cn('text-[10px] font-medium font-sans px-1.5 py-0.5 rounded-md hover:opacity-80 cursor-pointer transition-colors', cfg.badge)}>
            All
          </button>
          <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-md font-sans', cfg.badge)}>{inputtedCount}/{workers.length}</span>
          <GroupDotMenu isNightShift={isNightShift} onChangeShift={onChangeShift} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 px-3 py-2.5 border-b border-stone-50">
        <label className="text-xs font-sans flex-shrink-0 text-stone-400">Boxes</label>
        <input
          type="number" value={boxInput} onChange={(e) => handleBoxInput(e.target.value)} min={0}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-32 px-2 py-1 text-sm font-mono text-right border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white border-stone-200 text-stone-700"
        />
      </div>
      <div className="flex items-center gap-4 px-4 py-1.5 bg-stone-50/60 border-b border-stone-50 text-[10px] font-semibold text-stone-400 uppercase tracking-wider font-sans">
        <span className="w-[58px]" />
        <span className="flex-1 min-w-0">Name</span>
        <span className="w-[88px] text-center">Shift</span>
        <span className="w-24 text-center">Extra</span>
        <span className="w-24 text-right">Pay</span>
      </div>
      <div className="flex flex-col flex-1">
        {workers.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-10 text-xs font-sans text-stone-300">
            Drag workers here
          </div>
        ) : (
          workers.map((worker) => {
            const state = workerStates.get(worker.employee_id)
            const attendance = state?.attendance ?? null
            const extra = state?.extra ?? 0
            const pay = attendance === 'present' ? calcComboPay(worker, boxes, presentCount, holiday, config) + extra : extra
            return (
              <DraggableCandyWorkerRow
                key={worker.employee_id}
                worker={worker}
                attendance={attendance}
                pay={pay}
                extra={extra}
                onAttendance={(v) => onAttendance(worker.employee_id, v)}
                onExtra={(x) => onExtra(worker.employee_id, x)}
                onNightshift={(nightshift) => onNightshift(worker, nightshift)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Piecewise group card ──────────────────────────────────────────────────────
function PiecewiseCard({
  jobCode, type, workers, candy, workerStates, config, holiday, saving,
  onCandy, onAttendance, onMarkAll, onChangeShift, onExtra, onNightshift,
}: {
  jobCode: string; type: PiecewiseType; workers: Employee[]; candy: number
  workerStates: Map<number, WorkerState>; config: PayrollConfig
  holiday: HolidayType; saving: boolean
  onCandy: (v: number) => void
  onAttendance: (id: number, v: Attendance) => void
  onMarkAll: () => void
  onChangeShift: (toNight: boolean) => void
  onExtra: (id: number, x: number) => void
  onNightshift: (worker: Employee, nightshift: boolean) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: jobCode })
  const isNightShift = workers[0]?.nightshift ?? false
  const cfg = CANDY_CONFIG[type === 'JR' ? 'JR' : type === 'COINS' ? 'COINS' : type as 'KING' | 'SP']

  const [candyInput, setCandyInput] = useState(candy === 0 ? '' : candy.toString())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => setCandyInput(candy === 0 ? '' : candy.toString()), [candy])

  const handleCandyInput = (val: string) => {
    setCandyInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onCandy(parseFloat(val) || 0), 500)
  }

  const presentCount = workers.filter((w) => workerStates.get(w.employee_id)?.attendance === 'present').length
  const inputtedCount = workers.filter((w) => workerStates.get(w.employee_id)?.attendance !== null).length

  function calcBasePay(worker: Employee) {
    if (type === 'KING' || type === 'JR') return calcKingPay(worker, candy, presentCount, holiday, config)
    if (type === 'SP') return calcSpPay(worker, candy, presentCount, holiday, config)
    return calcCoinsPay(worker, candy, presentCount, holiday, config)
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        `rounded-2xl border shadow-sm overflow-hidden bg-white ${cfg.border} flex flex-col transition-all duration-150`,
        isOver && `ring-2 ${cfg.ringColor} ring-offset-2`,
      )}
    >
      <div className={cn('flex items-center justify-between pl-3 pr-1.5 py-2.5 border-b', cfg.headerBg, cfg.border)}>
        <span className={cn('font-mono text-sm font-semibold tracking-wide', cfg.text)}>{jobCode}</span>
        <div className="flex items-center gap-1">
          {saving && <span className={cfg.text}><Spinner /></span>}
          <button onClick={onMarkAll} onPointerDown={(e) => e.stopPropagation()} className={cn('text-[10px] font-medium font-sans px-1.5 py-0.5 rounded-md hover:opacity-80 cursor-pointer transition-colors', cfg.badge)}>
            All
          </button>
          <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-md font-sans', cfg.badge)}>{inputtedCount}/{workers.length}</span>
          <GroupDotMenu isNightShift={isNightShift} onChangeShift={onChangeShift} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 px-3 py-2.5 border-b border-stone-50">
        <label className="text-xs font-sans flex-shrink-0 text-stone-400">Candy</label>
        <input
          type="number" value={candyInput} onChange={(e) => handleCandyInput(e.target.value)} min={0}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-32 px-2 py-1 text-sm font-mono text-right border rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-200 bg-white border-stone-200 text-stone-700"
        />
      </div>
      <div className="flex items-center gap-4 px-4 py-1.5 bg-stone-50/60 border-b border-stone-50 text-[10px] font-semibold text-stone-400 uppercase tracking-wider font-sans">
        <span className="w-[58px]" />
        <span className="flex-1 min-w-0">Name</span>
        <span className="w-[88px] text-center">Shift</span>
        <span className="w-24 text-center">Extra</span>
        <span className="w-24 text-right">Pay</span>
      </div>
      <div className="flex flex-col flex-1">
        {workers.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-10 text-xs font-sans text-stone-300">
            Drag workers here
          </div>
        ) : (
          workers.map((worker) => {
            const state = workerStates.get(worker.employee_id)
            const attendance = state?.attendance ?? null
            const extra = state?.extra ?? 0
            const pay = attendance === 'present' ? calcBasePay(worker) + extra : extra
            return (
              <DraggableCandyWorkerRow
                key={worker.employee_id}
                worker={worker}
                attendance={attendance}
                pay={pay}
                extra={extra}
                onAttendance={(v) => onAttendance(worker.employee_id, v)}
                onExtra={(x) => onExtra(worker.employee_id, x)}
                onNightshift={(nightshift) => onNightshift(worker, nightshift)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-10 bg-stone-100 rounded-2xl" />
      {[1, 2, 3].map((r) => (
        <div key={r} className="flex items-center gap-3 px-4 py-3">
          <div className="h-4 bg-stone-100 rounded flex-1" />
          <div className="h-7 w-24 bg-stone-100 rounded-lg" />
          <div className="h-4 w-20 bg-stone-100 rounded" />
          <div className="h-6 w-16 bg-stone-100 rounded-md" />
        </div>
      ))}
    </div>
  )
}

// ── Section divider ───────────────────────────────────────────────────────────
function SectionHeader({ label, dot, text }: { label: string; dot: string; text: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className={cn('w-2 h-2 rounded-full flex-shrink-0', dot)} />
      <span className={cn('text-xs font-mono font-semibold uppercase tracking-wider', text)}>{label}</span>
      <div className="flex-1 h-px bg-stone-200" />
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({
  modes, activeId, workerStates, onSelectEntry,
}: {
  modes: SidebarMode[]
  activeId: string | null
  workerStates: Map<number, WorkerState>
  onSelectEntry: (id: string) => void
}) {
  return (
    <aside className="fixed top-12 left-0 bottom-0 w-52 bg-white border-r border-stone-200 overflow-y-auto z-40 flex flex-col">
      <div className="py-3 flex-1 overflow-y-auto">
        {modes.map((modeItem) => (
          <div key={modeItem.id} className="mb-3">
            <div className="px-4 py-1 mb-0.5">
              <span className="text-[10px] font-semibold font-sans uppercase tracking-widest text-stone-400">
                {modeItem.label}
              </span>
            </div>
            {modeItem.entries.map((entry) => {
              const status = getStatus(entry.workers, workerStates)
              const isActive = activeId === entry.id
              return (
                <button
                  key={entry.id}
                  onClick={() => onSelectEntry(entry.id)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-4 py-1.5 text-left transition-colors',
                    isActive ? 'bg-stone-100' : 'hover:bg-stone-50',
                  )}
                >
                  <StatusIndicator status={status} />
                  <span className={cn('text-xs font-mono truncate', isActive ? 'font-semibold text-stone-800' : 'text-stone-500')}>
                    {entry.label}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}

// ── Drag overlay preview ──────────────────────────────────────────────────────
function WorkerDragOverlay({ worker }: { worker: Employee }) {
  return (
    <div className="bg-white border border-stone-200 shadow-2xl rounded-lg px-3 py-2 w-48 flex items-center gap-2 cursor-grabbing opacity-90">
      <span className="flex-1 text-xs font-medium font-sans text-stone-700 truncate">
        {nameTableFormat(worker)}
      </span>
    </div>
  )
}

// ── Add group dropdown button ─────────────────────────────────────────────────
function AddGroupDropdown({ onAdd }: { onAdd: (type: PiecewiseType | 'COMBO') => void }) {
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

  const options: Array<{ type: PiecewiseType | 'COMBO'; label: string; dot: string }> = [
    { type: 'COMBO', label: 'Combo', dot: JOB_COLOR_CONFIG.COMBO.dot },
    { type: 'KING',  label: 'King',  dot: CANDY_CONFIG.KING.dot },
    { type: 'JR',    label: 'JR',    dot: CANDY_CONFIG.JR.dot },
    { type: 'SP',    label: 'SP',    dot: CANDY_CONFIG.SP.dot },
    { type: 'COINS', label: 'Coins', dot: CANDY_CONFIG.COINS.dot },
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-sans rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-800 transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add Group
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 bg-white border border-stone-200 rounded-xl shadow-xl py-1.5 min-w-36 z-50 font-sans text-sm">
          {options.map(({ type, label, dot }) => (
            <button
              key={type}
              onClick={() => { onAdd(type); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-stone-600 hover:bg-stone-50 transition-colors"
            >
              <div className={cn('w-2 h-2 rounded-full flex-shrink-0', dot)} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function DailyPage({
  dailyWorkers: initialDailyWorkers,
  comboWorkers: initialComboWorkers,
  piecewiseWorkers: initialPiecewiseWorkers,
  config,
  configError,
}: Props) {
  const [date, setDate] = useState(todayString())
  const [holiday, setHoliday] = useState<HolidayType>('Regular Day')
  const [workerStates, setWorkerStates] = useState<Map<number, WorkerState>>(new Map())
  const [boxesMap, setBoxesMap] = useState<Map<string, number>>(new Map())
  const [candyMap, setCandyMap] = useState<Map<string, number>>(new Map())
  const [savingWorkers, setSavingWorkers] = useState<Set<number>>(new Set())
  const [savingGroups, setSavingGroups] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeWorker, setActiveWorker] = useState<Employee | null>(null)
  const [ephemeralGroups, setEphemeralGroups] = useState<Set<string>>(new Set())

  // Mutable worker list — drag/shift changes update this
  const [allWorkers, setAllWorkers] = useState<Employee[]>(() => [
    ...initialDailyWorkers, ...initialComboWorkers, ...initialPiecewiseWorkers,
  ])

  // Ref so fetchRecords can read current workers without being a dependency
  const allWorkersRef = useRef(allWorkers)
  useEffect(() => { allWorkersRef.current = allWorkers }, [allWorkers])

  // Derive categories from mutable list
  const dailyWorkers = useMemo(() =>
    allWorkers.filter((e) => !getPiecewiseTypeFromJob(e.job) && !e.job.startsWith('COMBO #')),
    [allWorkers],
  )
  const comboWorkers = useMemo(() =>
    allWorkers.filter((e) => e.job.startsWith('COMBO #')),
    [allWorkers],
  )
  const piecewiseWorkers = useMemo(() =>
    allWorkers.filter((e) => getPiecewiseTypeFromJob(e.job) !== null),
    [allWorkers],
  )

  const { selectedCompany } = useCompany()

  // Clear ephemeral groups when company switches — they're company-scoped
  useEffect(() => { setEphemeralGroups(new Set()) }, [selectedCompany])

  // ── DnD ─────────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  const handleDragStart = (event: DragStartEvent) => {
    const workerId = parseInt(event.active.id.toString().replace('worker-', ''))
    setActiveWorker(allWorkersRef.current.find((w) => w.employee_id === workerId) ?? null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveWorker(null)
    if (!over) return

    const workerId = parseInt(active.id.toString().replace('worker-', ''))
    const targetJob = over.id.toString()
    const worker = allWorkersRef.current.find((w) => w.employee_id === workerId)
    if (!worker || worker.job === targetJob) return

    // Match the target group's nightshift so dragged worker doesn't bleed its old shift color
    const targetGroupWorkers = allWorkersRef.current.filter((w) => w.job === targetJob)
    const targetNightshift = targetGroupWorkers.length > 0 ? targetGroupWorkers[0].nightshift : worker.nightshift

    // Ephemeral group becomes real once it has a worker
    if (ephemeralGroups.has(targetJob)) {
      setEphemeralGroups((prev) => { const s = new Set(prev); s.delete(targetJob); return s })
    }

    setAllWorkers((prev) =>
      prev.map((w) => w.employee_id === workerId ? { ...w, job: targetJob, nightshift: targetNightshift } : w),
    )
    await supabase.from('employees')
      .update({ job: targetJob, nightshift: targetNightshift })
      .eq('employee_id', workerId)
  }

  // ── Group shift toggle ───────────────────────────────────────────────────────
  const handleChangeGroupShift = async (jobCode: string, toNight: boolean) => {
    const ids = allWorkersRef.current.filter((w) => w.job === jobCode).map((w) => w.employee_id)
    setAllWorkers((prev) => prev.map((w) => ids.includes(w.employee_id) ? { ...w, nightshift: toNight } : w))
    await supabase.from('employees').update({ nightshift: toNight }).in('employee_id', ids)
  }

  // ── Flip shifts (piecewise + combo for selected company) ─────────────────────
  const handleFlipShifts = async () => {
    const targets = allWorkersRef.current.filter((w) =>
      w.company === selectedCompany &&
      (getPiecewiseTypeFromJob(w.job) !== null || w.job.startsWith('COMBO #')),
    )
    const toNightIds = targets.filter((w) => !w.nightshift).map((w) => w.employee_id)
    const toDayIds = targets.filter((w) => w.nightshift).map((w) => w.employee_id)
    const allTargetIds = targets.map((w) => w.employee_id)

    setAllWorkers((prev) =>
      prev.map((w) => allTargetIds.includes(w.employee_id) ? { ...w, nightshift: !w.nightshift } : w),
    )
    if (toNightIds.length) await supabase.from('employees').update({ nightshift: true }).in('employee_id', toNightIds)
    if (toDayIds.length) await supabase.from('employees').update({ nightshift: false }).in('employee_id', toDayIds)
  }

  // ── Add new piecewise/combo group ───────────────────────────────────────────
  const handleAddGroup = (type: PiecewiseType | 'COMBO') => {
    const existing = [
      ...(type === 'COMBO'
        ? [...comboGroups.keys()]
        : [...(piecewiseGroups.get(type as PiecewiseType)?.keys() ?? [])]),
      ...[...ephemeralGroups].filter((g) => g.startsWith(type + ' #')),
    ]
    const maxNum = existing.reduce((max, code) => {
      const n = parseInt(code.split('#')[1]?.trim() ?? '0') || 0
      return Math.max(max, n)
    }, 0)
    setEphemeralGroups((prev) => new Set(prev).add(`${type} #${maxNum + 1}`))
  }

  // ── Groupings for selected company ───────────────────────────────────────────
  const officeGroups = useMemo(() => {
    const map = new Map<string, Employee[]>()
    for (const e of dailyWorkers) {
      if (e.company !== selectedCompany) continue
      if (getDailyJobColor(e.job) !== 'OFFICE') continue
      if (!map.has(e.job)) map.set(e.job, [])
      map.get(e.job)!.push(e)
    }
    return map
  }, [dailyWorkers, selectedCompany])

  const productionGroups = useMemo(() => {
    const map = new Map<string, Employee[]>()
    for (const e of dailyWorkers) {
      if (e.company !== selectedCompany) continue
      if (getDailyJobColor(e.job) !== 'PRODUCTION') continue
      if (!map.has(e.job)) map.set(e.job, [])
      map.get(e.job)!.push(e)
    }
    return map
  }, [dailyWorkers, selectedCompany])

  const comboGroups = useMemo(() => {
    const map = new Map<string, Employee[]>()
    for (const e of comboWorkers) {
      if (e.company !== selectedCompany) continue
      if (!map.has(e.job)) map.set(e.job, [])
      map.get(e.job)!.push(e)
    }
    return map
  }, [comboWorkers, selectedCompany])

  const piecewiseGroups = useMemo(() => {
    const byType = new Map<PiecewiseType, Map<string, Employee[]>>()
    for (const e of piecewiseWorkers) {
      if (e.company !== selectedCompany) continue
      const type = getPiecewiseTypeFromJob(e.job)
      if (!type) continue
      if (!byType.has(type)) byType.set(type, new Map())
      const byJob = byType.get(type)!
      if (!byJob.has(e.job)) byJob.set(e.job, [])
      byJob.get(e.job)!.push(e)
    }
    return byType
  }, [piecewiseWorkers, selectedCompany])

  // ── Sidebar data (selected company only) ─────────────────────────────────────
  const sidebarData = useMemo<SidebarMode[]>(() => {
    const modes: SidebarMode[] = []

    const officeByJob = new Map<string, Employee[]>()
    const productionByJob = new Map<string, Employee[]>()
    for (const e of dailyWorkers) {
      if (e.company !== selectedCompany) continue
      const bucket = getDailyJobColor(e.job) === 'OFFICE' ? officeByJob : productionByJob
      if (!bucket.has(e.job)) bucket.set(e.job, [])
      bucket.get(e.job)!.push(e)
    }
    if (officeByJob.size > 0) {
      modes.push({
        id: toScrollId(selectedCompany, 'section-office'),
        label: 'Office',
        entries: Array.from(officeByJob.entries()).map(([job, workers]) => ({ id: toScrollId(selectedCompany, job), label: job, workers })),
      })
    }
    if (productionByJob.size > 0) {
      modes.push({
        id: toScrollId(selectedCompany, 'section-production'),
        label: 'Production',
        entries: Array.from(productionByJob.entries()).map(([job, workers]) => ({ id: toScrollId(selectedCompany, job), label: job, workers })),
      })
    }

    // Piecewise = combo + KING/JR/SP/COINS
    const pieceEntries: SidebarEntry[] = []
    const comboByJob = new Map<string, Employee[]>()
    for (const e of comboWorkers) {
      if (e.company !== selectedCompany) continue
      if (!comboByJob.has(e.job)) comboByJob.set(e.job, [])
      comboByJob.get(e.job)!.push(e)
    }
    for (const [job, workers] of [...comboByJob.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
      pieceEntries.push({ id: toScrollId(selectedCompany, job), label: job, workers })
    }
    for (const type of PIECEWISE_PREFIXES) {
      const byJob = new Map<string, Employee[]>()
      for (const e of piecewiseWorkers) {
        if (e.company !== selectedCompany || !e.job.startsWith(type + ' #')) continue
        if (!byJob.has(e.job)) byJob.set(e.job, [])
        byJob.get(e.job)!.push(e)
      }
      for (const [job, workers] of [...byJob.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
        pieceEntries.push({ id: toScrollId(selectedCompany, job), label: job, workers })
      }
    }
    if (pieceEntries.length > 0) {
      modes.push({ id: toScrollId(selectedCompany, 'section-piecewise'), label: 'Piecewise', entries: pieceEntries })
    }

    return modes
  }, [selectedCompany, dailyWorkers, comboWorkers, piecewiseWorkers])

  // ── IntersectionObserver ─────────────────────────────────────────────────────
  useEffect(() => {
    if (loading) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 },
    )
    sidebarData.forEach((m) =>
      m.entries.forEach((e) => {
        const el = document.getElementById(e.id)
        if (el) observer.observe(el)
      }),
    )
    return () => observer.disconnect()
  }, [sidebarData, loading])

  // ── Fetch records — uses ref so changing allWorkers doesn't re-trigger ────────
  const fetchRecords = useCallback(async (d: string) => {
    setLoading(true)
    const workers = allWorkersRef.current
    const ids = workers.map((e) => e.employee_id)
    if (!ids.length) { setLoading(false); return }

    const { data } = await supabase
      .from('daily_records')
      .select('employee_id, daily_pay, holiday, pieces, job, hours')
      .eq('date', d)
      .in('employee_id', ids)

    const next = new Map<number, WorkerState>()
    workers.forEach((e) => next.set(e.employee_id, { attendance: null, extra: 0, dailyRate: '0' }))
    const candySums = new Map<string, number>()
    if (data) {
      data.forEach((r: { employee_id: number; daily_pay: number; holiday: HolidayType; pieces: number; job: string; hours: number }) => {
        const dailyRate = rateFromHours(r.hours ?? 8)
        if (r.daily_pay > 0) {
          const isGroupWorker = r.job && (getPiecewiseTypeFromJob(r.job) !== null || r.job.startsWith('COMBO #'))
          if (isGroupWorker) {
            // Group workers: extra is not reconstructed on load (combo/piecewise pay can't be reversed)
            next.set(r.employee_id, { attendance: 'present', extra: 0, dailyRate: 'Full' })
          } else {
            const emp = workers.find((e) => e.employee_id === r.employee_id)
            const mult = getDailyMultiplier(dailyRate)
            const base = emp ? calcDailyPay({ ...emp, daily_salary: emp.daily_salary * mult }, 0, r.holiday, config) : 0
            const extra = Math.max(0, r.daily_pay - base)
            next.set(r.employee_id, { attendance: 'present', extra: Math.round(extra * 100) / 100, dailyRate })
          }
          // Reconstruct candy per group: pieces = Math.round(candy / presentCount) per worker,
          // so summing all present workers' pieces gives back ≈ total candy
          if (r.pieces > 0 && r.job && getPiecewiseTypeFromJob(r.job)) {
            candySums.set(r.job, (candySums.get(r.job) ?? 0) + r.pieces)
          }
        } else {
          next.set(r.employee_id, { attendance: 'absent', extra: 0, dailyRate: '0' })
        }
        if (r.holiday) setHoliday(r.holiday)
      })
    }
    setWorkerStates(next)
    setCandyMap(candySums)
    setLoading(false)
  }, [config]) // intentionally omits allWorkers — reads via ref to avoid re-fetch on drag

  useEffect(() => { fetchRecords(date) }, [date, fetchRecords])

  // ── Upsert helpers ───────────────────────────────────────────────────────────
  const upsertDailyWorker = useCallback(async (worker: Employee, state: WorkerState, h: HolidayType) => {
    setSavingWorkers((p) => new Set(p).add(worker.employee_id))
    // Only delete if nothing has been set at all
    if (state.attendance === null && state.dailyRate === '0' && state.extra === 0) {
      await supabase.from('daily_records').delete().match({ employee_id: worker.employee_id, date })
    } else {
      const mult = getDailyMultiplier(state.dailyRate)
      const extra = state.extra
      const pay = mult === 0 ? extra : calcDailyPay({ ...worker, daily_salary: worker.daily_salary * mult }, extra, h, config)
      await supabase.from('daily_records').upsert({
        employee_id: worker.employee_id, date, job: worker.job,
        hours: hoursFromRate(state.dailyRate), pieces: 0,
        daily_pay: pay, nightshift: worker.nightshift, holiday: h,
      }, { onConflict: 'employee_id,date' })
    }
    setSavingWorkers((p) => { const s = new Set(p); s.delete(worker.employee_id); return s })
  }, [config, date])

  const upsertComboGroup = useCallback(async (
    jobCode: string, workers: Employee[], boxes: number, states: Map<number, WorkerState>, h: HolidayType,
  ) => {
    setSavingGroups((p) => new Set(p).add(jobCode))
    const presentCount = workers.filter((w) => states.get(w.employee_id)?.attendance === 'present').length
    const toUpsert = workers.filter((w) => (states.get(w.employee_id)?.attendance ?? null) !== null)
    const toDelete = workers.filter((w) => (states.get(w.employee_id)?.attendance ?? null) === null)

    if (toUpsert.length > 0) {
      await supabase.from('daily_records').upsert(
        toUpsert.map((w) => ({
          employee_id: w.employee_id, date, job: w.job, hours: 8, pieces: 0,
          daily_pay: states.get(w.employee_id)?.attendance === 'present' ? calcComboPay(w, boxes, presentCount, h, config) + (states.get(w.employee_id)?.extra ?? 0) : (states.get(w.employee_id)?.extra ?? 0),
          nightshift: w.nightshift, holiday: h,
        })),
        { onConflict: 'employee_id,date' },
      )
    }
    if (toDelete.length > 0) {
      await supabase.from('daily_records').delete().eq('date', date).in('employee_id', toDelete.map((w) => w.employee_id))
    }
    setSavingGroups((p) => { const s = new Set(p); s.delete(jobCode); return s })
  }, [config, date])

  const upsertPiecewiseGroup = useCallback(async (
    jobCode: string, type: PiecewiseType, workers: Employee[], candy: number,
    states: Map<number, WorkerState>, h: HolidayType,
  ) => {
    setSavingGroups((p) => new Set(p).add(jobCode))
    const presentCount = workers.filter((w) => states.get(w.employee_id)?.attendance === 'present').length
    const toUpsert = workers.filter((w) => (states.get(w.employee_id)?.attendance ?? null) !== null)
    const toDelete = workers.filter((w) => (states.get(w.employee_id)?.attendance ?? null) === null)

    if (toUpsert.length > 0) {
      await supabase.from('daily_records').upsert(
        toUpsert.map((w) => {
          const isPresent = states.get(w.employee_id)?.attendance === 'present'
          let pay = 0
          if (isPresent) {
            if (type === 'KING' || type === 'JR') pay = calcKingPay(w, candy, presentCount, h, config)
            else if (type === 'SP') pay = calcSpPay(w, candy, presentCount, h, config)
            else pay = calcCoinsPay(w, candy, presentCount, h, config)
          }
          pay += states.get(w.employee_id)?.extra ?? 0
          return {
            employee_id: w.employee_id, date, job: w.job, hours: 8,
            pieces: isPresent ? Math.round(candy / Math.max(presentCount, 1)) : 0,
            daily_pay: pay, nightshift: w.nightshift, holiday: h,
          }
        }),
        { onConflict: 'employee_id,date' },
      )
    }
    if (toDelete.length > 0) {
      await supabase.from('daily_records').delete().eq('date', date).in('employee_id', toDelete.map((w) => w.employee_id))
    }
    setSavingGroups((p) => { const s = new Set(p); s.delete(jobCode); return s })
  }, [config, date])

  // ── Event handlers ───────────────────────────────────────────────────────────
  const handleDailyAttendance = (worker: Employee, v: Attendance) => {
    const cur = workerStates.get(worker.employee_id) ?? { attendance: null, extra: 0, dailyRate: '0' as DailyRate }
    const next = { ...cur, attendance: v, dailyRate: (v === 'present' ? 'Full' : '0') as DailyRate }
    setWorkerStates((m) => new Map(m).set(worker.employee_id, next))
    upsertDailyWorker(worker, next, holiday)
  }

  const handleDailyRate = (worker: Employee, rate: DailyRate) => {
    const cur = workerStates.get(worker.employee_id) ?? { attendance: null, extra: 0, dailyRate: '0' as DailyRate }
    // Promote null → absent so the record gets saved rather than deleted
    const next = { ...cur, dailyRate: rate, attendance: cur.attendance ?? 'absent' } as WorkerState
    setWorkerStates((m) => new Map(m).set(worker.employee_id, next))
    upsertDailyWorker(worker, next, holiday)
  }

  const handleDailyExtra = (worker: Employee, extra: number) => {
    const cur = workerStates.get(worker.employee_id) ?? { attendance: null, extra: 0, dailyRate: '0' as DailyRate }
    const next = { ...cur, extra, attendance: cur.attendance ?? 'absent' } as WorkerState
    setWorkerStates((m) => new Map(m).set(worker.employee_id, next))
    upsertDailyWorker(worker, next, holiday)
  }

  const handleDailyNightshift = async (worker: Employee, nightshift: boolean) => {
    setAllWorkers((prev) => prev.map((w) => w.employee_id === worker.employee_id ? { ...w, nightshift } : w))
    await supabase.from('employees').update({ nightshift }).eq('employee_id', worker.employee_id)
    const state = workerStates.get(worker.employee_id)
    if (state?.attendance !== null && state !== undefined) {
      await upsertDailyWorker({ ...worker, nightshift }, state, holiday)
    }
  }

  const handleDailyMarkAll = (workers: Employee[]) => {
    const next = new Map(workerStates)
    workers.forEach((w) => {
      const cur = next.get(w.employee_id) ?? { attendance: null, extra: 0, dailyRate: '0' as DailyRate }
      next.set(w.employee_id, { ...cur, attendance: 'present', dailyRate: 'Full' })
    })
    setWorkerStates(next)
    workers.forEach((w) => upsertDailyWorker(w, next.get(w.employee_id)!, holiday))
  }

  const handleComboAttendance = (jobCode: string, workers: Employee[], empId: number, v: Attendance) => {
    const cur = workerStates.get(empId) ?? { attendance: null, extra: 0, dailyRate: 'Full' as DailyRate }
    const next = new Map(workerStates).set(empId, { ...cur, attendance: v })
    setWorkerStates(next)
    upsertComboGroup(jobCode, workers, boxesMap.get(jobCode) ?? 0, next, holiday)
  }

  const handleComboBoxes = (jobCode: string, workers: Employee[], val: number) => {
    setBoxesMap((m) => new Map(m).set(jobCode, val))
    upsertComboGroup(jobCode, workers, val, workerStates, holiday)
  }

  const handleComboMarkAll = (jobCode: string, workers: Employee[]) => {
    const next = new Map(workerStates)
    workers.forEach((w) => {
      const cur = next.get(w.employee_id) ?? { attendance: null, extra: 0, dailyRate: 'Full' as DailyRate }
      next.set(w.employee_id, { ...cur, attendance: 'present' })
    })
    setWorkerStates(next)
    upsertComboGroup(jobCode, workers, boxesMap.get(jobCode) ?? 0, next, holiday)
  }

  const handlePiecewiseAttendance = (jobCode: string, type: PiecewiseType, workers: Employee[], empId: number, v: Attendance) => {
    const cur = workerStates.get(empId) ?? { attendance: null, extra: 0, dailyRate: 'Full' as DailyRate }
    const next = new Map(workerStates).set(empId, { ...cur, attendance: v })
    setWorkerStates(next)
    upsertPiecewiseGroup(jobCode, type, workers, candyMap.get(jobCode) ?? 0, next, holiday)
  }

  const handlePiecewiseCandy = (jobCode: string, type: PiecewiseType, workers: Employee[], val: number) => {
    setCandyMap((m) => new Map(m).set(jobCode, val))
    upsertPiecewiseGroup(jobCode, type, workers, val, workerStates, holiday)
  }

  const handlePiecewiseMarkAll = (jobCode: string, type: PiecewiseType, workers: Employee[]) => {
    const next = new Map(workerStates)
    workers.forEach((w) => {
      const cur = next.get(w.employee_id) ?? { attendance: null, extra: 0, dailyRate: 'Full' as DailyRate }
      next.set(w.employee_id, { ...cur, attendance: 'present' })
    })
    setWorkerStates(next)
    upsertPiecewiseGroup(jobCode, type, workers, candyMap.get(jobCode) ?? 0, next, holiday)
  }

  const handleComboExtra = (jobCode: string, workers: Employee[], empId: number, extra: number) => {
    const cur = workerStates.get(empId) ?? { attendance: null, extra: 0, dailyRate: 'Full' as DailyRate }
    const next = new Map(workerStates).set(empId, { ...cur, extra, attendance: cur.attendance ?? 'absent' })
    setWorkerStates(next)
    upsertComboGroup(jobCode, workers, boxesMap.get(jobCode) ?? 0, next, holiday)
  }

  const handlePiecewiseExtra = (jobCode: string, type: PiecewiseType, workers: Employee[], empId: number, extra: number) => {
    const cur = workerStates.get(empId) ?? { attendance: null, extra: 0, dailyRate: 'Full' as DailyRate }
    const next = new Map(workerStates).set(empId, { ...cur, extra, attendance: cur.attendance ?? 'absent' })
    setWorkerStates(next)
    upsertPiecewiseGroup(jobCode, type, workers, candyMap.get(jobCode) ?? 0, next, holiday)
  }

  const handleComboWorkerNightshift = async (jobCode: string, groupWorkers: Employee[], worker: Employee, nightshift: boolean) => {
    const updatedWorker = { ...worker, nightshift }
    setAllWorkers((prev) => prev.map((w) => w.employee_id === worker.employee_id ? updatedWorker : w))
    await supabase.from('employees').update({ nightshift }).eq('employee_id', worker.employee_id)
    const state = workerStates.get(worker.employee_id)
    if (state?.attendance !== null && state !== undefined) {
      const updatedWorkers = groupWorkers.map((w) => w.employee_id === worker.employee_id ? updatedWorker : w)
      await upsertComboGroup(jobCode, updatedWorkers, boxesMap.get(jobCode) ?? 0, workerStates, holiday)
    }
  }

  const handlePiecewiseWorkerNightshift = async (jobCode: string, type: PiecewiseType, groupWorkers: Employee[], worker: Employee, nightshift: boolean) => {
    const updatedWorker = { ...worker, nightshift }
    setAllWorkers((prev) => prev.map((w) => w.employee_id === worker.employee_id ? updatedWorker : w))
    await supabase.from('employees').update({ nightshift }).eq('employee_id', worker.employee_id)
    const state = workerStates.get(worker.employee_id)
    if (state?.attendance !== null && state !== undefined) {
      const updatedWorkers = groupWorkers.map((w) => w.employee_id === worker.employee_id ? updatedWorker : w)
      await upsertPiecewiseGroup(jobCode, type, updatedWorkers, candyMap.get(jobCode) ?? 0, workerStates, holiday)
    }
  }

  const handleHolidayChange = async (h: HolidayType) => {
    setHoliday(h)
    for (const [jobCode, workers] of comboGroups) {
      if (workers.some((w) => workerStates.get(w.employee_id)?.attendance !== null))
        await upsertComboGroup(jobCode, workers, boxesMap.get(jobCode) ?? 0, workerStates, h)
    }
    for (const [, byJob] of piecewiseGroups) {
      for (const [jobCode, workers] of byJob) {
        const type = getPiecewiseTypeFromJob(workers[0].job)!
        if (workers.some((w) => workerStates.get(w.employee_id)?.attendance !== null))
          await upsertPiecewiseGroup(jobCode, type, workers, candyMap.get(jobCode) ?? 0, workerStates, h)
      }
    }
    for (const worker of dailyWorkers) {
      const state = workerStates.get(worker.employee_id)
      if (state?.attendance !== null && state?.attendance !== undefined)
        await upsertDailyWorker(worker, state, h)
    }
  }

  const handleSelectEntry = (id: string) => {
    setActiveId(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Toaster />

      <Sidebar
        modes={sidebarData}
        activeId={activeId}
        workerStates={workerStates}
        onSelectEntry={handleSelectEntry}
      />

      <div className="ml-52">
        <div className="sticky top-12 z-30 bg-canvas border-b border-stone-200/60 shadow-sm">
          <div className="px-8 py-3 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-xl font-semibold text-stone-800 tracking-tight">Daily Entry</h1>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <button
                onClick={handleFlipShifts}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-sans rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-800 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                Flip shifts
              </button>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="px-3 py-1.5 text-sm font-sans border border-stone-200 rounded-lg bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-300 cursor-pointer" />
              <div className="flex rounded-lg border border-stone-200 overflow-hidden bg-white">
                {HOLIDAY_OPTIONS.map((h) => (
                  <button key={h} onClick={() => handleHolidayChange(h)}
                    className={cn('px-3 py-1.5 text-xs font-medium font-sans transition-colors',
                      holiday === h ? 'bg-stone-800 text-white' : 'text-stone-500 hover:bg-stone-50')}>
                    {h}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {configError && (
          <div className="px-8 pt-4">
            <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 font-sans">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span><strong>Config table error:</strong> {configError}</span>
            </div>
          </div>
        )}

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="px-8 py-6 space-y-10">
            {loading ? (
              <Skeleton />
            ) : (
              <>
                {officeGroups.size > 0 && (
                  <div id={toScrollId(selectedCompany, 'section-office')} className="scroll-mt-24">
                    <SectionHeader label="Office" dot={JOB_COLOR_CONFIG.OFFICE.dot} text={JOB_COLOR_CONFIG.OFFICE.text} />
                    <div className="space-y-4">
                      {Array.from(officeGroups.entries()).map(([job, workers]) => (
                        <div key={job} id={toScrollId(selectedCompany, job)} className="scroll-mt-24">
                          <DailyJobCard
                            job={job} workers={workers} workerStates={workerStates}
                            config={config} holiday={holiday} saving={savingWorkers}
                            onAttendance={handleDailyAttendance}
                            onRate={handleDailyRate}
                            onExtra={handleDailyExtra}
                            onNightshift={handleDailyNightshift}
                            onMarkAll={() => handleDailyMarkAll(workers)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {productionGroups.size > 0 && (
                  <div id={toScrollId(selectedCompany, 'section-production')} className="scroll-mt-24">
                    <SectionHeader label="Production" dot={JOB_COLOR_CONFIG.PRODUCTION.dot} text={JOB_COLOR_CONFIG.PRODUCTION.text} />
                    <div className="space-y-4">
                      {Array.from(productionGroups.entries()).map(([job, workers]) => (
                        <div key={job} id={toScrollId(selectedCompany, job)} className="scroll-mt-24">
                          <DailyJobCard
                            job={job} workers={workers} workerStates={workerStates}
                            config={config} holiday={holiday} saving={savingWorkers}
                            onAttendance={handleDailyAttendance}
                            onRate={handleDailyRate}
                            onExtra={handleDailyExtra}
                            onNightshift={handleDailyNightshift}
                            onMarkAll={() => handleDailyMarkAll(workers)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(comboGroups.size > 0 || piecewiseGroups.size > 0 || ephemeralGroups.size > 0) && (
                  <div id={toScrollId(selectedCompany, 'section-piecewise')} className="scroll-mt-24">
                    <div className="flex justify-end mb-3">
                      <AddGroupDropdown onAdd={handleAddGroup} />
                    </div>
                    <div className="space-y-8">
                      {(() => {
                        const ephemerals = [...ephemeralGroups]
                          .filter((g) => g.startsWith('COMBO #'))
                          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                        return (comboGroups.size > 0 || ephemerals.length > 0) && (
                          <div>
                            <SectionHeader label="Combo" dot={JOB_COLOR_CONFIG.COMBO.dot} text={JOB_COLOR_CONFIG.COMBO.text} />
                            <div className="grid grid-cols-2 gap-4">
                              {Array.from(comboGroups.entries()).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([jobCode, workers]) => (
                                <div key={jobCode} id={toScrollId(selectedCompany, jobCode)} className="scroll-mt-24">
                                  <ComboCard
                                    jobCode={jobCode} workers={workers} boxes={boxesMap.get(jobCode) ?? 0}
                                    workerStates={workerStates} config={config} holiday={holiday}
                                    saving={savingGroups.has(jobCode)}
                                    onBoxes={(v) => handleComboBoxes(jobCode, workers, v)}
                                    onAttendance={(id, v) => handleComboAttendance(jobCode, workers, id, v)}
                                    onMarkAll={() => handleComboMarkAll(jobCode, workers)}
                                    onChangeShift={(toNight) => handleChangeGroupShift(jobCode, toNight)}
                                    onExtra={(id, x) => handleComboExtra(jobCode, workers, id, x)}
                                    onNightshift={(worker, nightshift) => handleComboWorkerNightshift(jobCode, workers, worker, nightshift)}
                                  />
                                </div>
                              ))}
                              {ephemerals.map((jobCode) => (
                                <div key={jobCode} id={toScrollId(selectedCompany, jobCode)} className="scroll-mt-24">
                                  <ComboCard
                                    jobCode={jobCode} workers={[]} boxes={0}
                                    workerStates={workerStates} config={config} holiday={holiday}
                                    saving={false}
                                    onBoxes={() => {}} onAttendance={() => {}}
                                    onMarkAll={() => {}}
                                    onChangeShift={(toNight) => handleChangeGroupShift(jobCode, toNight)}
                                    onExtra={() => {}} onNightshift={() => {}}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                      {PIECEWISE_PREFIXES.map((type) => {
                        const byJob = piecewiseGroups.get(type)
                        const ephemerals = [...ephemeralGroups]
                          .filter((g) => g.startsWith(type + ' #'))
                          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                        if ((!byJob || byJob.size === 0) && ephemerals.length === 0) return null
                        const cfg = CANDY_CONFIG[type === 'JR' ? 'JR' : type === 'COINS' ? 'COINS' : type as 'KING' | 'SP']
                        return (
                          <div key={type}>
                            <SectionHeader label={SECTION_LABELS[type]} dot={cfg.dot} text={cfg.text} />
                            <div className="grid grid-cols-2 gap-4">
                              {byJob && Array.from(byJob.entries()).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([jobCode, workers]) => (
                                <div key={jobCode} id={toScrollId(selectedCompany, jobCode)} className="scroll-mt-24">
                                  <PiecewiseCard
                                    jobCode={jobCode} type={type} workers={workers}
                                    candy={candyMap.get(jobCode) ?? 0}
                                    workerStates={workerStates} config={config} holiday={holiday}
                                    saving={savingGroups.has(jobCode)}
                                    onCandy={(v) => handlePiecewiseCandy(jobCode, type, workers, v)}
                                    onAttendance={(id, v) => handlePiecewiseAttendance(jobCode, type, workers, id, v)}
                                    onMarkAll={() => handlePiecewiseMarkAll(jobCode, type, workers)}
                                    onChangeShift={(toNight) => handleChangeGroupShift(jobCode, toNight)}
                                    onExtra={(id, x) => handlePiecewiseExtra(jobCode, type, workers, id, x)}
                                    onNightshift={(worker, nightshift) => handlePiecewiseWorkerNightshift(jobCode, type, workers, worker, nightshift)}
                                  />
                                </div>
                              ))}
                              {ephemerals.map((jobCode) => (
                                <div key={jobCode} id={toScrollId(selectedCompany, jobCode)} className="scroll-mt-24">
                                  <PiecewiseCard
                                    jobCode={jobCode} type={type} workers={[]}
                                    candy={0}
                                    workerStates={workerStates} config={config} holiday={holiday}
                                    saving={false}
                                    onCandy={() => {}} onAttendance={() => {}}
                                    onMarkAll={() => {}}
                                    onChangeShift={(toNight) => handleChangeGroupShift(jobCode, toNight)}
                                    onExtra={() => {}} onNightshift={() => {}}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {officeGroups.size === 0 && productionGroups.size === 0 && comboGroups.size === 0 && piecewiseGroups.size === 0 && (
                  <div className="text-center py-20 text-stone-300 font-sans text-sm">
                    No workers found for {selectedCompany}.
                  </div>
                )}
              </>
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeWorker ? <WorkerDragOverlay worker={activeWorker} /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  )
}
