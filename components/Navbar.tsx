'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useCompany } from '@/lib/company-context'

const ENTRY_ITEMS = [
  { label: 'Daily Entry', href: '/daily' },
  { label: 'Deductions', href: '/deductions' },
  { label: 'Weekly Summary', href: '/weekly-summary' },
  { label: 'SSS', href: '/sss' },
]

const DELIVERY_ITEMS = [
  { label: 'Dashboard', href: '/delivery/dashboard' },
  { label: 'Inputs', href: '/delivery/inputs' },
  { label: 'Summary', href: '/delivery/summary' },
]

const DATABASE_ITEMS = [
  { label: 'Formulas', href: '/database' },
  { label: 'Employees', href: '/database/employees' },
]

export function Navbar() {
  const [entryOpen, setEntryOpen] = useState(false)
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [databaseOpen, setDatabaseOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const entryRef = useRef<HTMLDivElement>(null)
  const deliveryRef = useRef<HTMLDivElement>(null)
  const databaseRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const { selectedCompany, setSelectedCompany, allCompanies } = useCompany()

  useEffect(() => {
    if (!entryOpen && !deliveryOpen && !databaseOpen && !profileOpen) return
    const close = (e: MouseEvent) => {
      if (entryRef.current && !entryRef.current.contains(e.target as Node)) setEntryOpen(false)
      if (deliveryRef.current && !deliveryRef.current.contains(e.target as Node)) setDeliveryOpen(false)
      if (databaseRef.current && !databaseRef.current.contains(e.target as Node)) setDatabaseOpen(false)
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [entryOpen, deliveryOpen, databaseOpen, profileOpen])

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-12 bg-white border-b border-stone-200 flex items-center justify-between px-6">
      {/* Brand */}
      <Link href="/" className="font-display text-lg font-semibold text-stone-800 tracking-tight hover:text-stone-600 transition-colors">
        Annie&apos;s Candy
      </Link>

      {/* Right side */}
      <div className="flex items-center gap-1">
        {/* Delivery dropdown */}
        <div className="relative" ref={deliveryRef}>
          <button
            onClick={() => setDeliveryOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium font-sans transition-colors',
              deliveryOpen
                ? 'bg-stone-100 text-stone-800'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-50',
            )}
          >
            Delivery
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={cn('transition-transform duration-150', deliveryOpen && 'rotate-180')}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {deliveryOpen && (
            <div className="absolute right-0 top-full mt-1.5 bg-white border border-stone-200 rounded-xl shadow-xl py-1.5 min-w-44 font-sans text-sm">
              {DELIVERY_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setDeliveryOpen(false)}
                  className="block px-3.5 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Entry dropdown */}
        <div className="relative" ref={entryRef}>
          <button
            onClick={() => setEntryOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium font-sans transition-colors',
              entryOpen
                ? 'bg-stone-100 text-stone-800'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-50',
            )}
          >
            Entry
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className={cn('transition-transform duration-150', entryOpen && 'rotate-180')}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {entryOpen && (
            <div className="absolute right-0 top-full mt-1.5 bg-white border border-stone-200 rounded-xl shadow-xl py-1.5 min-w-44 font-sans text-sm">
              {ENTRY_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setEntryOpen(false)}
                  className="block px-3.5 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Database dropdown */}
        <div className="relative" ref={databaseRef}>
          <button
            onClick={() => setDatabaseOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium font-sans transition-colors',
              databaseOpen
                ? 'bg-stone-100 text-stone-800'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-50',
            )}
          >
            Database
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={cn('transition-transform duration-150', databaseOpen && 'rotate-180')}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {databaseOpen && (
            <div className="absolute right-0 top-full mt-1.5 bg-white border border-stone-200 rounded-xl shadow-xl py-1.5 min-w-44 font-sans text-sm">
              {DATABASE_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setDatabaseOpen(false)}
                  className="block px-3.5 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-full transition-colors ml-1',
              profileOpen
                ? 'bg-stone-200 text-stone-800'
                : 'bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-800',
            )}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full mt-1.5 bg-white border border-stone-200 rounded-xl shadow-xl py-1.5 min-w-52 font-sans text-sm z-50">
              {/* Company selection */}
              <div className="px-3.5 pt-1 pb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1">Company</p>
                {allCompanies.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setSelectedCompany(c); setProfileOpen(false) }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors',
                      c === selectedCompany
                        ? 'text-stone-900 font-semibold'
                        : 'text-stone-500 hover:text-stone-900 hover:bg-stone-50',
                    )}
                  >
                    <span className={cn(
                      'w-3.5 h-3.5 flex items-center justify-center flex-shrink-0',
                    )}>
                      {c === selectedCompany && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                    {c}
                  </button>
                ))}
              </div>

              <div className="border-t border-stone-100 my-1" />

              {/* Settings */}
              <Link
                href="/settings"
                onClick={() => setProfileOpen(false)}
                className="flex items-center gap-2.5 px-3.5 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Settings
              </Link>

              {/* Logout */}
              <button
                disabled
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-stone-400 cursor-not-allowed transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
