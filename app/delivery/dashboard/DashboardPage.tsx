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
import type { DeliveryProduct, Customer, Truck, Order, OrderItem, Delivery, DeliveryItem, WarehouseDrop, BodegaRow } from '@/lib/delivery-types'
import { getProductAbbr, SPREAD_PRODUCT_IDS, CONDITIONAL_SHOW_PRODUCT_IDS } from '@/lib/delivery-types'
import { BodegaTable } from '../BodegaTable'
import { TruckSummary } from '../summary/SummaryPage'

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
  initialBodegas: BodegaRow[]
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
  inventory, inventory40x1, warehouse, warehouseDrops, initialBodegas, date,
}: Props) {
  const initialStops = useMemo(() => buildInitialStops(deliveries, deliveryItems, trucks, warehouseDrops), [])

  const [stops, setStops] = useState<Map<number, TruckStop[]>>(initialStops)
  const stopsRef = useRef<Map<number, TruckStop[]>>(initialStops)
  const [localOrderItems, setLocalOrderItems] = useState<OrderItem[]>(orderItems)
  const localOrderItemsRef = useRef<OrderItem[]>(orderItems)
  const [localAllDeliveries, setLocalAllDeliveries] = useState<Delivery[]>(allOrderDeliveries)
  const localAllDeliveriesRef = useRef<Delivery[]>(allOrderDeliveries)
  const [localAllDeliveryItems, setLocalAllDeliveryItems] = useState<DeliveryItem[]>(allOrderDeliveryItems)
  const localAllDeliveryItemsRef = useRef<DeliveryItem[]>(allOrderDeliveryItems)
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

  const [empakaByOrder, setEmpakaByOrder] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    for (const o of orders) init[o.id] = o.empaka_note ?? ''
    return init
  })
  const empakaTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const [cancelledOrderIds, setCancelledOrderIds] = useState<Set<number>>(new Set())
  const [localNewOrders, setLocalNewOrders] = useState<Order[]>([])
  const [newOrderOpen, setNewOrderOpen] = useState(false)

  const [localWarehouse, setLocalWarehouse] = useState(warehouse)
  const localWarehouseRef = useRef(warehouse)
  const warehouseEditTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [editingWarehouseCell, setEditingWarehouseCell] = useState<{ productId: string; field: 'pickup' | 'stock' } | null>(null)
  const [editWarehouseValue, setEditWarehouseValue] = useState('')

  const [bodegas, setBodegas] = useState<BodegaRow[]>(initialBodegas)
  const bodegaRef = useRef<BodegaRow[]>(initialBodegas)
  const bodegaTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [bodegaDialogOpen, setBodegaDialogOpen] = useState(false)

  const [showSummary, setShowSummary] = useState(false)
  const [summaryExpanded, setSummaryExpanded] = useState<Set<number>>(() => new Set(trucks.map(t => t.id)))

  const [truckNotes, setTruckNotes] = useState<Record<number, string>>({})
  useEffect(() => {
    const result: Record<number, string> = {}
    for (const t of trucks) {
      const v = localStorage.getItem(`truck-note-${t.id}-${date}`)
      if (v) result[t.id] = v
    }
    setTruckNotes(result)
  }, [])
  const handleTruckNoteChange = useCallback((truckId: number, note: string) => {
    setTruckNotes(prev => ({ ...prev, [truckId]: note }))
    if (note) localStorage.setItem(`truck-note-${truckId}-${date}`, note)
    else localStorage.removeItem(`truck-note-${truckId}-${date}`)
  }, [date])

  useEffect(() => { localAllDeliveriesRef.current = localAllDeliveries }, [localAllDeliveries])
  useEffect(() => { localAllDeliveryItemsRef.current = localAllDeliveryItems }, [localAllDeliveryItems])

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
  const truckById    = useMemo(() => new Map(trucks.map(t => [t.id, t])), [trucks])

  const orderItemsByOrder = useMemo(() => {
    const m: Record<number, OrderItem[]> = {}
    for (const i of localOrderItems) {
      if (!m[i.order_id]) m[i.order_id] = []
      m[i.order_id].push(i)
    }
    return m
  }, [localOrderItems])

  // ── Summary panel data (converts local stops → Delivery/DeliveryItem shape) ─
  const summaryData = useMemo(() => trucks.map(truck => {
    const truckStops = stops.get(truck.id) ?? []
    const nonWhStops = truckStops.filter(s => !s.isWarehouseDrop)
    const fakeDels: Delivery[] = nonWhStops.map(s => ({
      id: s.deliveryId, order_id: s.orderId!, truck_id: truck.id,
      delivery_date: date, stop_order: s.stopOrder, finalized: s.finalized, created_at: '',
    }))
    const fakeItems: Record<number, DeliveryItem[]> = {}
    for (const s of nonWhStops) {
      fakeItems[s.deliveryId] = s.items.map((item, idx) => ({
        id: idx, delivery_id: s.deliveryId, product_id: item.productId, cases: item.cases,
      }))
    }
    const drops = localWarehouseDrops.filter(d => d.truck_id === truck.id)
    return { truck, deliveries: fakeDels, itemsByDelivery: fakeItems, drops }
  }), [trucks, stops, localWarehouseDrops, date])

  // ── Remaining (partial delivery) ─────────────────────────────────────────

  const visibleOrders = useMemo(() => {
    const base = cancelledOrderIds.size === 0 ? orders : orders.filter(o => !cancelledOrderIds.has(o.id))
    return localNewOrders.length === 0 ? base : [...base, ...localNewOrders]
  }, [orders, cancelledOrderIds, localNewOrders])

  const orderById = useMemo(() => new Map(visibleOrders.map(o => [o.id, o])), [visibleOrders])

  const sevenDaysAgo = useMemo(() => {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() - 7)
    return d.toLocaleDateString('en-CA')
  }, [date])

  const orderRemainingMap = useMemo(() => {
    const map = new Map<number, OrderRemaining>()
    for (const order of visibleOrders) {
      const items = orderItemsByOrder[order.id] ?? []
      map.set(order.id, getOrderRemaining(order.id, items, localAllDeliveries, localAllDeliveryItems))
    }
    return map
  }, [visibleOrders, orderItemsByOrder, localAllDeliveries, localAllDeliveryItems])

  // ── Inventory / capacity ──────────────────────────────────────────────────

  const inventoryDisplayProducts = products

  const { assignedEmpako, assignedRegular } = useMemo(() => {
    const assignedEmpako: Record<string, number> = {}
    const assignedRegular: Record<string, number> = {}
    for (const arr of stops.values()) {
      for (const stop of arr) {
        const ois = stop.orderId ? (orderItemsByOrder[stop.orderId] ?? []) : []
        for (const item of stop.items) {
          const isEmpako = !SPREAD_PRODUCT_IDS.has(item.productId) &&
            (ois.find(i => i.product_id === item.productId)?.empako ?? false)
          if (isEmpako) {
            assignedEmpako[item.productId] = (assignedEmpako[item.productId] ?? 0) + item.cases
          } else {
            assignedRegular[item.productId] = (assignedRegular[item.productId] ?? 0) + item.cases
          }
        }
      }
    }
    return { assignedEmpako, assignedRegular }
  }, [stops, orderItemsByOrder])

  // How many 40x1 cases remain after empako assignments consume them first
  const remaining40x1 = useMemo((): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const p of inventoryDisplayProducts) {
      out[p.id] = Math.max(0, (localInventory40x1[p.id] ?? 0) - (assignedEmpako[p.id] ?? 0))
    }
    return out
  }, [inventoryDisplayProducts, assignedEmpako, localInventory40x1])

  const remainingInventory = useMemo((): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const p of inventoryDisplayProducts) {
      const inv40x1      = localInventory40x1[p.id] ?? 0
      const empako       = assignedEmpako[p.id] ?? 0
      const regular      = assignedRegular[p.id] ?? 0
      // Empako cases not covered by 40x1 stock each consume 2 regular cases
      const empakoFromRegular = Math.max(0, empako - inv40x1)
      out[p.id] = (localInventory[p.id] ?? 0) - regular - empakoFromRegular * 2
    }
    return out
  }, [inventoryDisplayProducts, assignedEmpako, assignedRegular, localInventory, localInventory40x1])

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

  // Pickup totals derived from bodega orders — drives the warehouse Orders column
  const bodegaPickup = useMemo((): Record<string, number> => {
    const totals: Record<string, number> = {}
    for (const row of bodegas) {
      for (const [pid, item] of Object.entries(row.items)) {
        totals[pid] = (totals[pid] ?? 0) + item.cases
      }
    }
    return totals
  }, [bodegas])

  // Cases being dropped at the warehouse today, per product (across all trucks)
  const dropsByProduct = useMemo((): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const d of localWarehouseDrops) {
      out[d.product_id] = (out[d.product_id] ?? 0) + d.cases
    }
    return out
  }, [localWarehouseDrops])

  // Orders fully fulfilled with a delivery on today's date — stay in Orders tab, shown green
  const todayFulfilled = useMemo(
    () => visibleOrders.filter(o => {
      const rem = orderRemainingMap.get(o.id)
      if (!rem || rem.totalOrdered === 0 || rem.totalRemaining > 0) return false
      return localAllDeliveries.some(d => d.order_id === o.id && d.delivery_date === date)
    }),
    [visibleOrders, orderRemainingMap, localAllDeliveries, date],
  )

  const fulfilledOrders = useMemo(
    () => visibleOrders.filter(o => {
      const rem = orderRemainingMap.get(o.id)
      if (!rem || rem.totalOrdered === 0 || rem.totalRemaining > 0) return false
      if (o.delivery_date_end < sevenDaysAgo) return false
      // Exclude orders fulfilled today — those show in the Orders tab instead
      return !localAllDeliveries.some(d => d.order_id === o.id && d.delivery_date === date)
    }),
    [visibleOrders, orderRemainingMap, localAllDeliveries, date, sevenDaysAgo],
  )

  // ── Unassigned orders ─────────────────────────────────────────────────────

  const unassigned = useMemo(
    () => visibleOrders.filter(o => {
      const rem = orderRemainingMap.get(o.id)
      // Orders with no items (totalOrdered=0) are data-entry incomplete — surface them here
      if (!rem || rem.totalOrdered === 0) return true
      return rem.totalRemaining > 0
    }),
    [visibleOrders, orderRemainingMap],
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

    // Sync delivery_items for today's delivery (fulfilled orders shown in Orders tab)
    const todayDelivery = localAllDeliveriesRef.current.find(
      d => d.order_id === orderId && d.delivery_date === date,
    )
    if (todayDelivery) {
      await supabase.from('delivery_items').delete().eq('delivery_id', todayDelivery.id).eq('product_id', productId)
      if (cases > 0) {
        await supabase.from('delivery_items').insert({ delivery_id: todayDelivery.id, product_id: productId, cases })
      }
      setLocalAllDeliveryItems(prev => {
        const without = prev.filter(di => !(di.delivery_id === todayDelivery.id && di.product_id === productId))
        if (cases <= 0) return without
        return [...without, { id: -Date.now() - 1, delivery_id: todayDelivery.id, product_id: productId, cases }]
      })
      mutStops(prev => {
        const next = new Map(prev)
        const arr = (prev.get(todayDelivery.truck_id) ?? []).map(s => {
          if (s.deliveryId !== todayDelivery.id) return s
          const withoutProd = s.items.filter(i => i.productId !== productId)
          return { ...s, items: cases > 0 ? [...withoutProd, { productId, cases }] : withoutProd }
        })
        next.set(todayDelivery.truck_id, arr)
        return next
      })
    }
  }, [date])

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

  const handleDeleteOrder = useCallback(async (orderId: number) => {
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId)
    if (error) { toast('Failed to delete order', 'error'); return }
    setCancelledOrderIds(prev => new Set([...prev, orderId]))
    toast('Order deleted', 'success')
  }, [])

  const handleOrderCreated = useCallback((order: Order, items: OrderItem[]) => {
    setLocalNewOrders(prev => [...prev, order])
    syncLocalOrderItems(prev => [...prev, ...items])
    setEmpakaByOrder(prev => ({ ...prev, [order.id]: '' }))
  }, [])

  function handleWarehouseEdit(productId: string, field: 'stock', raw: string) {
    const val = parseInt(raw) || 0
    const prev = localWarehouseRef.current[productId] ?? { pickup: 0, stock: 0 }
    localWarehouseRef.current = { ...localWarehouseRef.current, [productId]: { ...prev, stock: val } }
    setLocalWarehouse({ ...localWarehouseRef.current })
    const existing = warehouseEditTimers.current.get(productId)
    if (existing) clearTimeout(existing)
    warehouseEditTimers.current.set(productId, setTimeout(() => {
      warehouseEditTimers.current.delete(productId)
      const stock = localWarehouseRef.current[productId]?.stock ?? 0
      const pickup = bodegaRef.current.reduce((s, r) => s + (r.items[productId]?.cases ?? 0), 0)
      supabase.from('warehouse_daily')
        .upsert({ date, product_id: productId, pickup_orders_total: pickup, warehouse_stock: stock }, { onConflict: 'date,product_id' })
        .then(({ error }) => { if (error) toast('Failed to save warehouse', 'error') })
    }, 500))
  }

  function handleBodegaChange(orderId: number, productId: string, raw: string) {
    const val = Math.max(0, parseInt(raw) || 0)

    bodegaRef.current = bodegaRef.current.map(row => {
      if (row.orderId !== orderId) return row
      return {
        ...row,
        items: { ...row.items, [productId]: { itemId: row.items[productId]?.itemId ?? null, cases: val } },
      }
    })
    setBodegas([...bodegaRef.current])

    const key = `${orderId}-${productId}`
    const existing = bodegaTimers.current.get(key)
    if (existing) clearTimeout(existing)
    bodegaTimers.current.set(key, setTimeout(async () => {
      bodegaTimers.current.delete(key)

      const row = bodegaRef.current.find(r => r.orderId === orderId)
      if (!row) return
      const item = row.items[productId]
      const cases = item?.cases ?? 0
      const itemId = item?.itemId ?? null

      if (cases === 0 && itemId !== null) {
        const { error } = await supabase.from('order_items').delete().eq('id', itemId)
        if (error) { toast('Failed to save', 'error'); return }
        bodegaRef.current = bodegaRef.current.map(r =>
          r.orderId !== orderId ? r : { ...r, items: { ...r.items, [productId]: { itemId: null, cases: 0 } } }
        )
        setBodegas([...bodegaRef.current])
      } else if (cases > 0 && itemId === null) {
        const { data, error } = await supabase.from('order_items')
          .insert({ order_id: orderId, product_id: productId, cases, empako: false })
          .select('id').single()
        if (error || !data) { toast('Failed to save', 'error'); return }
        const newId = (data as { id: number }).id
        bodegaRef.current = bodegaRef.current.map(r =>
          r.orderId !== orderId ? r : { ...r, items: { ...r.items, [productId]: { itemId: newId, cases } } }
        )
        setBodegas([...bodegaRef.current])
      } else if (cases > 0 && itemId !== null) {
        const { error } = await supabase.from('order_items').update({ cases }).eq('id', itemId)
        if (error) { toast('Failed to save', 'error'); return }
      }

      // Sync updated pickup total to warehouse_daily
      const pickup = bodegaRef.current.reduce((s, r) => s + (r.items[productId]?.cases ?? 0), 0)
      const stock = localWarehouseRef.current[productId]?.stock ?? 0
      supabase.from('warehouse_daily')
        .upsert({ date, product_id: productId, pickup_orders_total: pickup, warehouse_stock: stock }, { onConflict: 'date,product_id' })
        .then(({ error: wErr }) => { if (wErr) console.error('Failed to sync warehouse pickup', wErr) })
    }, 500))
  }

  // ── Shared inventory/capacity validation ──────────────────────────────────

  function validateItems(
    items: { productId: string; cases: number; empako?: boolean }[],
    truckId: number,
  ): boolean {
    // Tally all currently assigned cases, split by empako vs regular
    const totalEmpako: Record<string, number> = {}
    const totalRegular: Record<string, number> = {}
    for (const arr of stopsRef.current.values()) {
      for (const stop of arr) {
        const ois = stop.orderId ? (orderItemsByOrder[stop.orderId] ?? []) : []
        for (const item of stop.items) {
          const isEmpako = !SPREAD_PRODUCT_IDS.has(item.productId) &&
            (ois.find(i => i.product_id === item.productId)?.empako ?? false)
          if (isEmpako) {
            totalEmpako[item.productId] = (totalEmpako[item.productId] ?? 0) + item.cases
          } else {
            totalRegular[item.productId] = (totalRegular[item.productId] ?? 0) + item.cases
          }
        }
      }
    }

    // Add new items
    for (const i of items) {
      const isEmpako = !SPREAD_PRODUCT_IDS.has(i.productId) && (i.empako ?? false)
      if (isEmpako) {
        totalEmpako[i.productId] = (totalEmpako[i.productId] ?? 0) + i.cases
      } else {
        totalRegular[i.productId] = (totalRegular[i.productId] ?? 0) + i.cases
      }
    }

    for (const productId of new Set([...Object.keys(totalEmpako), ...Object.keys(totalRegular)])) {
      const inv40x1 = localInventory40x1Ref.current[productId] ?? 0
      const inv     = localInventoryRef.current[productId] ?? 0
      const empako  = totalEmpako[productId] ?? 0
      const regular = totalRegular[productId] ?? 0
      // Empako cases first consume 40x1 stock 1:1; overflow hits regular at 2:1
      const empakoFromRegular = Math.max(0, empako - inv40x1)
      const regularConsumed   = regular + empakoFromRegular * 2
      if (regularConsumed > inv) {
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
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans mb-3">40x1 Stock</p>
                <div className="space-y-3">
                  {inventoryDisplayProducts.filter(p => !SPREAD_PRODUCT_IDS.has(p.id)).map(p => {
                    const rem40       = remaining40x1[p.id] ?? 0
                    const total40     = localInventory40x1[p.id] ?? 0
                    const low40       = rem40 <= 0 && total40 > 0
                    const isEditing40 = editingInventory40x1Id === p.id
                    return (
                      <div key={p.id}>
                        <div className="flex items-center justify-between mb-0.5 gap-1">
                          <span className="text-xs font-sans text-stone-600 truncate min-w-0">{p.name}</span>
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <span className={cn('text-xs font-mono font-semibold tabular-nums', low40 ? 'text-red-600' : 'text-stone-700')}>
                              {rem40}
                            </span>
                            <span className="text-xs font-mono text-stone-400">/</span>
                            {isEditing40 ? (
                              <input
                                type="number" min={0} value={editInventory40x1Value} autoFocus
                                onChange={e => { setEditInventory40x1Value(e.target.value); handleInventory40x1Edit(p.id, e.target.value) }}
                                onBlur={() => setEditingInventory40x1Id(null)}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingInventory40x1Id(null) }}
                                className="w-10 text-xs font-mono text-stone-700 font-semibold text-right bg-stone-100 rounded px-1 focus:outline-none focus:ring-1 focus:ring-stone-400 [appearance:textfield] tabular-nums"
                              />
                            ) : (
                              <button
                                onClick={() => { setEditingInventory40x1Id(p.id); setEditInventory40x1Value(String(total40)) }}
                                className="text-xs font-mono text-stone-400 hover:text-stone-700 hover:underline tabular-nums transition-colors"
                              >
                                {total40}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', low40 ? 'bg-red-400' : 'bg-amber-400')}
                            style={{ width: `${total40 > 0 ? Math.max(0, Math.min(100, rem40 / total40 * 100)) : 0}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

          </aside>

          {/* ── Center: Orders ── */}
          <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
            <div className="flex-shrink-0 px-5 py-3 border-b border-stone-200/60 bg-canvas flex items-center justify-between">
              <div>
                <h1 className="font-display text-lg font-semibold text-stone-800 tracking-tight">Delivery Dashboard</h1>
                <p className="text-xs font-sans text-stone-400 mt-0.5">
                  {unassigned.length} order{unassigned.length !== 1 ? 's' : ''} to assign
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setNewOrderOpen(true)}
                  className="px-3 py-1.5 text-xs font-semibold font-sans rounded-lg bg-stone-800 text-white hover:bg-stone-700 transition-colors"
                >
                  + New Order
                </button>
                <DayPicker date={date} />
              </div>
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
                  {unassigned.length === 0 && todayFulfilled.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-stone-300">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mb-2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      <p className="text-sm font-sans">All orders assigned</p>
                    </div>
                  )}

                  {/* Fulfilled Today */}
                  {todayFulfilled.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className="flex-1 h-0.5 bg-emerald-200 rounded-full" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 font-sans">Fulfilled Today</p>
                        <div className="flex-1 h-0.5 bg-emerald-200 rounded-full" />
                      </div>
                      <div className="space-y-2">
                        {todayFulfilled.map(order => {
                          const orderDeliveries = localAllDeliveries.filter(d => d.order_id === order.id).map(d => ({
                            truckId: d.truck_id, truckName: truckById.get(d.truck_id)?.name ?? `Truck #${d.truck_id}`,
                            date: d.delivery_date, cases: localAllDeliveryItems.filter(di => di.delivery_id === d.id).reduce((s, di) => s + di.cases, 0),
                          }))
                          return <OrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} items={orderItemsByOrder[order.id] ?? []} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} date={date} deliveries={orderDeliveries} products={products} fulfilled onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} onGoToTruck={setSelectedTruckId} onPartialClick={() => setPartialDialog({ open: true, orderId: order.id, truckId: selectedTruckId })} onAddToTruck={null} empakaNote={empakaByOrder[order.id] ?? ''} onEmpakaChange={text => handleEmpakaChange(order.id, text)} onDelete={() => handleDeleteOrder(order.id)} />
                        })}
                      </div>
                    </div>
                  )}

                  {/* Overdue */}
                  {sortedUnassigned.overdue.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className="flex-1 h-0.5 bg-red-200 rounded-full" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 font-sans">Overdue</p>
                        <div className="flex-1 h-0.5 bg-red-200 rounded-full" />
                      </div>
                      <div className="space-y-2">
                        {sortedUnassigned.overdue.map(order => {
                          const orderDeliveries = localAllDeliveries.filter(d => d.order_id === order.id).map(d => ({
                            truckId: d.truck_id, truckName: truckById.get(d.truck_id)?.name ?? `Truck #${d.truck_id}`,
                            date: d.delivery_date, cases: localAllDeliveryItems.filter(di => di.delivery_id === d.id).reduce((s, di) => s + di.cases, 0),
                          }))
                          return <OrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} items={orderItemsByOrder[order.id] ?? []} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} date={date} deliveries={orderDeliveries} products={products} onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} onGoToTruck={setSelectedTruckId} onPartialClick={() => setPartialDialog({ open: true, orderId: order.id, truckId: selectedTruckId })} onAddToTruck={selectedTruckId ? () => assignOrderToTruck(order.id, selectedTruckId) : null} empakaNote={empakaByOrder[order.id] ?? ''} onEmpakaChange={text => handleEmpakaChange(order.id, text)} onDelete={() => handleDeleteOrder(order.id)} />
                        })}
                      </div>
                    </div>
                  )}

                  {/* Due Today — exact + range merged */}
                  {(sortedUnassigned.todayExact.length > 0 || sortedUnassigned.todayRange.length > 0) && (
                    <div>
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className="flex-1 h-0.5 bg-stone-300 rounded-full" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 font-sans">Due Today</p>
                        <div className="flex-1 h-0.5 bg-stone-300 rounded-full" />
                      </div>
                      <div className="space-y-2">
                        {[...sortedUnassigned.todayExact, ...sortedUnassigned.todayRange].map(order => {
                          const orderDeliveries = localAllDeliveries.filter(d => d.order_id === order.id).map(d => ({
                            truckId: d.truck_id, truckName: truckById.get(d.truck_id)?.name ?? `Truck #${d.truck_id}`,
                            date: d.delivery_date, cases: localAllDeliveryItems.filter(di => di.delivery_id === d.id).reduce((s, di) => s + di.cases, 0),
                          }))
                          return <OrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} items={orderItemsByOrder[order.id] ?? []} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} date={date} deliveries={orderDeliveries} products={products} onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} onGoToTruck={setSelectedTruckId} onPartialClick={() => setPartialDialog({ open: true, orderId: order.id, truckId: selectedTruckId })} onAddToTruck={selectedTruckId ? () => assignOrderToTruck(order.id, selectedTruckId) : null} empakaNote={empakaByOrder[order.id] ?? ''} onEmpakaChange={text => handleEmpakaChange(order.id, text)} onDelete={() => handleDeleteOrder(order.id)} />
                        })}
                      </div>
                    </div>
                  )}

                  {/* Future */}
                  {sortedUnassigned.future.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className="flex-1 h-0.5 bg-stone-300 rounded-full" />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 font-sans">Future</p>
                        <div className="flex-1 h-0.5 bg-stone-300 rounded-full" />
                      </div>
                      <div className="space-y-2">
                        {sortedUnassigned.future.map(order => {
                          const orderDeliveries = localAllDeliveries.filter(d => d.order_id === order.id).map(d => ({
                            truckId: d.truck_id, truckName: truckById.get(d.truck_id)?.name ?? `Truck #${d.truck_id}`,
                            date: d.delivery_date, cases: localAllDeliveryItems.filter(di => di.delivery_id === d.id).reduce((s, di) => s + di.cases, 0),
                          }))
                          return <OrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} items={orderItemsByOrder[order.id] ?? []} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} date={date} deliveries={orderDeliveries} products={products} onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} onGoToTruck={setSelectedTruckId} onPartialClick={() => setPartialDialog({ open: true, orderId: order.id, truckId: selectedTruckId })} onAddToTruck={selectedTruckId ? () => assignOrderToTruck(order.id, selectedTruckId) : null} empakaNote={empakaByOrder[order.id] ?? ''} onEmpakaChange={text => handleEmpakaChange(order.id, text)} onDelete={() => handleDeleteOrder(order.id)} />
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
                        return <FulfilledOrderCard key={order.id} order={order} customer={customerById.get(order.customer_id) ?? null} totalCases={totalCases} deliveries={orderDeliveries} remaining={orderRemainingMap.get(order.id) ?? null} productById={productById} products={products} items={orderItemsByOrder[order.id] ?? []} viewingDate={date} onGoToTruck={setSelectedTruckId} onUpdateItem={(pid, cs) => handleUpdateSingleOrderItem(order.id, pid, cs)} onToggleEmpako={(pid, emp) => handleToggleOrderItemEmpako(order.id, pid, emp)} onDelete={() => handleDeleteOrder(order.id)} />
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
                    {/* Bodega orders button */}
                    <div className="mt-3 mb-3">
                      <button
                        onClick={() => setBodegaDialogOpen(true)}
                        className="text-xs font-sans font-medium text-stone-500 hover:text-stone-800 border border-stone-200 rounded-lg px-3 py-1.5 hover:bg-stone-50 transition-colors w-full text-left"
                      >
                        Bodega Orders{bodegas.length > 0 ? ` (${bodegas.length})` : ''}
                      </button>
                    </div>
                    {/* Warehouse summary stats */}
                    <table className="w-full text-xs font-sans">
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
                          const pickup = bodegaPickup[p.id] ?? 0
                          const dropped = dropsByProduct[p.id] ?? 0
                          const stillNeeded = Math.max(0, pickup - w.stock - dropped)
                          const editingStock = editingWarehouseCell?.productId === p.id && editingWarehouseCell.field === 'stock'
                          return (
                            <tr key={p.id} className="border-b border-stone-50 last:border-0">
                              <td className="py-1.5 text-stone-700">{p.name}</td>
                              <td className="py-1.5 text-right font-mono tabular-nums text-stone-500">
                                {pickup > 0 ? pickup : '—'}
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

          {/* ── Right: Truck assignment / summary panel ── */}
          <aside className="flex-1 bg-white border-l border-stone-200 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-5 py-3 border-b border-stone-200/60 flex items-center justify-between">
              <h1 className="font-display text-lg font-semibold text-stone-800 tracking-tight">Trucks</h1>
              <div className="flex bg-stone-100 rounded-lg p-0.5">
                <button
                  onClick={() => setShowSummary(false)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-sans font-medium transition-colors',
                    !showSummary ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500 hover:text-stone-700',
                  )}
                >
                  Assign
                </button>
                <button
                  onClick={() => setShowSummary(true)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-sans font-medium transition-colors',
                    showSummary ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500 hover:text-stone-700',
                  )}
                >
                  Summary
                </button>
              </div>
            </div>

            {showSummary ? (
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {summaryData.length === 0 ? (
                  <p className="text-center py-10 text-stone-400 text-sm font-sans">No deliveries for this date.</p>
                ) : (
                  summaryData.map(({ truck, deliveries: fakeDels, itemsByDelivery: fakeItems, drops }) => (
                    <TruckSummary
                      key={truck.id}
                      truck={truck}
                      deliveries={fakeDels}
                      itemsByDelivery={fakeItems}
                      drops={drops}
                      products={products}
                      orderById={orderById}
                      customerById={customerById}
                      orderItemsByOrderId={orderItemsByOrder}
                      note={truckNotes[truck.id] ?? ''}
                      expanded={summaryExpanded.has(truck.id)}
                      onToggle={() => setSummaryExpanded(prev => {
                        const next = new Set(prev)
                        if (next.has(truck.id)) next.delete(truck.id)
                        else next.add(truck.id)
                        return next
                      })}
                    />
                  ))
                )}
              </div>
            ) : (
              <>
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
                    note={truckNotes[selectedTruck.id] ?? ''}
                    onNoteChange={(n) => handleTruckNoteChange(selectedTruck.id, n)}
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
              </>
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
        orders={visibleOrders}
        trucks={trucks}
        products={products}
        productById={productById}
        customerById={customerById}
        orderRemainingMap={orderRemainingMap}
        orderItemsByOrder={orderItemsByOrder}
        remainingInventory={remainingInventory}
        remaining40x1={remaining40x1}
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

      <NewOrderDialog
        open={newOrderOpen}
        onClose={() => setNewOrderOpen(false)}
        customers={customers}
        products={products}
        date={date}
        onCreated={handleOrderCreated}
      />

      {/* Bodega orders popup */}
      {bodegaDialogOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-50" onClick={() => setBodegaDialogOpen(false)} />
          <div className="fixed inset-4 z-[51] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 shrink-0">
              <span className="font-display text-base font-semibold text-stone-800">Bodega Orders</span>
              <button
                onClick={() => setBodegaDialogOpen(false)}
                className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition-colors text-sm font-sans"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {bodegas.length === 0 ? (
                <p className="text-sm text-stone-400 font-sans py-4 text-center">No bodega orders for this date.</p>
              ) : (
                <BodegaTable
                  products={products}
                  bodegas={bodegas}
                  editable={true}
                  onCellChange={handleBodegaChange}
                />
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ── EditOrderDialog ───────────────────────────────────────────────────────────

function EditOrderDialog({
  open, onClose, items, products, onSave, onToggleEmpako, onDelete,
}: {
  open: boolean
  onClose: () => void
  items: OrderItem[]
  products: DeliveryProduct[]
  onSave: (productId: string, cases: number) => Promise<void>
  onToggleEmpako: (productId: string, empako: boolean) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [empakoState, setEmpakoState] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
      setConfirmDelete(false)
    }
  }, [open, items])

  async function handleDelete() {
    setDeleting(true)
    await onDelete()
    setDeleting(false)
    onClose()
  }

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
          <div className="flex-1 flex items-center">
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-3 py-1.5 text-xs font-semibold font-sans rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
            >
              Delete Order
            </button>
          </div>
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

      {/* Delete confirmation popup */}
      <Dialog open={confirmDelete} onOpenChange={v => { if (!v) setConfirmDelete(false) }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete this order?</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-sans text-stone-500 -mt-2 pb-1">This cannot be undone.</p>
          <DialogFooter>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-4 py-2 text-sm font-sans font-medium text-stone-500 hover:text-stone-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete} disabled={deleting}
              className="px-5 py-2 text-sm font-semibold font-sans rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

// ── OrderCard ─────────────────────────────────────────────────────────────────

function OrderCard({
  order, customer, items, remaining, productById, products, date,
  deliveries, fulfilled, onUpdateItem, onToggleEmpako, onGoToTruck, onPartialClick, onAddToTruck,
  empakaNote, onEmpakaChange, onDelete,
}: {
  order: Order
  customer: Customer | null
  items: OrderItem[]
  remaining: OrderRemaining | null
  productById: Map<string, DeliveryProduct>
  products: DeliveryProduct[]
  date: string
  deliveries: { truckId: number; truckName: string; date: string; cases: number }[]
  fulfilled?: boolean
  onUpdateItem: (productId: string, cases: number) => Promise<void>
  onToggleEmpako: (productId: string, empako: boolean) => Promise<void>
  onGoToTruck: (truckId: number) => void
  onPartialClick: () => void
  onAddToTruck: (() => void) | null
  empakaNote: string
  onEmpakaChange: (text: string) => void
  onDelete: () => Promise<void>
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
  const itemMap: Record<string, OrderItem> = {}
  for (const i of sortedItems) itemMap[i.product_id] = i
  const tableProds = [...products]
    .sort((a, b) => a.display_order - b.display_order)
    .filter(p => !CONDITIONAL_SHOW_PRODUCT_IDS.has(p.id) || (itemMap[p.id]?.cases ?? 0) > 0)

  function fmtDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className={cn('rounded-xl border shadow-sm overflow-hidden', fulfilled ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-stone-100')}>
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0 flex items-start gap-1.5">
          {fulfilled && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 flex-shrink-0 mt-0.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
          <div className="min-w-0">
            <span className="text-sm font-sans font-semibold text-stone-800 truncate block">
              {customer?.name ?? `Customer #${order.customer_id}`}
            </span>
            <p className="text-[11px] font-sans text-stone-400 mt-0.5">{dueLine}</p>
          </div>
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
          {!fulfilled && (
            <button
              onClick={onPartialClick}
              className="px-2 py-0.5 text-[11px] font-semibold font-sans rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              Partial
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
            defaultName={customer?.name ?? ''}
            onChange={onEmpakaChange}
          />
        </div>
      )}

      {/* ── Product table ── */}
      <div className="border-t border-stone-100 overflow-x-auto">
        <table className="text-xs font-sans w-full">
          <thead>
            <tr className={cn('border-b', fulfilled ? 'bg-emerald-50/70 border-emerald-100' : 'bg-stone-50/70 border-stone-100')}>
              {tableProds.map(p => (
                <th key={p.id} className="px-2 py-1.5 text-center font-medium text-stone-400 whitespace-nowrap">
                  {getProductAbbr(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Ordered row */}
            <tr className={cn(isPartial && 'border-b border-stone-50')}>
              {tableProds.map(p => {
                const item = itemMap[p.id]
                const val = item?.cases ?? 0
                return (
                  <td key={p.id} className={cn('px-2 py-1.5 text-center font-mono tabular-nums', val > 0 ? 'font-bold text-stone-700' : 'text-stone-300')}>
                    {val}
                    {item?.empako && val > 0 && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                  </td>
                )
              })}
            </tr>
            {/* Delivered row — only when partially delivered */}
            {isPartial && (
              <tr className="border-b border-stone-50">
                {tableProds.map(p => {
                  const dlv = remaining?.byItem[p.id]?.delivered ?? 0
                  const item = itemMap[p.id]
                  return (
                    <td key={p.id} className={cn('px-2 py-1.5 text-center font-mono tabular-nums', dlv > 0 ? 'font-bold text-emerald-600' : 'text-stone-300')}>
                      {dlv}
                      {item?.empako && dlv > 0 && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                    </td>
                  )
                })}
              </tr>
            )}
            {/* Needed row — only when partially delivered */}
            {isPartial && (
              <tr>
                {tableProds.map(p => {
                  const need = remaining?.byItem[p.id]?.remaining ?? (itemMap[p.id]?.cases ?? 0)
                  const item = itemMap[p.id]
                  return (
                    <td key={p.id} className={cn('px-2 py-1.5 text-center font-mono tabular-nums', need > 0 ? 'font-bold text-amber-600' : 'text-stone-300')}>
                      {need}
                      {item?.empako && need > 0 && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                    </td>
                  )
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Notes */}
      {order.notes && (
        <p className="px-3 pt-1 pb-1 text-xs font-sans text-stone-400 italic border-t border-stone-50">{order.notes}</p>
      )}

      {/* Deliveries — toggle button + inline expand below */}
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
            Deliveries
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
        onDelete={onDelete}
      />
    </div>
  )
}

// ── TruckCapacityBar (shared between panel and dialogs) ───────────────────────

function TruckCapacityBar({
  truck, load, productTotals, productById, products, actions, stops, orderById, customerById, orderItemsByOrder,
}: {
  truck: Truck
  load: number
  productTotals: Record<string, number>
  productById: Map<string, DeliveryProduct>
  products?: DeliveryProduct[]
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

    const visibleProducts = (products ?? [])
      .filter(p => !CONDITIONAL_SHOW_PRODUCT_IDS.has(p.id) || (productTotals[p.id] ?? 0) > 0)
      .sort((a, b) => a.display_order - b.display_order)

    if (visibleProducts.length === 0) return null

    type StopData = {
      stop: TruckStop
      idx: number
      label: string
      isWh: boolean
      empakoMap: Record<string, boolean>
      itemMap: Record<string, number>
    }

    const allRows: StopData[] = sortedStops.map((stop, idx) => {
      const itemMap: Record<string, number> = {}
      for (const i of stop.items) itemMap[i.productId] = i.cases

      const empakoMap: Record<string, boolean> = {}
      if (!stop.isWarehouseDrop && stop.orderId && orderItemsByOrder) {
        for (const oi of orderItemsByOrder[stop.orderId] ?? [])
          empakoMap[oi.product_id] = !SPREAD_PRODUCT_IDS.has(oi.product_id) && (oi.empako ?? false)
      }

      const isWh = !!stop.isWarehouseDrop
      let label: string
      if (isWh) {
        label = 'Warehouse'
      } else {
        const order = orderById.get(stop.orderId!)
        const customer = customerById.get(order?.customer_id ?? -1)
        label = customer?.name ?? `Order #${stop.orderId}`
      }
      return { stop, idx, label, isWh, empakoMap, itemMap }
    })

    const topRows = allRows.filter(r =>
      r.isWh || Object.entries(r.itemMap).some(([pid, cs]) => !r.empakoMap[pid] && cs > 0)
    )
    const bottomRows = allRows.filter(r =>
      !r.isWh && Object.entries(r.itemMap).some(([pid, cs]) => r.empakoMap[pid] && cs > 0)
    )
    const hasEmpako = bottomRows.length > 0

    const topTotals: Record<string, number> = {}
    for (const r of topRows)
      for (const [pid, cs] of Object.entries(r.itemMap))
        if (r.isWh || !r.empakoMap[pid]) topTotals[pid] = (topTotals[pid] ?? 0) + cs

    const bottomTotals: Record<string, number> = {}
    for (const r of bottomRows)
      for (const [pid, cs] of Object.entries(r.itemMap))
        if (r.empakoMap[pid]) bottomTotals[pid] = (bottomTotals[pid] ?? 0) + cs

    return (
      <div className="mt-2 border border-stone-100 rounded-lg overflow-x-auto">
        <table className="w-full text-xs font-sans [&_td]:align-middle [&_th]:align-middle">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200">
              <th className="text-left px-3 py-1.5 font-medium text-stone-400 whitespace-nowrap w-40">Client</th>
              {visibleProducts.map(p => (
                <th key={p.id} className="px-2 py-1.5 font-medium text-stone-400 text-right whitespace-nowrap">{getProductAbbr(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasEmpako && (
              <tr className="bg-stone-50 border-b border-stone-200">
                <td colSpan={1 + visibleProducts.length} className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans text-center">
                  20×1
                </td>
              </tr>
            )}
            {topRows.map(r => (
              <tr key={r.stop.deliveryId} className="hover:bg-stone-50 border-b border-stone-100">
                <td className="px-3 py-1.5 text-stone-600 whitespace-nowrap w-40">
                  {r.label}
                </td>
                {visibleProducts.map(p => {
                  const val = r.isWh ? r.itemMap[p.id] : (!r.empakoMap[p.id] ? r.itemMap[p.id] : undefined)
                  return (
                    <td key={p.id} className="px-2 py-1.5 text-right font-mono tabular-nums text-stone-700">
                      {val != null ? val : <span className="text-stone-200">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className={cn('bg-stone-100 border-b border-stone-200', !hasEmpako && 'border-b-0')}>
              <td className="px-3 py-1.5 font-semibold text-stone-600 w-40">{hasEmpako ? 'Total (20×1)' : 'Total'}</td>
              {visibleProducts.map(p => (
                <td key={p.id} className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold text-stone-700">
                  {topTotals[p.id] ?? 0}
                </td>
              ))}
            </tr>
            {hasEmpako && (
              <>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <td colSpan={1 + visibleProducts.length} className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans text-center">
                    40×1
                  </td>
                </tr>
                {bottomRows.map(r => (
                  <tr key={`emp-${r.stop.deliveryId}`} className="hover:bg-stone-50 border-b border-stone-100">
                    <td className="px-3 py-1.5 text-stone-600 whitespace-nowrap w-40">
                      {r.label}
                    </td>
                    {visibleProducts.map(p => {
                      const val = r.empakoMap[p.id] ? r.itemMap[p.id] : undefined
                      return (
                        <td key={p.id} className="px-2 py-1.5 text-right font-mono tabular-nums text-stone-700">
                          {val != null ? val : <span className="text-stone-200">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="bg-stone-100">
                  <td className="px-3 py-1.5 font-semibold text-stone-600 w-40">Total (40×1)</td>
                  {visibleProducts.map(p => (
                    <td key={p.id} className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold text-stone-700">
                      {bottomTotals[p.id] ?? 0}
                    </td>
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    )
  }, [stops, orderById, customerById, productById, products, productTotals, orderItemsByOrder])

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

function TruckPanel({ truck, stops, load, orderById, customerById, productById, products, orderItemsByOrder, empakaByOrder, note, onNoteChange, onEmpakaChange, onRemoveStop, onUpdateDeliveryItems, onUpdateOrderItems, onToggleEmpako, onDropClick }: {
  truck: Truck
  stops: TruckStop[]
  load: number
  orderById: Map<number, Order>
  customerById: Map<number, Customer>
  productById: Map<string, DeliveryProduct>
  products: DeliveryProduct[]
  orderItemsByOrder: Record<number, OrderItem[]>
  empakaByOrder: Record<number, string>
  note: string
  onNoteChange: (note: string) => void
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
      <div className="flex-shrink-0 border-b border-stone-100">
        <div className="px-4 pt-3 pb-2">
          <TruckCapacityBar
            truck={truck}
            load={load}
            productTotals={productTotals}
            productById={productById}
            products={products}
            stops={stops}
            orderById={orderById}
            customerById={customerById}
            orderItemsByOrder={orderItemsByOrder}
          />
        </div>
        <div className="border-t border-stone-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans mb-1.5">Notes</p>
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            placeholder="Add notes for this truck…"
            rows={3}
            className="w-full text-xs font-sans text-stone-700 placeholder-stone-300 border border-stone-100 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-stone-200 bg-stone-50/50"
          />
        </div>
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
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [empakoState, setEmpakoState] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  const orderTotal = useMemo(() => orderItems.reduce((s, i) => s + i.cases, 0), [orderItems])
  const deliveryTotal = useMemo(() => stop.items.reduce((s, i) => s + i.cases, 0), [stop.items])
  const isPartial = orderTotal > 0 && deliveryTotal < orderTotal

  const orderMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const i of orderItems) m[i.productId] = i.cases
    return m
  }, [orderItems])

  useEffect(() => {
    if (open) {
      const vals: Record<string, string> = {}
      const emp: Record<string, boolean> = {}
      if (isPartial) {
        for (const i of stop.items) vals[i.productId] = String(i.cases)
      } else {
        for (const i of orderItems) vals[i.productId] = String(i.cases)
      }
      for (const i of orderItems) emp[i.productId] = i.empako ?? false
      setAmounts(vals)
      setEmpakoState(emp)
    }
  }, [open, orderItems, stop.items])

  async function handleSave() {
    setSaving(true)

    if (isPartial) {
      // Partial: only update this truck's delivery; order total stays unchanged
      const newDelivery = products
        .map(p => ({ productId: p.id, cases: parseInt(amounts[p.id] ?? '0') || 0 }))
        .filter(i => i.cases > 0)
      await onSaveDelivery(newDelivery)
    } else {
      // Full: update order items and keep delivery in sync
      const promises: Promise<void>[] = []
      for (const p of products) {
        const newVal = parseInt(amounts[p.id] ?? '0') || 0
        const oldVal = orderItems.find(i => i.productId === p.id)?.cases ?? 0
        if (newVal !== oldVal) promises.push(onSaveOrderItem(p.id, newVal))

        if (!SPREAD_PRODUCT_IDS.has(p.id)) {
          const newEmp = empakoState[p.id] ?? false
          const oldEmp = orderItems.find(i => i.productId === p.id)?.empako ?? false
          if (newEmp !== oldEmp) promises.push(onToggleEmpako(p.id, newEmp))
        }
      }
      await Promise.all(promises)
      const newDelivery = products
        .map(p => ({ productId: p.id, cases: parseInt(amounts[p.id] ?? '0') || 0 }))
        .filter(i => i.cases > 0)
      await onSaveDelivery(newDelivery)
    }

    setSaving(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm max-h-[90svh] grid-rows-[auto_auto_1fr_auto]">
        <DialogHeader>
          <DialogTitle>{isPartial ? 'Edit Partial Delivery' : 'Edit Order'}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-stone-400 font-sans -mt-1">
          {isPartial
            ? <>Editing changes the amount on <span className="font-medium text-stone-600">this truck only</span>. The original order total stays unchanged.</>
            : <>Editing changes the <span className="font-medium text-stone-600">order amount</span>. The delivery updates automatically.</>}
        </p>
        <div className="min-h-0 overflow-y-auto border border-stone-100 rounded-xl">
          <div className="grid grid-cols-[1fr_44px_80px] px-4 py-2 bg-stone-50 border-b border-stone-100 text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans gap-2">
            <span>Product</span>
            <span className="text-center">40x1</span>
            <span className="text-right">Amount</span>
          </div>
          {products.map(p => {
            const val = amounts[p.id] ?? '0'
            const n = parseInt(val) || 0
            const isActive = n > 0
            const isEmpako = empakoState[p.id] ?? false
            const isSpread = SPREAD_PRODUCT_IDS.has(p.id)
            const maxVal = isPartial ? (orderMap[p.id] ?? undefined) : undefined
            return (
              <div
                key={p.id}
                className={cn(
                  'grid grid-cols-[1fr_44px_80px] items-center px-4 py-2 border-b border-stone-50 last:border-0 gap-2',
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
                  type="number" min={0} max={maxVal} value={val}
                  onChange={e => setAmounts(prev => ({ ...prev, [p.id]: e.target.value }))}
                  onFocus={e => e.target.select()}
                  className="w-full px-2 py-1 text-sm font-mono text-right border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 [appearance:auto]"
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
                <span className="text-[10px] font-semibold font-sans px-2 py-0.5 rounded bg-amber-400 text-white flex-shrink-0 tracking-wide uppercase">Partial</span>
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
        const tableProds = [...products]
          .sort((a, b) => a.display_order - b.display_order)
          .filter(p => !CONDITIONAL_SHOW_PRODUCT_IDS.has(p.id) || (dlvMap[p.id] ?? 0) > 0 || (ordMap[p.id] ?? 0) > 0)
        return (
          <div className="border-t border-stone-100 overflow-x-auto">
            <table className="text-xs font-sans w-full">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50/70">
                  {tableProds.map(p => (
                    <th key={p.id} className="px-2 py-1.5 text-center font-medium text-stone-400 whitespace-nowrap">
                      {getProductAbbr(p)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {tableProds.map(p => {
                    const val = isPartial ? (dlvMap[p.id] ?? 0) : (ordMap[p.id] ?? 0)
                    return (
                      <td key={p.id} className={cn('px-2 py-1.5 text-center font-mono tabular-nums', val > 0 ? 'font-bold text-stone-700' : 'text-stone-300')}>
                        {val}
                        {empakoMap[p.id] && val > 0 && <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>}
                      </td>
                    )
                  })}
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
  order, customer, totalCases, deliveries, remaining, productById, products, items, viewingDate, onGoToTruck, onUpdateItem, onToggleEmpako, onDelete,
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
  onDelete: () => Promise<void>
}) {
  const router = useRouter()
  const [showDeliveries, setShowDeliveries] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const tableProds = [...products]
    .sort((a, b) => a.display_order - b.display_order)
    .filter(p => !CONDITIONAL_SHOW_PRODUCT_IDS.has(p.id) || (remaining?.byItem[p.id]?.delivered ?? 0) > 0)

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
      <div className="border-t border-stone-100 overflow-x-auto">
        <table className="text-xs font-sans w-full">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50/70">
              {tableProds.map(p => (
                <th key={p.id} className="px-2 py-1.5 text-center font-medium text-stone-400 whitespace-nowrap">
                  {getProductAbbr(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {tableProds.map(p => {
                const dlv = remaining?.byItem[p.id]?.delivered ?? 0
                return (
                  <td key={p.id} className={cn('px-2 py-1.5 text-center font-mono tabular-nums', dlv > 0 ? 'font-bold text-emerald-600' : 'text-stone-300')}>
                    {dlv}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes */}
      {order.notes && (
        <p className="px-3 pt-1 pb-1 text-xs font-sans text-stone-400 italic border-t border-stone-50">{order.notes}</p>
      )}

      {/* Deliveries — toggle button + inline expand below */}
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
          Deliveries
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
        onDelete={onDelete}
      />
    </div>
  )
}

// ── PartialDialog ─────────────────────────────────────────────────────────────

function PartialDialog({
  open, onClose, initialOrderId, initialTruckId,
  orders, trucks, products, productById, customerById,
  orderRemainingMap, orderItemsByOrder, remainingInventory, remaining40x1, truckLoads, truckProductTotals, onSubmit,
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
  remaining40x1: Record<string, number>
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
    const avail = isEmpako
      ? (remaining40x1[pid] ?? 0) + Math.floor((remainingInventory[pid] ?? 0) / 2)
      : (remainingInventory[pid] ?? 0)
    return n > avail
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
          {/* Order display (pre-selected, read-only) */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-stone-500 font-sans">Order</label>
            <div className="w-full px-3 py-2 text-sm font-sans border border-stone-100 rounded-lg bg-stone-50 text-stone-700">
              {selectedOrderId
                ? (customerById.get(orders.find(o => o.id === selectedOrderId)?.customer_id ?? -1)?.name ?? `Order #${selectedOrderId}`)
                : <span className="text-stone-400">No order selected</span>}
            </div>
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
                    <th className="px-3 py-2 text-right text-stone-500 font-medium">Remaining</th>
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
                      const avail = isEmpako
                        ? (remaining40x1[pid] ?? 0) + Math.floor((remainingInventory[pid] ?? 0) / 2)
                        : (remainingInventory[pid] ?? 0)
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
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            <span className={dynamicRemaining === 0 ? 'text-emerald-500' : 'text-stone-500'}>
                              {dynamicRemaining}
                            </span>
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

// ── NewOrderDialog ────────────────────────────────────────────────────────────

function NewOrderDialog({
  open, onClose, customers: initialCustomers, products, date, onCreated,
}: {
  open: boolean
  onClose: () => void
  customers: Customer[]
  products: DeliveryProduct[]
  date: string
  onCreated: (order: Order, items: OrderItem[]) => void
}) {
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers)
  const [customerId, setCustomerId] = useState('')
  const [addingCustomer, setAddingCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [dateType, setDateType] = useState<'specific' | 'range'>('specific')
  const [deliveryDate, setDeliveryDate] = useState(date)
  const [dateStart, setDateStart] = useState(date)
  const [dateEnd, setDateEnd] = useState(date)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [empakoState, setEmpakoState] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setCustomers(initialCustomers)
      setCustomerId('')
      setAddingCustomer(false)
      setNewCustomerName('')
      setDateType('specific')
      setDeliveryDate(date)
      setDateStart(date)
      setDateEnd(date)
      setAmounts({})
      setEmpakoState({})
      setNotes('')
    }
  }, [open])

  async function handleSaveCustomer() {
    if (!newCustomerName.trim()) return
    setSavingCustomer(true)
    const { data, error } = await supabase.from('customers')
      .insert({ name: newCustomerName.trim(), city: '' })
      .select().single()
    setSavingCustomer(false)
    if (error || !data) { toast('Failed to add customer', 'error'); return }
    const newC = data as Customer
    setCustomers(prev => [...prev, newC].sort((a, b) => a.name.localeCompare(b.name)))
    setCustomerId(String(newC.id))
    setAddingCustomer(false)
    setNewCustomerName('')
    toast('Customer added')
  }

  async function handleSave() {
    const cid = parseInt(customerId)
    if (!cid) { toast('Select a customer', 'error'); return }

    const validItems = products
      .map(p => ({
        productId: p.id,
        cases: parseInt(amounts[p.id] ?? '0') || 0,
        empako: !SPREAD_PRODUCT_IDS.has(p.id) && (empakoState[p.id] ?? false),
      }))
      .filter(i => i.cases > 0)
    if (!validItems.length) { toast('Enter at least one item', 'error'); return }

    const start = dateType === 'specific' ? deliveryDate : dateStart
    const end   = dateType === 'specific' ? deliveryDate : dateEnd
    if (start > end) { toast('End date must be on or after start date', 'error'); return }

    setSaving(true)
    const { data: order, error: orderErr } = await supabase.from('orders')
      .insert({
        customer_id: cid,
        order_date: new Date().toLocaleDateString('en-CA'),
        delivery_date_start: start,
        delivery_date_end: end,
        status: 'open',
        notes: notes.trim() || null,
      })
      .select().single()
    if (orderErr || !order) { setSaving(false); toast('Failed to create order', 'error'); return }

    const { data: insertedItems, error: itemsErr } = await supabase.from('order_items')
      .insert(validItems.map(i => ({ order_id: order.id, product_id: i.productId, cases: i.cases, empako: i.empako })))
      .select()
    setSaving(false)
    if (itemsErr) { toast('Order created but items failed to save', 'error'); return }

    onCreated(order as Order, (insertedItems ?? []) as OrderItem[])
    toast('Order created')
    onClose()
  }

  const totalCases = products.reduce((s, p) => s + (parseInt(amounts[p.id] ?? '0') || 0), 0)

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm max-h-[90svh] grid-rows-[auto_1fr_auto]">
        <DialogHeader>
          <DialogTitle>New Order</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-4">
          {/* Customer */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans mb-1.5">Customer</p>
            {addingCustomer ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Customer name"
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveCustomer()
                    if (e.key === 'Escape') { setAddingCustomer(false); setNewCustomerName('') }
                  }}
                  className="flex-1 px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
                />
                <button
                  onClick={handleSaveCustomer}
                  disabled={savingCustomer || !newCustomerName.trim()}
                  className="px-3 py-2 text-xs font-semibold font-sans rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
                >
                  {savingCustomer ? '…' : 'Add'}
                </button>
                <button
                  onClick={() => { setAddingCustomer(false); setNewCustomerName('') }}
                  className="px-2 py-2 text-xs font-sans text-stone-400 hover:text-stone-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white"
                >
                  <option value="">Select customer…</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => setAddingCustomer(true)}
                  className="px-3 py-2 text-xs font-semibold font-sans rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 transition-colors whitespace-nowrap"
                >
                  + New
                </button>
              </div>
            )}
          </div>

          {/* Delivery date */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans mb-1.5">Delivery Date</p>
            <div className="flex gap-1 mb-2">
              {(['specific', 'range'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setDateType(t)}
                  className={cn(
                    'px-3 py-1 text-xs font-sans font-medium rounded-lg border transition-colors',
                    dateType === t
                      ? 'bg-stone-800 text-white border-stone-800'
                      : 'border-stone-200 text-stone-500 hover:bg-stone-50',
                  )}
                >
                  {t === 'specific' ? 'Specific' : 'Range'}
                </button>
              ))}
            </div>
            {dateType === 'specific' ? (
              <input
                type="date"
                value={deliveryDate}
                onChange={e => setDeliveryDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  value={dateStart}
                  onChange={e => setDateStart(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
                />
                <span className="text-stone-400 text-sm flex-shrink-0">–</span>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={e => setDateEnd(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300"
                />
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans mb-1.5">Items</p>
            <div className="border border-stone-100 rounded-xl overflow-hidden">
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
          </div>

          {/* Notes */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 font-sans mb-1.5">Notes</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional"
              rows={2}
              className="w-full px-3 py-2 text-sm font-sans border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <span className="text-xs font-mono tabular-nums self-center text-stone-400 flex-1">
            {totalCases > 0 ? `${totalCases} cs` : ''}
          </span>
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
