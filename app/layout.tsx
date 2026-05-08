import type { Metadata } from 'next'
import { Fraunces, DM_Sans, JetBrains_Mono } from 'next/font/google'
import { Navbar } from '@/components/Navbar'
import { CompanyProvider } from '@/lib/company-context'
import { createServerClient } from '@/lib/supabase-server'
import './globals.css'

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  axes: ['opsz'],
})

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: "Annie's Candy — Payroll",
  description: "Internal payroll management for Annie's Candy",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let companies: string[] = []
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('employees')
      .select('company')
      .eq('is_active', true)
      .not('job', 'eq', 'FACTORY')
    companies = [...new Set((data ?? []).map((d: { company: string }) => d.company))].sort()
  } catch {
    // fallback to empty — CompanyProvider handles gracefully
  }

  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-stone-800">
        <CompanyProvider companies={companies}>
          <Navbar />
          <div className="pt-12 flex flex-col flex-1">{children}</div>
        </CompanyProvider>
      </body>
    </html>
  )
}
