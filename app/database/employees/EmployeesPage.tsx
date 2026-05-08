'use client'

import { useState, useRef, useCallback, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  ModuleRegistry, AllCommunityModule, themeQuartz,
  type ColDef, type CellValueChangedEvent, type GetRowIdParams,
} from 'ag-grid-community'
import { supabase } from '@/lib/supabase'
import { useCompany } from '@/lib/company-context'
import type { Employee } from '@/lib/types'

ModuleRegistry.registerModules([AllCommunityModule])

// ── Add employee form ──────────────────────────────────────────────────────────

type EmpForm = {
  first_name: string
  middle_name: string
  last_name: string
  company: string
  job: string
  daily_salary: string
  sss_num: string
  pagibig_num: string
  philhealth_num: string
  tin_num: string
  birthday: string
  date_hired: string
}

const EMPTY_FORM: EmpForm = {
  first_name: '', middle_name: '', last_name: '', company: '', job: '',
  daily_salary: '',
  sss_num: '', pagibig_num: '', philhealth_num: '', tin_num: '',
  birthday: '', date_hired: '',
}

const INPUT = 'px-3 py-1.5 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white text-stone-700 w-full'
const LABEL = 'block text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans mb-1'

function AddEmployeeModal({
  defaultCompany,
  companies,
  jobsByCompany,
  onClose,
  onAdd,
}: {
  defaultCompany: string
  companies: string[]
  jobsByCompany: Record<string, string[]>
  onClose: () => void
  onAdd: (emp: Employee) => void
}) {
  const [form, setForm] = useState<EmpForm>({ ...EMPTY_FORM, company: defaultCompany })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof EmpForm, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const setCompany = (company: string) => setForm((f) => ({ ...f, company, job: '' }))
  const availableJobs = jobsByCompany[form.company] ?? []

  async function handleSubmit() {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.company.trim() || !form.job.trim()
      || !form.sss_num.trim() || !form.philhealth_num.trim() || !form.pagibig_num.trim() || !form.tin_num.trim()) {
      setError('First name, last name, company, job, SSS, PhilHealth, Pag-IBIG, and TIN are required.')
      return
    }
    setSaving(true)
    setError(null)
    const { data: row, error: err } = await supabase.from('employees').insert({
      first_name: form.first_name.trim(),
      middle_name: form.middle_name.trim() || null,
      last_name: form.last_name.trim(),
      company: form.company,
      job: form.job,
      daily_salary: parseFloat(form.daily_salary) || 0,
      nightshift: false,
      is_active: true,
      sss_num: form.sss_num.trim(),
      pagibig_num: form.pagibig_num.trim(),
      philhealth_num: form.philhealth_num.trim(),
      tin_num: form.tin_num.trim(),
      birthday: form.birthday || null,
      date_hired: form.date_hired || null,
    }).select().single()
    setSaving(false)
    if (err || !row) {
      console.error('employees insert failed:', err)
      setError(err?.message ?? 'Failed to add employee.')
      return
    }
    onAdd(row as Employee)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="font-display text-lg font-semibold text-stone-800">Add Employee</h2>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={LABEL}>First Name *</label>
            <input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} className={INPUT} placeholder="First name" />
          </div>
          <div>
            <label className={LABEL}>Middle Name</label>
            <input value={form.middle_name} onChange={(e) => set('middle_name', e.target.value)} className={INPUT} placeholder="Optional" />
          </div>
          <div>
            <label className={LABEL}>Last Name *</label>
            <input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} className={INPUT} placeholder="Last name" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={LABEL}>Company *</label>
            <select value={form.company} onChange={(e) => setCompany(e.target.value)} className={INPUT}>
              <option value="">Select company…</option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Job *</label>
            <select value={form.job} onChange={(e) => set('job', e.target.value)} className={INPUT} disabled={!form.company}>
              <option value="">{form.company ? 'Select job…' : 'Select company first'}</option>
              {availableJobs.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Daily Salary</label>
            <input type="number" min={0} step="any" value={form.daily_salary} onChange={(e) => set('daily_salary', e.target.value)} className={INPUT} placeholder="0" />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className={LABEL}>SSS No. *</label>
            <input value={form.sss_num} onChange={(e) => set('sss_num', e.target.value)} className={INPUT} placeholder="SSS number" />
          </div>
          <div>
            <label className={LABEL}>PhilHealth No. *</label>
            <input value={form.philhealth_num} onChange={(e) => set('philhealth_num', e.target.value)} className={INPUT} placeholder="PhilHealth number" />
          </div>
          <div>
            <label className={LABEL}>Pag-IBIG No. *</label>
            <input value={form.pagibig_num} onChange={(e) => set('pagibig_num', e.target.value)} className={INPUT} placeholder="Pag-IBIG number" />
          </div>
          <div>
            <label className={LABEL}>TIN *</label>
            <input value={form.tin_num} onChange={(e) => set('tin_num', e.target.value)} className={INPUT} placeholder="TIN number" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Birthday</label>
            <input type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Date Hired</label>
            <input type="date" value={form.date_hired} onChange={(e) => set('date_hired', e.target.value)} className={INPUT} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 font-sans">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium font-sans rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-1.5 text-sm font-semibold font-sans rounded-xl bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Adding…' : 'Add Employee'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delete confirmation modal ──────────────────────────────────────────────────

function DeleteConfirmModal({
  onCancel,
  onConfirm,
  deleting,
}: {
  onCancel: () => void
  onConfirm: () => void
  deleting: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-sm mx-4 p-6 space-y-4">
        <h2 className="font-display text-lg font-semibold text-stone-800">Delete Employee</h2>
        <p className="text-sm text-stone-600 font-sans">This will permanently delete the employee and cannot be undone.</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm font-medium font-sans rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-5 py-1.5 text-sm font-semibold font-sans rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── EmployeesPage ──────────────────────────────────────────────────────────────

type Props = { initialEmployees: Employee[] }

export function EmployeesPage({ initialEmployees }: Props) {
  const gridRef = useRef<AgGridReact<Employee>>(null)
  const timerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const [saving, setSaving] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { selectedCompany } = useCompany()

  const companies = useMemo(
    () => [...new Set(initialEmployees.map((e) => e.company))].sort(),
    [initialEmployees],
  )

  const jobsByCompany = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const e of initialEmployees) {
      if (!map[e.company]) map[e.company] = []
      if (!map[e.company].includes(e.job)) map[e.company].push(e.job)
    }
    for (const company in map) map[company].sort()
    return map
  }, [initialEmployees])

  const companyEmployees = useMemo(
    () => initialEmployees.filter((e) => e.company === selectedCompany),
    [initialEmployees, selectedCompany],
  )

  const handleCellValueChanged = useCallback((params: CellValueChangedEvent<Employee>) => {
    const emp = params.data
    setSaving(true)
    const existing = timerRef.current.get(emp.employee_id)
    if (existing) clearTimeout(existing)
    timerRef.current.set(emp.employee_id, setTimeout(async () => {
      timerRef.current.delete(emp.employee_id)
      await supabase.from('employees').update({
        first_name: emp.first_name,
        middle_name: emp.middle_name || null,
        last_name: emp.last_name,
        company: emp.company,
        job: emp.job,
        daily_salary: emp.daily_salary,
        nightshift: emp.nightshift,
        sss_num: emp.sss_num || null,
        pagibig_num: emp.pagibig_num || null,
        philhealth_num: emp.philhealth_num || null,
        tin_num: emp.tin_num || null,
        birthday: emp.birthday || null,
        date_hired: emp.date_hired || null,
      }).eq('employee_id', emp.employee_id)
      if (timerRef.current.size === 0) setSaving(false)
    }, 500))
  }, [])

  const handleDelete = useCallback(async () => {
    if (confirmDeleteId === null) return
    setDeleting(true)
    const { error } = await supabase.from('employees').delete().eq('employee_id', confirmDeleteId)
    setDeleting(false)
    if (!error) {
      const api = gridRef.current?.api
      const node = api?.getRowNode(String(confirmDeleteId))
      if (node?.data) api?.applyTransaction({ remove: [node.data] })
    }
    setConfirmDeleteId(null)
  }, [confirmDeleteId])

  const handleAdd = useCallback((emp: Employee) => {
    gridRef.current?.api?.applyTransaction({ add: [emp] })
  }, [])

  const DeleteCellRenderer = useCallback(({ data }: { data: Employee }) => (
    <button
      onClick={() => setConfirmDeleteId(data.employee_id)}
      className="text-xs font-medium font-sans text-stone-400 hover:text-red-600 transition-colors h-full flex items-center"
    >
      Delete
    </button>
  ), [])

  const colDefs = useMemo((): ColDef<Employee>[] => [
    {
      field: 'employee_id', headerName: 'ID', width: 70, editable: false,
      cellStyle: { fontFamily: 'monospace', color: '#a8a29e' },
    },
    { field: 'last_name', headerName: 'Last Name', editable: true, flex: 1, minWidth: 120 },
    { field: 'first_name', headerName: 'First Name', editable: true, flex: 1, minWidth: 110 },
    { field: 'job', headerName: 'Job', editable: true, width: 140, cellStyle: { fontFamily: 'monospace' } },
    {
      field: 'daily_salary', headerName: 'Salary', editable: true, width: 110,
      cellDataType: 'number',
      valueFormatter: (p) => p.value != null ? `₱${Number(p.value).toFixed(2)}` : '',
    },
    { field: 'date_hired', headerName: 'Date Hired', editable: true, width: 120 },
    { field: 'sss_num', headerName: 'SSS No.', editable: true, width: 130 },
    { field: 'philhealth_num', headerName: 'PhilHealth No.', editable: true, width: 140 },
    { field: 'pagibig_num', headerName: 'Pag-IBIG No.', editable: true, width: 130 },
    { field: 'tin_num', headerName: 'TIN', editable: true, width: 120 },
    { field: 'birthday', headerName: 'Birthday', editable: true, width: 120 },
    {
      headerName: '', width: 90, editable: false, sortable: false,
      cellRenderer: DeleteCellRenderer,
    },
  ], [DeleteCellRenderer])

  const getRowId = useCallback((params: GetRowIdParams<Employee>) => String(params.data.employee_id), [])

  return (
    <div className="h-[calc(100vh-3rem)] bg-canvas flex flex-col">
      <div className="flex-shrink-0 bg-canvas border-b border-stone-200/60 shadow-sm px-6 py-3 flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-stone-800 tracking-tight">Employees</h1>
        <div className="flex items-center gap-3">
          {saving && <span className="text-stone-400 text-xs font-mono">saving…</span>}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold font-sans rounded-xl bg-stone-800 text-white hover:bg-stone-700 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Employee
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-6 py-4">
        <AgGridReact<Employee>
          ref={gridRef}
          theme={themeQuartz}
          columnDefs={colDefs}
          rowData={companyEmployees}
          rowHeight={42}
          headerHeight={42}
          getRowId={getRowId}
          onCellValueChanged={handleCellValueChanged}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          suppressMovableColumns
          pagination
          paginationPageSize={20}
        />
      </div>

      {showAddModal && (
        <AddEmployeeModal
          defaultCompany={selectedCompany}
          companies={companies}
          jobsByCompany={jobsByCompany}
          onClose={() => setShowAddModal(false)}
          onAdd={handleAdd}
        />
      )}

      {confirmDeleteId !== null && (
        <DeleteConfirmModal
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={handleDelete}
          deleting={deleting}
        />
      )}
    </div>
  )
}
