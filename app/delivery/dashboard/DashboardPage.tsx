'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast, Toaster } from '@/components/ui/toast'
import { DayPicker } from '@/components/DayPicker'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { getOrderRemaining, type OrderRemaining } from '@/lib/delivery-remaining'
import type { DeliveryProduct, Customer, Truck, Order, OrderItem, Delivery, DeliveryItem, WarehouseDrop } from '@/lib/delivery-types'
import { getProductAbbr, SPREAD_PRODUCT_IDS } from '@/lib/delivery-types'

// ── Types ─────────────────────────────────────────────────────────────────────

type TruckStop = {
  deliveryId: number           // negative (−truckId) for warehouse stops
  orderId: number | null       // null for warehouse stops
  stopOrder: number
  items: { productId: string; cases: number }[]
  finalized: boolean
  isWarehouseDrop?: boolean
}

type Props = {
  products: DeliveryProduct[]
  trucks: Truck[]
  customers: Customer[]
  orders: Order[]
  orderItems: OrderItem[]
  deliveries: Delivery[]
  deliveryItems: DeliveryItem[]
  allOrderDeliveries: Delivery[]
  allOrderDeliveryItems: DeliveryItem[]
  inventory: Record<string, number>
  inventory40x1: Record<string, number>
  warehouse: Record<string, { pickup: number; stock: number }>
  warehouseDrops: WarehouseDrop[]
  date: string
}

// ── Product abbreviations (for compact table headers) ────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildInitialStops(
  deliveries: Delivery[],
  deliveryItems: DeliveryItem[],
  trucks: Truck[],
  warehouseDrops: WarehouseDrop[],
): Map<number, TruckStop[]> {
  const truckIds = new Set(trucks.map(t => t.id))

  const itemsByDelivery: Record<number, TruckStop['items']> = {}
  for (const di of deliveryItems) {
    if (!itemsByDelivery[di.delivery_id]) itemsByDelivery[di.delivery_id] = []
    itemsByDelivery[di.delivery_id].push({ productId: di.product_id, cases: di.cases })
  }

  const map = new Map<number, TruckStop[]>()
  for (const t of trucks) map.set(t.id, [])

  for (const d of deliveries) {
    if (!truckIds.has(d.truck_id)) continue
    const arr = map.get(d.truck_id) ?? []
    arr.push({
      deliveryId: d.id,
      orderId: d.order_id,
      stopOrder: d.stop_order,
      items: itemsByDelivery[d.id] ?? [],
      finalized: d.finalized,
    })
    map.set(d.truck_id, arr)
  }

  // Group warehouse drops by truck and append as a virtual stop (deliveryId = -truckId)
  const dropsByTruck: Record<number, WarehouseDrop[]> = {}
  for (const d of warehouseDrops) {
    if (!dropsByTruck[d.truck_id]) dropsByTruck[d.truck_id] = []
    dropsByTruck[d.truck_id].push(d)
  }

  for (const [id, arr] of map) {
    arr.sort((a, b) => a.stopOrder - b.stopOrder)
    const drops = dropsByTruck[id]
    if (drops && drops.length > 0) {
      arr.push({
        deliveryId: -id,
        orderId: null,
        stopOrder: drops[0].stop_order,  // all rows for same truck/date share stop_order
        items: drops.map(d => ({ productId: d.product_id, cases: d.cases })),
        finalized: false,
        isWarehouseDrop: true,
      })
      arr.sort((a, b) => a.stopOrder - b.stopOrder)
    }
    map.set(id, arr)
  }

  return map
}

function itemSummary(items: TruckStop['items'], productById: Map<string, DeliveryProduct>): string {
  if (!items.length) return '—'
  return [...items]
    .sort((a, b) => (productById.get(a.productId)?.display_order ?? 999) - (productById.get(b.productId)?.display_order ?? 999))
    .map(i => `${getProductAbbr({ id: i.productId, name: productById.get(i.productId)?.name ?? i.productId })} ×${i.cases}`)
    .join(', ')
}

function ItemMiniTable({ items, productById }: {
  items: { productId: string; cases: number }[]
  productById: Map<string, DeliveryProduct>
}) {
  const sorted = [...items]
    .filter(i => i.cases > 0)
    .sort((a, b) => (productById.get(a.productId)?.display_order ?? 999) - (productById.get(b.productId)?.display_order ?? 999))
  if (!sorted.length) return <span className="text-xs text-stone-300 font-sans">—</span>
  return (
    <table className="text-[10px] font-sans mt-1">
      <thead>
        <tr>
          {sorted.map(i => (
            <th key={i.productId} className="pr-2.5 last:pr-0 text-right font-medium text-stone-300 whitespace-nowrap pb-0.5">
              {getProductAbbr({ id: i.productId, name: productById.get(i.productId)?.name ?? i.productId })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {sorted.map(i => (
            <td key={i.productId} className="pr-2.5 last:pr-0 text-right font-mono tabular-nums text-stone-600 font-semibold">
              {i.cases}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

function orderDateLabel(order: Order, viewingDate: string): string {
  const { delivery_date_start: s, delivery_date_end: e } = order
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (s === e) {
    if (s === viewingDate) return 'Due today'
    return `Due ${fmt(s)}`
  }
  return `${fmt(s)} – ${fmt(e)}`
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DashboardPage({
  products, trucks, customers, orders, orderItems,
  deliveries, deliveryItems, allOrderDeliveries, allOrderDeliveryItems,
  inventory, inventory40x1, warehouse, warehouseDrops, date,
}: Props) {
  const initialStops = useMemo(() => buildInitialStops(deliveries, deliveryItems, trucks, warehouseDrops), [])

  const [stops, setStops] = useState<Map<number, TruckStop[]>>(initialStops)
  const stopsRef = useRef<Map<number, TruckStop[]>>(initialStops)
  const [localOrderItems, setLocalOrderItems] = useState<OrderItem[]>(orderItems)
  const localOrderItemsRef = useRef<OrderItem[]>(orderItems)
  const [localAllDeliveries, setLocalAllDeliveries] = useState<Delivery[]>(allOrderDeliveries)
  const [localAllDeliveryItems, setLocalAllDeliveryItems] = useState<DeliveryItem[]>(allOrderDeliveryItems)
  const [selectedTruckId, setSelectedTruckId] = useState<number | null>(trucks[0]?.id ?? null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [partialDialog, setPartialDialog] = useState<{
    open: boolean
    orderId: number | null
    truckId: number | null
  }>({ open: false, orderId: null, truckId: null })
  const [warehouseDropDialog, setWarehouseDropDialog] = useState<{
    open: boolean
    truckId: number | null
  }>({ open: false, truckId: null })
  const [localWarehouseDrops, setLocalWarehouseDrops] = useState<WarehouseDrop[]>(warehouseDrops)
  const [warehouseOpen, setWarehouseOpen] = useState(false)

  const [localInventory, setLocalInventory] = useState<Record<string, number>>(inventory)
  const localInventoryRef = useRef<Record<string, number>>(inventory)
  const inventoryEditTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(null)
  const [editInventoryValue, setEditInventoryValue] = useState('')

  const [localInventory40x1, setLocalInventory40x1] = useState<Record<string, number>>(inventory40x1)
  const localInventory40x1Ref = useRef<Record<string, number>>(inventory40x1)
  const inventory40x1EditTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [editingInventory40x1Id, setEditingInventory40x1Id] = useState<string | null>(null)
  const [editInventory40x1Value, setEditInventory40x1Value] = useState('')
  const [convertDialogOpen, setConvertDialogOpen] = useState(false)
  const [convertAmounts, setConvertAmounts] = useState<Record<string, string>>({})

  const [empakaByOrder, setEmpakaByOrder] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    for (const o of orders) init[o.id] = o.empaka_note ?? ''
    return init
  })
  const empakaTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const [localWarehouse, setLocalWarehouse] = useState(warehouse)
  const localWarehouseRef = useRef(warehouse)
  const warehouseEditTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [editingWarehouseCell, setEditingWarehouseCell] = useState<{ productId: string; field: 'pickup' | 'stock' } | null>(null)
  const [editWarehouseValue, setEditWarehouseValue] = useState('')

  function mutStops(fn: (prev: Map<number, TruckStop[]>) => Map<number, TruckStop[]>) {
    setStops(prev => {
      const next = fn(prev)
      stopsRef.current = next
      return next
    })
  }

  function syncLocalOrderItems(fn: (prev: OrderItem[]) => OrderItem[]) {
    setLocalOrderItems(prev => {
      const next = fn(prev)
      localOrderItemsRef.current = next
      return next
    })
  }

  // ── Lookup maps ───────────────────────────────────────────────────────────

  const customerById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers])
  const productById  = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const orderById    = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders])
  const truckById    = useMemo(() => new Map(trucks.map(t => [t.id, t])), [trucks])

  const orderItemsByOrder = useMemo(() => {
    const m: Record<number, OrderItem[]> = {}
    for (const i of localOrderItems) {
      if (!m[i.order_id]) m[i.order_id] = []
      m[i.order_id].push(i)
    }
    return m
  }, [localOrderItems])

  // ── Remaining (partial delivery) ─────────────────────────────────────────

  const orderRemainingMap = useMemo(() => {
    const map = new Map<number, OrderRemaining>()
    for (const order of orders) {
      const items = orderItemsByOrder[order.id] ?? []
      map.set(order.id, getOrderRemaining(order.id, items, localAllDeliveries, localAllDeliveryItems))
    }
    return map
  }, [orders, orderItemsByOrder, localAllDeliveries, localAllDeliveryItems])

  // ── Inventory / capacity ──────────────────────────────────────────────────

  const inventoryDisplayProducts = products

  const assignedByProduct = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const arr of stops.values()) {
      for (const stop of arr) {
        const ois = stop.orderId ? (orderItemsByOrder[stop.orderId] ?? []) : []
        for (const item of stop.items) {
          const isEmpako = !SPREAD_PRODUCT_IDS.has(item.productId) &&
            (ois.find(i => i.product_id === item.productId)?.empako ?? false)
          acc[item.productId] = (acc[item.productId] ?? 0) + (isEmpako ? item.cases * 2 : item.cases)
        }
      }
    }
    return acc
  }, [stops, orderItemsByOrder])

  const remainingInventory = useMemo((): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const p of inventoryDisplayProducts) {
      out[p.id] = (localInventory[p.id] ?? 0) - (assignedByProduct[p.id] ?? 0)
    }
    return out
  }, [inventoryDisplayProducts, assignedByProduct, localInventory])

  const truckLoads = useMemo((): Record<number, number> => {
    const out: Record<number, number> = {}
    for (const [tid, arr] of stops) {
      let load = 0
      for (const stop of arr) {
        const ois = stop.orderId ? (orderItemsByOrder[stop.orderId] ?? []) : []
        for (const item of stop.items) {
          const isEmpako = !SPREAD_PRODUCT_IDS.has(item.productId) &&
            (ois.find(i => i.product_id === item.productId)?.empako ?? false)
          load += isEmpako ? item.cases * 2 : item.cases
        }
      }
      out[tid] = load
    }
    return out
  }, [stops, orderItemsByOrder])

  const truckProductTotals = useMemo((): Record<number, Record<string, number>> => {
    const out: Record<number, Record<string, number>> = {}
    for (const [tid, arr] of stops) {
      const acc: Record<string, number> = {}
      for (const stop of arr) {
        const ois = stop.orderId ? (orderItemsByOrder[stop.orderId] ?? []) : []
        for (const item of stop.items) {
          const isEmpako = !SPREAD_PRODUCT_IDS.has(item.productId) &&
            (ois.find(i => i.product_id === item.productId)?.empako ?? false)
          acc[item.productId] = (acc[item.productId] ?? 0) + (isEmpako ? item.cases * 2 : item.cases)
        }
      }
      out[tid] = acc
    }
    return out
  }, [stops, orderItemsByOrder])

  // Cases being dropped at the warehouse today, per product (across all trucks)
  const dropsByProduct = useMemo((): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const d of localWarehouseDrops) {
      out[d.product_id] = (out[d.product_id] ?? 0) + d.cases
    }
    return out
  }, [localWarehouseDrops])

  const fulfilledOrders = useMemo(
    () => orders.filter(o => {
      const rem = orderRemainingMap.get(o.id)
      return rem && rem.totalOrdered > 0 && rem.totalRemaining === 0
    }),
    [orders, orderRemainingMap],
  )

  // ── Unassigned orders ─────────────────────────────────────────────────────

  const unassigned = useMemo(
    () => orders.filter(o => {
      const rem = orderRemainingMap.get(o.id)
      // Orders with no items (totalOrdered=0) are data-entry incomplete — surface them here
      if (!rem || rem.totalOrdered === 0) return true
      return rem.totalRemaining > 0
    }),
    [orders, orderRemainingMap],
  )

  const sortedUnassigned = useMemo(() => {
    const overdue: Order[] = [], todayExact: Order[] = [], todayRange: Order[] = [], future: Order[] = []
    for (const o of unassigned) {
      const s = o.delivery_date_start, e = o.delivery_date_end
      if (e < date) overdue.push(o)
      else if (s === date && e === date) todayExact.push(o)
      else if (s <= date && e >= date) todayRange.push(o)
      else future.push(o)
    }
    overdue.sort((a, b) => a.delivery_date_end.localeCompare(b.delivery_date_end))
    future.sort((a, b) => a.delivery_date_start.localeCompare(b.delivery_date_start))
    return { overdue, todayExact, todayRange, future }
  }, [unassigned, date])

  const [activeTab, setActiveTab] = useState<'orders' | 'fulfilled'>('orders')

  // ── Edit order items ──────────────────────────────────────────────────────

  const handleUpdateSingleOrderItem = useCallback(async (
    orderId: number,
    productId: string,
    cases: number,
  ) => {
    const currentEmpako = localOrderItemsRef.current.find(
      i => i.order_id === orderId && i.product_id === productId,
    )?.empako ?? false

    syncLocalOrderItems(prev => {
      const without = prev.filter(i => !(i.order_id === orderId && i.product_id === productId))
      if (cases <= 0) return without
      return [...without, { id: -Date.now(), order_id: orderId, product_id: productId, cases, empako: currentEmpako }]
    })
    await supabase.from('order_items').delete().eq('order_id', orderId).eq('product_id', productId)
    if (cases > 0) {
      const { error } = await supabase.from('order_items').insert({ order_id: orderId, product_id: productId, cases, empako: currentEmpako })
      if (error) toast('Failed to save item', 'error')
    }
  }, [])

  async function handleToggleOrderItemEmpako(orderId: number, productId: string, empako: boolean) {
    syncLocalOrderItems(prev => prev.map(i =>
      i.order_id === orderId && i.product_id === productId ? { ...i, empako } : i
    ))
    const { error } = await supabase.from('order_items')
      .update({ empako })
      .eq('order_id', orderId)
      .eq('product_id', productId)
    if (error) toast('Failed to save 40x1', 'error')
  }

  // ── Inventory / warehouse sidebar editing ─────────────────────────────────

  function handleInventoryEdit(productId: string, raw: string) {
    const val = parseInt(raw) || 0
    localInventoryRef.current = { ...localInventoryRef.current, [productId]: val }
    setLocalInventory({ ...localInventoryRef.current })
    const existing = inventoryEditTimers.current.get(productId)
    if (existing) clearTimeout(existing)
    inventoryEditTimers.current.set(productId, setTimeout(() => {
      inventoryEditTimers.current.delete(productId)
      supabase.from('daily_inventory')
        .upsert({ date, product_id: productId, cases_available: localInventoryRef.current[productId] ?? 0, cases_available_40x1: localInventory40x1Ref.current[productId] ?? 0 }, { onConflict: 'date,product_id' })
        .then(({ error }) => { if (error) toast('Failed to save inventory', 'error') })
    }, 500))
  }

  function handleInventory40x1Edit(productId: string, raw: string) {
    const val = parseInt(raw) || 0
    localInventory40x1Ref.current = { ...localInventory40x1Ref.current, [productId]: val }
    setLocalInventory40x1({ ...localInventory40x1Ref.current })
    const existing = inventory40x1EditTimers.current.get(productId)
    if (existing) clearTimeout(existing)
    inventory40x1EditTimers.current.set(productId, setTimeout(() => {
      inventory40x1EditTimers.current.delete(productId)
      supabase.from('daily_inventory')
        .upsert({ date, product_id: productId, cases_available_40x1: localInventory40x1Ref.current[productId] ?? 0, cases_available: localInventoryRef.current[productId] ?? 0 }, { onConflict: 'date,product_id' })
        .then(({ error }) => { if (error) toast('Failed to save 40x1 inventory', 'error') })
    }, 500))
  }

  async function handleBatchConvert40x1(amounts: Record<string, string>) {
    const newInv = { ...localInventoryRef.current }
    const newInv40 = { ...localInventory40x1Ref.current }
    const toSave: { productId: string; new20x1: number; new40x1: number }[] = []

    for (const [productId, raw] of Object.entries(amounts)) {
      const amount = parseInt(raw) || 0
      if (amount <= 0) continue
      const current40x1 = newInv40[productId] ?? 0
      const safe = Math.min(amount, current40x1)
      if (safe <= 0) continue
      newInv40[productId] = current40x1 - safe
      newInv[productId] = (newInv[productId] ?? 0) + safe * 2
      toSave.push({ productId, new20x1: newInv[productId], new40x1: newInv40[productId] })
    }

    if (toSave.length === 0) { toast('Nothing to convert', 'error'); return }

    localInventoryRef.current = newInv
    localInventory40x1Ref.current = newInv40
    setLocalInventory({ ...newInv })
    setLocalInventory40x1({ ...newInv40 })

    await Promise.all(toSave.map(({ productId, new20x1, new40x1 }) =>
      supabase.from('daily_inventory')
        .upsert({ date, product_id: productId, cases_available: new20x1, cases_available_40x1: new40x1 }, { onConflict: 'date,product_id' })
        .then(({ error }) => { if (error) toast('Failed to convert cases', 'error') })
    ))
    toast(`Converted 40x1 → 20x1`)
    setConvertDialogOpen(false)
  }

  function handleEmpakaChange(orderId: number, text: string) {
    setEmpakaByOrder(prev => ({ ...prev, [orderId]: text }))
    const existing = empakaTimers.current.get(orderId)
    if (existing) clearTimeout(existing)
    empakaTimers.current.set(orderId, setTimeout(() => {
      empakaTimers.current.delete(orderId)
      supabase.from('orders').update({ empaka_note: text || null }).eq('id', orderId)
        .then(({ error }) => { if (error) toast('Failed to save empaka note', 'error') })
    }, 800))
  }

  function handleWarehouseEdit(productId: string, field: 'pickup' | 'stock', raw: string) {
    const val = parseInt(raw) || 0
    const prev = localWarehouseRef.current[productId] ?? { pickup: 0, stock: 0 }
    const next = { ...prev, [field]: val }
    localWarehouseRef.current = { ...localWarehouseRef.current, [productId]: next }
    setLocalWarehouse({ ...localWarehouseRef.current })
    const existing = warehouseEditTimers.current.get(productId)
    if (existing) clearTimeout(existing)
    warehouseEditTimers.current.set(productId, setTimeout(() => {
      warehouseEditTimers.current.delete(productId)
      const vals = localWarehouseRef.current[productId] ?? { pickup: 0, stock: 0 }
      supabase.from('warehouse_daily')
        .upsert({ date, product_id: productId, pickup_orders_total: vals.pickup, warehouse_stock: vals.stock }, { onConflict: 'date,product_id' })
        .then(({ error }) => { if (error) toast('Failed to save warehouse', 'error') })
    }, 500))
  }

  // ── Shared inventory/capacity validation ──────────────────────────────────

  function validateItems(
    items: { productId: string; cases: number; empako?: boolean }[],
    truckId: number,
  ): boolean {
    // Current 20x1-equivalent assigned across all stops (empako counts ×2)
    const currentAssigned: Record<string, number> = {}
    for (const arr of stopsRef.current.values()) {
      for (const stop of arr) {
        const ois = stop.orderId ? (orderItemsByOrder[stop.orderId] ?? []) : []
        for (const item of stop.items) {
          const isEmpako = !SPREAD_PRODUCT_IDS.has(item.productId) &&
            (ois.find(i => i.product_id === item.productId)?.empako ?? false)
          currentAssigned[item.productId] = (currentAssigned[item.productId] ?? 0) +
            (isEmpako ? item.cases * 2 : item.cases)
        }
      }
    }

    // How much 20x1 inventory the new items need (empako counts ×2)
    const itemSum: Record<string, number> = {}
    for (const i of items) {
      const impact = (!SPREAD_PRODUCT_IDS.has(i.productId) && i.empako) ? i.cases * 2 : i.cases
      itemSum[i.productId] = (itemSum[i.productId] ?? 0) + impact
    }

    for (const [productId, needed] of Object.entries(itemSum)) {
      const available = (localInventoryRef.current[productId] ?? 0) - (currentAssigned[productId] ?? 0)
      if (available < needed) {
        toast(`Not enough ${productById.get(productId)?.name ?? productId}`, 'error')
        return false
      }
    }

    return true
  }

  // ── Create delivery (shared by both drag and partial dialog) ─────────────

  async function createDelivery(
    orderId: number,
    truckId: number,
    items: { productId: string; cases: number }[],
  ): Promise<boolean> {
    const stopOrder = (stopsRef.current.get(truckId)?.length ?? 0) + 1

    const { data: delivery, error: dErr } = await supabase
      .from('deliveries')
      .insert({ order_id: orderId, truck_id: truckId, delivery_date: date, stop_order: stopOrder, finalized: false })
      .select()
      .single()
    if (dErr || !delivery) { toast('Failed to create delivery', 'error'); return false }

    const { error: iErr } = await supabase.from('delivery_items').insert(
      items.map(i => ({ delivery_id: delivery.id, product_id: i.productId, cases: i.cases })),
    )
    if (iErr) toast('Delivery saved but items failed — refresh to sync', 'error')

    const typedDelivery = delivery as Delivery

    mutStops(prev => {
      const next = new Map(prev)
      const arr = [...(next.get(truckId) ?? [])]
      arr.push({
        deliveryId: delivery.id,
        orderId,
        stopOrder,
        items: items.map(i => ({ productId: i.productId, cases: i.cases })),
        finalized: false,
      })
      next.set(truckId, arr)
      return next
    })

    setLocalAllDeliveries(prev => [...prev, typedDelivery])
    setLocalAllDeliveryItems(prev => [
      ...prev,
      ...items.map((item, i) => ({
        id: -(Date.now() + i + 1),
        delivery_id: delivery.id,
        product_id: item.productId,
        cases: item.cases,
      } as DeliveryItem)),
    ])

    return true
  }

  // ── Assign order to truck (drag → all remaining) ──────────────────────────

  const assignOrderToTruck = useCallback(async (orderId: number, truckId: number) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return

    const orderItemsForOrder = orderItemsByOrder[orderId] ?? []
    const empakoByProduct: Record<string, boolean> = {}
    for (const oi of orderItemsForOrder) empakoByProduct[oi.product_id] = oi.empako ?? false

    const rem = orderRemainingMap.get(orderId)
    const items: { productId: string; cases: number; empako?: boolean }[] = rem
      ? Object.entries(rem.byItem)
          .filter(([, v]) => v.remaining > 0)
          .map(([productId, v]) => ({ productId, cases: v.remaining, empako: empakoByProduct[productId] ?? false }))
      : orderItemsForOrder.map(i => ({ productId: i.product_id, cases: i.cases, empako: i.empako ?? false }))

    if (!items.length) {
      toast('No items remaining for this order', 'error')
      return
    }

    if (!validateItems(items, truckId)) return

    const truck = trucks.find(t => t.id === truckId)
    const ok = await createDelivery(orderId, truckId, items.map(i => ({ productId: i.productId, cases: i.cases })))
    if (!ok) return

    setSelectedTruckId(truckId)
    toast(`Assigned to ${truck?.name ?? 'truck'}`)
  }, [orders, orderRemainingMap, orderItemsByOrder, trucks, inventory, productById, date])

  // ── Partial delivery (dialog → custom amounts) ────────────────────────────

  const assignPartialDelivery = useCallback(async (
    orderId: number,
    truckId: number,
    items: { productId: string; cases: number }[],
  ) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return

    const orderItemsForOrder = orderItemsByOrder[orderId] ?? []
    const itemsWithEmpako = items.map(i => ({
      ...i,
      empako: orderItemsForOrder.find(oi => oi.product_id === i.productId)?.empako ?? false,
    }))

    if (!validateItems(itemsWithEmpako, truckId)) return

    const truck = trucks.find(t => t.id === truckId)
    const ok = await createDelivery(orderId, truckId, items)
    if (!ok) return

    setSelectedTruckId(truckId)
    toast(`Partial delivery created for ${truck?.name ?? 'truck'}`)
  }, [orders, orderRemainingMap, orderItemsByOrder, trucks, inventory, productById, date])

  // ── Warehouse drops ───────────────────────────────────────────────────────

  const handleCreateWarehouseDrop = useCallback(async (
    truckId: number,
    items: { productId: string; cases: number }[],
  ) => {
    // Inventory check — stopsRef.current is always fresh; inventory/productById are stable server props
    const currentAssigned: Record<string, number> = {}
    for (const arr of stopsRef.current.values()) {
      for (const stop of arr) {
        for (const item of stop.items) {
          currentAssigned[item.productId] = (currentAssigned[item.productId] ?? 0) + item.cases
        }
      }
    }
    for (const item of items) {
      const available = (inventory[item.productId] ?? 0) - (currentAssigned[item.productId] ?? 0)
      if (available < item.cases) {
        toast(`Not enough ${productById.get(item.productId)?.name ?? item.productId} in inventory`, 'error')
        return
      }
    }

    const toInsert: { productId: string; cases: number }[] = []
    const toUpdate: { id: number; newCases: number }[] = []

    for (const item of items) {
      const existing = localWarehouseDrops.find(
        d => d.truck_id === truckId && d.product_id === item.productId,
      )
      if (existing) {
        toUpdate.push({ id: existing.id, newCases: existing.cases + item.cases })
      } else {
        toInsert.push(item)
      }
    }

    for (const u of toUpdate) {
      const { error } = await supabase.from('warehouse_drops').update({ cases: u.newCases }).eq('id', u.id)
      if (error) { toast(`Failed to update warehouse drop: ${error.message}`, 'error'); return }
    }

    // Compute stop_order for new warehouse stop (end of current list)
    const currentStops = stopsRef.current.get(truckId) ?? []
    const maxOrder = currentStops.length > 0 ? Math.max(...currentStops.map(s => s.stopOrder)) : 0
    const whStopOrder = maxOrder + 1

    let inserted: WarehouseDrop[] = []
    if (toInsert.length > 0) {
      const rows = toInsert.map(i => ({ truck_id: truckId, date, product_id: i.productId, cases: i.cases, stop_order: whStopOrder }))
      const { data, error } = await supabase.from('warehouse_drops').insert(rows).select()
      if (error) { toast(`Failed to save warehouse drop: ${error.message}`, 'error'); return }
      inserted = data as WarehouseDrop[]
    }

    setLocalWarehouseDrops(prev => {
      const updated = prev.map(d => {
        const u = toUpdate.find(x => x.id === d.id)
        return u ? { ...d, cases: u.newCases } : d
      })
      return [...updated, ...inserted]
    })

    // Add or update the warehouse stop in the stops array
    mutStops(prev => {
      const next = new Map(prev)
      const existing = prev.get(truckId) ?? []
      const hasWhStop = existing.some(s => s.isWarehouseDrop)
      if (hasWhStop) {
        next.set(truckId, existing.map(s =>
          s.isWarehouseDrop ? { ...s, items: items.map(i => ({ productId: i.productId, cases: i.cases })) } : s,
        ))
      } else {
        next.set(truckId, [...existing, {
          deliveryId: -truckId,
          orderId: null,
          stopOrder: whStopOrder,
          items: items.map(i => ({ productId: i.productId, cases: i.cases })),
          finalized: false,
          isWarehouseDrop: true,
        }])
      }
      return next
    })

    const truck = trucks.find(t => t.id === truckId)
    toast(`Warehouse drop added for ${truck?.name ?? 'truck'}`)
  }, [date, trucks, localWarehouseDrops])

  // ── Remove / reorder stops ────────────────────────────────────────────────

  const handleRemoveStop = useCallback(async (truckId: number, deliveryId: number) => {
    if (deliveryId < 0) {
      // Warehouse stop — delete all warehouse_drops rows for this truck/date
      const { error } = await supabase.from('warehouse_drops').delete().eq('truck_id', truckId).eq('date', date)
      if (error) { toast('Failed to remove warehouse stop', 'error'); return }
      setLocalWarehouseDrops(prev => prev.filter(d => d.truck_id !== truckId))
      mutStops(prev => {
        const next = new Map(prev)
        const remaining = (prev.get(truckId) ?? [])
          .filter(s => s.deliveryId !== deliveryId)
          .map((s, i) => ({ ...s, stopOrder: i + 1 }))
        next.set(truckId, remaining)
        return next
      })
      return
    }

    const { error } = await supabase.from('deliveries').delete().eq('id', deliveryId)
    if (error) { toast('Failed to remove stop', 'error'); return }

    const remaining = (stopsRef.current.get(truckId) ?? []).filter(s => s.deliveryId !== deliveryId)
    mutStops(prev => {
      const next = new Map(prev)
      next.set(truckId, remaining.map((s, i) => ({ ...s, stopOrder: i + 1 })))
      return next
    })
    remaining.forEach((s, i) => {
      if (s.deliveryId > 0) {
        supabase.from('deliveries').update({ stop_order: i + 1 }).eq('id', s.deliveryId)
          .then(({ error }) => { if (error) console.error('stop_order sync failed') })
      }
    })

    setLocalAllDeliveries(prev => prev.filter(d => d.id !== deliveryId))
    setLocalAllDeliveryItems(prev => prev.filter(di => di.delivery_id !== deliveryId))
  }, [date])

  // ── Update delivery items (Make Partial / Edit Delivery) ──────────────────

  const handleUpdateDeliveryItems = useCallback(async (
    deliveryId: number,
    truckId: number,
    newItems: { productId: string; cases: number }[],
  ) => {
    const { error: delErr } = await supabase.from('delivery_items').delete().eq('delivery_id', deliveryId)
    if (delErr) { toast('Failed to update delivery', 'error'); return }

    if (newItems.length > 0) {
      const { error: insErr } = await supabase.from('delivery_items').insert(
        newItems.map(i => ({ delivery_id: deliveryId, product_id: i.productId, cases: i.cases })),
      )
      if (insErr) { toast('Delivery updated but items failed to save', 'error'); return }
    }

    mutStops(prev => {
      const next = new Map(prev)
      const arr = (prev.get(truckId) ?? []).map(s =>
        s.deliveryId === deliveryId ? { ...s, items: newItems } : s,
      )
      next.set(truckId, arr)
      return next
    })

    setLocalAllDeliveryItems(prev => [
      ...prev.filter(di => di.delivery_id !== deliveryId),
      ...newItems.map((item, i) => ({
        id: -(Date.now() + i + 1),
        delivery_id: deliveryId,
        product_id: item.productId,
        cases: item.cases,
      } as DeliveryItem)),
    ])

    toast('Delivery updated')
  }, [])

  const handleReorderStops = useCallback((truckId: number, activeDeliveryId: number, overDeliveryId: number) => {
    const arr = stopsRef.current.get(truckId) ?? []
    const oldIdx = arr.findIndex(s => s.deliveryId === activeDeliveryId)
    const newIdx = arr.findIndex(s => s.deliveryId === overDeliveryId)
    if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return

    const reordered = arrayMove([...arr], oldIdx, newIdx).map((s, i) => ({ ...s, stopOrder: i + 1 }))
    mutStops(prev => { const next = new Map(prev); next.set(truckId, reordered); return next })

    for (const s of reordered) {
      if (s.deliveryId > 0) {
        supabase.from('deliveries').update({ stop_order: s.stopOrder }).eq('id', s.deliveryId)
          .then(({ error }) => { if (error) toast('Stop order update failed', 'error') })
      } else if (s.isWarehouseDrop) {
        supabase.from('warehouse_drops').update({ stop_order: s.stopOrder }).eq('truck_id', truckId).eq('date', date)
          .then(({ error }) => { if (error) toast('Stop order update failed', 'error') })
      }
    }
  }, [date])

  // ── Unassigned pool droppable (stop cards drag back here) ────────────────

  const { setNodeRef: setUnassignedRef, isOver: isOverUnassigned } = useDroppable({
    id: 'unassigned-pool',
    data: { type: 'unassigned' },
  })

  const activeStopInfo = useMemo(() => {
    if (!activeDragId?.startsWith('stop-')) return null
    const deliveryId = parseInt(activeDragId.slice(5))
    for (const [, arr] of stops) {
      const stop = arr.find(s => s.deliveryId === deliveryId)
      if (stop) {
        if (stop.isWarehouseDrop) return { stop, customerName: 'Warehouse' }
        const order    = orderById.get(stop.orderId!)
        const customer = customerById.get(order?.customer_id ?? -1)
        return { stop, customerName: customer?.name ?? `Order #${stop.orderId}` }
      }
    }
    return null
  }, [activeDragId, stops, orderById, customerById])

  // ── DnD ───────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveDragId(null)
    if (!over) return

    const aData = active.data.current as Record<string, unknown>
    const oData = over.data.current as Record<string, unknown>

    if (aData?.type === 'stop') {
      if (oData?.type === 'unassigned') {
        if (typeof aData.truckId === 'number' && typeof aData.deliveryId === 'number') {
          handleRemoveStop(aData.truckId, aData.deliveryId)
        }
      } else if (oData?.type === 'stop' && aData.truckId === oData.truckId) {
        if (
          typeof aData.truckId === 'number' &&
          typeof aData.deliveryId === 'number' &&
          typeof oData.deliveryId === 'number'
        ) {
          handleReorderStops(aData.truckId, aData.deliveryId, oData.deliveryId)
        }
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const selectedTruck = trucks.find(t => t.id === selectedTruckId) ?? null
  const hasWarehouse  = products.length > 0

  return (
    <>
      <Toaster />
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="fixed inset-0 top-12 flex overflow-hidden">

          {/* ── Left: Inventory + Truck load ── */}
          <aside className="w-56 flex-shrink-0 bg-white border-r border-stone-200 overflow-y-auto">
            {/* 20x1 inventory */}
            <div className="p-4 border-b border-stone-100">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans mb-3">Inventory</p>
              <div className="space-y-3">
                {inventoryDisplayProducts.map(p => {
                  const remaining = remainingInventory[p.id] ?? 0
                  const total     = localInventory[p.id] ?? 0
                  const pct       = total > 0 ? remaining / total : 0
                  const low       = remaining <= 0
                  const isEditing = editingInventoryId === p.id
                  return (
                    <div key={p.id}>
                      <div className="flex items-center justify-between mb-0.5 gap-1">
                        <span className="text-xs font-sans text-stone-600 truncate min-w-0">
                          {p.name}
                        </span>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <span className={cn('text-xs font-mono font-semibold tabular-nums', low ? 'text-red-600' : 'text-stone-700')}>
                            {remaining}
                          </span>
                          <span className="text-xs font-mono text-stone-400">/</span>
                          {isEditing ? (
                            <input
                              type="number" min={0} value={editInventoryValue} autoFocus
                              onChange={e => { setEditInventoryValue(e.target.value); handleInventoryEdit(p.id, e.target.value) }}
                              onBlur={() => setEditingInventoryId(null)}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingInventoryId(null) }}
                              className="w-10 text-xs font-mono text-stone-700 font-semibold text-right bg-stone-100 rounded px-1 focus:outline-none focus:ring-1 focus:ring-stone-400 [appearance:textfield] tabular-nums"
                            />
                          ) : (
                            <button
                              onClick={() => { setEditingInventoryId(p.id); setEditInventoryValue(String(total)) }}
                              className="text-xs font-mono text-stone-400 hover:text-stone-700 hover:underline tabular-nums transition-colors"
                            >
                              {total}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', low ? 'bg-red-400' : 'bg-emerald-400')}
                          style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
                {inventoryDisplayProducts.length === 0 && (
                  <p className="text-xs text-stone-300 font-sans">No inventory data</p>
                )}
              </div>
            </div>

            {/* 40x1 stock */}
            {inventoryDisplayProducts.some(p => !SPREAD_PRODUCT_IDS.has(p.id)) && (
              <div className="p-4 border-b border-stone-100">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans">40x1 Stock</p>
                  <button
                    onClick={() => { setConvertDialogOpen(true); setConvertAmounts({}) }}
                    className="text-[10px] font-semibold font-sans text-orange-500 hover:text-orange-700 transition-colors"
                  >
                    Convert →
                  </button>
                </div>
                <div className="space-y-1.5">
                  {inventoryDisplayProducts.filter(p => !SPREAD_PRODUCT_IDS.has(p.id)).map(p => {
                    const stock40x1     = localInventory40x1[p.id] ?? 0
                    const isEditing40x1 = editingInventory40x1Id === p.id
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-1">
                        <span className="text-xs font-sans text-stone-600 truncate min-w-0">
                          {p.name}
                        </span>
                        {isEditing40x1 ? (
                          <input
                            type="number" min={0} value={editInventory40x1Value} autoFocus
                            onChange={e => { setEditInventory40x1Value(e.target.value); handleInventory40x1Edit(p.id, e.target.value) }}
                            onBlur={() => setEditingInventory40x1Id(null)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingInventory40x1Id(null) }}
                            className="w-12 text-xs font-mono text-stone-700 font-semibold text-right bg-stone-100 rounded px-1 focus:outline-none focus:ring-1 focus:ring-stone-400 [appearance:textfield] tabular-nums"
                          />
                        ) : (
                          <button
                            onClick={() => { setEditingInventory40x1Id(p.id); setEditInventory40x1Value(String(stock40x1)) }}
                            className="text-xs font-mono text-stone-500 hover:text-stone-700 hover:underline tabular-nums transition-colors"
                          >
                            {stock40x1}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

          </aside>

          <Convert40x1Dialog
            open={convertDialogOpen}
            onClose={() => setConvertDialogOpen(false)}
            products={inventoryDisplayProducts.filter(p => !SPREAD_PRODUCT_IDS.has(p.id))}
            stock={localInventory40x1}
            amounts={convertAmounts}
            onAmountsChange={setConvertAmounts}
            onConvert={handleBatchConvert40x1}
          />

          {/* ── Center: Orders ── */}
          <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
            <div className="flex-shrink-0 px-5 py-3 border-b border-stone-200/60 bg-canvas flex items-center justify-between">
              <div>
                <h1 className="font-display text-lg font-semibold text-stone-800 tracking-tight">Delivery Dashboard</h1>
                <p className="text-xs font-sans text-stone-400 mt-0.5">
                  {unassigned.length} order{unassigned.length !== 1 ? 's' : ''} to assign
                </p>
              </div>
              <DayPicker date={date} />
            </div>

            {/* Tabs */}
            <div className="flex-shrink-0 flex border-b border-stone-100 bg-canvas">
              <button
                onClick={() => setActiveTab('orders')}
                className={cn(
                  'px-5 py-2 text-sm font-sans font-medium border-b-2 transition-colors',
                  activeTab === 'orders' ? 'border-stone-800 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800',
                )}
              >
                Orders{unassigned.length > 0 ? ` (${unassigned.length})` : ''}
              </button>
              <button
                onClick={() => setActiveTab('fulfilled')}
                className={cn(
                  'px-5 py-2 text-sm font-sans font-medium border-b-2 transition-colors',
                  activeTab === 'fulfilled' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-stone-500 hover:text-stone-800',
                )}
              >
                Fulfilled{fulfilledOrders.length > 0 ? ` (${fulfilledOrders.length})` : ''}
              </button>
            </div>

            <div
              ref={setUnassignedRef}
              className={cn(
                'flex-1 overflow-y-auto transition-colors',
                isOverUnassigned && activeDragId?.startsWith('stop-') && 'bg-stone-100/60',
              )}
            >
              {activeTab === 'orders' && (
                <div className="max-w-2xl mx-auto px-4 py-4 space-y-5">
                  {unassigned.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-stone-300">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mb-2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      <p className="text-sm font-sans">All orders assigned</p>
                    </div>
                  )}

                  {/* Overdue */}
                  {sortedUnassigned.overdue.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex-1 h-px bg-red-100" />
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 font-sans">Overdue</p>
                        <div className="flex-1 h-px bg-red-100" />
                      </div>
                      <div className="space-y-2">
                        {sortedUnassigned.overdue.map(order => {
                          const orderDeliveries = localAllDeliveries.filter(d => d.order_id === order.id).map(d => ({
                            truckId: d.truck_id, truckName: truckById.get(d.truck_id)?.name ?? `Truck #${d.truck_id}`,
                            date: d.delivery_date, cases: localAllDeliveryItems.filter(di => di.delivery_id === d.id).reduce((s, di) => s + di.cases, 0),
                          }))
                          return <OrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} items={orderItemsByOrder[order.id] ?? []} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} date={date} deliveries={orderDeliveries} products={products} onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} onGoToTruck={setSelectedTruckId} onPartialClick={() => setPartialDialog({ open: true, orderId: order.id, truckId: selectedTruckId })} onAddToTruck={selectedTruckId ? () => assignOrderToTruck(order.id, selectedTruckId) : null} empakaNote={empakaByOrder[order.id] ?? ''} onEmpakaChange={text => handleEmpakaChange(order.id, text)} />
                        })}
                      </div>
                    </div>
                  )}

                  {/* Due today — exact */}
                  {sortedUnassigned.todayExact.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex-1 h-px bg-stone-200" />
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans">Due Today</p>
                        <div className="flex-1 h-px bg-stone-200" />
                      </div>
                      <div className="space-y-2">
                        {sortedUnassigned.todayExact.map(order => {
                          const orderDeliveries = localAllDeliveries.filter(d => d.order_id === order.id).map(d => ({
                            truckId: d.truck_id, truckName: truckById.get(d.truck_id)?.name ?? `Truck #${d.truck_id}`,
                            date: d.delivery_date, cases: localAllDeliveryItems.filter(di => di.delivery_id === d.id).reduce((s, di) => s + di.cases, 0),
                          }))
                          return <OrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} items={orderItemsByOrder[order.id] ?? []} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} date={date} deliveries={orderDeliveries} products={products} onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} onGoToTruck={setSelectedTruckId} onPartialClick={() => setPartialDialog({ open: true, orderId: order.id, truckId: selectedTruckId })} onAddToTruck={selectedTruckId ? () => assignOrderToTruck(order.id, selectedTruckId) : null} empakaNote={empakaByOrder[order.id] ?? ''} onEmpakaChange={text => handleEmpakaChange(order.id, text)} />
                        })}
                      </div>
                    </div>
                  )}

                  {/* Due today — range includes today */}
                  {sortedUnassigned.todayRange.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex-1 h-px bg-stone-200" />
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans">In Range Today</p>
                        <div className="flex-1 h-px bg-stone-200" />
                      </div>
                      <div className="space-y-2">
                        {sortedUnassigned.todayRange.map(order => {
                          const orderDeliveries = localAllDeliveries.filter(d => d.order_id === order.id).map(d => ({
                            truckId: d.truck_id, truckName: truckById.get(d.truck_id)?.name ?? `Truck #${d.truck_id}`,
                            date: d.delivery_date, cases: localAllDeliveryItems.filter(di => di.delivery_id === d.id).reduce((s, di) => s + di.cases, 0),
                          }))
                          return <OrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} items={orderItemsByOrder[order.id] ?? []} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} date={date} deliveries={orderDeliveries} products={products} onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} onGoToTruck={setSelectedTruckId} onPartialClick={() => setPartialDialog({ open: true, orderId: order.id, truckId: selectedTruckId })} onAddToTruck={selectedTruckId ? () => assignOrderToTruck(order.id, selectedTruckId) : null} empakaNote={empakaByOrder[order.id] ?? ''} onEmpakaChange={text => handleEmpakaChange(order.id, text)} />
                        })}
                      </div>
                    </div>
                  )}

                  {/* Future */}
                  {sortedUnassigned.future.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex-1 h-px bg-stone-200" />
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans">Upcoming</p>
                        <div className="flex-1 h-px bg-stone-200" />
                      </div>
                      <div className="space-y-2">
                        {sortedUnassigned.future.map(order => {
                          const orderDeliveries = localAllDeliveries.filter(d => d.order_id === order.id).map(d => ({
                            truckId: d.truck_id, truckName: truckById.get(d.truck_id)?.name ?? `Truck #${d.truck_id}`,
                            date: d.delivery_date, cases: localAllDeliveryItems.filter(di => di.delivery_id === d.id).reduce((s, di) => s + di.cases, 0),
                          }))
                          return <OrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} items={orderItemsByOrder[order.id] ?? []} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} date={date} deliveries={orderDeliveries} products={products} onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} onGoToTruck={setSelectedTruckId} onPartialClick={() => setPartialDialog({ open: true, orderId: order.id, truckId: selectedTruckId })} onAddToTruck={selectedTruckId ? () => assignOrderToTruck(order.id, selectedTruckId) : null} empakaNote={empakaByOrder[order.id] ?? ''} onEmpakaChange={text => handleEmpakaChange(order.id, text)} />
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'fulfilled' && (
                <div className="max-w-2xl mx-auto px-4 py-4">
                  {fulfilledOrders.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-stone-300 text-sm font-sans">No fulfilled orders.</div>
                  ) : (
                    <div className="space-y-2">
                      {fulfilledOrders.map(order => {
                        const orderDeliveries = localAllDeliveries.filter(d => d.order_id === order.id).map(d => ({
                          truckId: d.truck_id, truckName: truckById.get(d.truck_id)?.name ?? `Truck #${d.truck_id}`,
                          date: d.delivery_date, cases: localAllDeliveryItems.filter(di => di.delivery_id === d.id).reduce((s, di) => s + di.cases, 0),
                        }))
                        const totalCases = (orderItemsByOrder[order.id] ?? []).reduce((s, i) => s + i.cases, 0)
                        return <FulfilledOrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} totalCases={totalCases} deliveries={orderDeliveries} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} products={products} items={orderItemsByOrder[order.id] ?? []} viewingDate={date} onGoToTruck={setSelectedTruckId} onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} />
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Warehouse drawer ── */}
            {hasWarehouse && (
              <div className="flex-shrink-0 border-t border-stone-200 bg-white">
                {/* Collapsed header row */}
                <div className="px-5 py-2.5 flex items-center gap-3">
                  <button
                    onClick={() => setWarehouseOpen(v => !v)}
                    className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-70 transition-opacity text-left"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans flex-shrink-0">Warehouse</p>
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className={cn('text-stone-400 transition-transform duration-150 flex-shrink-0 ml-auto', warehouseOpen && 'rotate-180')}
                    >
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {warehouseOpen && (
                  <div className="px-5 pb-4 border-t border-stone-100">
                    <table className="w-full text-xs font-sans mt-3">
                      <thead>
                        <tr className="border-b border-stone-100">
                          <th className="pb-2 text-left text-stone-400 font-medium">Product</th>
                          <th className="pb-2 text-right text-stone-400 font-medium">Orders</th>
                          <th className="pb-2 text-right text-stone-400 font-medium">Stock</th>
                          <th className="pb-2 text-right text-stone-400 font-medium">Delivered</th>
                          <th className="pb-2 text-right text-stone-400 font-medium">Needed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map(p => {
                          const w = localWarehouse[p.id] ?? { pickup: 0, stock: 0 }
                          const dropped = dropsByProduct[p.id] ?? 0
                          const stillNeeded = Math.max(0, w.pickup - w.stock - dropped)
                          const editingPickup = editingWarehouseCell?.productId === p.id && editingWarehouseCell.field === 'pickup'
                          const editingStock  = editingWarehouseCell?.productId === p.id && editingWarehouseCell.field === 'stock'
                          return (
                            <tr key={p.id} className="border-b border-stone-50 last:border-0">
                              <td className="py-1.5 text-stone-700">{p.name}</td>
                              <td className="py-1.5 text-right font-mono tabular-nums">
                                {editingPickup ? (
                                  <input
                                    type="number" min={0} value={editWarehouseValue} autoFocus
                                    onChange={e => { setEditWarehouseValue(e.target.value); handleWarehouseEdit(p.id, 'pickup', e.target.value) }}
                                    onBlur={() => setEditingWarehouseCell(null)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingWarehouseCell(null) }}
                                    className="w-14 text-xs font-mono text-right bg-stone-100 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-stone-400 [appearance:textfield]"
                                  />
                                ) : (
                                  <button
                                    onClick={() => { setEditingWarehouseCell({ productId: p.id, field: 'pickup' }); setEditWarehouseValue(String(w.pickup)) }}
                                    className="text-stone-500 hover:text-stone-800 hover:underline transition-colors"
                                  >{w.pickup}</button>
                                )}
                              </td>
                              <td className="py-1.5 text-right font-mono tabular-nums text-stone-600">
                                {editingStock ? (
                                  <input
                                    type="number" min={0} value={editWarehouseValue} autoFocus
                                    onChange={e => { setEditWarehouseValue(e.target.value); handleWarehouseEdit(p.id, 'stock', e.target.value) }}
                                    onBlur={() => setEditingWarehouseCell(null)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingWarehouseCell(null) }}
                                    className="w-14 text-xs font-mono text-right bg-stone-100 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-stone-400 [appearance:textfield]"
                                  />
                                ) : (
                                  <button
                                    onClick={() => { setEditingWarehouseCell({ productId: p.id, field: 'stock' }); setEditWarehouseValue(String(w.stock)) }}
                                    className="text-stone-600 hover:text-stone-800 hover:underline transition-colors"
                                  >{w.stock}</button>
                                )}
                              </td>
                              <td className="py-1.5 text-right font-mono tabular-nums text-stone-500">
                                {dropped > 0 ? dropped : '—'}
                              </td>
                              <td className={cn('py-1.5 text-right font-mono tabular-nums font-semibold', stillNeeded > 0 ? 'text-red-600' : 'text-emerald-600')}>
                                {stillNeeded > 0 ? stillNeeded : '✓'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right: Truck assignment panel ── */}
          <aside className="flex-1 bg-white border-l border-stone-200 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-5 py-3 border-b border-stone-200/60">
              <h1 className="font-display text-lg font-semibold text-stone-800 tracking-tight">Trucks</h1>
            </div>
            {/* Truck tabs */}
            <div className="flex-shrink-0 flex bg-stone-50 border-b border-stone-200 overflow-x-auto">
              {trucks.map(t => {
                const load = truckLoads[t.id] ?? 0
                const pct = t.capacity_cases > 0 ? load / t.capacity_cases : 0
                const dot = load === 0 ? null : pct > 1 ? 'red' : pct >= 0.7 ? 'green' : 'yellow'
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTruckId(t.id)}
                    className={cn(
                      'px-4 py-2.5 text-sm font-sans font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 flex items-center gap-1.5',
                      selectedTruckId === t.id
                        ? 'bg-white text-stone-800 border-stone-700'
                        : 'text-stone-400 border-transparent hover:text-stone-600 hover:bg-white/60',
                    )}
                  >
                    {dot && (
                      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dot === 'red' ? 'bg-red-400' : dot === 'green' ? 'bg-emerald-400' : 'bg-amber-400')} />
                    )}
                    {t.name}
                  </button>
                )
              })}
              {trucks.length === 0 && (
                <p className="px-4 py-2.5 text-sm text-stone-300 font-sans">No trucks available</p>
              )}
            </div>

            {selectedTruck ? (
              <TruckPanel
                truck={selectedTruck}
                stops={stops.get(selectedTruck.id) ?? []}
                load={truckLoads[selectedTruck.id] ?? 0}
                orderById={orderById}
                customerById={customerById}
                productById={productById}
                products={products}
                orderItemsByOrder={orderItemsByOrder}
                empakaByOrder={empakaByOrder}
                onEmpakaChange={handleEmpakaChange}
                onRemoveStop={(deliveryId) => handleRemoveStop(selectedTruck.id, deliveryId)}
                onUpdateDeliveryItems={(deliveryId, items) => handleUpdateDeliveryItems(deliveryId, selectedTruck.id, items)}
                onUpdateOrderItems={handleUpdateSingleOrderItem}
                onToggleEmpako={handleToggleOrderItemEmpako}
                onDropClick={() => setWarehouseDropDialog({ open: true, truckId: selectedTruck.id })}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-stone-300 text-sm font-sans">Select a truck</p>
              </div>
            )}
          </aside>

        </div>

        <DragOverlay dropAnimation={null}>
          {activeStopInfo && (
            <div className="bg-white rounded-xl border border-stone-200 shadow-2xl px-4 py-3 w-64 -rotate-1 pointer-events-none">
              <p className="text-sm font-sans font-semibold text-stone-800">{activeStopInfo.customerName}</p>
              <p className="text-xs font-sans text-stone-400 mt-0.5">{itemSummary(activeStopInfo.stop.items, productById)}</p>
              <p className="text-xs font-mono text-stone-300 mt-0.5">{activeStopInfo.stop.items.reduce((s, i) => s + i.cases, 0)} cs</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <PartialDialog
        open={partialDialog.open}
        onClose={() => setPartialDialog(p => ({ ...p, open: false }))}
        initialOrderId={partialDialog.orderId}
        initialTruckId={partialDialog.truckId}
        orders={orders}
        trucks={trucks}
        products={products}
        productById={productById}
        customerById={customerById}
        orderRemainingMap={orderRemainingMap}
        orderItemsByOrder={orderItemsByOrder}
        remainingInventory={remainingInventory}
        truckLoads={truckLoads}
        truckProductTotals={truckProductTotals}
        onSubmit={assignPartialDelivery}
      />

      <WarehouseDropDialog
        open={warehouseDropDialog.open}
        onClose={() => setWarehouseDropDialog(p => ({ ...p, open: false }))}
        initialTruckId={warehouseDropDialog.truckId}
        trucks={trucks}
        products={products}
        productById={productById}
        warehouse={localWarehouse}
        dropsByProduct={dropsByProduct}
        remainingInventory={remainingInventory}
        truckLoads={truckLoads}
        truckProductTotals={truckProductTotals}
        onSubmit={handleCreateWarehouseDrop}
      />
    </>
  )
}

// ── EditOrderDialog ───────────────────────────────────────────────────────────

function EditOrderDialog({
  open, onClose, items, products, onSave, onToggleEmpako,
}: {
  open: boolean
  onClose: () => void
  items: OrderItem[]
  products: DeliveryProduct[]
  onSave: (productId: string, cases: number) => Promise<void>
  onToggleEmpako: (productId: string, empako: boolean) => Promise<void>
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [empakoState, setEmpakoState] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      const initAmounts: Record<string, string> = {}
      const initEmpako: Record<string, boolean> = {}
      for (const item of items) {
        initAmounts[item.product_id] = String(item.cases)
        initEmpako[item.product_id] = item.empako ?? false
      }
      setAmounts(initAmounts)
      setEmpakoState(initEmpako)
    }
  }, [open, items])

  async function handleSave() {
    setSaving(true)
    const promises: Promise<void>[] = []
    for (const p of products) {
      const newCases = parseInt(amounts[p.id] ?? '0') || 0
      const oldCases = items.find(i => i.product_id === p.id)?.cases ?? 0
      if (newCases !== oldCases) promises.push(onSave(p.id, newCases))

      if (!SPREAD_PRODUCT_IDS.has(p.id)) {
        const newEmpako = empakoState[p.id] ?? false
        const oldEmpako = items.find(i => i.product_id === p.id)?.empako ?? false
        if (newEmpako !== oldEmpako) promises.push(onToggleEmpako(p.id, newEmpako))
      }
    }
    await Promise.all(promises)
    setSaving(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm max-h-[90svh] grid-rows-[auto_1fr_auto]">
        <DialogHeader>
          <DialogTitle>Edit Order</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto border border-stone-100 rounded-xl">
          <div className="grid grid-cols-[1fr_56px_100px] px-4 py-2 bg-stone-50 border-b border-stone-100 text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans">
            <span>Product</span>
            <span className="text-center">40x1</span>
            <span className="text-right">Cases</span>
          </div>
          {products.map(p => {
            const val = amounts[p.id] ?? '0'
            const isSet = (parseInt(val) || 0) > 0
            const isEmpako = empakoState[p.id] ?? false
            const isSpread = SPREAD_PRODUCT_IDS.has(p.id)
            return (
              <div
                key={p.id}
                className={cn(
                  'grid grid-cols-[1fr_56px_100px] items-center px-4 py-2.5 border-b border-stone-50 last:border-0',
                  isEmpako && isSet ? 'bg-amber-50/40' : isSet ? 'bg-emerald-50/40' : '',
                )}
              >
                <span className={cn('text-sm font-sans', isSet ? 'text-stone-800 font-medium' : 'text-stone-500')}>
                  {getProductAbbr(p)}
                </span>
                {isSpread ? (
                  <div className="text-center text-stone-300 text-xs select-none">—</div>
                ) : (
                  <div className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={isEmpako}
                      onChange={e => setEmpakoState(prev => ({ ...prev, [p.id]: e.target.checked }))}
                      className="w-4 h-4 accent-orange-500 cursor-pointer"
                    />
                  </div>
                )}
                <input
                  type="number" min={0} value={val}
                  onChange={e => setAmounts(prev => ({ ...prev, [p.id]: e.target.value }))}
                  onFocus={e => e.target.select()}
                  className={cn(
                    'w-full px-3 py-1 text-sm font-mono text-right border rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 [appearance:auto]',
                    isEmpako && isSet ? 'border-amber-200 bg-white' : isSet ? 'border-emerald-200 bg-white' : 'border-stone-200',
                  )}
                />
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-sans font-medium text-stone-500 hover:text-stone-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-semibold font-sans rounded-xl bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── OrderCard ─────────────────────────────────────────────────────────────────

function OrderCard({
  order, customer, items, remaining, productById, products, date,
  deliveries, onUpdateItem, onToggleEmpako, onGoToTruck, onPartialClick, onAddToTruck,
  empakaNote, onEmpakaChange,
}: {
  order: Order
  customer: Customer | null
  items: OrderItem[]
  remaining: OrderRemaining | null
  productById: Map<string, DeliveryProduct>
  products: DeliveryProduct[]
  date: string
  deliveries: { truckId: number; truckName: string; date: string; cases: number }[]
  onUpdateItem: (productId: string, cases: number) => Promise<void>
  onToggleEmpako: (productId: string, empako: boolean) => Promise<void>
  onGoToTruck: (truckId: number) => void
  onPartialClick: () => void
  onAddToTruck: (() => void) | null
  empakaNote: string
  onEmpakaChange: (text: string) => void
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [showDeliveries, setShowDeliveries] = useState(false)

  const dueLine        = orderDateLabel(order, date)
  const totalOrdered   = remaining?.totalOrdered ?? items.reduce((s, i) => s + i.cases, 0)
  const totalRemaining = remaining?.totalRemaining ?? totalOrdered
  const totalDelivered = remaining?.totalDelivered ?? 0
  const hasDeliveries  = deliveries.length > 0
  const isPartial      = totalDelivered > 0
  const hasEmpako      = items.some(i => i.empako)

  const sortedItems = [...items].sort(
    (a, b) => (productById.get(a.product_id)?.display_order ?? 999) - (productById.get(b.product_id)?.display_order ?? 999),
  )

  function fmtDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="bg-white rounded-xl border border-stone-100 shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0">
          <span className="text-sm font-sans font-semibold text-stone-800 truncate block">
            {customer?.name ?? `Customer #${order.customer_id}`}
          </span>
          <p className="text-[11px] font-sans text-stone-400 mt-0.5">{dueLine}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          {onAddToTruck && (
            <button
              onClick={onAddToTruck}
              className="px-2 py-0.5 text-[11px] font-semibold font-sans rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              Add
            </button>
          )}
          <button
            onClick={() => setEditOpen(true)}
            className="px-2 py-0.5 text-[11px] font-semibold font-sans rounded-md bg-stone-50 text-stone-600 hover:bg-stone-100 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onPartialClick}
            className="px-2 py-0.5 text-[11px] font-semibold font-sans rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
          >
            Partial
          </button>
        </div>
      </div>

      {/* ── 40x1 label ── */}
      {hasEmpako && (
        <div className="px-3 py-1.5 border-t border-amber-100 bg-amber-50/50 flex items-center gap-1.5">
          <span className="text-xs font-semibold font-sans text-orange-500 flex-shrink-0">40x1:</span>
          <EmpakaInput
            note={empakaNote}
            defaultName={customer?.name ?? ''}
            onChange={onEmpakaChange}
          />
        </div>
      )}

      {/* ── Product table ── */}
      {sortedItems.length > 0 ? (
        <div className="border-t border-stone-100 overflow-x-auto">
          <table className="text-xs font-sans">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50/70">
                <th className="px-3 py-1.5 text-left font-medium text-stone-300 whitespace-nowrap w-10" />
                {sortedItems.map(item => (
                  <th key={item.product_id} className="px-2 py-1.5 text-left font-medium text-stone-400 whitespace-nowrap pr-4 last:pr-2">
                    {getProductAbbr({ id: item.product_id, name: productById.get(item.product_id)?.name ?? item.product_id })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Ordered row */}
              <tr className={cn(isPartial && 'border-b border-stone-50')}>
                <td className="px-3 py-1.5 text-stone-400 font-medium whitespace-nowrap text-[10px] uppercase tracking-wide">Ord</td>
                {sortedItems.map(item => (
                  <td key={item.product_id} className="px-2 py-1.5 text-left font-mono tabular-nums text-stone-600 pr-4 last:pr-2">
                    {item.cases}
                    {item.empako && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                  </td>
                ))}
              </tr>
              {/* Delivered row — only when partially delivered */}
              {isPartial && (
                <tr className="border-b border-stone-50">
                  <td className="px-3 py-1.5 text-emerald-600 font-medium whitespace-nowrap text-[10px] uppercase tracking-wide">Dlv</td>
                  {sortedItems.map(item => {
                    const dlv = remaining?.byItem[item.product_id]?.delivered ?? 0
                    return (
                      <td key={item.product_id} className={cn('px-2 py-1.5 text-left font-mono tabular-nums font-semibold pr-4 last:pr-2', dlv === 0 ? 'text-stone-200' : 'text-emerald-600')}>
                        {dlv}
                        {item.empako && dlv > 0 && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                      </td>
                    )
                  })}
                </tr>
              )}
              {/* Needed row — only when partially delivered */}
              {isPartial && (
                <tr>
                  <td className="px-3 py-1.5 text-amber-600 font-medium whitespace-nowrap text-[10px] uppercase tracking-wide">Need</td>
                  {sortedItems.map(item => {
                    const need = remaining?.byItem[item.product_id]?.remaining ?? item.cases
                    return (
                      <td key={item.product_id} className={cn('px-2 py-1.5 text-left font-mono tabular-nums font-semibold pr-4 last:pr-2', need === 0 ? 'text-stone-200' : 'text-amber-600')}>
                        {need}
                        {item.empako && need > 0 && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                      </td>
                    )
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-3 pb-2 text-xs text-stone-300 font-sans">No items</p>
      )}

      {/* Notes */}
      {order.notes && (
        <p className="px-3 pt-1 pb-1 text-xs font-sans text-stone-400 italic border-t border-stone-50">{order.notes}</p>
      )}

      {/* Past deliveries — toggle button + inline expand below */}
      {hasDeliveries && (
        <div className="border-t border-stone-100">
          <button
            onClick={() => setShowDeliveries(v => !v)}
            className="w-full px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-semibold font-sans text-sky-600 hover:bg-sky-50 transition-colors"
          >
            <svg
              className={cn('w-3 h-3 transition-transform duration-150 flex-shrink-0', showDeliveries && 'rotate-90')}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            Past Deliveries
          </button>
          {showDeliveries && (
            <div className="px-3 pb-2 space-y-0.5 border-t border-stone-50">
              {deliveries.map((d, i) => (
                <button
                  key={i}
                  onClick={() => d.date === date ? onGoToTruck(d.truckId) : router.push(`/delivery/dashboard?date=${d.date}`)}
                  className="w-full flex items-center justify-between py-1 px-1.5 rounded-lg hover:bg-stone-50 transition-colors text-left group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-sans font-medium text-stone-500">{d.truckName}</span>
                    {d.date !== date && (
                      <span className="text-[11px] font-sans text-stone-400">{fmtDate(d.date)}</span>
                    )}
                  </div>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className="text-stone-300 group-hover:text-stone-500 transition-colors flex-shrink-0" strokeLinecap="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <EditOrderDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        items={items}
        products={products}
        onSave={onUpdateItem}
        onToggleEmpako={onToggleEmpako}
      />
    </div>
  )
}

// ── Convert40x1Dialog ─────────────────────────────────────────────────────────

function Convert40x1Dialog({
  open, onClose, products, stock, amounts, onAmountsChange, onConvert,
}: {
  open: boolean
  onClose: () => void
  products: DeliveryProduct[]
  stock: Record<string, number>
  amounts: Record<string, string>
  onAmountsChange: (a: Record<string, string>) => void
  onConvert: (amounts: Record<string, string>) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    setSaving(true)
    await onConvert(amounts)
    setSaving(false)
  }

  const hasAny = products.some(p => (parseInt(amounts[p.id] ?? '0') || 0) > 0)

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Convert 40x1 → 20x1</DialogTitle>
        </DialogHeader>
        <div className="border border-stone-100 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_64px_auto] px-4 py-2 bg-stone-50 border-b border-stone-100 text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans gap-2">
            <span>Product</span>
            <span className="text-right">In stock</span>
            <span className="text-right">Convert</span>
          </div>
          {products.map(p => {
            const available = stock[p.id] ?? 0
            const val = amounts[p.id] ?? ''
            const n = parseInt(val) || 0
            const over = n > available
            return (
              <div key={p.id} className="grid grid-cols-[1fr_64px_auto] items-center px-4 py-2.5 border-b border-stone-50 last:border-0 gap-2">
                <span className="text-sm font-sans text-stone-700">{getProductAbbr(p)}</span>
                <span className="text-sm font-mono text-stone-400 text-right tabular-nums">{available}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number" min={0} max={available} value={val}
                    onChange={e => onAmountsChange({ ...amounts, [p.id]: e.target.value })}
                    onFocus={e => e.target.select()}
                    placeholder="0"
                    className={cn(
                      'w-14 px-2 py-1 text-sm font-mono text-right border rounded-lg focus:outline-none focus:ring-2 [appearance:textfield]',
                      over ? 'border-red-300 focus:ring-red-300' : 'border-stone-200 focus:ring-stone-300',
                    )}
                  />
                  <button
                    onClick={() => onAmountsChange({ ...amounts, [p.id]: String(available) })}
                    title="Convert all in stock"
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-stone-300 hover:text-orange-500 hover:bg-orange-50 transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-sans font-medium text-stone-500 hover:text-stone-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit} disabled={saving || !hasAny}
            className="px-5 py-2 text-sm font-semibold font-sans rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Converting…' : 'Convert'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── TruckCapacityBar (shared between panel and dialogs) ───────────────────────

function TruckCapacityBar({
  truck, load, productTotals, productById, actions, stops, orderById, customerById, orderItemsByOrder,
}: {
  truck: Truck
  load: number
  productTotals: Record<string, number>
  productById: Map<string, DeliveryProduct>
  actions?: React.ReactNode
  stops?: TruckStop[]
  orderById?: Map<number, Order>
  customerById?: Map<number, Customer>
  orderItemsByOrder?: Record<number, OrderItem[]>
}) {
  const pct  = truck.capacity_cases > 0 ? (load / truck.capacity_cases) * 100 : 0
  const over = load > truck.capacity_cases
  const hasBreakdown = Object.keys(productTotals).length > 0

  // Build summary table when stops data is available
  const summaryTable = useMemo(() => {
    if (!stops || !orderById || !customerById || stops.length === 0) return null

    const sortedStops = [...stops].sort((a, b) => a.stopOrder - b.stopOrder)

    const pidSet = new Set(sortedStops.flatMap(s => s.items.map(i => i.productId)))
    const activeProducts = [...pidSet]
      .map(id => productById.get(id))
      .filter((p): p is DeliveryProduct => p != null)
      .sort((a, b) => a.display_order - b.display_order)

    if (activeProducts.length === 0) return null

    const totals: Record<string, number> = {}
    for (const s of sortedStops) {
      const empakoMap: Record<string, boolean> = {}
      if (!s.isWarehouseDrop && s.orderId && orderItemsByOrder) {
        for (const oi of orderItemsByOrder[s.orderId] ?? [])
          empakoMap[oi.product_id] = oi.empako ?? false
      }
      for (const i of s.items) {
        const isEmpako = !SPREAD_PRODUCT_IDS.has(i.productId) && (empakoMap[i.productId] ?? false)
        totals[i.productId] = (totals[i.productId] ?? 0) + (isEmpako ? i.cases * 2 : i.cases)
      }
    }

    return (
      <div className="mt-2 border border-stone-100 rounded-lg overflow-x-auto">
        <table className="w-full text-xs font-sans">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-100">
              <th className="text-left px-3 py-1.5 font-medium text-stone-400 whitespace-nowrap w-40">Stop</th>
              {activeProducts.map(p => (
                <th key={p.id} className="px-2 py-1.5 font-medium text-stone-400 text-right whitespace-nowrap">{getProductAbbr(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {sortedStops.map((stop, idx) => {
              const itemMap: Record<string, number> = {}
              for (const i of stop.items) itemMap[i.productId] = i.cases

              const empakoMap: Record<string, boolean> = {}
              if (!stop.isWarehouseDrop && stop.orderId && orderItemsByOrder) {
                for (const oi of orderItemsByOrder[stop.orderId] ?? []) {
                  empakoMap[oi.product_id] = oi.empako ?? false
                }
              }

              let label: string
              let rowCls = 'hover:bg-stone-50'
              if (stop.isWarehouseDrop) {
                label = 'Warehouse'
                rowCls = 'bg-amber-50'
              } else {
                const order    = orderById.get(stop.orderId!)
                const customer = customerById.get(order?.customer_id ?? -1)
                label = customer?.name ?? `Order #${stop.orderId}`
              }

              return (
                <tr key={stop.deliveryId} className={rowCls}>
                  <td className={cn('px-3 py-1.5 whitespace-nowrap w-40', stop.isWarehouseDrop ? 'text-amber-700 font-medium' : 'text-stone-600')}>
                    <span className="text-stone-300 mr-1">{idx + 1}.</span>{label}
                  </td>
                  {activeProducts.map(p => (
                    <td key={p.id} className={cn('px-2 py-1.5 text-right font-mono tabular-nums', stop.isWarehouseDrop ? 'text-amber-700' : 'text-stone-700')}>
                      {itemMap[p.id] != null ? (
                        <>
                          {itemMap[p.id]}
                          {empakoMap[p.id] && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                        </>
                      ) : <span className="text-stone-200">—</span>}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-stone-100 border-t border-stone-200">
              <td className="px-3 py-1.5 font-semibold text-stone-600 w-40">Total</td>
              {activeProducts.map(p => (
                <td key={p.id} className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold text-stone-700">
                  {totals[p.id] ?? 0}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    )
  }, [stops, orderById, customerById, productById, orderItemsByOrder, load])

  return (
    <div>
      <div className="flex items-center mb-1.5">
        <div className="flex-1 flex items-center justify-between">
          <span className="text-xs font-sans text-stone-500">Current load</span>
          <span className={cn('text-xs font-mono tabular-nums', over ? 'text-red-600 font-semibold' : 'text-stone-600')}>
            {load} / {truck.capacity_cases} cs
          </span>
        </div>
        {actions}
      </div>
      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', over ? 'bg-red-400' : 'bg-amber-400')}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      {hasBreakdown && (
        summaryTable ?? (
          <div className="mt-2 bg-white border border-stone-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs font-sans">
              <tbody>
                {Object.entries(productTotals).sort(([a], [b]) => (productById.get(a)?.display_order ?? 999) - (productById.get(b)?.display_order ?? 999)).map(([pid, cases]) => (
                  <tr key={pid} className="border-b border-stone-50 last:border-0">
                    <td className="px-3 py-1.5 text-stone-500">{productById.get(pid)?.name ?? pid}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-stone-700 tabular-nums font-medium">{cases} cs</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-stone-50 border-t border-stone-100">
                <tr>
                  <td className="px-3 py-1.5 text-stone-400 font-medium">Total</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-stone-700">{load} cs</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  )
}

// ── WarehouseDropCard ─────────────────────────────────────────────────────────

function WarehouseDropCard({
  drops, productById, onRemove,
}: {
  drops: WarehouseDrop[]
  productById: Map<string, DeliveryProduct>
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const byProduct: Record<string, number> = {}
  for (const d of drops) byProduct[d.product_id] = (byProduct[d.product_id] ?? 0) + d.cases
  const items = Object.entries(byProduct).map(([productId, cases]) => ({ productId, cases }))
  const totalCases = items.reduce((s, i) => s + i.cases, 0)

  return (
    <div className="border-b border-stone-100 bg-stone-50/40">
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="flex-shrink-0 text-[10px] font-mono text-stone-300 w-5 text-right mt-0.5 tabular-nums">WH</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-sans text-stone-600 font-medium">Warehouse</p>
            <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 flex-shrink-0">
              Drop
            </span>
          </div>
          {!expanded && (
            <p className="text-xs font-sans text-stone-400 mt-0.5">{itemSummary(items, productById)}</p>
          )}
          <p className="text-xs font-mono text-stone-300 mt-0.5 tabular-nums">{totalCases} cs</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-5 h-5 flex items-center justify-center rounded text-stone-300 hover:text-stone-500 transition-colors"
          >
            <svg
              width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={cn('transition-transform duration-150', expanded && 'rotate-180')}
              strokeLinecap="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <button
            onClick={onRemove}
            className="text-stone-300 hover:text-red-400 transition-colors"
            title="Remove warehouse drop"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-stone-100">
          <table className="w-full text-xs font-sans mt-2">
            <thead>
              <tr>
                <th className="pb-1 text-left text-stone-400 font-medium">Product</th>
                <th className="pb-1 text-right text-stone-400 font-medium">Cases</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.productId} className="border-t border-stone-50">
                  <td className="py-1.5 text-stone-600">{productById.get(item.productId)?.name ?? item.productId}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-stone-700 font-medium">{item.cases}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── TruckPanel ────────────────────────────────────────────────────────────────

function TruckPanel({ truck, stops, load, orderById, customerById, productById, products, orderItemsByOrder, empakaByOrder, onEmpakaChange, onRemoveStop, onUpdateDeliveryItems, onUpdateOrderItems, onToggleEmpako, onDropClick }: {
  truck: Truck
  stops: TruckStop[]
  load: number
  orderById: Map<number, Order>
  customerById: Map<number, Customer>
  productById: Map<string, DeliveryProduct>
  products: DeliveryProduct[]
  orderItemsByOrder: Record<number, OrderItem[]>
  empakaByOrder: Record<number, string>
  onEmpakaChange: (orderId: number, text: string) => void
  onRemoveStop: (deliveryId: number) => void
  onUpdateDeliveryItems: (deliveryId: number, items: { productId: string; cases: number }[]) => Promise<void>
  onUpdateOrderItems: (orderId: number, productId: string, cases: number) => Promise<void>
  onToggleEmpako: (orderId: number, productId: string, empako: boolean) => Promise<void>
  onDropClick: () => void
}) {

  const { setNodeRef, isOver } = useDroppable({
    id: `truck-${truck.id}`,
    data: { type: 'truck', truckId: truck.id },
  })

  const productTotals = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const stop of stops) {
      for (const item of stop.items) {
        acc[item.productId] = (acc[item.productId] ?? 0) + item.cases
      }
    }
    return acc
  }, [stops])

  const hasWarehouseStop = stops.some(s => s.isWarehouseDrop)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Capacity section */}
      <div className="flex-shrink-0 border-b border-stone-100 px-4 pt-3 pb-2">
        <TruckCapacityBar
          truck={truck}
          load={load}
          productTotals={productTotals}
          productById={productById}
          stops={stops}
          orderById={orderById}
          customerById={customerById}
          orderItemsByOrder={orderItemsByOrder}
        />
      </div>

      {/* Stop list */}
      <div
        ref={setNodeRef}
        className={cn('flex-1 overflow-y-auto transition-colors', isOver && 'bg-stone-50')}
      >
        <SortableContext
          items={stops.map(s => `stop-${s.deliveryId}`)}
          strategy={verticalListSortingStrategy}
        >
          <div className="px-3 pt-3 pb-3 space-y-2">
          {stops.map((stop, idx) => {
            if (stop.isWarehouseDrop) {
              return (
                <StopCard
                  key={stop.deliveryId}
                  stop={stop}
                  index={idx}
                  truckId={truck.id}
                  customerName="Warehouse"
                  orderItems={[]}
                  orderTotalCases={0}
                  empakaNote=""
                  onEmpakaChange={() => {}}
                  products={products}
                  productById={productById}
                  onRemove={() => onRemoveStop(stop.deliveryId)}
                  onUpdateDeliveryItems={(items) => onUpdateDeliveryItems(stop.deliveryId, items)}
                  onUpdateOrderItems={() => Promise.resolve()}
                  onToggleEmpako={() => Promise.resolve()}
                />
              )
            }
            const order    = orderById.get(stop.orderId!)
            const customer = customerById.get(order?.customer_id ?? -1)
            const rawOrderItems = orderItemsByOrder[stop.orderId!] ?? []
            const orderTotalCases = rawOrderItems.reduce((s, i) => s + i.cases, 0)
            const empakaNote = empakaByOrder[stop.orderId!] ?? ''
            const customerName = customer?.name ?? `Order #${stop.orderId}`
            return (
              <StopCard
                key={stop.deliveryId}
                stop={stop}
                index={idx}
                truckId={truck.id}
                customerName={customerName}
                orderItems={rawOrderItems.map(i => ({ productId: i.product_id, cases: i.cases, empako: i.empako }))}
                orderTotalCases={orderTotalCases}
                empakaNote={empakaNote}
                defaultEmpakaName={customerName}
                onEmpakaChange={text => onEmpakaChange(stop.orderId!, text)}
                products={products}
                productById={productById}
                onRemove={() => onRemoveStop(stop.deliveryId)}
                onUpdateDeliveryItems={(items) => onUpdateDeliveryItems(stop.deliveryId, items)}
                onUpdateOrderItems={(pid, cs) => onUpdateOrderItems(stop.orderId!, pid, cs)}
                onToggleEmpako={(pid, emp) => onToggleEmpako(stop.orderId!, pid, emp)}
              />
            )
          })}
          </div>
        </SortableContext>

        {stops.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-stone-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <p className="text-xs font-sans mt-2">Drop orders here</p>
          </div>
        )}

        {!hasWarehouseStop && (
          <div className="px-4 py-3 border-t border-stone-100">
            <button
              onClick={onDropClick}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold font-sans text-stone-500 bg-stone-50 hover:bg-stone-100 border border-stone-200 hover:border-stone-300 rounded-lg transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <path d="M9 22V12h6v10" />
              </svg>
              Add Warehouse Delivery
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

// ── StopEditDialog ────────────────────────────────────────────────────────────

function StopEditDialog({
  open, onClose, stop, orderItems, products, onSaveOrderItem, onSaveDelivery, onToggleEmpako,
}: {
  open: boolean
  onClose: () => void
  stop: TruckStop
  orderItems: { productId: string; cases: number; empako?: boolean }[]
  products: DeliveryProduct[]
  onSaveOrderItem: (productId: string, cases: number) => Promise<void>
  onSaveDelivery: (items: { productId: string; cases: number }[]) => Promise<void>
  onToggleEmpako: (productId: string, empako: boolean) => Promise<void>
}) {
  const [ordAmounts, setOrdAmounts] = useState<Record<string, string>>({})
  const [dlvAmounts, setDlvAmounts] = useState<Record<string, string>>({})
  const [empakoState, setEmpakoState] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      const ord: Record<string, string> = {}
      const dlv: Record<string, string> = {}
      const emp: Record<string, boolean> = {}
      for (const i of orderItems) {
        ord[i.productId] = String(i.cases)
        emp[i.productId] = i.empako ?? false
      }
      for (const i of stop.items) dlv[i.productId] = String(i.cases)
      setOrdAmounts(ord)
      setDlvAmounts(dlv)
      setEmpakoState(emp)
    }
  }, [open, orderItems, stop.items])

  function handleOrdChange(productId: string, value: string) {
    const newOrdN = parseInt(value) || 0
    setOrdAmounts(prev => ({ ...prev, [productId]: value }))
    // Cap delivery to ordered — delivery can never exceed ordered amount
    const currentDlv = parseInt(dlvAmounts[productId] ?? '0') || 0
    if (currentDlv > newOrdN) {
      setDlvAmounts(prev => ({ ...prev, [productId]: String(newOrdN) }))
    }
  }

  async function handleSave() {
    setSaving(true)
    const promises: Promise<void>[] = []

    for (const p of products) {
      const newOrd = parseInt(ordAmounts[p.id] ?? '0') || 0
      const oldOrd = orderItems.find(i => i.productId === p.id)?.cases ?? 0
      if (newOrd !== oldOrd) promises.push(onSaveOrderItem(p.id, newOrd))

      if (!SPREAD_PRODUCT_IDS.has(p.id)) {
        const newEmpako = empakoState[p.id] ?? false
        const oldEmpako = orderItems.find(i => i.productId === p.id)?.empako ?? false
        if (newEmpako !== oldEmpako) promises.push(onToggleEmpako(p.id, newEmpako))
      }
    }
    await Promise.all(promises)

    const newDelivery = products
      .map(p => ({ productId: p.id, cases: parseInt(dlvAmounts[p.id] ?? '0') || 0 }))
      .filter(i => i.cases > 0)
    await onSaveDelivery(newDelivery)

    setSaving(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm max-h-[90svh] grid-rows-[auto_auto_1fr_auto]">
        <DialogHeader>
          <DialogTitle>Edit Order</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-stone-400 font-sans -mt-1">
          Change <span className="font-medium text-stone-600">Ordered</span> to update the order, or change <span className="font-medium text-stone-600">Deliver</span> to set what goes on this truck. Deliver is capped to Ordered.
        </p>
        <div className="min-h-0 overflow-y-auto border border-stone-100 rounded-xl">
          <div className="grid grid-cols-[1fr_44px_72px_72px] px-4 py-2 bg-stone-50 border-b border-stone-100 text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans gap-2">
            <span>Product</span>
            <span className="text-center">40x1</span>
            <span className="text-right">Ordered</span>
            <span className="text-right">Deliver</span>
          </div>
          {products.map(p => {
            const ordVal = ordAmounts[p.id] ?? '0'
            const dlvVal = dlvAmounts[p.id] ?? '0'
            const ordN   = parseInt(ordVal) || 0
            const dlvN   = parseInt(dlvVal) || 0
            const isActive    = ordN > 0 || dlvN > 0
            const isPartialRow = dlvN > 0 && dlvN < ordN
            const isEmpako    = empakoState[p.id] ?? false
            const isSpread    = SPREAD_PRODUCT_IDS.has(p.id)
            return (
              <div
                key={p.id}
                className={cn(
                  'grid grid-cols-[1fr_44px_72px_72px] items-center px-4 py-2 border-b border-stone-50 last:border-0 gap-2',
                  isEmpako && isActive ? 'bg-amber-50/40' : isActive ? 'bg-emerald-50/40' : '',
                )}
              >
                <span className={cn('text-sm font-sans truncate', isActive ? 'text-stone-800 font-medium' : 'text-stone-400')}>
                  {getProductAbbr(p)}
                </span>
                {isSpread ? (
                  <div className="text-center text-stone-300 text-xs select-none">—</div>
                ) : (
                  <div className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={isEmpako}
                      onChange={e => setEmpakoState(prev => ({ ...prev, [p.id]: e.target.checked }))}
                      className="w-4 h-4 accent-orange-500 cursor-pointer"
                    />
                  </div>
                )}
                <input
                  type="number" min={0} value={ordVal}
                  onChange={e => handleOrdChange(p.id, e.target.value)}
                  onFocus={e => e.target.select()}
                  className="w-full px-2 py-1 text-sm font-mono text-right border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 [appearance:auto]"
                />
                <input
                  type="number" min={0} max={ordN} value={dlvVal}
                  onChange={e => setDlvAmounts(prev => ({ ...prev, [p.id]: e.target.value }))}
                  onFocus={e => e.target.select()}
                  className={cn(
                    'w-full px-2 py-1 text-sm font-mono text-right border rounded-lg focus:outline-none focus:ring-2 [appearance:auto]',
                    isPartialRow
                      ? 'border-amber-300 bg-amber-50/60 focus:ring-amber-200'
                      : 'border-stone-200 focus:ring-stone-300',
                  )}
                />
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <button onClick={onClose} className="px-4 py-2 text-sm font-sans font-medium text-stone-500 hover:text-stone-700 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-semibold font-sans rounded-xl bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── StopCard (sortable within truck) ─────────────────────────────────────────

function StopCard({ stop, index, truckId, customerName, orderItems, orderTotalCases, empakaNote, defaultEmpakaName, onEmpakaChange, products, productById, onRemove, onUpdateDeliveryItems, onUpdateOrderItems, onToggleEmpako }: {
  stop: TruckStop
  index: number
  truckId: number
  customerName: string
  orderItems: { productId: string; cases: number; empako?: boolean }[]
  orderTotalCases: number
  empakaNote: string
  defaultEmpakaName?: string
  onEmpakaChange: (text: string) => void
  products: DeliveryProduct[]
  productById: Map<string, DeliveryProduct>
  onRemove: () => void
  onUpdateDeliveryItems: (items: { productId: string; cases: number }[]) => Promise<void>
  onUpdateOrderItems: (productId: string, cases: number) => Promise<void>
  onToggleEmpako: (productId: string, empako: boolean) => Promise<void>
}) {
  const [editOpen, setEditOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `stop-${stop.deliveryId}`,
    data: { type: 'stop', truckId, deliveryId: stop.deliveryId },
  })

  const style = { transform: CSS.Transform.toString(transform), transition }

  const stopCases = stop.items.reduce((s, i) => s + i.cases, 0)
  const isPartial = !stop.isWarehouseDrop && orderTotalCases > 0 && stopCases < orderTotalCases
  const showButtons = !stop.isWarehouseDrop && !stop.finalized
  const hasEmpako = !stop.isWarehouseDrop && orderItems.some(i => i.empako)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        'bg-white rounded-xl border border-stone-100 shadow-sm overflow-hidden',
        isDragging && 'opacity-40',
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="flex items-start gap-2 min-w-0">
          {/* Drag handle */}
          <button
            {...listeners}
            className="flex-shrink-0 mt-1 cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-400 touch-none transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
              <circle cx="7" cy="4"  r="1.5"/><circle cx="7" cy="10" r="1.5"/><circle cx="7" cy="16" r="1.5"/>
              <circle cx="13" cy="4" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="13" cy="16" r="1.5"/>
            </svg>
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-sans font-semibold text-stone-800 truncate">
                <span className="text-stone-400 font-normal mr-1.5">{index + 1}.</span>{customerName}
              </span>
              {stop.isWarehouseDrop && (
                <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 flex-shrink-0">Drop</span>
              )}
              {isPartial && (
                <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 flex-shrink-0">Partial</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          {showButtons && (
            <button
              onClick={() => setEditOpen(true)}
              className="px-2 py-0.5 text-[11px] font-semibold font-sans rounded-md bg-stone-50 text-stone-600 hover:bg-stone-100 transition-colors"
            >
              Edit
            </button>
          )}
          {!stop.finalized && (
            <button
              onClick={onRemove}
              className="px-2 py-0.5 text-[11px] font-semibold font-sans rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* ── 40x1 label ── */}
      {hasEmpako && (
        <div className="px-3 py-1.5 border-t border-amber-100 bg-amber-50/50 flex items-center gap-1.5">
          <span className="text-xs font-semibold font-sans text-orange-500 flex-shrink-0">40x1:</span>
          <EmpakaInput
            note={empakaNote}
            defaultName={defaultEmpakaName ?? customerName}
            onChange={onEmpakaChange}
          />
        </div>
      )}

      {/* ── Product table ── */}
      {(() => {
        const dlvMap: Record<string, number> = {}
        for (const i of stop.items) dlvMap[i.productId] = i.cases
        const ordMap: Record<string, number> = {}
        const empakoMap: Record<string, boolean> = {}
        for (const i of orderItems) {
          ordMap[i.productId] = i.cases
          empakoMap[i.productId] = i.empako ?? false
        }

        const pidSet = new Set([
          ...stop.items.map(i => i.productId),
          ...(isPartial ? orderItems.map(i => i.productId) : []),
        ])
        const tableProds = [...pidSet]
          .map(id => productById.get(id))
          .filter((p): p is DeliveryProduct => p != null)
          .sort((a, b) => a.display_order - b.display_order)

        if (!tableProds.length) return null
        return (
          <div className="border-t border-stone-100 overflow-x-auto">
            <table className="text-xs font-sans">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50/70">
                  <th className="px-3 py-1.5 text-left font-medium text-stone-300 whitespace-nowrap w-10" />
                  {tableProds.map(p => (
                    <th key={p.id} className="px-2 py-1.5 text-left font-medium text-stone-400 whitespace-nowrap pr-4 last:pr-2">
                      {getProductAbbr(p)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isPartial && (
                  <tr className="border-b border-stone-50">
                    <td className="px-3 py-1.5 text-stone-400 font-medium whitespace-nowrap text-[10px] uppercase tracking-wide">Ord</td>
                    {tableProds.map(p => (
                      <td key={p.id} className="px-2 py-1.5 text-left font-mono tabular-nums text-stone-600 pr-4 last:pr-2">
                        {ordMap[p.id] != null ? (
                          <>
                            {ordMap[p.id]}
                            {empakoMap[p.id] && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                          </>
                        ) : <span className="text-stone-200">—</span>}
                      </td>
                    ))}
                  </tr>
                )}
                <tr>
                  <td className={cn('px-3 py-1.5 font-medium whitespace-nowrap text-[10px] uppercase tracking-wide', isPartial ? 'text-amber-600' : 'text-stone-400')}>
                    Dlv
                  </td>
                  {tableProds.map(p => (
                    <td key={p.id} className="px-2 py-1.5 text-left font-mono tabular-nums text-stone-700 pr-4 last:pr-2">
                      {dlvMap[p.id] != null ? (
                        <>
                          {dlvMap[p.id]}
                          {empakoMap[p.id] && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                        </>
                      ) : <span className="text-stone-200">—</span>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )
      })()}

      <StopEditDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        stop={stop}
        orderItems={orderItems}
        products={products}
        onSaveOrderItem={onUpdateOrderItems}
        onSaveDelivery={onUpdateDeliveryItems}
        onToggleEmpako={onToggleEmpako}
      />
    </div>
  )
}

// ── FulfilledOrderCard ────────────────────────────────────────────────────────

function FulfilledOrderCard({
  order, customer, totalCases, deliveries, remaining, productById, products, items, viewingDate, onGoToTruck, onUpdateItem, onToggleEmpako,
}: {
  order: Order
  customer: Customer | null
  totalCases: number
  deliveries: { truckId: number; truckName: string; date: string; cases: number }[]
  remaining: OrderRemaining | null
  productById: Map<string, DeliveryProduct>
  products: DeliveryProduct[]
  items: OrderItem[]
  viewingDate: string
  onGoToTruck: (truckId: number) => void
  onUpdateItem: (productId: string, cases: number) => Promise<void>
  onToggleEmpako: (productId: string, empako: boolean) => Promise<void>
}) {
  const router = useRouter()
  const [showDeliveries, setShowDeliveries] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const itemRows = remaining
    ? Object.entries(remaining.byItem)
        .filter(([, v]) => v.ordered > 0)
        .sort(([a], [b]) => (productById.get(a)?.display_order ?? 999) - (productById.get(b)?.display_order ?? 999))
    : []

  return (
    <div className="bg-white rounded-xl border border-emerald-100 shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-sans font-semibold text-stone-800 truncate">
              {customer?.name ?? `Customer #${order.customer_id}`}
            </span>
            <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 font-sans bg-emerald-100 text-emerald-700 flex-shrink-0">
              Fulfilled
            </span>
          </div>
          <p className="text-[11px] font-sans text-stone-400 mt-0.5">{orderDateLabel(order, viewingDate)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-mono text-stone-400 tabular-nums">{totalCases} cs</span>
          <button
            onClick={() => setEditOpen(true)}
            className="px-2 py-0.5 text-[11px] font-semibold font-sans rounded-md bg-stone-50 text-stone-600 hover:bg-stone-100 transition-colors"
          >
            Edit
          </button>
        </div>
      </div>

      {/* ── Product table ── */}
      {itemRows.length > 0 ? (
        <div className="border-t border-stone-100 overflow-x-auto">
          <table className="text-xs font-sans">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50/70">
                <th className="px-3 py-1.5 text-left font-medium text-stone-300 whitespace-nowrap w-10" />
                {itemRows.map(([pid]) => (
                  <th key={pid} className="px-2 py-1.5 text-left font-medium text-stone-400 whitespace-nowrap pr-4 last:pr-2">
                    {getProductAbbr({ id: pid, name: productById.get(pid)?.name ?? pid })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-1.5 text-emerald-600 font-medium whitespace-nowrap text-[10px] uppercase tracking-wide">Dlv</td>
                {itemRows.map(([pid, v]) => (
                  <td key={pid} className={cn('px-2 py-1.5 text-left font-mono tabular-nums font-semibold pr-4 last:pr-2', v.delivered === 0 ? 'text-stone-200' : 'text-emerald-600')}>
                    {v.delivered}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-3 pb-2 text-xs text-stone-300 font-sans">No items</p>
      )}

      {/* Notes */}
      {order.notes && (
        <p className="px-3 pt-1 pb-1 text-xs font-sans text-stone-400 italic border-t border-stone-50">{order.notes}</p>
      )}

      {/* Past deliveries — toggle button + inline expand below */}
      <div className="border-t border-stone-100">
        <button
          onClick={() => setShowDeliveries(v => !v)}
          className="w-full px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-semibold font-sans text-sky-600 hover:bg-sky-50 transition-colors"
        >
          <svg
            className={cn('w-3 h-3 transition-transform duration-150 flex-shrink-0', showDeliveries && 'rotate-90')}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          Past Deliveries
        </button>
        {showDeliveries && deliveries.length > 0 && (
          <div className="px-3 pb-2 space-y-0.5 border-t border-stone-50">
            {deliveries.map((d, i) => (
              <button
                key={i}
                onClick={() => d.date === viewingDate ? onGoToTruck(d.truckId) : router.push(`/delivery/dashboard?date=${d.date}`)}
                className="w-full flex items-center justify-between py-1 px-1.5 rounded-lg hover:bg-stone-50 transition-colors text-left group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-sans font-medium text-stone-500">{d.truckName}</span>
                  {d.date !== viewingDate && (
                    <span className="text-[11px] font-sans text-stone-400">{fmtDate(d.date)}</span>
                  )}
                </div>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className="text-stone-300 group-hover:text-stone-500 transition-colors flex-shrink-0" strokeLinecap="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>

      <EditOrderDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        items={items}
        products={products}
        onSave={onUpdateItem}
        onToggleEmpako={onToggleEmpako}
      />
    </div>
  )
}

// ── PartialDialog ─────────────────────────────────────────────────────────────

function PartialDialog({
  open, onClose, initialOrderId, initialTruckId,
  orders, trucks, products, productById, customerById,
  orderRemainingMap, orderItemsByOrder, remainingInventory, truckLoads, truckProductTotals, onSubmit,
}: {
  open: boolean
  onClose: () => void
  initialOrderId: number | null
  initialTruckId: number | null
  orders: Order[]
  trucks: Truck[]
  products: DeliveryProduct[]
  productById: Map<string, DeliveryProduct>
  customerById: Map<number, Customer>
  orderRemainingMap: Map<number, OrderRemaining>
  orderItemsByOrder: Record<number, OrderItem[]>
  remainingInventory: Record<string, number>
  truckLoads: Record<number, number>
  truckProductTotals: Record<number, Record<string, number>>
  onSubmit: (orderId: number, truckId: number, items: { productId: string; cases: number }[]) => Promise<void>
}) {
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null)
  const [selectedTruckId, setSelectedTruckId] = useState<number | null>(null)
  const [sendAmounts, setSendAmounts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setSelectedOrderId(initialOrderId)
      setSelectedTruckId(initialTruckId)
      setSendAmounts({})
    }
  }, [open, initialOrderId, initialTruckId])

  useEffect(() => {
    setSendAmounts({})
  }, [selectedOrderId])

  const remaining = selectedOrderId ? orderRemainingMap.get(selectedOrderId) : undefined
  const totalSend = Object.values(sendAmounts).reduce((s, v) => s + (parseInt(v) || 0), 0)
  const eligibleOrders = orders.filter(o => (orderRemainingMap.get(o.id)?.totalRemaining ?? 0) > 0)

  const previewLoad = selectedTruckId ? (truckLoads[selectedTruckId] ?? 0) + totalSend : 0
  const previewProductTotals = useMemo(() => {
    if (!selectedTruckId) return {}
    const base = { ...(truckProductTotals[selectedTruckId] ?? {}) }
    for (const [pid, val] of Object.entries(sendAmounts)) {
      const n = parseInt(val) || 0
      if (n > 0) base[pid] = (base[pid] ?? 0) + n
    }
    return base
  }, [selectedTruckId, truckProductTotals, sendAmounts])

  const hasInventoryViolation = Object.entries(sendAmounts).some(([pid, val]) => {
    const n = parseInt(val) || 0
    if (n <= 0) return false
    const isEmpako = !SPREAD_PRODUCT_IDS.has(pid) &&
      (selectedOrderId ? (orderItemsByOrder[selectedOrderId] ?? []).find(i => i.product_id === pid)?.empako ?? false : false)
    const needed = isEmpako ? n * 2 : n
    return needed > (remainingInventory[pid] ?? 0)
  })

  async function handleSubmit() {
    if (!selectedOrderId || !selectedTruckId) return
    const items = products
      .map(p => ({ productId: p.id, cases: parseInt(sendAmounts[p.id] ?? '0') || 0 }))
      .filter(i => i.cases > 0)
    if (!items.length) { toast('No items to send', 'error'); return }
    setSubmitting(true)
    await onSubmit(selectedOrderId, selectedTruckId, items)
    setSubmitting(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Partial Delivery</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Order selector */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-stone-500 font-sans">Order</label>
            <select
              value={selectedOrderId ?? ''}
              onChange={e => setSelectedOrderId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
            >
              <option value="">Select order…</option>
              {eligibleOrders.map(o => {
                const c   = customerById.get(o.customer_id)
                const rem = orderRemainingMap.get(o.id)
                return (
                  <option key={o.id} value={o.id}>
                    {c?.name ?? `Order #${o.id}`} — {rem?.totalRemaining ?? 0} cs remaining
                  </option>
                )
              })}
            </select>
          </div>

          {/* Truck selector */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-stone-500 font-sans">Truck</label>
            <select
              value={selectedTruckId ?? ''}
              onChange={e => setSelectedTruckId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
            >
              <option value="">Select truck…</option>
              {trucks.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Truck capacity bar */}
          {selectedTruckId && (() => {
            const t = trucks.find(tr => tr.id === selectedTruckId)
            if (!t) return null
            return (
              <div className="px-3 py-2 bg-stone-50 rounded-lg">
                <TruckCapacityBar
                  truck={t}
                  load={previewLoad}
                  productTotals={previewProductTotals}
                  productById={productById}
                />
              </div>
            )
          })()}

          {/* Items table */}
          {remaining && (
            <div className="border border-stone-100 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-xs font-sans">
                <thead className="bg-stone-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-stone-500 font-medium">Product</th>
                    <th className="px-3 py-2 text-right text-stone-500 font-medium">Ordered</th>
                    <th className="px-3 py-2 text-right text-stone-500 font-medium">Remaining</th>
                    <th className="px-3 py-2 text-right text-stone-500 font-medium">Avail</th>
                    <th className="px-3 py-2 text-right text-stone-500 font-medium w-24">Send</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(remaining.byItem)
                    .filter(([, v]) => v.ordered > 0)
                    .sort(([a], [b]) => (productById.get(a)?.display_order ?? 999) - (productById.get(b)?.display_order ?? 999))
                    .map(([pid, v]) => {
                      const isEmpako = !SPREAD_PRODUCT_IDS.has(pid) &&
                        (selectedOrderId ? (orderItemsByOrder[selectedOrderId] ?? []).find(i => i.product_id === pid)?.empako ?? false : false)
                      const rawAvail = remainingInventory[pid] ?? 0
                      // For empako items: avail in 40x1 units = floor(20x1 remaining / 2)
                      const avail = isEmpako ? Math.floor(rawAvail / 2) : rawAvail
                      const effectiveMax = Math.min(v.remaining, avail)
                      const sendVal = parseInt(sendAmounts[pid] ?? '0') || 0
                      const overInventory = sendVal > avail
                      const dynamicRemaining = Math.max(0, v.remaining - sendVal)
                      return (
                        <tr key={pid} className="border-t border-stone-50">
                          <td className="px-3 py-2 text-stone-700">
                            <span>{productById.get(pid)?.name ?? pid}</span>
                            {isEmpako && (
                              <span className="ml-1.5 text-[9px] font-semibold font-sans px-1 py-0.5 rounded bg-amber-100 text-amber-700">40×1</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-stone-400 tabular-nums">{v.ordered}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            <span className={dynamicRemaining === 0 ? 'text-emerald-500' : 'text-stone-500'}>
                              {dynamicRemaining}
                            </span>
                          </td>
                          <td className={cn('px-3 py-2 text-right tabular-nums text-xs', avail < v.remaining ? 'text-amber-600 font-semibold' : 'text-stone-400')}>
                            {avail}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={effectiveMax}
                                value={sendAmounts[pid] ?? '0'}
                                onChange={e => setSendAmounts(prev => ({ ...prev, [pid]: e.target.value }))}
                                className={cn(
                                  'w-14 px-2 py-1 text-right text-xs font-mono border rounded-lg focus:outline-none focus:ring-2 [appearance:auto]',
                                  overInventory
                                    ? 'border-red-300 bg-red-50 text-red-700 focus:ring-red-300'
                                    : 'border-stone-200 focus:ring-stone-300',
                                )}
                              />
                              <button
                                onClick={() => setSendAmounts(prev => ({ ...prev, [pid]: String(effectiveMax) }))}
                                title="Fill to max (order remaining or inventory)"
                                className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-stone-300 hover:text-stone-600 hover:bg-stone-100 transition-colors"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                  <path d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="text-xs font-mono tabular-nums self-center">
            {hasInventoryViolation
              ? <span className="text-red-500 font-sans text-xs">Exceeds inventory</span>
              : <span className="text-stone-400">{totalSend} cs total</span>}
          </span>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedOrderId || !selectedTruckId || totalSend === 0 || hasInventoryViolation}
            className="px-4 py-2 text-sm font-semibold font-sans rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-40 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create Delivery'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── WarehouseDropDialog ────────────────────────────────────────────────────────

function WarehouseDropDialog({
  open, onClose, initialTruckId, trucks, products, productById,
  warehouse, dropsByProduct, remainingInventory, truckLoads, truckProductTotals, onSubmit,
}: {
  open: boolean
  onClose: () => void
  initialTruckId: number | null
  trucks: Truck[]
  products: DeliveryProduct[]
  productById: Map<string, DeliveryProduct>
  warehouse: Record<string, { pickup: number; stock: number }>
  dropsByProduct: Record<string, number>
  remainingInventory: Record<string, number>
  truckLoads: Record<number, number>
  truckProductTotals: Record<number, Record<string, number>>
  onSubmit: (truckId: number, items: { productId: string; cases: number }[]) => Promise<void>
}) {
  const [selectedTruckId, setSelectedTruckId] = useState<number | null>(null)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setSelectedTruckId(initialTruckId)
      setAmounts({})
    }
  }, [open, initialTruckId])

  const totalCases = Object.values(amounts).reduce((s, v) => s + (parseInt(v) || 0), 0)

  const previewLoad = selectedTruckId ? (truckLoads[selectedTruckId] ?? 0) + totalCases : 0
  const previewProductTotals = useMemo(() => {
    if (!selectedTruckId) return {}
    const base = { ...(truckProductTotals[selectedTruckId] ?? {}) }
    for (const [pid, val] of Object.entries(amounts)) {
      const n = parseInt(val) || 0
      if (n > 0) base[pid] = (base[pid] ?? 0) + n
    }
    return base
  }, [selectedTruckId, truckProductTotals, amounts])

  // Products that have warehouse data
  const warehouseProducts = products.filter(p => {
    const w = warehouse[p.id]
    return w && (w.pickup > 0 || w.stock > 0)
  })

  const hasInventoryViolation = warehouseProducts.some(p => {
    const n = parseInt(amounts[p.id] ?? '0') || 0
    return n > (remainingInventory[p.id] ?? 0)
  })

  async function handleSubmit() {
    if (!selectedTruckId) return
    const items = products
      .map(p => ({ productId: p.id, cases: parseInt(amounts[p.id] ?? '0') || 0 }))
      .filter(i => i.cases > 0)
    if (!items.length) { return }
    setSubmitting(true)
    await onSubmit(selectedTruckId, items)
    setSubmitting(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Warehouse Drop</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-stone-500 font-sans">Truck</label>
            <select
              value={selectedTruckId ?? ''}
              onChange={e => setSelectedTruckId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
            >
              <option value="">Select truck…</option>
              {trucks.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Truck capacity bar */}
          {selectedTruckId && (() => {
            const t = trucks.find(tr => tr.id === selectedTruckId)
            if (!t) return null
            return (
              <div className="px-3 py-2 bg-stone-50 rounded-lg">
                <TruckCapacityBar
                  truck={t}
                  load={previewLoad}
                  productTotals={previewProductTotals}
                  productById={productById}
                />
              </div>
            )
          })()}

          {/* Items table */}
          <div className="border border-stone-100 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-xs font-sans">
              <thead className="bg-stone-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-stone-500 font-medium">Product</th>
                  <th className="px-3 py-2 text-right text-stone-500 font-medium">Ordered</th>
                  <th className="px-3 py-2 text-right text-stone-500 font-medium">Stock</th>
                  <th className="px-3 py-2 text-right text-stone-500 font-medium">Needed</th>
                  <th className="px-3 py-2 text-right text-stone-500 font-medium">Avail</th>
                  <th className="px-3 py-2 text-right text-stone-500 font-medium w-24">Send</th>
                </tr>
              </thead>
              <tbody>
                {warehouseProducts.map(p => {
                  const w = warehouse[p.id]!
                  const avail = remainingInventory[p.id] ?? 0
                  const alreadyDropped = dropsByProduct[p.id] ?? 0
                  const needed = Math.max(0, w.pickup - w.stock - alreadyDropped)
                  const sendVal = parseInt(amounts[p.id] ?? '0') || 0
                  const overInventory = sendVal > avail
                  const dynamicNeeded = Math.max(0, needed - sendVal)
                  return (
                    <tr key={p.id} className="border-t border-stone-50">
                      <td className="px-3 py-2 text-stone-700">{productById.get(p.id)?.name ?? p.id}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-400">{w.pickup}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">{w.stock}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                        <span className={dynamicNeeded === 0 ? 'text-emerald-500' : 'text-stone-500'}>
                          {dynamicNeeded}
                        </span>
                      </td>
                      <td className={cn('px-3 py-2 text-right font-mono tabular-nums', avail === 0 ? 'text-red-500 font-semibold' : avail < needed ? 'text-amber-600 font-semibold' : 'text-stone-400')}>
                        {avail}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={avail}
                            value={amounts[p.id] ?? '0'}
                            onChange={e => setAmounts(prev => ({ ...prev, [p.id]: e.target.value }))}
                            className={cn(
                              'w-14 px-2 py-1 text-right text-xs font-mono border rounded-lg focus:outline-none focus:ring-2 [appearance:auto]',
                              overInventory
                                ? 'border-red-300 bg-red-50 text-red-700 focus:ring-red-300'
                                : 'border-stone-200 focus:ring-stone-300',
                            )}
                          />
                          <button
                            onClick={() => setAmounts(prev => ({ ...prev, [p.id]: String(Math.min(needed, avail)) }))}
                            title="Fill needed (capped by inventory)"
                            disabled={needed === 0 || avail === 0}
                            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-stone-300 hover:text-stone-600 hover:bg-stone-100 transition-colors disabled:opacity-30"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="text-xs font-mono tabular-nums self-center">
            {hasInventoryViolation
              ? <span className="text-red-500 font-sans text-xs">Exceeds inventory</span>
              : <span className="text-stone-400">{totalCases} cs total</span>}
          </span>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedTruckId || totalCases === 0 || hasInventoryViolation}
            className="px-4 py-2 text-sm font-semibold font-sans rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-40 transition-colors"
          >
            {submitting ? 'Saving…' : 'Add Drop'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── EmpakaInput ────────────────────────────────────────────────────────────────

function EmpakaInput({ note, defaultName, onChange }: {
  note: string
  defaultName: string
  onChange: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(note || defaultName)

  useEffect(() => {
    if (!editing) setValue(note || defaultName)
  }, [note, defaultName, editing])

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => { setEditing(false); onChange(value) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { setEditing(false); onChange(value) }
          if (e.key === 'Escape') { setEditing(false); setValue(note || defaultName) }
        }}
        className="flex-1 min-w-0 text-xs font-sans font-semibold text-stone-800 bg-white border border-amber-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-xs font-sans font-semibold text-stone-800 hover:text-amber-700 hover:underline transition-colors text-left truncate"
    >
      {note || defaultName || 'Click to set…'}
    </button>
  )
}
