'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  ModuleRegistry, AllCommunityModule, themeQuartz,
  type ColDef, type IsFullWidthRowParams,
} from 'ag-grid-community'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { formatPeso, getWeekEnd, getWeekDates, listWednesdays } from '@/lib/payroll'
import { WednesdayPicker } from '@/components/WednesdayPicker'
import { classifyJob, getJobColorConfig, getCandyType, CANDY_TYPES, nameTableFormat } from '@/lib/types'
import type { Employee, WeeklyRecord } from '@/lib/types'
import { useCompany } from '@/lib/company-context'
import { getWeekTagInfo } from '@/lib/sssPeriods'
import { recomputeSSSForWeek } from '@/lib/sss'

ModuleRegistry.registerModules([AllCommunityModule])

const WEDNESDAYS = listWednesdays(12)
const DAY_NAMES = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']
const DEDUCTION_KEYS = ['sss', 'philhealth', 'pagibig', 'sss_loan', 'pagibig_loan', 'cash_advance', 'canteen', 'others'] as const
const DEDUCTION_COL_LABELS: Record<string, string> = {
  sss: 'SSS', philhealth: 'PhilHealth', pagibig: 'Pag-IBIG',
  sss_loan: 'SSS Loan', pagibig_loan: 'Pag-IBIG Loan',
  cash_advance: 'Cash Adv.', canteen: 'Canteen', others: 'Others',
}
const CANDY_TYPE_ORDER = Object.fromEntries(CANDY_TYPES.map((t, i) => [t, i]))

type Category = 'piecewise' | 'office' | 'production'
const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'office', label: 'Office' },
  { id: 'production', label: 'Production' },
  { id: 'piecewise', label: 'Piecewise' },
]

// ── Types ──────────────────────────────────────────────────────────────────────

type DailyRecord = { employee_id: number; date: string; daily_pay: number; holiday: string | null; nightshift: boolean }

type JobSummaryRow = {
  job: string
  employee_count: number
  total_nightshift: number
  total_holiday: number
  total_gross: number
  sss: number; philhealth: number; pagibig: number; sss_loan: number
  pagibig_loan: number; cash_advance: number; canteen: number; others: number
  total_deduction: number
  total_net: number
}

type SummaryRow = {
  employee_id: number
  name: string
  dailyPay: Record<string, number>
  weeklyTotal: number
  sss: number; philhealth: number; pagibig: number; sss_loan: number
  pagibig_loan: number; cash_advance: number; canteen: number; others: number
  totalDeductions: number
  netPay: number
}

type SummaryGridRow = {
  _isHeader?: boolean
  _label?: string
  _headerBg?: string
  _headerText?: string
  _dot?: string
  employee_id: number
  name: string
  d0: number; d1: number; d2: number; d3: number; d4: number; d5: number; d6: number
  weeklyTotal: number
  sss: number; philhealth: number; pagibig: number; sss_loan: number
  pagibig_loan: number; cash_advance: number; canteen: number; others: number
  totalDeductions: number
  netPay: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function toSummaryTotal(rows: SummaryRow[], dates: string[]): SummaryRow {
  const dailyPay: Record<string, number> = {}
  for (const d of dates) dailyPay[d] = rows.reduce((s, r) => s + (r.dailyPay[d] ?? 0), 0)
  const weeklyTotal = rows.reduce((s, r) => s + r.weeklyTotal, 0)
  const sss = rows.reduce((s, r) => s + r.sss, 0)
  const philhealth = rows.reduce((s, r) => s + r.philhealth, 0)
  const pagibig = rows.reduce((s, r) => s + r.pagibig, 0)
  const sss_loan = rows.reduce((s, r) => s + r.sss_loan, 0)
  const pagibig_loan = rows.reduce((s, r) => s + r.pagibig_loan, 0)
  const cash_advance = rows.reduce((s, r) => s + r.cash_advance, 0)
  const canteen = rows.reduce((s, r) => s + r.canteen, 0)
  const others = rows.reduce((s, r) => s + r.others, 0)
  const totalDeductions = sss + philhealth + pagibig + sss_loan + pagibig_loan + cash_advance + canteen + others
  return {
    employee_id: -1, name: 'Grand Total', dailyPay, weeklyTotal,
    sss, philhealth, pagibig, sss_loan, pagibig_loan, cash_advance, canteen, others,
    totalDeductions, netPay: weeklyTotal - totalDeductions,
  }
}

function makeHeaderRow(job: string): SummaryGridRow {
  const cfg = getJobColorConfig(job)
  return {
    _isHeader: true, _label: job,
    _headerBg: cfg.headerBg, _headerText: cfg.text, _dot: cfg.dot,
    employee_id: 0, name: '',
    d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0,
    weeklyTotal: 0, sss: 0, philhealth: 0, pagibig: 0, sss_loan: 0,
    pagibig_loan: 0, cash_advance: 0, canteen: 0, others: 0,
    totalDeductions: 0, netPay: 0,
  }
}

function summaryToGridRow(r: SummaryRow, dates: string[]): SummaryGridRow {
  return {
    employee_id: r.employee_id, name: r.name,
    d0: r.dailyPay[dates[0]] ?? 0,
    d1: r.dailyPay[dates[1]] ?? 0,
    d2: r.dailyPay[dates[2]] ?? 0,
    d3: r.dailyPay[dates[3]] ?? 0,
    d4: r.dailyPay[dates[4]] ?? 0,
    d5: r.dailyPay[dates[5]] ?? 0,
    d6: r.dailyPay[dates[6]] ?? 0,
    weeklyTotal: r.weeklyTotal,
    sss: r.sss, philhealth: r.philhealth, pagibig: r.pagibig, sss_loan: r.sss_loan,
    pagibig_loan: r.pagibig_loan, cash_advance: r.cash_advance, canteen: r.canteen, others: r.others,
    totalDeductions: r.totalDeductions, netPay: r.netPay,
  }
}

function pesoFormatter(p: { value: number | null | undefined }) {
  if (p.value == null || p.value === 0) return '—'
  return formatPeso(p.value)
}

function JobHeaderCell({ data }: { data: SummaryGridRow }) {
  return (
    <div className={cn('flex items-center h-full px-3 gap-2 font-semibold text-xs font-sans', data._headerBg, data._headerText)}>
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', data._dot)} />
      {data._label}
    </div>
  )
}

// ── Summary modal ─────────────────────────────────────────────────────────────

function SummaryModal({
  rows, company, weekStart, weekEnd, onClose,
}: {
  rows: JobSummaryRow[]
  company: string
  weekStart: string
  weekEnd: string
  onClose: () => void
}) {
  const [exporting, setExporting] = useState(false)

  const totals = useMemo(() => ({
    employee_count: rows.reduce((s, r) => s + r.employee_count, 0),
    total_nightshift: rows.reduce((s, r) => s + r.total_nightshift, 0),
    total_holiday: rows.reduce((s, r) => s + r.total_holiday, 0),
    total_gross: rows.reduce((s, r) => s + r.total_gross, 0),
    sss: rows.reduce((s, r) => s + r.sss, 0),
    philhealth: rows.reduce((s, r) => s + r.philhealth, 0),
    pagibig: rows.reduce((s, r) => s + r.pagibig, 0),
    sss_loan: rows.reduce((s, r) => s + r.sss_loan, 0),
    pagibig_loan: rows.reduce((s, r) => s + r.pagibig_loan, 0),
    cash_advance: rows.reduce((s, r) => s + r.cash_advance, 0),
    canteen: rows.reduce((s, r) => s + r.canteen, 0),
    others: rows.reduce((s, r) => s + r.others, 0),
    total_deduction: rows.reduce((s, r) => s + r.total_deduction, 0),
    total_net: rows.reduce((s, r) => s + r.total_net, 0),
  }), [rows])

  const fp = (n: number) => n === 0 ? '—' : `₱${n.toFixed(2)}`
  const fpPdf = (n: number) => n === 0 ? '—' : n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  async function handleExportPDF() {
    setExporting(true)
    const jsPDF = (await import('jspdf')).default
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF('l', 'mm', 'a4')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('WEEKLY SUMMARY REPORT', 14, 12)
    doc.setFontSize(11)
    doc.text(company, 14, 19)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Period: ${weekStart} to ${weekEnd}`, 14, 25)

    const headers = [
      'Job Position', 'Emp', 'PM', 'Holiday',
      'Gross', 'SSS', 'PhilHealth', 'Pag-IBIG',
      'SSS Ln', 'PIB Ln', 'Cash Adv', 'Canteen', 'Others',
      'Total Ded.', 'Net Total',
    ]

    const body = [
      ...rows.map((r) => [
        r.job, r.employee_count, fpPdf(r.total_nightshift), fpPdf(r.total_holiday),
        fpPdf(r.total_gross), fpPdf(r.sss), fpPdf(r.philhealth), fpPdf(r.pagibig),
        fpPdf(r.sss_loan), fpPdf(r.pagibig_loan), fpPdf(r.cash_advance),
        fpPdf(r.canteen), fpPdf(r.others), fpPdf(r.total_deduction), fpPdf(r.total_net),
      ]),
      [
        'TOTAL', totals.employee_count, fpPdf(totals.total_nightshift), fpPdf(totals.total_holiday),
        fpPdf(totals.total_gross), fpPdf(totals.sss), fpPdf(totals.philhealth), fpPdf(totals.pagibig),
        fpPdf(totals.sss_loan), fpPdf(totals.pagibig_loan), fpPdf(totals.cash_advance),
        fpPdf(totals.canteen), fpPdf(totals.others), fpPdf(totals.total_deduction), fpPdf(totals.total_net),
      ],
    ]

    // A4 landscape usable width ≈ 269mm  (297 - 2×14 margins)
    // 36+10+17+17+20+17+19+16+14+14+15+15+13+20+20 = 263mm
    const columnStyles: Record<number, object> = {
      0: { cellWidth: 36, halign: 'left' },
      1: { cellWidth: 10, halign: 'center' },
      2: { cellWidth: 17, halign: 'right' },
      3: { cellWidth: 17, halign: 'right' },
      4: { cellWidth: 20, halign: 'right' },
      5: { cellWidth: 17, halign: 'right' },
      6: { cellWidth: 19, halign: 'right' },
      7: { cellWidth: 16, halign: 'right' },
      8: { cellWidth: 14, halign: 'right' },
      9: { cellWidth: 14, halign: 'right' },
      10: { cellWidth: 15, halign: 'right' },
      11: { cellWidth: 15, halign: 'right' },
      12: { cellWidth: 13, halign: 'right' },
      13: { cellWidth: 20, halign: 'right' },
      14: { cellWidth: 20, halign: 'right' },
    }

    autoTable(doc, {
      head: [headers], body, startY: 30,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [28, 25, 23], textColor: 255, fontSize: 7 },
      columnStyles,
      didParseCell: (params) => {
        if (params.row.index === rows.length) {
          params.cell.styles.fontStyle = 'bold'
          params.cell.styles.fillColor = [240, 240, 240] as unknown as string
        }
      },
    })

    const slug = company.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
    doc.save(`summary_${slug}_${weekStart}.pdf`)
    setExporting(false)
  }

  const TH = 'px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans whitespace-nowrap'
  const TD = 'px-3 py-2 text-xs font-mono whitespace-nowrap'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-[95vw] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 flex-shrink-0">
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-800">Weekly Summary — {company}</h2>
            <p className="text-xs text-stone-400 font-sans mt-0.5">Period: {weekStart} to {weekEnd}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-stone-800 text-white sticky top-0 z-10">
              <tr>
                <th className={cn(TH, 'text-white text-left')}>Job Position</th>
                <th className={cn(TH, 'text-white text-center')}>Emp</th>
                <th className={cn(TH, 'text-white text-right')}>PM Shift</th>
                <th className={cn(TH, 'text-white text-right')}>Holiday</th>
                <th className={cn(TH, 'text-white text-right')}>Gross Total</th>
                <th className={cn(TH, 'text-white text-right')}>SSS Cont.</th>
                <th className={cn(TH, 'text-white text-right')}>PhilHealth</th>
                <th className={cn(TH, 'text-white text-right')}>Pag-IBIG</th>
                <th className={cn(TH, 'text-white text-right')}>SSS Ln</th>
                <th className={cn(TH, 'text-white text-right')}>PIB Ln</th>
                <th className={cn(TH, 'text-white text-right')}>Cash Adv</th>
                <th className={cn(TH, 'text-white text-right')}>Canteen</th>
                <th className={cn(TH, 'text-white text-right')}>Others</th>
                <th className={cn(TH, 'text-white text-right')}>Total Ded.</th>
                <th className={cn(TH, 'text-white text-right')}>Net Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {rows.map((r) => (
                <tr key={r.job} className="hover:bg-stone-50">
                  <td className={cn(TD, 'font-sans font-medium text-stone-800')}>{r.job}</td>
                  <td className={cn(TD, 'text-center text-stone-600')}>{r.employee_count}</td>
                  <td className={cn(TD, 'text-right text-stone-500')}>{fp(r.total_nightshift)}</td>
                  <td className={cn(TD, 'text-right text-stone-500')}>{fp(r.total_holiday)}</td>
                  <td className={cn(TD, 'text-right text-stone-800 font-semibold')}>{fp(r.total_gross)}</td>
                  <td className={cn(TD, 'text-right text-red-600')}>{fp(r.sss)}</td>
                  <td className={cn(TD, 'text-right text-red-600')}>{fp(r.philhealth)}</td>
                  <td className={cn(TD, 'text-right text-red-600')}>{fp(r.pagibig)}</td>
                  <td className={cn(TD, 'text-right text-red-600')}>{fp(r.sss_loan)}</td>
                  <td className={cn(TD, 'text-right text-red-600')}>{fp(r.pagibig_loan)}</td>
                  <td className={cn(TD, 'text-right text-red-600')}>{fp(r.cash_advance)}</td>
                  <td className={cn(TD, 'text-right text-red-600')}>{fp(r.canteen)}</td>
                  <td className={cn(TD, 'text-right text-red-600')}>{fp(r.others)}</td>
                  <td className={cn(TD, 'text-right text-red-700 font-semibold')}>{fp(r.total_deduction)}</td>
                  <td className={cn(TD, 'text-right text-blue-700 font-semibold')}>{fp(r.total_net)}</td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-stone-100 font-semibold">
                <td className={cn(TD, 'font-sans font-bold text-stone-900')}>TOTAL</td>
                <td className={cn(TD, 'text-center text-stone-800')}>{totals.employee_count}</td>
                <td className={cn(TD, 'text-right text-stone-700')}>{fp(totals.total_nightshift)}</td>
                <td className={cn(TD, 'text-right text-stone-700')}>{fp(totals.total_holiday)}</td>
                <td className={cn(TD, 'text-right text-stone-900 font-bold')}>{fp(totals.total_gross)}</td>
                <td className={cn(TD, 'text-right text-red-700 font-bold')}>{fp(totals.sss)}</td>
                <td className={cn(TD, 'text-right text-red-700 font-bold')}>{fp(totals.philhealth)}</td>
                <td className={cn(TD, 'text-right text-red-700 font-bold')}>{fp(totals.pagibig)}</td>
                <td className={cn(TD, 'text-right text-red-700 font-bold')}>{fp(totals.sss_loan)}</td>
                <td className={cn(TD, 'text-right text-red-700 font-bold')}>{fp(totals.pagibig_loan)}</td>
                <td className={cn(TD, 'text-right text-red-700 font-bold')}>{fp(totals.cash_advance)}</td>
                <td className={cn(TD, 'text-right text-red-700 font-bold')}>{fp(totals.canteen)}</td>
                <td className={cn(TD, 'text-right text-red-700 font-bold')}>{fp(totals.others)}</td>
                <td className={cn(TD, 'text-right text-red-800 font-bold')}>{fp(totals.total_deduction)}</td>
                <td className={cn(TD, 'text-right text-blue-800 font-bold')}>{fp(totals.total_net)}</td>
              </tr>
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="flex items-center justify-center h-32 text-stone-400 font-sans text-sm">No data for this period.</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-stone-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium font-sans rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleExportPDF}
            disabled={exporting}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold font-sans rounded-xl bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            {exporting ? 'Exporting…' : 'Export Summary'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Props = { employees: Employee[] }

export function WeeklySummaryPage({ employees }: Props) {
  const [selectedWeek, setSelectedWeek] = useState(WEDNESDAYS[0])
  const [selectedCategory, setSelectedCategory] = useState<Category>('office')
  const [dailyRecords, setDailyRecords] = useState<DailyRecord[]>([])
  const [weeklyRecords, setWeeklyRecords] = useState<WeeklyRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [exportingPayslips, setExportingPayslips] = useState(false)
  const [nightshiftRate, setNightshiftRate] = useState(0.25)

  const { selectedCompany } = useCompany()

  useEffect(() => {
    supabase.from('config').select('key, value').then(({ data }) => {
      const row = (data as { key: string; value: string }[] | null)?.find((r) => r.key === 'NIGHTSHIFT_BONUS_RATE')
      if (row) setNightshiftRate(parseFloat(row.value))
    })
  }, [])

  const weekDates = useMemo(() => getWeekDates(selectedWeek), [selectedWeek])
  const weekEnd = useMemo(() => getWeekEnd(selectedWeek), [selectedWeek])
  const tagInfo = useMemo(() => getWeekTagInfo(selectedWeek), [selectedWeek])

  const companyEmployees = useMemo(
    () => employees.filter((e) => e.company === selectedCompany),
    [employees, selectedCompany],
  )

  const categoryEmployees = useMemo(
    () => sortEmployees(companyEmployees.filter((e) => classifyJob(e.job) === selectedCategory), selectedCategory),
    [companyEmployees, selectedCategory],
  )

  const fetchData = useCallback(async (week: string, end: string, empIds: number[]) => {
    if (empIds.length === 0) { setDailyRecords([]); setWeeklyRecords([]); return }
    setLoading(true)
    if (getWeekTagInfo(week).isSSSWeek) {
      // Trigger B: refresh stored SSS deduction values before reading them.
      try { await recomputeSSSForWeek(supabase, week) }
      catch (err) { console.error('[weekly-summary] recomputeSSSForWeek failed', err) }
    }
    const [{ data: dr }, { data: wr }] = await Promise.all([
      supabase.from('daily_records').select('employee_id, date, daily_pay, holiday, nightshift')
        .in('employee_id', empIds).gte('date', week).lte('date', end),
      supabase.from('weekly_records').select('*')
        .in('employee_id', empIds).eq('week_start', week),
    ])
    setDailyRecords((dr ?? []) as DailyRecord[])
    setWeeklyRecords((wr ?? []) as WeeklyRecord[])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData(selectedWeek, weekEnd, companyEmployees.map((e) => e.employee_id))
  }, [selectedWeek, weekEnd, companyEmployees, fetchData])

  const allSummaryMap = useMemo((): Map<number, SummaryRow> => {
    const dailyMap = new Map<string, number>()
    for (const r of dailyRecords) {
      const key = `${r.employee_id}:${r.date}`
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + r.daily_pay)
    }
    const weeklyMap = new Map<number, WeeklyRecord>()
    for (const r of weeklyRecords) weeklyMap.set(r.employee_id, r)

    const map = new Map<number, SummaryRow>()
    for (const e of companyEmployees) {
      const dailyPay: Record<string, number> = {}
      let weeklyTotal = 0
      for (const d of weekDates) {
        const pay = dailyMap.get(`${e.employee_id}:${d}`) ?? 0
        dailyPay[d] = pay
        weeklyTotal += pay
      }
      const wr = weeklyMap.get(e.employee_id)
      const sss = wr?.sss ?? 0
      const philhealth = wr?.philhealth ?? 0
      const pagibig = wr?.pagibig ?? 0
      const sss_loan = wr?.sss_loan ?? 0
      const pagibig_loan = wr?.pagibig_loan ?? 0
      const cash_advance = wr?.cash_advance ?? 0
      const canteen = wr?.canteen ?? 0
      const others = wr?.others ?? 0
      const totalDeductions = sss + philhealth + pagibig + sss_loan + pagibig_loan + cash_advance + canteen + others
      map.set(e.employee_id, {
        employee_id: e.employee_id,
        name: nameTableFormat(e),
        dailyPay, weeklyTotal,
        sss, philhealth, pagibig, sss_loan, pagibig_loan, cash_advance, canteen, others,
        totalDeductions, netPay: weeklyTotal - totalDeductions,
      })
    }
    return map
  }, [companyEmployees, dailyRecords, weeklyRecords, weekDates])

  const jobGroups = useMemo((): Map<string, SummaryRow[]> => {
    const groups = new Map<string, SummaryRow[]>()
    for (const e of categoryEmployees) {
      if (!groups.has(e.job)) groups.set(e.job, [])
      const row = allSummaryMap.get(e.employee_id)
      if (row) groups.get(e.job)!.push(row)
    }
    return groups
  }, [categoryEmployees, allSummaryMap])

  const categoryRows = useMemo((): SummaryRow[] => {
    const rows: SummaryRow[] = []
    for (const jobRows of jobGroups.values()) rows.push(...jobRows)
    return rows
  }, [jobGroups])

  const grandTotal = useMemo(
    () => categoryRows.length > 0 ? toSummaryTotal(categoryRows, weekDates) : null,
    [categoryRows, weekDates],
  )

  // ── Summary modal data ───────────────────────────────────────────────────────

  const [showSummaryModal, setShowSummaryModal] = useState(false)

  const payBreakdownMap = useMemo((): Map<number, { nightshiftPay: number; holidayPay: number }> => {
    const empMap = new Map(companyEmployees.map((e) => [e.employee_id, e]))
    const map = new Map<number, { nightshiftPay: number; holidayPay: number }>()
    for (const dr of dailyRecords) {
      if (dr.daily_pay <= 0) continue
      const emp = empMap.get(dr.employee_id)
      if (!emp) continue
      const prev = map.get(dr.employee_id) ?? { nightshiftPay: 0, holidayPay: 0 }
      map.set(dr.employee_id, {
        nightshiftPay: prev.nightshiftPay + (dr.nightshift ? emp.daily_salary * nightshiftRate : 0),
        holidayPay: prev.holidayPay +
          (dr.holiday === '30%' ? emp.daily_salary * 0.3 : 0) +
          (dr.holiday === '100%' ? emp.daily_salary : 0),
      })
    }
    return map
  }, [dailyRecords, companyEmployees, nightshiftRate])

  const jobSummaryRows = useMemo((): JobSummaryRow[] => {
    // Piecewise workers group by candy type (KING, JR, SP…); others by exact job name
    const jobMap = new Map<string, Employee[]>()
    for (const e of companyEmployees) {
      const key = getCandyType(e.job) ?? e.job
      if (!jobMap.has(key)) jobMap.set(key, [])
      jobMap.get(key)!.push(e)
    }
    const rows: JobSummaryRow[] = []
    for (const [job, emps] of jobMap) {
      let employee_count = 0, total_nightshift = 0, total_holiday = 0
      let total_gross = 0, sss = 0, philhealth = 0, pagibig = 0
      let sss_loan = 0, pagibig_loan = 0, cash_advance = 0, canteen = 0, others = 0
      for (const e of emps) {
        const sr = allSummaryMap.get(e.employee_id)
        if (!sr || (sr.weeklyTotal === 0 && sr.totalDeductions === 0)) continue
        employee_count++
        const breakdown = payBreakdownMap.get(e.employee_id)
        total_nightshift += breakdown?.nightshiftPay ?? 0
        total_holiday += breakdown?.holidayPay ?? 0
        total_gross += sr.weeklyTotal
        sss += sr.sss; philhealth += sr.philhealth; pagibig += sr.pagibig
        sss_loan += sr.sss_loan; pagibig_loan += sr.pagibig_loan
        cash_advance += sr.cash_advance; canteen += sr.canteen; others += sr.others
      }
      if (employee_count === 0) continue
      const total_deduction = sss + philhealth + pagibig + sss_loan + pagibig_loan + cash_advance + canteen + others
      rows.push({ job, employee_count, total_nightshift, total_holiday, total_gross, sss, philhealth, pagibig, sss_loan, pagibig_loan, cash_advance, canteen, others, total_deduction, total_net: total_gross - total_deduction })
    }
    return rows.sort((a, b) => {
      const aOrder = CANDY_TYPE_ORDER[a.job] ?? 99
      const bOrder = CANDY_TYPE_ORDER[b.job] ?? 99
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.job.localeCompare(b.job, undefined, { numeric: true })
    })
  }, [companyEmployees, allSummaryMap, payBreakdownMap])

  // ── Grid data ────────────────────────────────────────────────────────────────

  const rowData = useMemo((): SummaryGridRow[] => {
    const rows: SummaryGridRow[] = []
    for (const [job, jobRows] of jobGroups) {
      rows.push(makeHeaderRow(job))
      rows.push(...jobRows.map((r) => summaryToGridRow(r, weekDates)))
    }
    return rows
  }, [jobGroups, weekDates])

  const pinnedBottomRowData = useMemo((): SummaryGridRow[] => {
    if (!grandTotal) return []
    return [summaryToGridRow(grandTotal, weekDates)]
  }, [grandTotal, weekDates])

  const colDefs = useMemo((): ColDef<SummaryGridRow>[] => [
    {
      field: 'name', headerName: 'Name',
      minWidth: 150, flex: 2, editable: false,
      cellStyle: { fontWeight: 500 },
    },
    ...([0, 1, 2, 3, 4, 5, 6] as const).map((i) => {
      const date = weekDates[i]
      const dt = date ? new Date(date + 'T00:00:00') : null
      const header = dt
        ? `${DAY_NAMES[i]} ${dt.getMonth() + 1}/${dt.getDate()}`
        : DAY_NAMES[i]
      return {
        field: `d${i}` as keyof SummaryGridRow,
        headerName: header,
        width: 105, editable: false,
        valueFormatter: pesoFormatter,
        cellStyle: { color: '#57534e', textAlign: 'right' },
        headerClass: 'ag-right-aligned-header',
      } as ColDef<SummaryGridRow>
    }),
    {
      field: 'weeklyTotal', headerName: 'Total',
      width: 110, editable: false,
      valueFormatter: pesoFormatter,
      cellStyle: { color: '#1c1917', fontWeight: 600, textAlign: 'right' },
    },
    ...DEDUCTION_KEYS.map((key) => ({
      field: key as keyof SummaryGridRow,
      headerName: DEDUCTION_COL_LABELS[key],
      width: 100, editable: false,
      valueFormatter: pesoFormatter,
      cellStyle: { color: '#dc2626', textAlign: 'right' },
    } as ColDef<SummaryGridRow>)),
    {
      field: 'totalDeductions', headerName: 'Deductions',
      width: 120, editable: false,
      valueFormatter: pesoFormatter,
      cellStyle: { color: '#b91c1c', fontWeight: 600, textAlign: 'right' },
    },
    {
      field: 'netPay', headerName: 'Net Pay',
      width: 110, editable: false,
      valueFormatter: pesoFormatter,
      cellStyle: (params) => {
        const isNeg = (params.value ?? 0) < 0
        return {
          color: isNeg ? '#dc2626' : '#1d4ed8',
          fontWeight: isNeg ? 700 : 600,
          textAlign: 'right',
        }
      },
    },
  ], [weekDates])

  const isFullWidthRow = useCallback((params: IsFullWidthRowParams<SummaryGridRow>) => {
    return !params.rowNode.rowPinned && !!params.rowNode.data?._isHeader
  }, [])

  const fullWidthCellRenderer = useCallback(
    (params: { data: SummaryGridRow }) => <JobHeaderCell data={params.data} />,
    [],
  )

  // ── PDF export ───────────────────────────────────────────────────────────────

  const handleExportPDF = useCallback(async () => {
    const jsPDF = (await import('jspdf')).default
    const autoTable = (await import('jspdf-autotable')).default

    const doc = new jsPDF('l', 'mm', 'a4')
    const weekLabel = new Date(selectedWeek + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })

    const pdfHeaders = [
      'Name',
      ...DAY_NAMES.map((d, i) => {
        const date = new Date(weekDates[i] + 'T00:00:00')
        return `${d} ${date.getMonth() + 1}/${date.getDate()}`
      }),
      'Total', 'SSS', 'PH', 'Pag-IBIG', 'SSS Ln', 'PIB Ln', 'Cash', 'Canteen', 'Others',
      'Deductions', 'Net Pay',
    ]

    const pfInt = (n: number) => n === 0 ? '—' : Math.round(n).toLocaleString('en-US')
    const pfDec = (n: number) => n === 0 ? '—' : n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

    function toTableRow(row: SummaryRow) {
      return [
        row.name,
        ...weekDates.map((d) => pfInt(row.dailyPay[d] ?? 0)),
        pfDec(row.weeklyTotal),
        pfInt(row.sss), pfInt(row.philhealth), pfInt(row.pagibig),
        pfInt(row.sss_loan), pfInt(row.pagibig_loan),
        pfInt(row.cash_advance), pfInt(row.canteen), pfInt(row.others),
        pfDec(row.totalDeductions), pfDec(row.netPay),
      ]
    }

    function getJobGroupsForCategory(category: Category): Map<string, SummaryRow[]> {
      const sorted = sortEmployees(
        companyEmployees.filter((e) => classifyJob(e.job) === category),
        category,
      )
      const groups = new Map<string, SummaryRow[]>()
      for (const e of sorted) {
        if (!groups.has(e.job)) groups.set(e.job, [])
        const row = allSummaryMap.get(e.employee_id)
        if (row) groups.get(e.job)!.push(row)
      }
      return groups
    }

    const columnStyles: Record<number, object> = { 0: { cellWidth: 33, halign: 'left' } }
    for (let i = 1; i <= 7; i++) columnStyles[i] = { cellWidth: 12, halign: 'right' }
    columnStyles[8] = { cellWidth: 15, halign: 'right' }
    for (let i = 9; i <= 16; i++) columnStyles[i] = { cellWidth: 11, halign: 'right' }
    columnStyles[17] = { cellWidth: 15, halign: 'right' }
    columnStyles[18] = { cellWidth: 15, halign: 'right' }

    const sections: { label: string; category: Category }[] = [
      { label: 'Office', category: 'office' },
      { label: 'Production', category: 'production' },
      { label: 'Piecewise', category: 'piecewise' },
    ]

    let firstPage = true
    for (const { label, category } of sections) {
      const groups = getJobGroupsForCategory(category)
      if (groups.size === 0) continue

      if (!firstPage) doc.addPage()
      firstPage = false

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.text(`${selectedCompany} — ${label}`, 14, 12)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(`Week of ${weekLabel}`, 14, 19)

      const body: (string | { content: string; styles?: object; colSpan?: number })[][] = []
      for (const [job, rows] of groups) {
        body.push([{ content: job, colSpan: pdfHeaders.length, styles: { fontStyle: 'bold' as const, fillColor: [240, 240, 240] as [number, number, number] } }])
        body.push(...rows.map((r) => toTableRow(r)))
      }

      autoTable(doc, {
        head: [pdfHeaders], body, startY: 25,
        theme: 'grid',
        styles: { fontSize: 6.5, cellPadding: 1.5 },
        headStyles: { fillColor: [28, 25, 23], textColor: 255, fontSize: 6 },
        alternateRowStyles: { fillColor: [255, 255, 255] as [number, number, number] },
        columnStyles,
      })
    }

    doc.save(`weekly-summary-${selectedCompany}-${selectedWeek}.pdf`)
  }, [selectedWeek, selectedCompany, weekDates, allSummaryMap, companyEmployees])

  // ── Payslip PDF export ───────────────────────────────────────────────────────

  const handleExportPayslips = useCallback(async () => {
    setExportingPayslips(true)
    try {
      const jsPDF = (await import('jspdf')).default

      // Fetch nightshift bonus rate from config
      const { data: configRows } = await supabase.from('config').select('key, value')
      const nightshiftRate = configRows
        ? parseFloat((configRows as { key: string; value: string }[]).find((r) => r.key === 'NIGHTSHIFT_BONUS_RATE')?.value ?? '0.25')
        : 0.25

      // Build ordered list: office → production → piecewise, each sorted by job then last name
      const orderedEmployees: Employee[] = []
      for (const cat of ['office', 'production', 'piecewise'] as Category[]) {
        orderedEmployees.push(
          ...sortEmployees(companyEmployees.filter((e) => classifyJob(e.job) === cat), cat),
        )
      }

      type SlipData = {
        name: string
        nightshiftPay: number
        holidayPay: number
        extraPay: number
        grossPay: number
        sss: number
        philhealth: number
        pagibig: number
        sssLoan: number
        pagibigLoan: number
        others: number  // cash_advance + others combined
        canteen: number
        totalDeductions: number
        netPay: number
      }

      const slips: SlipData[] = []

      for (const emp of orderedEmployees) {
        const sr = allSummaryMap.get(emp.employee_id)
        if (!sr || (sr.weeklyTotal === 0 && sr.totalDeductions === 0)) continue

        const empDrs = dailyRecords.filter((r) => r.employee_id === emp.employee_id && r.daily_pay > 0)
        let nightshiftDays = 0
        let holiday30Pay = 0
        let holiday100Pay = 0

        for (const dr of empDrs) {
          if (dr.nightshift) nightshiftDays++
          if (dr.holiday === '30%') holiday30Pay += emp.daily_salary * 0.3
          if (dr.holiday === '100%') holiday100Pay += emp.daily_salary
        }

        const nightshiftPay = nightshiftDays * (emp.daily_salary * nightshiftRate)
        const holidayPay = holiday30Pay + holiday100Pay
        const basePay = empDrs.length * emp.daily_salary
        const extraPay = Math.max(0, sr.weeklyTotal - basePay - nightshiftPay - holidayPay)

        slips.push({
          name: sr.name,
          nightshiftPay,
          holidayPay,
          extraPay,
          grossPay: sr.weeklyTotal,
          sss: sr.sss,
          philhealth: sr.philhealth,
          pagibig: sr.pagibig,
          sssLoan: sr.sss_loan,
          pagibigLoan: sr.pagibig_loan,
          others: sr.cash_advance + sr.others,
          canteen: sr.canteen,
          totalDeductions: sr.totalDeductions,
          netPay: sr.netPay,
        })
      }

      if (slips.length === 0) return

      // A4 landscape: 297 × 210 mm — 4 columns × 2 rows = 8 payslips per page
      const doc = new jsPDF('l', 'mm', 'a4')
      const PW = 297, PH = 210, M = 8
      const COLS = 4, ROWS = 2, PER_PAGE = COLS * ROWS
      const CW = (PW - 2 * M) / COLS
      const CH = (PH - 2 * M) / ROWS

      const fmt = (n: number) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

      function drawSlip(s: SlipData, ox: number, oy: number) {
        const LH = 3.8
        const LP = 3.5
        let cy = oy + 5

        // Border
        doc.setDrawColor(180)
        doc.setLineWidth(0.25)
        doc.rect(ox, oy, CW, CH)
        doc.setDrawColor(0)

        // ── Title
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.text('PAYSLIP', ox + CW / 2, cy, { align: 'center' })
        cy += LH + 0.5

        doc.setFontSize(6.5)
        doc.text(selectedCompany, ox + CW / 2, cy, { align: 'center' })
        cy += LH + 1.5

        // ── Name / Period
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6)
        doc.text('Name:', ox + LP, cy)
        doc.setFont('helvetica', 'bold')
        doc.text(s.name, ox + CW - LP, cy, { align: 'right', maxWidth: CW - LP * 2 - 8 })
        doc.setFont('helvetica', 'normal')
        cy += LH

        doc.text('Period:', ox + LP, cy)
        doc.text(selectedWeek, ox + CW - LP, cy, { align: 'right' })
        cy += LH
        doc.text('TO ' + weekEnd, ox + CW - LP, cy, { align: 'right' })
        cy += LH + 1

        // ── SALARY section
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6)
        doc.text('SALARY', ox + LP, cy)
        doc.setLineWidth(0.15)
        doc.line(ox + 2, cy + 0.8, ox + CW - 2, cy + 0.8)
        doc.setLineWidth(0.1)
        cy += LH

        const dataRow = (label: string, val: number) => {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(6)
          doc.text(label, ox + LP, cy)
          doc.text(fmt(val), ox + CW - LP, cy, { align: 'right' })
          cy += LH
        }

        dataRow('PM Shift:', s.nightshiftPay)
        dataRow('Holiday Pay:', s.holidayPay)
        dataRow('Extra:', s.extraPay)

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6.5)
        doc.text('Gross Pay:', ox + LP, cy)
        doc.text('P' + fmt(s.grossPay), ox + CW - LP, cy, { align: 'right' })
        cy += LH + 1

        // ── DEDUCTIONS section
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6)
        doc.text('DEDUCTIONS', ox + LP, cy)
        doc.setLineWidth(0.15)
        doc.line(ox + 2, cy + 0.8, ox + CW - 2, cy + 0.8)
        doc.setLineWidth(0.1)
        cy += LH

        dataRow('SSS Cont.:', s.sss)
        dataRow('Philhealth:', s.philhealth)
        dataRow('Pagibig:', s.pagibig)
        dataRow('SSS Ln.:', s.sssLoan)
        dataRow('Pagibig Ln.:', s.pagibigLoan)
        dataRow('Others:', s.others)
        dataRow('Canteen:', s.canteen)

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6.5)
        doc.text('Total Ded.:', ox + LP, cy)
        doc.text('P' + fmt(s.totalDeductions), ox + CW - LP, cy, { align: 'right' })
        cy += LH + 2

        // ── Net Pay box
        doc.setFillColor(245, 245, 245)
        doc.setLineWidth(0.25)
        doc.rect(ox + 2, cy - 1, CW - 4, 7, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.text('Net Pay: P' + fmt(s.netPay), ox + CW / 2, cy + 3.5, { align: 'center' })
      }

      for (let i = 0; i < slips.length; i++) {
        if (i > 0 && i % PER_PAGE === 0) doc.addPage()
        const pos = i % PER_PAGE
        const col = pos % COLS
        const row = Math.floor(pos / COLS)
        drawSlip(slips[i], M + col * CW, M + row * CH)
      }

      const slug = selectedCompany.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
      doc.save(`payslips_${slug}_${selectedWeek}.pdf`)
    } finally {
      setExportingPayslips(false)
    }
  }, [dailyRecords, companyEmployees, allSummaryMap, selectedWeek, weekEnd, selectedCompany])

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-3rem)] bg-canvas flex flex-col">
      <div className="flex-shrink-0 bg-canvas border-b border-stone-200/60 shadow-sm">
        <div className="px-6 py-3 flex items-center gap-4 flex-wrap">
          <h1 className="font-display text-xl font-semibold text-stone-800 tracking-tight">Weekly Summary</h1>
          <WednesdayPicker value={selectedWeek} options={WEDNESDAYS} onChange={setSelectedWeek} />
          {tagInfo.label && (
            <span className="text-stone-500 font-sans text-sm">· {tagInfo.label}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowSummaryModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-sm font-sans text-stone-700 hover:border-stone-300 hover:bg-stone-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
              </svg>
              Show Summary
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-sm font-sans text-stone-700 hover:border-stone-300 hover:bg-stone-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Export PDF
            </button>
            <button
              onClick={handleExportPayslips}
              disabled={exportingPayslips}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-sm font-sans text-stone-700 hover:border-stone-300 hover:bg-stone-50 disabled:opacity-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
              </svg>
              {exportingPayslips ? 'Exporting…' : 'Export Payslips'}
            </button>
          </div>
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
        ) : categoryRows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-stone-400 font-sans text-sm">
            No {selectedCategory} employees for this company.
          </div>
        ) : (
          <AgGridReact<SummaryGridRow>
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
              if (params.node.rowPinned === 'bottom') {
                return { background: '#eff6ff', fontWeight: 600 }
              }
            }}
          />
        )}
      </div>

      {showSummaryModal && (
        <SummaryModal
          rows={jobSummaryRows}
          company={selectedCompany}
          weekStart={selectedWeek}
          weekEnd={weekEnd}
          onClose={() => setShowSummaryModal(false)}
        />
      )}
    </div>
  )
}
