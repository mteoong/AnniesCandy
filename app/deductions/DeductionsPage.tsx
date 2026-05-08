'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, AllCommunityModule, themeQuartz, type ColDef, type CellValueChangedEvent, type IsFullWidthRowParams } from 'ag-grid-community'

ModuleRegistry.registerModules([AllCommunityModule])

import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { formatPeso, getWeekEnd, listWednesdays } from '@/lib/payroll'
import { WednesdayPicker } from '@/components/WednesdayPicker'
import { classifyJob, getJobColorConfig, CANDY_TYPES } from '@/lib/types'
import type { Employee, WeeklyRecord } from '@/lib/types'
import { useCompany } from '@/lib/company-context'
import { getWeekTagInfo } from '@/lib/sssPeriods'
import { recomputeSSSForWeek } from '@/lib/sss'

const WEDNESDAYS = listWednesdays(12)

type Category = 'piecewise' | 'office' | 'production'
const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'office', label: 'Office' },
  { id: 'production', label: 'Production' },
  { id: 'piecewise', label: 'Piecewise' },
]

const CANDY_TYPE_ORDER = Object.fromEntries(CANDY_TYPES.map((t, i) => [t, i]))

function sortEmployees(employees: Employee[], category: Category): Employee[] {
  return [...employees].sort((a, b) => {
    if (category === 'piecewise') {
      const aType = CANDY_TYPES.find((t) => a.job.startsWith(t + ' #') || a.job.startsWith(t)) ?? ''
      const bType = CANDY_TYPES.find((t) => b.job.startsWith(t + ' #') || b.job.startsWith(t)) ?? ''
      const orderDiff = (CANDY_TYPE_ORDER[aType] ?? 99) - (CANDY_TYPE_ORDER[bType] ?? 99)
      if (orderDiff !== 0) return orderDiff
    }
    const jobCmp = a.job.localeCompare(b.job, undefined, { numeric: true })
    if (jobCmp !== 0) return jobCmp
    return a.last_name.localeCompare(b.last_name)
  })
}

const DEDUCTION_FIELDS = [
  'sss', 'philhealth', 'pagibig', 'sss_loan', 'pagibig_loan',
  'cash_advance', 'canteen', 'others',
] as const
type DeductionField = (typeof DEDUCTION_FIELDS)[number]

const DEDUCTION_LABELS: Record<DeductionField, string> = {
  sss: 'SSS', philhealth: 'PhilHealth', pagibig: 'Pag-IBIG',
  sss_loan: 'SSS Loan', pagibig_loan: 'Pag-IBIG Loan',
  cash_advance: 'Cash Advance', canteen: 'Canteen', others: 'Others',
}

type DeductionRow = {
  _isHeader?: boolean
  _label?: string
  _headerBg?: string
  _headerText?: string
  _dot?: string
  employee_id: number
  name: string
  gross: number
  sss: number
  philhealth: number
  pagibig: number
  sss_loan: number
  pagibig_loan: number
  cash_advance: number
  canteen: number
  others: number
}

function makeHeaderRow(job: string): DeductionRow {
  const cfg = getJobColorConfig(job)
  return {
    _isHeader: true, _label: job,
    _headerBg: cfg.headerBg, _headerText: cfg.text, _dot: cfg.dot,
    employee_id: 0, name: '', gross: 0,
    sss: 0, philhealth: 0, pagibig: 0, sss_loan: 0, pagibig_loan: 0,
    cash_advance: 0, canteen: 0, others: 0,
  }
}

function totalDeductions(row: DeductionRow): number {
  return row.sss + row.philhealth + row.pagibig + row.sss_loan + row.pagibig_loan + row.cash_advance + row.canteen + row.others
}

function JobHeaderCell({ data }: { data: DeductionRow }) {
  return (
    <div className={cn('flex items-center h-full px-3 gap-2 font-semibold text-xs font-sans', data._headerBg, data._headerText)}>
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', data._dot)} />
      {data._label}
    </div>
  )
}

function pesoFormatter(p: { value: number | null }) {
  if (p.value == null || p.value === 0) return '—'
  return formatPeso(p.value)
}

type Props = { employees: Employee[] }

export function DeductionsPage({ employees }: Props) {
  const [selectedWeek, setSelectedWeek] = useState(WEDNESDAYS[0])
  const [selectedCategory, setSelectedCategory] = useState<Category>('office')
  const [rowData, setRowData] = useState<DeductionRow[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const timerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const { selectedCompany } = useCompany()
  const tagInfo = useMemo(() => getWeekTagInfo(selectedWeek), [selectedWeek])

  const companyEmployees = useMemo(
    () => employees.filter((e) => e.company === selectedCompany),
    [employees, selectedCompany],
  )

  const categoryEmployees = useMemo(
    () => sortEmployees(companyEmployees.filter((e) => classifyJob(e.job) === selectedCategory), selectedCategory),
    [companyEmployees, selectedCategory],
  )

  const fetchData = useCallback(async (week: string, empList: Employee[]) => {
    setLoading(true)
    if (empList.length === 0) { setRowData([]); setLoading(false); return }

    if (getWeekTagInfo(week).isSSSWeek) {
      // Trigger B: refresh stored SSS deduction values before reading them.
      try { await recomputeSSSForWeek(supabase, week) }
      catch (err) { console.error('[deductions] recomputeSSSForWeek failed', err) }
    }

    const weekEnd = getWeekEnd(week)
    const [{ data: dailyData }, { data: weeklyData }] = await Promise.all([
      supabase.from('daily_records').select('employee_id, daily_pay')
        .in('employee_id', empList.map((e) => e.employee_id))
        .gte('date', week).lte('date', weekEnd),
      supabase.from('weekly_records').select('*')
        .in('employee_id', empList.map((e) => e.employee_id))
        .eq('week_start', week),
    ])

    const grossMap = new Map<number, number>()
    for (const r of dailyData ?? []) {
      grossMap.set(r.employee_id, (grossMap.get(r.employee_id) ?? 0) + r.daily_pay)
    }
    const weeklyMap = new Map<number, WeeklyRecord>()
    for (const r of (weeklyData ?? []) as WeeklyRecord[]) weeklyMap.set(r.employee_id, r)

    // empList is already sorted by job — group preserving that order
    const jobGroups = new Map<string, Employee[]>()
    for (const e of empList) {
      if (!jobGroups.has(e.job)) jobGroups.set(e.job, [])
      jobGroups.get(e.job)!.push(e)
    }

    function toRow(e: Employee): DeductionRow {
      const wr = weeklyMap.get(e.employee_id)
      return {
        employee_id: e.employee_id,
        name: [e.last_name, e.first_name].filter(Boolean).join(', '),
        gross: grossMap.get(e.employee_id) ?? 0,
        sss: wr?.sss ?? 0, philhealth: wr?.philhealth ?? 0, pagibig: wr?.pagibig ?? 0,
        sss_loan: wr?.sss_loan ?? 0, pagibig_loan: wr?.pagibig_loan ?? 0,
        cash_advance: wr?.cash_advance ?? 0, canteen: wr?.canteen ?? 0, others: wr?.others ?? 0,
      }
    }

    const rows: DeductionRow[] = []
    for (const [job, workers] of jobGroups) {
      rows.push(makeHeaderRow(job))
      rows.push(...workers.map(toRow))
    }

    setRowData(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData(selectedWeek, categoryEmployees)
  }, [selectedWeek, categoryEmployees, fetchData])

  const handleCellValueChanged = useCallback((params: CellValueChangedEvent<DeductionRow>) => {
    const row = params.data
    if (row._isHeader || !row.employee_id) return
    setSaving(true)
    const existing = timerRef.current.get(row.employee_id)
    if (existing) clearTimeout(existing)
    timerRef.current.set(
      row.employee_id,
      setTimeout(async () => {
        timerRef.current.delete(row.employee_id)
        const { error } = await supabase.from('weekly_records').upsert(
          {
            employee_id: row.employee_id,
            week_start: selectedWeek,
            week_end: getWeekEnd(selectedWeek),
            total_gross: row.gross || 0,
            sss: row.sss || 0, philhealth: row.philhealth || 0, pagibig: row.pagibig || 0,
            sss_loan: row.sss_loan || 0, pagibig_loan: row.pagibig_loan || 0,
            cash_advance: row.cash_advance || 0, canteen: row.canteen || 0, others: row.others || 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'employee_id,week_start' },
        )
        if (error) console.error('weekly_records upsert failed:', error)
        if (timerRef.current.size === 0) setSaving(false)
      }, 500),
    )
  }, [selectedWeek])

  const colDefs = useMemo((): ColDef<DeductionRow>[] => [
    {
      field: 'name', headerName: 'Name', minWidth: 160, flex: 2,
      editable: false, cellStyle: { fontWeight: 500 },
    },
    {
      field: 'gross', headerName: 'Gross', width: 110, editable: false,
      valueFormatter: pesoFormatter, cellStyle: { color: '#15803d', fontWeight: 600 },
    },
    ...DEDUCTION_FIELDS.map((field): ColDef<DeductionRow> => {
      // SSS, PhilHealth, Pag-IBIG are auto-computed on the SSS week and would be
      // overwritten on next page load — lock them from manual edit so users don't
      // get confused when their input vanishes.
      const isAutoComputedField = field === 'sss' || field === 'philhealth' || field === 'pagibig'
      const lockedByAutoCompute = tagInfo.isSSSWeek && isAutoComputedField
      return {
        field, headerName: DEDUCTION_LABELS[field], width: 110,
        editable: (params) => !params.data?._isHeader && !lockedByAutoCompute,
        singleClickEdit: true,
        valueFormatter: pesoFormatter,
        cellStyle: lockedByAutoCompute
          ? { color: '#a8a29e', fontStyle: 'italic' as const }
          : undefined,
        valueSetter: (params) => {
          const val = parseFloat(params.newValue)
          params.data[field] = isNaN(val) ? 0 : val
          return true
        },
      }
    }),
    {
      headerName: 'Total Deductions', width: 140, editable: false,
      valueGetter: (params) => params.data?._isHeader ? null : totalDeductions(params.data!),
      valueFormatter: pesoFormatter, cellStyle: { color: '#dc2626', fontWeight: 600 },
    },
    {
      headerName: 'Net Pay', width: 120, editable: false,
      valueGetter: (params) => params.data?._isHeader ? null : (params.data!.gross - totalDeductions(params.data!)),
      valueFormatter: pesoFormatter,
      cellStyle: (params) => {
        const isNeg = (params.value ?? 0) < 0
        return {
          color: isNeg ? '#dc2626' : '#1d4ed8',
          fontWeight: isNeg ? 700 : 600,
        }
      },
    },
  ], [tagInfo.isSSSWeek])

  const isFullWidthRow = useCallback((params: IsFullWidthRowParams<DeductionRow>) => {
    return !!params.rowNode.data?._isHeader
  }, [])

  const fullWidthCellRenderer = useCallback(
    (params: { data: DeductionRow }) => <JobHeaderCell data={params.data} />,
    [],
  )

  return (
    <div className="h-[calc(100vh-3rem)] bg-canvas flex flex-col">
      <div className="flex-shrink-0 bg-canvas border-b border-stone-200/60 shadow-sm">
        <div className="px-6 py-3 flex items-center gap-4">
          <h1 className="font-display text-xl font-semibold text-stone-800 tracking-tight">Deductions</h1>
          <WednesdayPicker value={selectedWeek} options={WEDNESDAYS} onChange={setSelectedWeek} />
          {tagInfo.label && (
            <span className="text-stone-500 font-sans text-sm">· {tagInfo.label}</span>
          )}
          {saving && <span className="text-stone-400 text-xs font-mono ml-auto">saving…</span>}
        </div>
        <div className="flex border-t border-stone-100">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                'px-5 py-2 text-sm font-sans font-medium whitespace-nowrap border-b-2 transition-colors',
                cat.id === selectedCategory
                  ? 'border-stone-800 text-stone-900'
                  : 'border-transparent text-stone-500 hover:text-stone-800',
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-stone-400 font-sans text-sm">Loading…</div>
        ) : rowData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-stone-400 font-sans text-sm">
            No {selectedCategory} employees for this company.
          </div>
        ) : (
          <div className="h-full">
            <AgGridReact<DeductionRow>
              theme={themeQuartz}
              columnDefs={colDefs}
              rowData={rowData}
              rowHeight={42}
              headerHeight={42}
              onCellValueChanged={handleCellValueChanged}
              isFullWidthRow={isFullWidthRow}
              fullWidthCellRenderer={fullWidthCellRenderer}
              stopEditingWhenCellsLoseFocus
              suppressMovableColumns
            />
          </div>
        )}
      </div>
    </div>
  )
}
