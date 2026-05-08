export type Employee = {
  employee_id: number
  first_name: string
  middle_name: string | null
  last_name: string
  company: string
  job: string
  daily_salary: number
  nightshift: boolean
  is_active: boolean
  sss_num: string | null
  pagibig_num: string | null
  philhealth_num: string | null
  tin_num: string | null
  birthday: string | null
  date_hired: string | null
  created_at: string
}

export const CANDY_TYPES = ['KING', 'JR', 'SP', 'COMBO', 'COINS', 'XL'] as const
export type CandyType = (typeof CANDY_TYPES)[number]

export const UNASSIGNED_JOB = 'FACTORY'

export function getCandyType(job: string): CandyType | null {
  for (const type of CANDY_TYPES) {
    if (job.startsWith(type + ' #')) return type
  }
  return null
}

export type HolidayType = 'Regular Day' | '30%' | '100%'

export const HOLIDAY_MULTIPLIER: Record<HolidayType, number> = {
  'Regular Day': 0,
  '30%': 0.3,
  '100%': 1.0,
}

export type DailyRecord = {
  id: number
  employee_id: number
  date: string
  job: string
  hours: number
  pieces: number
  daily_pay: number
  nightshift: boolean
  holiday: HolidayType
  created_at: string
}

export type WeeklyRecord = {
  id: number
  employee_id: number
  week_start: string
  week_end: string
  total_gross: number
  sss: number
  philhealth: number
  pagibig: number
  sss_loan: number
  pagibig_loan: number
  cash_advance: number
  canteen: number
  others: number
  created_at: string
  updated_at: string
}

export type ConfigRow = {
  key: string
  value: string
  description: string | null
  updated_at: string
}

export type PayrollConfig = {
  COMBO_CONSTANT: number
  KING_THRESHOLD: number
  KING_RATE_LOW: number
  KING_RATE_HIGH: number
  SP_THRESHOLD_1: number
  SP_THRESHOLD_2: number
  SP_RATE_1: number
  SP_RATE_2: number
  SP_RATE_3: number
  COIN_RATE: number
  NIGHTSHIFT_BONUS_RATE: number
  KING_JR_SP_QUOTA_THRESHOLD: number
  KING_JR_SP_QUOTA_HIGH: number
  KING_JR_SP_QUOTA_LOW: number
  COIN_QUOTA_THRESHOLD: number
  COIN_QUOTA_HIGH: number
  COIN_QUOTA_LOW: number
}

export const PIECEWISE_PREFIXES = ['KING', 'JR', 'SP', 'COINS'] as const
export type PiecewiseType = (typeof PIECEWISE_PREFIXES)[number]

export const COMBO_PREFIX = 'COMBO'
export const DAILY_EXCLUDED_PREFIXES = ['KING', 'JR', 'SP', 'COINS', 'COMBO']

export type JobColorType = CandyType | 'OFFICE' | 'PRODUCTION'

type ColorConfig = {
  dot: string
  text: string
  border: string
  headerBg: string
  badge: string
  ringColor: string
}

export const JOB_COLOR_CONFIG: Record<JobColorType, ColorConfig> = {
  KING:       { dot: 'bg-red-500',    text: 'text-red-600',    border: 'border-red-200',    headerBg: 'bg-red-50',    badge: 'bg-red-100 text-red-700',    ringColor: 'ring-red-400' },
  JR:         { dot: 'bg-blue-600',   text: 'text-blue-700',   border: 'border-blue-200',   headerBg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700',   ringColor: 'ring-blue-400' },
  SP:         { dot: 'bg-emerald-600',text: 'text-emerald-700',border: 'border-emerald-200',headerBg: 'bg-emerald-50',badge: 'bg-emerald-100 text-emerald-700',ringColor: 'ring-emerald-400' },
  COMBO:      { dot: 'bg-violet-600', text: 'text-violet-700', border: 'border-violet-200', headerBg: 'bg-violet-50', badge: 'bg-violet-100 text-violet-700', ringColor: 'ring-violet-400' },
  COINS:      { dot: 'bg-amber-500',  text: 'text-amber-700',  border: 'border-amber-200',  headerBg: 'bg-amber-50',  badge: 'bg-amber-100 text-amber-700',  ringColor: 'ring-amber-400' },
  XL:         { dot: 'bg-cyan-600',   text: 'text-cyan-700',   border: 'border-cyan-200',   headerBg: 'bg-cyan-50',   badge: 'bg-cyan-100 text-cyan-700',   ringColor: 'ring-cyan-400' },
  OFFICE:     { dot: 'bg-indigo-500', text: 'text-indigo-700', border: 'border-indigo-200', headerBg: 'bg-indigo-50', badge: 'bg-indigo-100 text-indigo-700', ringColor: 'ring-indigo-400' },
  PRODUCTION: { dot: 'bg-orange-400', text: 'text-orange-700', border: 'border-orange-200', headerBg: 'bg-orange-50', badge: 'bg-orange-100 text-orange-700', ringColor: 'ring-orange-400' },
}

export function getDailyJobColor(job: string): 'OFFICE' | 'PRODUCTION' {
  const lower = job.toLowerCase()
  if (lower.includes('office') || lower.includes('driver') || lower.includes('checker')) return 'OFFICE'
  return 'PRODUCTION'
}

export function getPiecewiseTypeFromJob(job: string): PiecewiseType | null {
  for (const p of PIECEWISE_PREFIXES) {
    if (job.startsWith(p + ' #')) return p
  }
  return null
}

export function getJobColorConfig(job: string): ColorConfig {
  const candyType = getCandyType(job)
  if (candyType) return JOB_COLOR_CONFIG[candyType]
  return JOB_COLOR_CONFIG[getDailyJobColor(job)]
}

export function classifyJob(job: string): 'piecewise' | 'office' | 'production' {
  if (PIECEWISE_PREFIXES.some((p) => job.startsWith(p + ' #')) || job.startsWith('COMBO #')) return 'piecewise'
  const lower = job.toLowerCase()
  if (lower.includes('office') || lower.includes('driver') || lower.includes('checker')) return 'office'
  return 'production'
}

export const CANDY_CONFIG: Record<
  CandyType,
  {
    dot: string
    text: string
    border: string
    headerBg: string
    badge: string
    cardBorderLeft: string
    ringColor: string
  }
> = {
  KING: {
    dot: 'bg-red-500',
    text: 'text-red-600',
    border: 'border-red-200',
    headerBg: 'bg-red-50',
    badge: 'bg-red-100 text-red-700',
    cardBorderLeft: 'border-l-red-500',
    ringColor: 'ring-red-400',
  },
  JR: {
    dot: 'bg-blue-600',
    text: 'text-blue-700',
    border: 'border-blue-200',
    headerBg: 'bg-blue-50',
    badge: 'bg-blue-100 text-blue-700',
    cardBorderLeft: 'border-l-blue-500',
    ringColor: 'ring-blue-400',
  },
  SP: {
    dot: 'bg-emerald-600',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    headerBg: 'bg-emerald-50',
    badge: 'bg-emerald-100 text-emerald-700',
    cardBorderLeft: 'border-l-emerald-500',
    ringColor: 'ring-emerald-400',
  },
  COMBO: {
    dot: 'bg-violet-600',
    text: 'text-violet-700',
    border: 'border-violet-200',
    headerBg: 'bg-violet-50',
    badge: 'bg-violet-100 text-violet-700',
    cardBorderLeft: 'border-l-violet-500',
    ringColor: 'ring-violet-400',
  },
  COINS: {
    dot: 'bg-amber-500',
    text: 'text-amber-700',
    border: 'border-amber-200',
    headerBg: 'bg-amber-50',
    badge: 'bg-amber-100 text-amber-700',
    cardBorderLeft: 'border-l-amber-500',
    ringColor: 'ring-amber-400',
  },
  XL: {
    dot: 'bg-cyan-600',
    text: 'text-cyan-700',
    border: 'border-cyan-200',
    headerBg: 'bg-cyan-50',
    badge: 'bg-cyan-100 text-cyan-700',
    cardBorderLeft: 'border-l-cyan-500',
    ringColor: 'ring-cyan-400',
  },
}
