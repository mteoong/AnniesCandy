export type DeliveryProduct = {
  id: string
  name: string
  weight_multiplier: number
  pool: string | null
  display_order: number
}

export type Customer = {
  id: number
  name: string
  city: string
  notes: string | null
  active: boolean
  created_at: string
}

export type Truck = {
  id: number
  name: string
  capacity_cases: number
  active: boolean
  created_at: string
}

export type OrderStatus = 'open' | 'closed' | 'cancelled'

export type Order = {
  id: number
  customer_id: number
  order_date: string
  delivery_date_start: string
  delivery_date_end: string
  status: OrderStatus
  notes: string | null
  empaka_note?: string | null
  created_at: string
}

export type OrderItem = {
  id: number
  order_id: number
  product_id: string
  cases: number
  empako?: boolean
}

export type Delivery = {
  id: number
  order_id: number
  truck_id: number
  delivery_date: string
  stop_order: number
  finalized: boolean
  created_at: string
}

export type DeliveryItem = {
  id: number
  delivery_id: number
  product_id: string
  cases: number
}

export type TruckAvailability = {
  truck_id: number
  date: string
  available: boolean
}

export type DailyInventory = {
  date: string
  product_id: string
  cases_available: number
  cases_available_40x1?: number
}

export const SPREAD_PRODUCT_IDS = new Set([
  'CHOC_SPREAD_CLASSIC_330',
  'CHOC_SPREAD_CLASSIC_165',
  'CHOC_SPREAD_DARK_330',
])

export type WarehouseDaily = {
  date: string
  product_id: string
  pickup_orders_total: number
  warehouse_stock: number
}

export type WarehouseDrop = {
  id: number
  truck_id: number
  date: string
  product_id: string
  cases: number
  stop_order: number
}

export const PRODUCT_ABBR: Record<string, string> = {
  HANY_SP:                 'HSP',
  KING:                    'K',
  LANGKA:                  'L',
  UBE:                     'U',
  COIN:                    'C',
  COMBO:                   'CB',
  JR:                      'JR',
  CHOC_KING:               'CNK',
  CHOC_SP:                 'CNSP',
  CHOC_XL:                 'CNXL',
  CHOC_SPREAD_CLASSIC_330: 'C330G',
  CHOC_SPREAD_CLASSIC_165: 'C165G',
  CHOC_SPREAD_DARK_330:    'D330G',
}

export function getProductAbbr(p: { id: string; name: string }): string {
  return PRODUCT_ABBR[p.id] ?? p.name
}
