export const dynamic = 'force-dynamic'

import { createServerClient } from '@/lib/supabase-server'
import { ConfigPage } from './ConfigPage'
import type { ConfigRow } from '@/lib/types'

export default async function Page() {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase.from('config').select('*').order('key', { ascending: true })
    if (error) throw error
    return <ConfigPage initialRows={(data ?? []) as ConfigRow[]} />
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Config page load error:', msg)
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
