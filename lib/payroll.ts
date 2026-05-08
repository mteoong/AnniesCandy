import type { Employee, PayrollConfig, HolidayType, ConfigRow } from './types'
import { HOLIDAY_MULTIPLIER } from './types'

export function parseConfig(rows: ConfigRow[]): PayrollConfig {
  const map = Object.fromEntries(rows.map((r) => [r.key, parseFloat(r.value)]))
  return map as PayrollConfig
}

function nightshiftBonus(employee: Employee, cfg: PayrollConfig): number {
  return employee.nightshift ? employee.daily_salary * cfg.NIGHTSHIFT_BONUS_RATE : 0
}

function holidayBonus(employee: Employee, holiday: HolidayType): number {
  return employee.daily_salary * HOLIDAY_MULTIPLIER[holiday]
}

export function calcDailyPay(
  employee: Employee,
  extra: number,
  holiday: HolidayType,
  cfg: PayrollConfig,
): number {
  return employee.daily_salary + extra + nightshiftBonus(employee, cfg) + holidayBonus(employee, holiday)
}

export function calcComboPay(
  employee: Employee,
  boxes: number,
  presentCount: number,
  holiday: HolidayType,
  cfg: PayrollConfig,
): number {
  if (presentCount === 0) return 0
  const base = (boxes - presentCount * 10) / 2 + cfg.COMBO_CONSTANT
  return base + nightshiftBonus(employee, cfg) + holidayBonus(employee, holiday)
}

export function calcKingPay(
  employee: Employee,
  totalCandy: number,
  presentCount: number,
  holiday: HolidayType,
  cfg: PayrollConfig,
): number {
  if (presentCount === 0) return 0
  const cpp = totalCandy / presentCount
  const base = cpp < cfg.KING_THRESHOLD ? cpp * cfg.KING_RATE_LOW : cpp * cfg.KING_RATE_HIGH
  const threshold = cfg.KING_JR_SP_QUOTA_THRESHOLD || 340
  const quota = cpp >= threshold ? (cfg.KING_JR_SP_QUOTA_HIGH || 367) : (cfg.KING_JR_SP_QUOTA_LOW || 351)
  return base + quota + nightshiftBonus(employee, cfg) + holidayBonus(employee, holiday)
}

export function calcSpPay(
  employee: Employee,
  totalCandy: number,
  presentCount: number,
  holiday: HolidayType,
  cfg: PayrollConfig,
): number {
  if (presentCount === 0) return 0
  const cpp = totalCandy / presentCount
  const base =
    cpp < cfg.SP_THRESHOLD_1
      ? cpp * cfg.SP_RATE_1
      : cpp < cfg.SP_THRESHOLD_2
        ? cpp * cfg.SP_RATE_2
        : cpp * cfg.SP_RATE_3
  const threshold = cfg.KING_JR_SP_QUOTA_THRESHOLD || 340
  const quota = cpp >= threshold ? (cfg.KING_JR_SP_QUOTA_HIGH || 367) : (cfg.KING_JR_SP_QUOTA_LOW || 351)
  return base + quota + nightshiftBonus(employee, cfg) + holidayBonus(employee, holiday)
}

export function calcCoinsPay(
  employee: Employee,
  totalCandy: number,
  presentCount: number,
  holiday: HolidayType,
  cfg: PayrollConfig,
): number {
  if (presentCount === 0) return 0
  const cpp = totalCandy / presentCount
  const base = cpp * cfg.COIN_RATE
  const threshold = cfg.COIN_QUOTA_THRESHOLD || 540
  const quota = cpp >= threshold ? (cfg.COIN_QUOTA_HIGH || 476) : (cfg.COIN_QUOTA_LOW || 460)
  return base + quota + nightshiftBonus(employee, cfg) + holidayBonus(employee, holiday)
}

export function candyPerPerson(totalCandy: number, presentCount: number): number {
  if (presentCount === 0) return 0
  return totalCandy / presentCount
}

export function formatPeso(amount: number): string {
  return '₱' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function todayString(): string {
  return new Date().toLocaleDateString('en-CA')
}

export function getWeekStart(date?: Date): string {
  const d = date ? new Date(date) : new Date()
  const offset = (d.getDay() + 4) % 7 // days since last Wednesday (Sun=0 → 4, Wed=3 → 0)
  d.setDate(d.getDate() - offset)
  return d.toLocaleDateString('en-CA')
}

export function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00')
  d.setDate(d.getDate() + 6)
  return d.toLocaleDateString('en-CA')
}

export function getWeekDates(weekStart: string): string[] {
  const dates: string[] = []
  const d = new Date(weekStart + 'T00:00:00')
  for (let i = 0; i < 7; i++) {
    dates.push(d.toLocaleDateString('en-CA'))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

export function listWednesdays(count: number): string[] {
  const result: string[] = []
  const d = new Date(getWeekStart() + 'T00:00:00')
  for (let i = 0; i < count; i++) {
    result.push(d.toLocaleDateString('en-CA'))
    d.setDate(d.getDate() - 7)
  }
  return result
}
