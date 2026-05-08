// SSS period and week-tag math.
// All dates are local-zone 'YYYY-MM-DD' strings (matching the codebase convention from
// lib/payroll.ts → toLocaleDateString('en-CA')). Months are 1-indexed at the public API
// (1 = January … 12 = December) and converted to 0-indexed only when feeding the JS Date
// constructor.

export function parseLocalDate(s: string): Date {
  return new Date(s + 'T00:00:00')
}

export function formatLocalDate(d: Date): string {
  return d.toLocaleDateString('en-CA')
}

export function addDays(s: string, n: number): string {
  const d = parseLocalDate(s)
  d.setDate(d.getDate() + n)
  return formatLocalDate(d)
}

export function daysBetween(a: string, b: string): number {
  const ms = parseLocalDate(b).getTime() - parseLocalDate(a).getTime()
  return Math.round(ms / 86_400_000)
}

export function getWednesdaysInMonth(year: number, month: number): string[] {
  const firstOfMonth = new Date(year, month - 1, 1)
  const offsetToWed = (3 - firstOfMonth.getDay() + 7) % 7
  const result: string[] = []
  const d = new Date(year, month - 1, 1 + offsetToWed)
  while (d.getMonth() === month - 1) {
    result.push(formatLocalDate(d))
    d.setDate(d.getDate() + 7)
  }
  return result
}

export function getLastWednesdayOfMonth(year: number, month: number): string {
  const weds = getWednesdaysInMonth(year, month)
  return weds[weds.length - 1]
}

export type SSSPeriod = { start: string; end: string; totalWeeks: 4 | 5 }

export function getSSSPeriodForMonth(year: number, month: number): SSSPeriod {
  const weds = getWednesdaysInMonth(year, month)
  const start = weds[0]
  const lastWed = weds[weds.length - 1]
  const end = addDays(lastWed, 6) // Tuesday after the last Wednesday
  const totalWeeks = (weds.length === 5 ? 5 : 4) as 4 | 5
  return { start, end, totalWeeks }
}

export type SSSPeriodForDate = SSSPeriod & { year: number; month: number }

export function getSSSPeriodForDate(date: string): SSSPeriodForDate {
  const d = parseLocalDate(date)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const period = getSSSPeriodForMonth(y, m)
  if (date < period.start) {
    // Date falls before this month's first Wednesday → it belongs to the previous month's
    // period (whose tail extends past the calendar boundary into this month).
    const prevYear = m === 1 ? y - 1 : y
    const prevMonth = m === 1 ? 12 : m - 1
    const prev = getSSSPeriodForMonth(prevYear, prevMonth)
    return { ...prev, year: prevYear, month: prevMonth }
  }
  return { ...period, year: y, month: m }
}

const TAGS_4: readonly string[] = [
  'Pag-IBIG Loan Week',
  'Calamity Loan Week',
  'SSS Loan + Calamity Loan Week',
  'SSS + Pag-IBIG Contributions Week',
]
const TAGS_5: readonly string[] = ['Bye Week', ...TAGS_4]

export type WeekTagInfo = {
  label: string
  isSSSWeek: boolean
  isByeWeek: boolean
  weekIndex: number
  totalWeeks: 4 | 5
}

export function getWeekTagInfo(wedStartDate: string): WeekTagInfo {
  const period = getSSSPeriodForDate(wedStartDate)
  const weds = getWednesdaysInMonth(period.year, period.month)
  const weekIndex = weds.indexOf(wedStartDate)
  const totalWeeks = period.totalWeeks
  const tags = totalWeeks === 5 ? TAGS_5 : TAGS_4
  // weekIndex can be -1 if the input isn't actually one of this period's Wednesdays
  // (e.g. a non-Wednesday string snuck in). Fall back to a neutral label.
  const label = weekIndex >= 0 ? tags[weekIndex] : ''
  return {
    label,
    isSSSWeek: weekIndex === weds.length - 1,
    isByeWeek: totalWeeks === 5 && weekIndex === 0,
    weekIndex,
    totalWeeks,
  }
}
