import { createServerClient } from '@/lib/supabase-server'
import { DashboardPage } from './DashboardPage'
import type { DeliveryProduct, Customer, Truck, Order, OrderItem, Delivery, DeliveryItem, WarehouseDrop, BodegaRow } from '@/lib/delivery-types'

export const dynamic = 'force-dynamic'

function getTomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}

function dateOffset(base: string, days: number): string {
  const d = new Date(base + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA')
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date: dateParam } = await searchParams
  const date = dateParam && isValidDate(dateParam) ? dateParam : getTomorrow()

  const supabase = createServerClient()

  // Step 1: fetch date-independent data and orders in parallel
  const [
    { data: products },
    { data: allTrucks },
    { data: customers },
    { data: orders },
    { data: inventory },
    { data: warehouse },
    { data: availability },
    { data: warehouseDropsRaw },
  ] = await Promise.all([
    supabase.from('delivery_products').select('*').order('display_order'),
    supabase.from('trucks').select('*').eq('active', true).order('name'),
    supabase.from('customers').select('*').eq('active', true).order('name'),
    supabase.from('orders')
      .select('*')
      .neq('status', 'cancelled'),
    supabase.from('daily_inventory').select('*').eq('date', date),
    supabase.from('warehouse_daily').select('*').eq('date', date),
    supabase.from('truck_availability').select('*').eq('date', date),
    supabase.from('warehouse_drops').select('*').eq('date', date),
  ])

  const orderIds = (orders ?? []).map(o => o.id)

  // Step 2: fetch order-dependent data filtered to relevant IDs
  const [
    { data: allOrderItems },
    allOrderDeliveries,
  ] = await Promise.all([
    orderIds.length > 0
      ? supabase.from('order_items').select('*').in('order_id', orderIds)
      : Promise.resolve({ data: [] as OrderItem[] }),
    orderIds.length > 0
      ? supabase.from('deliveries').select('*').in('order_id', orderIds).then(r => r.data ?? [])
      : Promise.resolve([] as Delivery[]),
  ])

  const deliveryIds = (allOrderDeliveries as Delivery[]).map(d => d.id)

  // Step 3: fetch delivery items filtered to relevant delivery IDs
  const { data: allDeliveryItemsRaw } = deliveryIds.length > 0
    ? await supabase.from('delivery_items').select('*').in('delivery_id', deliveryIds)
    : { data: [] as DeliveryItem[] }

  const todayDeliveries = (allOrderDeliveries as Delivery[]).filter(d => d.delivery_date === date)
  const todayDeliveryIds = new Set(todayDeliveries.map(d => d.id))
  const todayDeliveryItems = (allDeliveryItemsRaw ?? []).filter(i => todayDeliveryIds.has(i.delivery_id))

  const availabilityMap: Record<number, boolean> = {}
  for (const r of availability ?? []) availabilityMap[r.truck_id] = r.available
  const availableTrucks = (allTrucks ?? []).filter(t => availabilityMap[t.id] === true)

  const inventoryMap: Record<string, number> = {}
  const inventoryMap40x1: Record<string, number> = {}
  for (const r of inventory ?? []) {
    inventoryMap[r.product_id] = r.cases_available
    inventoryMap40x1[r.product_id] = r.cases_available_40x1 ?? 0
  }

  const warehouseMap: Record<string, { pickup: number; stock: number }> = {}
  for (const r of warehouse ?? []) {
    warehouseMap[r.product_id] = { pickup: r.pickup_orders_total, stock: r.warehouse_stock }
  }

  const regularOrders = (orders ?? []).filter(o => (o as Order).order_type !== 'bodega')

  // Load bodega orders for this date
  const { data: bodegaOrders } = await supabase
    .from('orders')
    .select('*')
    .eq('order_type', 'bodega')
    .neq('status', 'cancelled')
    .lte('delivery_date_start', date)
    .gte('delivery_date_end', date)

  const bodegaIds = (bodegaOrders ?? []).map((o: Order) => o.id)
  const { data: bodegaItems } = bodegaIds.length > 0
    ? await supabase.from('order_items').select('*').in('order_id', bodegaIds)
    : { data: [] as OrderItem[] }

  const customerMap = new Map(((await supabase.from('customers').select('id,name')).data ?? []).map((c: { id: number; name: string }) => [c.id, c.name]))

  const bodegaRows: BodegaRow[] = (bodegaOrders ?? []).map((order: Order) => {
    const items: BodegaRow['items'] = {}
    for (const item of (bodegaItems ?? []).filter((i: OrderItem) => i.order_id === order.id)) {
      items[item.product_id] = { itemId: item.id, cases: item.cases }
    }
    return {
      orderId: order.id,
      customerId: order.customer_id,
      customerName: customerMap.get(order.customer_id) ?? 'Unknown',
      items,
    }
  })

  return (
    <DashboardPage
      key={date}
      products={(products ?? []) as DeliveryProduct[]}
      trucks={availableTrucks as Truck[]}
      customers={(customers ?? []) as Customer[]}
      orders={regularOrders as Order[]}
      orderItems={(allOrderItems ?? []) as OrderItem[]}
      deliveries={todayDeliveries}
      deliveryItems={todayDeliveryItems as DeliveryItem[]}
      allOrderDeliveries={allOrderDeliveries as Delivery[]}
      allOrderDeliveryItems={(allDeliveryItemsRaw ?? []) as DeliveryItem[]}
      inventory={inventoryMap}
      inventory40x1={inventoryMap40x1}
      warehouse={warehouseMap}
      warehouseDrops={(warehouseDropsRaw ?? []) as WarehouseDrop[]}
      initialBodegas={bodegaRows}
      date={date}
    />
  )
}
