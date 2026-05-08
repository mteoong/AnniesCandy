export const dynamic = 'force-dynamic'

import { createServerClient } from '@/lib/supabase-server'
import { FormulasPage } from './FormulasPage'
import type { ConfigRow } from '@/lib/types'

export default async function Page() {
  const supabase = createServerClient()
  const { data } = await supabase.from('config').select('*').order('key')
  return <FormulasPage initialRows={(data ?? []) as ConfigRow[]} />
}
