'use client'

import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast, Toaster } from '@/components/ui/toast'
import { DayPicker } from '@/components/DayPicker'
import { SPREAD_PRODUCT_IDS } from '@/lib/delivery-types'
import type { DeliveryProduct, Customer, Truck } from '@/lib/delivery-types'

type Props = {
  products: DeliveryProduct[]
  trucks: Truck[]
  customers: Customer[]
  initialInventory: Record<string, number>
  initialInventory40x1: Record<string, number>
  initialAvailability: Record<number, boolean>
  initialWarehouse: Record<string, { pickup: number; stock: number }>
  date: string
}

export function InputsPage({
  products,
  trucks,
  customers: initialCustomers,
  initialInventory,
  initialInventory40x1,
  initialAvailability,
  initialWarehouse,
  date,
}: Props) {
  const [tab, setTab] = useState<'daily' | 'orders'>('daily')

  // Daily state
  const [inventory, setInventory] = useState(initialInventory)
  const [inventory40x1, setInventory40x1] = useState(initialInventory40x1)
  const [availability, setAvailability] = useState(initialAvailability)
  const [warehouse, setWarehouse] = useState(initialWarehouse)

  // Order form state
  const [customers, setCustomers] = useState(initialCustomers)
  const [customerId, setCustomerId] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [dateType, setDateType] = useState<'specific' | 'range'>('specific')
  const [deliveryDate, setDeliveryDate] = useState(date)
  const [deliveryDateStart, setDeliveryDateStart] = useState(date)
  const [deliveryDateEnd, setDeliveryDateEnd] = useState(date)
  const [itemAmounts, setItemAmounts] = useState<Record<string, string>>({})
  const [itemEmpako, setItemEmpako] = useState<Record<string, boolean>>({})
  const [orderNotes, setOrderNotes] = useState('')
  const [savingOrder, setSavingOrder] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)

  // Debounce refs
  const inventoryRef = useRef(initialInventory)
  const inventory40x1Ref = useRef(initialInventory40x1)
  const warehouseRef = useRef(initialWarehouse)
  const inventoryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const inventory40x1Timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const warehouseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  // ── Inventory 20x1 ────────────────────────────────────────────────────────────

  function handleInventoryChange(productId: string, raw: string) {
    const val = parseInt(raw) || 0
    inventoryRef.current = { ...inventoryRef.current, [productId]: val }
    setInventory({ ...inventoryRef.current })

    const existing = inventoryTimers.current.get(productId)
    if (existing) clearTimeout(existing)
    inventoryTimers.current.set(productId, setTimeout(() => {
      inventoryTimers.current.delete(productId)
      supabase.from('daily_inventory')
        .upsert({ date, product_id: productId, cases_available: inventoryRef.current[productId] ?? 0, cases_available_40x1: inventory40x1Ref.current[productId] ?? 0 }, { onConflict: 'date,product_id' })
        .then(({ error }) => { if (error) toast('Failed to save inventory', 'error') })
    }, 500))
  }

  // ── Inventory 40x1 ────────────────────────────────────────────────────────────

  function handleInventory40x1Change(productId: string, raw: string) {
    const val = parseInt(raw) || 0
    inventory40x1Ref.current = { ...inventory40x1Ref.current, [productId]: val }
    setInventory40x1({ ...inventory40x1Ref.current })

    const existing = inventory40x1Timers.current.get(productId)
    if (existing) clearTimeout(existing)
    inventory40x1Timers.current.set(productId, setTimeout(() => {
      inventory40x1Timers.current.delete(productId)
      supabase.from('daily_inventory')
        .upsert({ date, product_id: productId, cases_available_40x1: inventory40x1Ref.current[productId] ?? 0, cases_available: inventoryRef.current[productId] ?? 0 }, { onConflict: 'date,product_id' })
        .then(({ error }) => { if (error) toast('Failed to save 40x1 inventory', 'error') })
    }, 500))
  }

  // ── Truck availability ────────────────────────────────────────────────────────

  async function handleAvailabilityToggle(truckId: number) {
    const next = !availability[truckId]
    setAvailability(prev => ({ ...prev, [truckId]: next }))
    const { error } = await supabase.from('truck_availability')
      .upsert({ truck_id: truckId, date, available: next }, { onConflict: 'truck_id,date' })
    if (error) {
      setAvailability(prev => ({ ...prev, [truckId]: !next }))
      toast('Failed to save availability', 'error')
    }
  }

  // ── Warehouse ─────────────────────────────────────────────────────────────────

  function handleWarehouseChange(productId: string, field: 'pickup' | 'stock', raw: string) {
    const val = parseInt(raw) || 0
    const prev = warehouseRef.current[productId] ?? { pickup: 0, stock: 0 }
    const next = { ...prev, [field]: val }
    warehouseRef.current = { ...warehouseRef.current, [productId]: next }
    setWarehouse({ ...warehouseRef.current })

    const existing = warehouseTimers.current.get(productId)
    if (existing) clearTimeout(existing)
    warehouseTimers.current.set(productId, setTimeout(() => {
      warehouseTimers.current.delete(productId)
      const vals = warehouseRef.current[productId] ?? { pickup: 0, stock: 0 }
      supabase.from('warehouse_daily')
        .upsert({ date, product_id: productId, pickup_orders_total: vals.pickup, warehouse_stock: vals.stock }, { onConflict: 'date,product_id' })
        .then(({ error }) => { if (error) toast('Failed to save warehouse data', 'error') })
    }, 500))
  }

  // ── Add customer inline ───────────────────────────────────────────────────────

  async function handleSaveNewCustomer() {
    if (!newCustomerName.trim()) {
      toast('Name is required', 'error')
      return
    }
    setSavingCustomer(true)
    const { data, error } = await supabase.from('customers')
      .insert({ name: newCustomerName.trim(), city: '' })
      .select().single()
    setSavingCustomer(false)
    if (error || !data) { toast('Failed to add customer', 'error'); return }
    const newC = data as Customer
    setCustomers(prev => [...prev, newC].sort((a, b) => a.name.localeCompare(b.name)))
    setCustomerId(String(newC.id))
    setNewCustomerName('')
    toast('Customer added')
  }

  // ── Submit order ──────────────────────────────────────────────────────────────

  async function handleOrderSubmit() {
    const cid = parseInt(customerId)
    if (!cid) { toast('Select a customer', 'error'); return }

    const validItems = products
      .map(p => ({
        productId: p.id,
        cases: parseInt(itemAmounts[p.id] ?? '0') || 0,
        empako: !SPREAD_PRODUCT_IDS.has(p.id) && (itemEmpako[p.id] ?? false),
      }))
      .filter(i => i.cases > 0)
    if (!validItems.length) { toast('Enter at least one item with cases > 0', 'error'); return }

    const dateStart = dateType === 'specific' ? deliveryDate : deliveryDateStart
    const dateEnd   = dateType === 'specific' ? deliveryDate : deliveryDateEnd
    if (dateStart > dateEnd) { toast('End date must be on or after start date', 'error'); return }

    setSavingOrder(true)
    const { data: order, error: orderErr } = await supabase.from('orders')
      .insert({
        customer_id: cid,
        order_date: new Date().toLocaleDateString('en-CA'),
        delivery_date_start: dateStart,
        delivery_date_end: dateEnd,
        status: 'open',
        notes: orderNotes.trim() || null,
      })
      .select().single()
    if (orderErr || !order) { setSavingOrder(false); toast('Failed to create order', 'error'); return }

    const { error: itemsErr } = await supabase.from('order_items').insert(
      validItems.map(i => ({ order_id: order.id, product_id: i.productId, cases: i.cases, empako: i.empako }))
    )
    setSavingOrder(false)
    if (itemsErr) { toast('Order created but items failed to save', 'error'); return }

    toast('Order saved')
    setCustomerId('')
    setItemAmounts({})
    setItemEmpako({})
    setOrderNotes('')
    setDateType('specific')
    setDeliveryDate(date)
    setDeliveryDateStart(date)
    setDeliveryDateEnd(date)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const totalOrderCases = products.reduce((s, p) => s + (parseInt(itemAmounts[p.id] ?? '0') || 0), 0)

  return (
    <div className="min-h-screen bg-canvas">
      <Toaster />

      {/* Header */}
      <div className="sticky top-12 z-30 bg-canvas border-b border-stone-200/60 shadow-sm">
        <div className="px-6 py-3 flex items-center justify-between">
          <h1 className="font-display text-xl font-semibold text-stone-800 tracking-tight">Delivery Inputs</h1>
          {tab === 'daily' && <DayPicker date={date} />}
        </div>
        {/* Tabs */}
        <div className="flex px-6 gap-1 -mb-px">
          {(['daily', 'orders'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium font-sans border-b-2 transition-colors capitalize',
                tab === t
                  ? 'border-stone-700 text-stone-800'
                  : 'border-transparent text-stone-400 hover:text-stone-600',
              )}
            >
              {t === 'daily' ? 'Daily Inputs' : 'New Order'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Daily Inputs tab ── */}
      {tab === 'daily' && (
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">

          {/* Daily Inventory */}
          <section>
            <SectionHeading>Daily Inventory</SectionHeading>
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
              <div className="grid grid-cols-[1fr_140px_140px] px-5 py-2 border-b border-stone-50 text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans gap-3">
                <span>Product</span>
                <span className="text-right">40x1 Cases</span>
                <span className="text-right">20x1 Cases</span>
              </div>
              {products.map(p => (
                <div key={p.id} className="grid grid-cols-[1fr_140px_140px] items-center px-5 py-3 border-b border-stone-50 last:border-0 gap-3">
                  <span className="text-sm font-sans text-stone-700">{p.name}</span>
                  {SPREAD_PRODUCT_IDS.has(p.id) ? (
                    <div className="w-full px-3 py-1.5 text-sm font-mono text-right text-stone-300 border border-stone-100 rounded-lg bg-stone-50 select-none">
                      —
                    </div>
                  ) : (
                    <input
                      type="number" min={0}
                      value={inventory40x1[p.id] ?? 0}
                      onChange={e => handleInventory40x1Change(p.id, e.target.value)}
                      className="w-full px-3 py-1.5 text-sm font-mono text-right border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
                    />
                  )}
                  <input
                    type="number" min={0}
                    value={inventory[p.id] ?? 0}
                    onChange={e => handleInventoryChange(p.id, e.target.value)}
                    className="w-full px-3 py-1.5 text-sm font-mono text-right border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
                  />
                </div>
              ))}
              {products.length === 0 && (
                <div className="text-center py-10 text-stone-300 font-sans text-sm">No products found.</div>
              )}
            </div>
          </section>

          {/* Truck Availability */}
          <section>
            <SectionHeading>Truck Availability</SectionHeading>
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden divide-y divide-stone-50">
              {trucks.map(truck => {
                const isAvailable = availability[truck.id] ?? false
                return (
                  <div key={truck.id} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm font-sans text-stone-700">{truck.name}</span>
                    <button
                      onClick={() => handleAvailabilityToggle(truck.id)}
                      className={cn(
                        'px-4 py-1.5 rounded-lg text-xs font-semibold font-sans transition-colors',
                        isAvailable
                          ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                          : 'bg-stone-100 text-stone-400 hover:bg-stone-200 hover:text-stone-600',
                      )}
                    >
                      {isAvailable ? 'Available' : 'Unavailable'}
                    </button>
                  </div>
                )
              })}
              {trucks.length === 0 && (
                <div className="text-center py-10 text-stone-300 font-sans text-sm">No trucks configured.</div>
              )}
            </div>
          </section>

          {/* Warehouse */}
          <section>
            <SectionHeading>Warehouse</SectionHeading>
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
              <div className="grid grid-cols-[1fr_120px_120px_80px] px-5 py-2 border-b border-stone-50 text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans gap-3">
                <span>Product</span>
                <span className="text-right">Pickup Orders</span>
                <span className="text-right">Warehouse Stock</span>
                <span className="text-right">Needed</span>
              </div>
              {products.map(p => {
                const w = warehouse[p.id] ?? { pickup: 0, stock: 0 }
                const needed = Math.max(0, w.pickup - w.stock)
                return (
                  <div key={p.id} className="grid grid-cols-[1fr_120px_120px_80px] items-center px-5 py-3 border-b border-stone-50 last:border-0 gap-3">
                    <span className="text-sm font-sans text-stone-700">{p.name}</span>
                    <input
                      type="number" min={0} value={w.pickup}
                      onChange={e => handleWarehouseChange(p.id, 'pickup', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm font-mono text-right border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
                    />
                    <input
                      type="number" min={0} value={w.stock}
                      onChange={e => handleWarehouseChange(p.id, 'stock', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm font-mono text-right border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
                    />
                    <div className={cn('text-right font-mono font-semibold text-sm', needed > 0 ? 'text-red-600' : 'text-stone-300')}>
                      {needed > 0 ? needed : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

        </div>
      )}

      {/* ── New Order tab ── */}
      {tab === 'orders' && (
        <div className="max-w-2xl mx-auto px-6 py-8">
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 space-y-5">

            {/* Customer */}
            <FormRow label="Customer">
              <div className="space-y-2">
                <select
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white text-stone-700"
                >
                  <option value="">Select customer…</option>
                  {customers.map(c => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                  <option value="new">+ Add new customer…</option>
                </select>
                {customerId === 'new' && (
                  <div className="flex gap-2">
                    <input
                      type="text" placeholder="Customer name"
                      value={newCustomerName}
                      onChange={e => setNewCustomerName(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
                    />
                    <button
                      onClick={handleSaveNewCustomer} disabled={savingCustomer}
                      className="px-3 py-1.5 text-xs font-semibold font-sans rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {savingCustomer ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            </FormRow>

            {/* Delivery date */}
            <FormRow label="Delivery date">
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl
                  options={[{ value: 'specific', label: 'Specific' }, { value: 'range', label: 'Range' }]}
                  value={dateType}
                  onChange={v => setDateType(v as 'specific' | 'range')}
                />
                {dateType === 'specific' ? (
                  <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                    className="px-3 py-1.5 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300" />
                ) : (
                  <div className="flex items-center gap-2">
                    <input type="date" value={deliveryDateStart} onChange={e => setDeliveryDateStart(e.target.value)}
                      className="px-3 py-1.5 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300" />
                    <span className="text-stone-400 text-xs font-sans">to</span>
                    <input type="date" value={deliveryDateEnd} onChange={e => setDeliveryDateEnd(e.target.value)}
                      className="px-3 py-1.5 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300" />
                  </div>
                )}
              </div>
            </FormRow>

            {/* Items */}
            <div>
              <div className="text-sm font-sans text-stone-500 mb-2">Items</div>
              <div className="border border-stone-100 rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_44px_100px] px-4 py-2 bg-stone-50 border-b border-stone-100 text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans gap-2">
                  <span>Product</span>
                  <span className="text-center">40x1</span>
                  <span className="text-right">Cases</span>
                </div>
                {products.map(p => {
                  const val = itemAmounts[p.id] ?? '0'
                  const isSet = (parseInt(val) || 0) > 0
                  const isSpread = SPREAD_PRODUCT_IDS.has(p.id)
                  const isEmpako = !isSpread && (itemEmpako[p.id] ?? false)
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'grid grid-cols-[1fr_44px_100px] items-center px-4 py-2.5 border-b border-stone-50 last:border-0 gap-2',
                        isSet && (isEmpako ? 'bg-amber-50/40' : 'bg-emerald-50/40'),
                      )}
                    >
                      <span className={cn('text-sm font-sans', isSet ? 'text-stone-800 font-medium' : 'text-stone-500')}>
                        {p.name}
                      </span>
                      <div className="flex justify-center">
                        {isSpread ? (
                          <span className="text-stone-200 text-xs font-sans">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isEmpako}
                            onChange={e => setItemEmpako(prev => ({ ...prev, [p.id]: e.target.checked }))}
                            className="w-4 h-4 rounded accent-amber-600 cursor-pointer"
                          />
                        )}
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={val}
                        onChange={e => setItemAmounts(prev => ({ ...prev, [p.id]: e.target.value }))}
                        onFocus={e => e.target.select()}
                        className={cn(
                          'w-full px-3 py-1 text-sm font-mono text-right border rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 [appearance:auto]',
                          isSet
                            ? isEmpako
                              ? 'border-amber-200 bg-white'
                              : 'border-emerald-200 bg-white'
                            : 'border-stone-200',
                        )}
                      />
                    </div>
                  )
                })}
              </div>
              {totalOrderCases > 0 && (
                <p className="text-xs font-mono text-stone-400 text-right mt-1.5 tabular-nums">
                  {totalOrderCases} cases total
                </p>
              )}
            </div>

            {/* Notes */}
            <FormRow label="Notes" alignStart>
              <textarea
                value={orderNotes}
                onChange={e => setOrderNotes(e.target.value)}
                rows={2} placeholder="Optional…"
                className="w-full px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 resize-none"
              />
            </FormRow>

            <div className="flex justify-end pt-1">
              <button
                onClick={handleOrderSubmit} disabled={savingOrder}
                className="px-5 py-2 text-sm font-semibold font-sans rounded-xl bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
              >
                {savingOrder ? 'Saving…' : 'Save Order'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-base font-semibold text-stone-700 mb-3">{children}</h2>
}

function FormRow({ label, children, alignStart = false }: { label: string; children: React.ReactNode; alignStart?: boolean }) {
  return (
    <div className={cn('grid gap-4 grid-cols-[130px_1fr]', alignStart ? 'items-start' : 'items-center')}>
      <label className={cn('text-sm font-sans text-stone-500', alignStart && 'pt-2')}>{label}</label>
      <div>{children}</div>
    </div>
  )
}

function SegmentedControl({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex rounded-lg border border-stone-200 overflow-hidden w-fit text-xs font-sans">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1.5 font-medium transition-colors',
            value === opt.value ? 'bg-stone-800 text-white' : 'text-stone-500 hover:bg-stone-50',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
