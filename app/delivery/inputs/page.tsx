import { createServerClient } from '@/lib/supabase-server'
import { InputsPage } from './InputsPage'
import type { DeliveryProduct, Customer, Truck, OrderItem, BodegaRow } from '@/lib/delivery-types'

export const dynamic = 'force-dynamic'

function getTomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
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

  const [
    { data: products },
    { data: trucks },
    { data: customers },
    { data: inventory },
    { data: availability },
    { data: warehouse },
    { data: bodegas },
  ] = await Promise.all([
    supabase.from('delivery_products').select('*').order('display_order'),
    supabase.from('trucks').select('*').eq('active', true).order('name'),
    supabase.from('customers').select('*').eq('active', true).order('name'),
    supabase.from('daily_inventory').select('*').eq('date', date),
    supabase.from('truck_availability').select('*').eq('date', date),
    supabase.from('warehouse_daily').select('*').eq('date', date),
    supabase.from('orders')
      .select('*')
      .eq('order_type', 'bodega')
      .neq('status', 'cancelled')
      .lte('delivery_date_start', date)
      .gte('delivery_date_end', date),
  ])

  const inventoryMap: Record<string, number> = {}
  const inventoryMap40x1: Record<string, number> = {}
  for (const r of inventory ?? []) {
    inventoryMap[r.product_id] = r.cases_available
    inventoryMap40x1[r.product_id] = r.cases_available_40x1 ?? 0
  }

  const availabilityMap: Record<number, boolean> = {}
  for (const r of availability ?? []) availabilityMap[r.truck_id] = r.available

  const warehouseMap: Record<string, { pickup: number; stock: number }> = {}
  for (const r of warehouse ?? []) {
    warehouseMap[r.product_id] = { pickup: r.pickup_orders_total, stock: r.warehouse_stock }
  }

  // Load order_items for bodega orders
  const bodegaIds = (bodegas ?? []).map(o => o.id)
  const { data: bodegaItems } = bodegaIds.length > 0
    ? await supabase.from('order_items').select('*').in('order_id', bodegaIds)
    : { data: [] as OrderItem[] }

  const customerMap = new Map((customers ?? []).map(c => [c.id, c.name]))

  const bodegaRows: BodegaRow[] = (bodegas ?? []).map(order => {
    const items: BodegaRow['items'] = {}
    for (const item of (bodegaItems ?? []).filter(i => i.order_id === order.id)) {
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
    <InputsPage
      key={date}
      products={(products ?? []) as DeliveryProduct[]}
      trucks={(trucks ?? []) as Truck[]}
      customers={(customers ?? []) as Customer[]}
      initialInventory={inventoryMap}
      initialInventory40x1={inventoryMap40x1}
      initialAvailability={availabilityMap}
      initialWarehouse={warehouseMap}
      initialBodegas={bodegaRows}
      date={date}
    />
  )
}
