import type { SupabaseClient } from '@supabase/supabase-js'
import { getWeekEnd } from './payroll'
import {
  getLastWednesdayOfMonth,
  getSSSPeriodForDate,
  getSSSPeriodForMonth,
} from './sssPeriods'

// Naming distinction (important):
//   weekly_records.sss     → EMPLOYEE share only (sss_employee + ec). Stored in DB.
//   SSSTableRow.sss_contribution → COMBINED remittance (sss_total + ec). Display only.

const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)

export type SSSDerivedValues = {
  // Stored on weekly_records:
  philhealth: number
  sss: number
  pagibig: number
  total_gross: number
  // Display-only (SSS page):
  monthly_total: number
  total_mcr: number
  mcrCapped: number
  mcr_employer: number
  mcr_employee: number
  mcr_total: number
  sssCapped: number
  sss_employer: number
  sss_employee: number
  sss_total: number
  sss_combined: number
  ec: number
  pagibig_employer: number
  pagibig_employee: number
  pagibig_total: number
}

export function computeSSSValues(
  daily_salary: number,
  monthly_total: number,
  weekly_gross: number,
): SSSDerivedValues {
  const total_mcr = daily_salary * 26
  const mcrCapped = clamp(total_mcr, 10_000, 100_000)
  const mcr_total = mcrCapped * 0.05
  const mcr_employer = mcr_total / 2
  const mcr_employee = mcr_total / 2

  const sssCapped = clamp(monthly_total, 5_000, 35_000)
  const sss_employee = sssCapped * 0.05
  const sss_employer = sssCapped * 0.10
  const sss_total = sssCapped * 0.15
  const ec = monthly_total < 15_000 ? 10 : 30
  const sss_employee_with_ec = sss_employee + ec
  const sss_combined = sss_total + ec

  return {
    philhealth: r2(mcr_employee),
    sss: r2(sss_employee_with_ec),
    pagibig: 200,
    total_gross: r2(weekly_gross),
    monthly_total: r2(monthly_total),
    total_mcr: r2(total_mcr),
    mcrCapped: r2(mcrCapped),
    mcr_employer: r2(mcr_employer),
    mcr_employee: r2(mcr_employee),
    mcr_total: r2(mcr_total),
    sssCapped: r2(sssCapped),
    sss_employer: r2(sss_employer),
    sss_employee: r2(sss_employee),
    sss_total: r2(sss_total),
    sss_combined: r2(sss_combined),
    ec,
    pagibig_employer: 200,
    pagibig_employee: 200,
    pagibig_total: 400,
  }
}

type DailyRecordSlim = { employee_id: number; date: string; daily_pay: number }
type EmployeeSlim = {
  employee_id: number
  first_name: string
  middle_name: string | null
  last_name: string
  company: string
  job: string
  daily_salary: number
}
type WeeklyRecordExisting = {
  employee_id: number
  week_start: string
  sss_loan: number
  pagibig_loan: number
  cash_advance: number
  canteen: number
  others: number
}

function buildAggregates(
  daily: DailyRecordSlim[],
  weekStart: string,
  weekEnd: string,
): {
  monthlyTotalByEmp: Map<number, number>
  weekGrossByEmp: Map<number, number>
} {
  const monthlyTotalByEmp = new Map<number, number>()
  const weekGrossByEmp = new Map<number, number>()
  for (const r of daily) {
    monthlyTotalByEmp.set(r.employee_id, (monthlyTotalByEmp.get(r.employee_id) ?? 0) + r.daily_pay)
    if (r.date >= weekStart && r.date <= weekEnd) {
      weekGrossByEmp.set(r.employee_id, (weekGrossByEmp.get(r.employee_id) ?? 0) + r.daily_pay)
    }
  }
  return { monthlyTotalByEmp, weekGrossByEmp }
}

export async function recomputeSSSForWeek(
  client: SupabaseClient,
  sssWeekStart: string,
): Promise<{ rowsWritten: number }> {
  const period = getSSSPeriodForDate(sssWeekStart)
  const expectedSSSWeekStart = getLastWednesdayOfMonth(period.year, period.month)
  if (sssWeekStart !== expectedSSSWeekStart) {
    console.warn('[sss] recomputeSSSForWeek called with non-SSS-week start', {
      sssWeekStart, expected: expectedSSSWeekStart,
    })
    return { rowsWritten: 0 }
  }
  const weekEnd = getWeekEnd(sssWeekStart)
  console.log('[sss] recompute start', {
    sssWeekStart, weekEnd, period: { start: period.start, end: period.end, totalWeeks: period.totalWeeks },
  })

  const { data: daily, error: dailyErr } = await client
    .from('daily_records')
    .select('employee_id, date, daily_pay')
    .gte('date', period.start)
    .lte('date', period.end)
  if (dailyErr) {
    console.error('[sss] daily_records fetch failed', dailyErr)
    throw dailyErr
  }

  const { monthlyTotalByEmp, weekGrossByEmp } = buildAggregates(
    (daily ?? []) as DailyRecordSlim[],
    sssWeekStart,
    weekEnd,
  )

  const empIds = [...monthlyTotalByEmp.entries()]
    .filter(([, total]) => total > 0)
    .map(([id]) => id)
  if (empIds.length === 0) {
    console.log('[sss] recompute end — no employees with earnings in period')
    return { rowsWritten: 0 }
  }

  const [{ data: emps, error: empErr }, { data: existing, error: exErr }] = await Promise.all([
    client
      .from('employees')
      .select('employee_id, first_name, middle_name, last_name, company, job, daily_salary')
      .in('employee_id', empIds),
    client
      .from('weekly_records')
      .select('employee_id, week_start, sss_loan, pagibig_loan, cash_advance, canteen, others')
      .in('employee_id', empIds)
      .eq('week_start', sssWeekStart),
  ])
  if (empErr) { console.error('[sss] employees fetch failed', empErr); throw empErr }
  if (exErr) { console.error('[sss] existing weekly_records fetch failed', exErr); throw exErr }

  const empById = new Map<number, EmployeeSlim>()
  for (const e of (emps ?? []) as EmployeeSlim[]) empById.set(e.employee_id, e)
  const existingById = new Map<number, WeeklyRecordExisting>()
  for (const w of (existing ?? []) as WeeklyRecordExisting[]) existingById.set(w.employee_id, w)

  const rows = empIds.flatMap((id) => {
    const emp = empById.get(id)
    if (!emp) return []
    const monthly = monthlyTotalByEmp.get(id) ?? 0
    const weekly = weekGrossByEmp.get(id) ?? 0
    const v = computeSSSValues(emp.daily_salary, monthly, weekly)
    const ex = existingById.get(id)
    return [{
      employee_id: id,
      week_start: sssWeekStart,
      week_end: weekEnd,
      total_gross: v.total_gross,
      sss: v.sss,
      philhealth: v.philhealth,
      pagibig: v.pagibig,
      sss_loan: ex?.sss_loan ?? 0,
      pagibig_loan: ex?.pagibig_loan ?? 0,
      cash_advance: ex?.cash_advance ?? 0,
      canteen: ex?.canteen ?? 0,
      others: ex?.others ?? 0,
      updated_at: new Date().toISOString(),
    }]
  })

  if (rows.length === 0) {
    console.log('[sss] recompute end — no rows to write')
    return { rowsWritten: 0 }
  }

  const { error: upErr } = await client
    .from('weekly_records')
    .upsert(rows, { onConflict: 'employee_id,week_start' })
  if (upErr) {
    console.error('[sss] weekly_records upsert failed', upErr)
    throw upErr
  }

  console.log('[sss] recompute end', { rowsWritten: rows.length })
  return { rowsWritten: rows.length }
}

export type SSSTableRow = {
  employee_id: number
  first_name: string
  middle_name: string | null
  last_name: string
  company: string
  job: string
  period_start: string
  period_end: string
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
  // Combined SSS remittance (employer + employee + EC). Different from weekly_records.sss
  // which stores employee-only.
  sss_contribution: number
  pagibig_employer: number
  pagibig_employee: number
  pagibig_total: number
}

export async function getSSSTableView(
  client: SupabaseClient,
  year: number,
  month: number,
): Promise<SSSTableRow[]> {
  const period = getSSSPeriodForMonth(year, month)
  const sssWeekStart = getLastWednesdayOfMonth(year, month)
  const weekEnd = getWeekEnd(sssWeekStart)

  const { data: daily, error: dailyErr } = await client
    .from('daily_records')
    .select('employee_id, date, daily_pay')
    .gte('date', period.start)
    .lte('date', period.end)
  if (dailyErr) throw dailyErr

  const { monthlyTotalByEmp, weekGrossByEmp } = buildAggregates(
    (daily ?? []) as DailyRecordSlim[],
    sssWeekStart,
    weekEnd,
  )
  const empIds = [...monthlyTotalByEmp.entries()]
    .filter(([, t]) => t > 0)
    .map(([id]) => id)
  if (empIds.length === 0) return []

  const { data: emps, error: empErr } = await client
    .from('employees')
    .select('employee_id, first_name, middle_name, last_name, company, job, daily_salary')
    .in('employee_id', empIds)
  if (empErr) throw empErr

  const out: SSSTableRow[] = []
  for (const e of (emps ?? []) as EmployeeSlim[]) {
    const monthly = monthlyTotalByEmp.get(e.employee_id) ?? 0
    const weekly = weekGrossByEmp.get(e.employee_id) ?? 0
    const v = computeSSSValues(e.daily_salary, monthly, weekly)
    out.push({
      employee_id: e.employee_id,
      first_name: e.first_name,
      middle_name: e.middle_name,
      last_name: e.last_name,
      company: e.company,
      job: e.job,
      period_start: period.start,
      period_end: period.end,
      daily_salary: e.daily_salary,
      monthly_total: v.monthly_total,
      total_mcr: v.total_mcr,
      mcr_employer: v.mcr_employer,
      mcr_employee: v.mcr_employee,
      mcr_total: v.mcr_total,
      sss_employer: v.sss_employer,
      sss_employee: v.sss_employee,
      sss_total: v.sss_total,
      ec: v.ec,
      sss_contribution: v.sss_combined,
      pagibig_employer: v.pagibig_employer,
      pagibig_employee: v.pagibig_employee,
      pagibig_total: v.pagibig_total,
    })
  }
  return out
}
