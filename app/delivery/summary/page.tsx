export const dynamic = 'force-dynamic'

import { createServerClient } from '@/lib/supabase-server'
import { SummaryPage } from './SummaryPage'
import type { DeliveryProduct, Customer, Truck, Order, OrderItem, Delivery, DeliveryItem, WarehouseDrop } from '@/lib/delivery-types'

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
    { data: allTrucks },
    { data: availability },
    { data: deliveries },
    { data: warehouseDrops },
    { data: customers },
  ] = await Promise.all([
    supabase.from('delivery_products').select('*').order('display_order'),
    supabase.from('trucks').select('*').eq('active', true).order('name'),
    supabase.from('truck_availability').select('*').eq('date', date),
    supabase.from('deliveries').select('*').eq('delivery_date', date),
    supabase.from('warehouse_drops').select('*').eq('date', date),
    supabase.from('customers').select('*').eq('active', true),
  ])

  const availabilityMap: Record<number, boolean> = {}
  for (const r of availability ?? []) availabilityMap[r.truck_id] = r.available
  const availableTrucks = (allTrucks ?? []).filter(t => availabilityMap[t.id] === true) as Truck[]

  const deliveryList = (deliveries ?? []) as Delivery[]
  const deliveryIds = deliveryList.map(d => d.id)
  const orderIds = [...new Set(deliveryList.map(d => d.order_id))]

  const [{ data: deliveryItems }, { data: orders }] = await Promise.all([
    deliveryIds.length > 0
      ? supabase.from('delivery_items').select('*').in('delivery_id', deliveryIds)
      : Promise.resolve({ data: [] as DeliveryItem[] }),
    orderIds.length > 0
      ? supabase.from('orders').select('*').in('id', orderIds)
      : Promise.resolve({ data: [] as Order[] }),
  ])

  const { data: orderItemsRaw } = orderIds.length > 0
    ? await supabase.from('order_items').select('*').in('order_id', orderIds)
    : { data: [] as OrderItem[] }

  return (
    <SummaryPage
      key={date}
      date={date}
      products={(products ?? []) as DeliveryProduct[]}
      trucks={availableTrucks}
      deliveries={deliveryList}
      deliveryItems={(deliveryItems ?? []) as DeliveryItem[]}
      orders={(orders ?? []) as Order[]}
      orderItems={(orderItemsRaw ?? []) as OrderItem[]}
      customers={(customers ?? []) as Customer[]}
      warehouseDrops={(warehouseDrops ?? []) as WarehouseDrop[]}
    />
  )
}
