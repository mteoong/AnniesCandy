export const dynamic = 'force-dynamic'

import { createServerClient } from '@/lib/supabase-server'
import { DailyPage } from './DailyPage'
import { DAILY_EXCLUDED_PREFIXES, PIECEWISE_PREFIXES, type Employee, type ConfigRow } from '@/lib/types'
import { parseConfig } from '@/lib/payroll'

export default async function Page() {
  try {
    const supabase = createServerClient()
    const pieceFilters = PIECEWISE_PREFIXES.map((p) => `job.like.${p} #%`).join(',')

    const [{ data: allEmployees, error: empError }, { data: configRows, error: cfgError }] =
      await Promise.all([
        supabase
          .from('employees')
          .select('*')
          .eq('is_active', true)
          .not('job', 'eq', 'FACTORY')
          .order('last_name', { ascending: true }),
        supabase.from('config').select('*'),
      ])

    if (empError) throw empError

    const employees = (allEmployees ?? []) as Employee[]

    const dailyWorkers = employees.filter(
      (e) => !DAILY_EXCLUDED_PREFIXES.some((p) => e.job.startsWith(p + ' #'))
    )
    const comboWorkers = employees.filter((e) => e.job.startsWith('COMBO #'))
    const { data: piecewiseData } = await supabase
      .from('employees')
      .select('*')
      .eq('is_active', true)
      .or(pieceFilters)
      .order('job', { ascending: true })

    const piecewiseWorkers = (piecewiseData ?? []) as Employee[]

    return (
      <DailyPage
        dailyWorkers={dailyWorkers}
        comboWorkers={comboWorkers}
        piecewiseWorkers={piecewiseWorkers}
        config={parseConfig((configRows ?? []) as ConfigRow[])}
        configError={cfgError?.message ?? null}
      />
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Daily page load error:', msg)
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-2 text-stone-400 font-sans text-sm">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
        </svg>
        <p>Could not load page.</p>
        <p className="text-xs text-stone-300 font-mono max-w-sm text-center">{msg}</p>
      </div>
    )
  }
}
