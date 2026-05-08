export const dynamic = 'force-dynamic'

import { createServerClient } from '@/lib/supabase-server'
import { EmployeesPage } from './EmployeesPage'
import type { Employee } from '@/lib/types'

export default async function Page() {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('employees')
    .select('*')
    .order('last_name')
  return <EmployeesPage initialEmployees={(data ?? []) as Employee[]} />
}
