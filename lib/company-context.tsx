'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type CompanyContextValue = {
  selectedCompany: string
  setSelectedCompany: (c: string) => void
  allCompanies: string[]
}

const CompanyContext = createContext<CompanyContextValue>({
  selectedCompany: '',
  setSelectedCompany: () => {},
  allCompanies: [],
})

export function CompanyProvider({ companies, children }: { companies: string[]; children: ReactNode }) {
  const [selectedCompany, setSelectedCompanyState] = useState<string>(companies[0] ?? '')

  useEffect(() => {
    const saved = localStorage.getItem('selectedCompany')
    if (saved && companies.includes(saved)) setSelectedCompanyState(saved)
  }, [companies])

  const setSelectedCompany = (c: string) => {
    setSelectedCompanyState(c)
    localStorage.setItem('selectedCompany', c)
  }

  return (
    <CompanyContext.Provider value={{ selectedCompany, setSelectedCompany, allCompanies: companies }}>
      {children}
    </CompanyContext.Provider>
  )
}

export function useCompany() {
  return useContext(CompanyContext)
}
