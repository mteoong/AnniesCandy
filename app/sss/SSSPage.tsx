'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  ModuleRegistry, AllCommunityModule, themeQuartz,
  type ColDef, type IsFullWidthRowParams,
} from 'ag-grid-community'

import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { formatPeso } from '@/lib/payroll'
import { getSSSTableView, recomputeSSSForWeek, type SSSTableRow } from '@/lib/sss'
import { getLastWednesdayOfMonth, getSSSPeriodForMonth } from '@/lib/sssPeriods'
import { classifyJob, getJobColorConfig, CANDY_TYPES } from '@/lib/types'
import { useCompany } from '@/lib/company-context'

ModuleRegistry.registerModules([AllCommunityModule])

// ── Month picker ──────────────────────────────────────────────────────────────

type YM = { year: number; month: number }

function listRecentMonths(count: number): YM[] {
  const now = new Date()
  const out: YM[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }
  return out
}

function ymLabel(ym: YM): string {
  return new Date(ym.year, ym.month - 1, 1).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  })
}

function formatPeriodRange(start: string, end: string): string {
  const fmt = (s: string, includeYear: boolean) =>
    new Date(s + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}),
    })
  const sYear = new Date(start + 'T00:00:00').getFullYear()
  const eYear = new Date(end + 'T00:00:00').getFullYear()
  return sYear === eYear
    ? `${fmt(start, false)} – ${fmt(end, true)}`
    : `${fmt(start, true)} – ${fmt(end, true)}`
}

function MonthPicker({ value, options, onChange }: {
  value: YM
  options: YM[]
  onChange: (ym: YM) => void
}) {
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
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span>{ymLabel(value)}</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={cn('transition-transform duration-150', open && 'rotate-180')}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 bg-white border border-stone-200 rounded-xl shadow-xl py-1.5 min-w-52 z-50 max-h-72 overflow-y-auto">
          {options.map((opt) => {
            const selected = opt.year === value.year && opt.month === value.month
            return (
              <button
                key={`${opt.year}-${opt.month}`}
                onClick={() => { onChange(opt); setOpen(false) }}
                className={cn(
                  'block w-full text-left px-3.5 py-2 text-sm font-sans transition-colors',
                  selected
                    ? 'text-stone-900 font-semibold bg-stone-50'
                    : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50',
                )}
              >
                {ymLabel(opt)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Grid types ────────────────────────────────────────────────────────────────

type Category = 'office' | 'production' | 'piecewise'
const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'office', label: 'Office' },
  { id: 'production', label: 'Production' },
  { id: 'piecewise', label: 'Piecewise' },
]

const CANDY_TYPE_ORDER = Object.fromEntries(CANDY_TYPES.map((t, i) => [t, i]))

type GridRow = {
  _isHeader?: boolean
  _label?: string
  _headerBg?: string
  _headerText?: string
  _dot?: string
  name: string
  daily_salary: number
  monthly_total: number
  total_mcr: number
  mcr_employer: number
  mcr_employee: number
  mcr_total: number
  sss_employer: number
  sss_employee: number
  sss_total: number
  ec: number
  sss_contribution: number
  pagibig_employer: number
  pagibig_employee: number
  pagibig_total: number
}

function makeJobHeaderRow(job: string): GridRow {
  const cfg = getJobColorConfig(job)
  return {
    _isHeader: true, _label: job,
    _headerBg: cfg.headerBg, _headerText: cfg.text, _dot: cfg.dot,
    name: '', daily_salary: 0, monthly_total: 0, total_mcr: 0,
    mcr_employer: 0, mcr_employee: 0, mcr_total: 0,
    sss_employer: 0, sss_employee: 0, sss_total: 0, ec: 0, sss_contribution: 0,
    pagibig_employer: 0, pagibig_employee: 0, pagibig_total: 0,
  }
}

function toGridRow(r: SSSTableRow): GridRow {
  return {
    name: [r.last_name, r.first_name].filter(Boolean).join(', '),
    daily_salary: r.daily_salary,
    monthly_total: r.monthly_total,
    total_mcr: r.total_mcr,
    mcr_employer: r.mcr_employer,
    mcr_employee: r.mcr_employee,
    mcr_total: r.mcr_total,
    sss_employer: r.sss_employer,
    sss_employee: r.sss_employee,
    sss_total: r.sss_total,
    ec: r.ec,
    sss_contribution: r.sss_contribution,
    pagibig_employer: r.pagibig_employer,
    pagibig_employee: r.pagibig_employee,
    pagibig_total: r.pagibig_total,
  }
}

function sumRows(rows: SSSTableRow[]) {
  const acc = {
    monthly_total: 0, total_mcr: 0,
    mcr_employer: 0, mcr_employee: 0, mcr_total: 0,
    sss_employer: 0, sss_employee: 0, sss_total: 0, ec: 0, sss_contribution: 0,
    pagibig_employer: 0, pagibig_employee: 0, pagibig_total: 0,
  }
  for (const r of rows) {
    acc.monthly_total += r.monthly_total
    acc.total_mcr += r.total_mcr
    acc.mcr_employer += r.mcr_employer
    acc.mcr_employee += r.mcr_employee
    acc.mcr_total += r.mcr_total
    acc.sss_employer += r.sss_employer
    acc.sss_employee += r.sss_employee
    acc.sss_total += r.sss_total
    acc.ec += r.ec
    acc.sss_contribution += r.sss_contribution
    acc.pagibig_employer += r.pagibig_employer
    acc.pagibig_employee += r.pagibig_employee
    acc.pagibig_total += r.pagibig_total
  }
  return acc
}

function sortSSSRows(rows: SSSTableRow[], category: Category): SSSTableRow[] {
  return [...rows].sort((a, b) => {
    if (category === 'piecewise') {
      const aType = CANDY_TYPES.find((t) => a.job.startsWith(t + ' #')) ?? ''
      const bType = CANDY_TYPES.find((t) => b.job.startsWith(t + ' #')) ?? ''
      const orderDiff = (CANDY_TYPE_ORDER[aType] ?? 99) - (CANDY_TYPE_ORDER[bType] ?? 99)
      if (orderDiff !== 0) return orderDiff
    }
    const jobCmp = a.job.localeCompare(b.job, undefined, { numeric: true })
    if (jobCmp !== 0) return jobCmp
    return a.last_name.localeCompare(b.last_name)
  })
}

function pesoFmt(p: { value: number | null | undefined }) {
  if (p.value == null || p.value === 0) return '—'
  const n = p.value
  if (Number.isInteger(n)) return '₱' + n.toLocaleString('en-US')
  return '₱' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function JobHeaderCell({ data }: { data: GridRow }) {
  return (
    <div className={cn('flex items-center h-full px-3 gap-2 font-semibold text-xs font-sans', data._headerBg, data._headerText)}>
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', data._dot)} />
      {data._label}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const MONTHS = listRecentMonths(12)

export function SSSPage() {
  const [selectedYM, setSelectedYM] = useState<YM>(MONTHS[0])
  const [selectedCategory, setSelectedCategory] = useState<Category>('office')
  const [rows, setRows] = useState<SSSTableRow[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { selectedCompany } = useCompany()

  const period = useMemo(
    () => getSSSPeriodForMonth(selectedYM.year, selectedYM.month),
    [selectedYM],
  )

  const loadData = useCallback(async (ym: YM) => {
    setLoading(true)
    setError(null)
    try {
      const sssWeekStart = getLastWednesdayOfMonth(ym.year, ym.month)
      await recomputeSSSForWeek(supabase, sssWeekStart)
      const data = await getSSSTableView(supabase, ym.year, ym.month)
      setRows(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[sss] page load failed', msg)
      setError(msg)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData(selectedYM) }, [selectedYM, loadData])

  // Filter to selected company, then to selected category
  const companyRows = useMemo(
    () => rows.filter((r) => r.company === selectedCompany),
    [rows, selectedCompany],
  )

  const categoryRows = useMemo(
    () => sortSSSRows(companyRows.filter((r) => classifyJob(r.job) === selectedCategory), selectedCategory),
    [companyRows, selectedCategory],
  )

  // Group by job, preserving sorted order
  const jobGroups = useMemo((): Map<string, SSSTableRow[]> => {
    const groups = new Map<string, SSSTableRow[]>()
    for (const r of categoryRows) {
      if (!groups.has(r.job)) groups.set(r.job, [])
      groups.get(r.job)!.push(r)
    }
    return groups
  }, [categoryRows])

  const rowData = useMemo((): GridRow[] => {
    const out: GridRow[] = []
    for (const [job, jobRows] of jobGroups) {
      out.push(makeJobHeaderRow(job))
      out.push(...jobRows.map(toGridRow))
    }
    return out
  }, [jobGroups])

  const grandTotal = useMemo((): GridRow | null => {
    if (categoryRows.length === 0) return null
    return { name: 'Grand Total', daily_salary: 0, ...sumRows(categoryRows) }
  }, [categoryRows])

  const pinnedBottomRowData = useMemo(
    () => grandTotal ? [grandTotal] : [],
    [grandTotal],
  )

  const colDefs = useMemo((): ColDef<GridRow>[] => {
    const money = (field: keyof GridRow, header: string, width = 110): ColDef<GridRow> => ({
      field,
      headerName: header,
      width,
      valueFormatter: pesoFmt,
      cellStyle: (params) => ({
        textAlign: 'right',
        fontWeight: params.node.rowPinned === 'bottom' ? 700 : 400,
      }),
      headerClass: 'ag-right-aligned-header',
    })
    return [
      {
        field: 'name', headerName: 'Name', minWidth: 160, flex: 2,
        cellStyle: (params) => ({
          fontWeight: params.node.rowPinned === 'bottom' ? 700 : 500,
        }),
      },
      money('daily_salary', 'Daily Salary'),
      money('monthly_total', 'Monthly Total', 120),
      money('total_mcr', 'Total MCR'),
      money('mcr_employer', 'MCR Empr'),
      money('mcr_employee', 'MCR Empe'),
      money('mcr_total', 'MCR Total'),
      money('sss_employer', 'SSS Empr'),
      money('sss_employee', 'SSS Empe'),
      money('sss_total', 'SSS Total'),
      money('ec', 'EC', 70),
      money('sss_contribution', 'SSS Contribution', 130),
      money('pagibig_employer', 'PIB Empr'),
      money('pagibig_employee', 'PIB Empe'),
      money('pagibig_total', 'PIB Total'),
    ]
  }, [])

  const isFullWidthRow = useCallback(
    (params: IsFullWidthRowParams<GridRow>) => !params.rowNode.rowPinned && !!params.rowNode.data?._isHeader,
    [],
  )
  const fullWidthCellRenderer = useCallback(
    (params: { data: GridRow }) => <JobHeaderCell data={params.data} />,
    [],
  )

  // ── PDF export ──────────────────────────────────────────────────────────────

  const handleExportPDF = useCallback(async () => {
    if (companyRows.length === 0) return
    setExporting(true)
    try {
      const jsPDF = (await import('jspdf')).default
      const autoTable = (await import('jspdf-autotable')).default
      const doc = new jsPDF('l', 'mm', 'a4')
      const periodLabel = formatPeriodRange(period.start, period.end)
      const fp = (n: number) => n === 0 ? '—' : n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

      const headers = [
        'Name', 'Daily Salary', 'Monthly Total', 'Total MCR',
        'MCR Empr', 'MCR Empe', 'MCR Total',
        'SSS Empr', 'SSS Empe', 'SSS Total', 'EC', 'SSS Contrib.',
        'PIB Empr', 'PIB Empe', 'PIB Total',
      ]
      const columnStyles: Record<number, object> = { 0: { cellWidth: 42, halign: 'left' } }
      for (let i = 1; i <= 14; i++) {
        columnStyles[i] = { cellWidth: i === 10 ? 10 : 16, halign: 'right' }
      }

      const sections: { label: string; category: Category }[] = [
        { label: 'Office', category: 'office' },
        { label: 'Production', category: 'production' },
        { label: 'Piecewise', category: 'piecewise' },
      ]

      let firstPage = true
      for (const { label, category } of sections) {
        const catRows = sortSSSRows(
          companyRows.filter((r) => classifyJob(r.job) === category),
          category,
        )
        if (catRows.length === 0) continue

        // Build job groups for this category
        const catGroups = new Map<string, SSSTableRow[]>()
        for (const r of catRows) {
          if (!catGroups.has(r.job)) catGroups.set(r.job, [])
          catGroups.get(r.job)!.push(r)
        }

        if (!firstPage) doc.addPage()
        firstPage = false

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(13)
        doc.text(`SSS REPORT — ${selectedCompany} — ${label}`, 14, 12)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.text(periodLabel, 14, 19)

        const body: (string | { content: string; styles?: object; colSpan?: number })[][] = []
        for (const [job, jobRows] of catGroups) {
          body.push([{
            content: job,
            colSpan: headers.length,
            styles: { fontStyle: 'bold' as const, fillColor: [240, 240, 240] as [number, number, number] },
          }])
          body.push(...jobRows.map((r) => [
            [r.last_name, r.first_name].filter(Boolean).join(', '),
            fp(r.daily_salary), fp(r.monthly_total), fp(r.total_mcr),
            fp(r.mcr_employer), fp(r.mcr_employee), fp(r.mcr_total),
            fp(r.sss_employer), fp(r.sss_employee), fp(r.sss_total),
            String(r.ec), fp(r.sss_contribution),
            fp(r.pagibig_employer), fp(r.pagibig_employee), fp(r.pagibig_total),
          ]))
        }

        const sums = sumRows(catRows)
        body.push([
          'Grand Total', '—', fp(sums.monthly_total), fp(sums.total_mcr),
          fp(sums.mcr_employer), fp(sums.mcr_employee), fp(sums.mcr_total),
          fp(sums.sss_employer), fp(sums.sss_employee), fp(sums.sss_total),
          String(sums.ec), fp(sums.sss_contribution),
          fp(sums.pagibig_employer), fp(sums.pagibig_employee), fp(sums.pagibig_total),
        ])

        autoTable(doc, {
          head: [headers], body, startY: 25,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 1.8 },
          headStyles: { fillColor: [28, 25, 23], textColor: 255, fontSize: 7 },
          columnStyles,
          didParseCell: (params) => {
            if (params.row.index === body.length - 1) {
              params.cell.styles.fontStyle = 'bold'
              params.cell.styles.fillColor = [240, 240, 240] as unknown as string
            }
          },
        })
      }

      const monthPad = String(selectedYM.month).padStart(2, '0')
      doc.save(`sss-${selectedYM.year}-${monthPad}.pdf`)
    } finally {
      setExporting(false)
    }
  }, [companyRows, selectedCompany, selectedYM, period])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-3rem)] bg-canvas flex flex-col">
      <div className="flex-shrink-0 bg-canvas border-b border-stone-200/60 shadow-sm">
        <div className="px-6 pt-3 pb-1 flex items-center gap-3">
          <h1 className="font-display text-xl font-semibold text-stone-800 tracking-tight">SSS</h1>
          <MonthPicker value={selectedYM} options={MONTHS} onChange={setSelectedYM} />
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleExportPDF}
              disabled={exporting || loading || companyRows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-sm font-sans text-stone-700 hover:border-stone-300 hover:bg-stone-50 disabled:opacity-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
          </div>
        </div>
        <div className="px-6 pb-2.5">
          <span className="text-sm font-sans font-medium text-stone-500 tracking-wide">
            {formatPeriodRange(period.start, period.end)}
          </span>
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
          <div className="flex items-center justify-center h-full text-stone-400 font-sans text-sm">
            Computing SSS for {ymLabel(selectedYM)}…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-stone-400 font-sans text-sm gap-1">
            <p>Could not load SSS data.</p>
            <p className="text-xs text-stone-300 font-mono">{error}</p>
          </div>
        ) : rowData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-stone-400 font-sans text-sm">
            No {selectedCategory} employees with earnings in {ymLabel(selectedYM)}.
          </div>
        ) : (
          <AgGridReact<GridRow>
            theme={themeQuartz}
            columnDefs={colDefs}
            rowData={rowData}
            pinnedBottomRowData={pinnedBottomRowData}
            rowHeight={42}
            headerHeight={42}
            isFullWidthRow={isFullWidthRow}
            fullWidthCellRenderer={fullWidthCellRenderer}
            suppressMovableColumns
            getRowStyle={(params) => {
              if (params.node.rowPinned === 'bottom') return { background: '#eff6ff', fontWeight: 600 }
            }}
          />
        )}
      </div>
    </div>
  )
}
