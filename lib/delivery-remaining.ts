import type { OrderItem, Delivery, DeliveryItem } from '@/lib/delivery-types'

export type OrderRemaining = {
  byItem: Record<string, { ordered: number; delivered: number; remaining: number }>
  totalOrdered: number
  totalDelivered: number
  totalRemaining: number
}

export function getOrderRemaining(
  orderId: number,
  orderItems: OrderItem[],
  allDeliveries: Delivery[],
  allDeliveryItems: DeliveryItem[],
): OrderRemaining {
  const deliveryIds = new Set(
    allDeliveries.filter(d => d.order_id === orderId).map(d => d.id),
  )

  const deliveredByProduct: Record<string, number> = {}
  for (const di of allDeliveryItems) {
    if (deliveryIds.has(di.delivery_id)) {
      deliveredByProduct[di.product_id] = (deliveredByProduct[di.product_id] ?? 0) + di.cases
    }
  }

  const byItem: OrderRemaining['byItem'] = {}
  for (const oi of orderItems) {
    const delivered = deliveredByProduct[oi.product_id] ?? 0
    byItem[oi.product_id] = {
      ordered: oi.cases,
      delivered,
      remaining: Math.max(0, oi.cases - delivered),
    }
  }

  const totalOrdered = Object.values(byItem).reduce((s, v) => s + v.ordered, 0)
  const totalDelivered = Object.values(byItem).reduce((s, v) => s + v.delivered, 0)

  return {
    byItem,
    totalOrdered,
    totalDelivered,
    totalRemaining: Math.max(0, totalOrdered - totalDelivered),
  }
}
