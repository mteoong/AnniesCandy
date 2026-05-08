'use client'

import { useState, useMemo, useCallback } from 'react'
import { DayPicker } from '@/components/DayPicker'
import type { DeliveryProduct, Customer, Truck, Order, OrderItem, Delivery, DeliveryItem, WarehouseDrop } from '@/lib/delivery-types'
import { getProductAbbr } from '@/lib/delivery-types'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  date: string
  products: DeliveryProduct[]
  trucks: Truck[]
  deliveries: Delivery[]
  deliveryItems: DeliveryItem[]
  orders: Order[]
  orderItems: OrderItem[]
  customers: Customer[]
  warehouseDrops: WarehouseDrop[]
}

type CustomerStop = {
  kind: 'customer'
  stopOrder: number
  delivery: Delivery
  order: Order | undefined
  customer: Customer | undefined
  items: DeliveryItem[]
}

type WarehouseStop = {
  kind: 'warehouse'
  stopOrder: number
  drops: WarehouseDrop[]
}

type UnifiedStop = CustomerStop | WarehouseStop

type TruckSummaryProps = {
  truck: Truck
  deliveries: Delivery[]
  itemsByDelivery: Record<number, DeliveryItem[]>
  drops: WarehouseDrop[]
  products: DeliveryProduct[]
  orderById: Map<number, Order>
  customerById: Map<number, Customer>
  orderItemsByOrderId: Record<number, OrderItem[]>
  expanded: boolean
  onToggle: () => void
}

// ── TruckSummary ──────────────────────────────────────────────────────────────

function TruckSummary({
  truck, deliveries, itemsByDelivery, drops,
  products, orderById, customerById, orderItemsByOrderId,
  expanded, onToggle,
}: TruckSummaryProps) {
  const unifiedStops: UnifiedStop[] = useMemo(() => {
    const customerStops: CustomerStop[] = deliveries.map(d => ({
      kind: 'customer',
      stopOrder: d.stop_order,
      delivery: d,
      order: orderById.get(d.order_id),
      customer: customerById.get(orderById.get(d.order_id)?.customer_id ?? -1),
      items: itemsByDelivery[d.id] ?? [],
    }))
    const warehouseStop: WarehouseStop[] = drops.length > 0 ? [{
      kind: 'warehouse',
      stopOrder: drops[0].stop_order,
      drops,
    }] : []
    return [...customerStops, ...warehouseStop].sort((a, b) => a.stopOrder - b.stopOrder)
  }, [deliveries, drops, orderById, customerById, itemsByDelivery])

  const productTotals: Record<string, number> = {}
  for (const stop of unifiedStops) {
    if (stop.kind === 'customer') {
      for (const item of stop.items) {
        productTotals[item.product_id] = (productTotals[item.product_id] ?? 0) + item.cases
      }
    } else {
      for (const drop of stop.drops) {
        productTotals[drop.product_id] = (productTotals[drop.product_id] ?? 0) + drop.cases
      }
    }
  }

  const activeProducts = products.filter(p => (productTotals[p.id] ?? 0) > 0)

  const empakaStops = useMemo(() =>
    unifiedStops.filter((s): s is CustomerStop => {
      if (s.kind !== 'customer' || !s.order) return false
      const ois = orderItemsByOrderId[s.order.id] ?? []
      return ois.some(i => i.empako)
    }),
    [unifiedStops, orderItemsByOrderId],
  )

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 transition-colors"
      >
        <svg
          className={`w-4 h-4 text-stone-400 flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="font-semibold text-stone-800">{truck.name}</span>
      </button>

      <div className={cn("border-t border-stone-200", !expanded && "hidden")}>
        {activeProducts.length === 0 ? (
          <p className="px-4 py-3 text-sm text-stone-400">No items recorded.</p>
        ) : (
          <>
            {/* Main delivery table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm summary-truck-table">
                <thead>
                  <tr className="bg-stone-50 sticky top-0">
                    <th className="text-left px-4 py-2 font-medium text-stone-500 whitespace-nowrap">Client</th>
                    {activeProducts.map(p => (
                      <th key={p.id} className="px-3 py-2 font-medium text-stone-500 text-right whitespace-nowrap">
                        {getProductAbbr(p)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {unifiedStops.map((stop, idx) => {
                    if (stop.kind === 'warehouse') {
                      const dropMap: Record<string, number> = {}
                      for (const d of stop.drops) {
                        dropMap[d.product_id] = (dropMap[d.product_id] ?? 0) + d.cases
                      }
                      return (
                        <tr key="warehouse" className="bg-amber-50">
                          <td className="px-4 py-2 text-amber-700 font-medium whitespace-nowrap">
                            <span className="text-stone-400 text-xs mr-1.5">{idx + 1}.</span>
                            Warehouse
                          </td>
                          {activeProducts.map(p => (
                            <td key={p.id} className="px-3 py-2 text-right text-amber-700">
                              {dropMap[p.id] != null ? dropMap[p.id] : <span className="text-amber-200">—</span>}
                            </td>
                          ))}
                        </tr>
                      )
                    }

                    const itemMap: Record<string, number> = {}
                    for (const item of stop.items) itemMap[item.product_id] = item.cases

                    const orderItemsForStop = stop.order
                      ? (orderItemsByOrderId[stop.order.id] ?? [])
                      : []

                    return (
                      <tr key={stop.delivery.id} className="hover:bg-stone-50">
                        <td className="px-4 py-2 text-stone-700 whitespace-nowrap">
                          <span className="text-stone-400 text-xs mr-1.5">{idx + 1}.</span>
                          {stop.customer?.name ?? 'Unknown'}
                        </td>
                        {activeProducts.map(p => {
                          const count = itemMap[p.id]
                          const isEmpako = orderItemsForStop.find(i => i.product_id === p.id)?.empako ?? false
                          return (
                            <td key={p.id} className="px-3 py-2 text-right text-stone-700">
                              {count != null ? (
                                <>
                                  {count}
                                  {isEmpako && count > 0 && (
                                    <div className="text-[8px] font-semibold text-orange-500 leading-none mt-0.5">40x1</div>
                                  )}
                                </>
                              ) : (
                                <span className="text-stone-200">—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-stone-100 border-t-2 border-stone-200">
                    <td className="px-4 py-2 font-semibold text-stone-700">Total</td>
                    {activeProducts.map(p => (
                      <td key={p.id} className="px-3 py-2 text-right font-semibold text-stone-800">
                        {productTotals[p.id] ?? 0}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* 40x1 labels sub-table */}
            {empakaStops.length > 0 && (
              <div className="border-t border-amber-100 bg-amber-50/40 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 font-sans mb-2">
                  40x1 Labels
                </p>
                <table className="text-sm font-sans">
                  <tbody>
                    {empakaStops.map(stop => {
                      const label = stop.order?.empaka_note || stop.customer?.name || '—'
                      return (
                        <tr key={stop.delivery.id}>
                          <td className="pr-3 py-0.5 text-stone-500 text-xs">{stop.customer?.name ?? '—'}</td>
                          <td className="text-stone-300 text-xs">→</td>
                          <td className="pl-3 py-0.5 font-semibold text-stone-800">{label}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── SummaryPage ───────────────────────────────────────────────────────────────

export function SummaryPage({
  date, products, trucks, deliveries, deliveryItems, orders, orderItems, customers, warehouseDrops,
}: Props) {
  const [expandedTrucks, setExpandedTrucks] = useState<Set<number>>(() => new Set(trucks.map(t => t.id)))
  const [exporting, setExporting] = useState(false)

  const customerById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers])
  const orderById    = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders])

  const orderItemsByOrderId = useMemo(() => {
    const m: Record<number, OrderItem[]> = {}
    for (const item of orderItems) {
      if (!m[item.order_id]) m[item.order_id] = []
      m[item.order_id].push(item)
    }
    return m
  }, [orderItems])

  const itemsByDelivery = useMemo(() => {
    const m: Record<number, DeliveryItem[]> = {}
    for (const item of deliveryItems) {
      if (!m[item.delivery_id]) m[item.delivery_id] = []
      m[item.delivery_id].push(item)
    }
    return m
  }, [deliveryItems])

  const deliveriesByTruck = useMemo(() => {
    const m: Record<number, Delivery[]> = {}
    for (const d of deliveries) {
      if (!m[d.truck_id]) m[d.truck_id] = []
      m[d.truck_id].push(d)
    }
    return m
  }, [deliveries])

  const dropsByTruck = useMemo(() => {
    const m: Record<number, WarehouseDrop[]> = {}
    for (const drop of warehouseDrops) {
      if (!m[drop.truck_id]) m[drop.truck_id] = []
      m[drop.truck_id].push(drop)
    }
    return m
  }, [warehouseDrops])

  const activeTrucks = useMemo(() =>
    trucks.filter(t =>
      (deliveriesByTruck[t.id]?.length ?? 0) > 0 ||
      (dropsByTruck[t.id]?.length ?? 0) > 0,
    ),
    [trucks, deliveriesByTruck, dropsByTruck],
  )

  function toggle(truckId: number) {
    setExpandedTrucks(prev => {
      const next = new Set(prev)
      if (next.has(truckId)) next.delete(truckId)
      else next.add(truckId)
      return next
    })
  }

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const handleExportPDF = useCallback(async () => {
    setExporting(true)
    try {
      const jsPDF = (await import('jspdf')).default
      const autoTable = (await import('jspdf-autotable')).default

      const doc = new jsPDF('l', 'mm', 'a4')
      const pw = doc.internal.pageSize.getWidth()
      const ph = doc.internal.pageSize.getHeight()
      const cutX = pw / 2
      const cutY = ph / 2
      const pad = 7
      const qw = cutX - 2 * pad   // ~134.5mm content width per quadrant
      const qh = cutY - 2 * pad   // ~91mm content height per quadrant

      const QX = [pad, cutX + pad, pad, cutX + pad]
      const QY = [pad, pad, cutY + pad, cutY + pad]

      const titleH   = 7    // title line height (truck name + date)
      const empLineH = 3.5  // height per empaka label line
      const rowH     = 5.5  // comfortable fixed row height


      const tables = activeTrucks.map(truck => {
        const truckDeliveries = deliveriesByTruck[truck.id] ?? []
        const truckDrops = dropsByTruck[truck.id] ?? []

        const custStops = truckDeliveries.map(d => {
          const order    = orderById.get(d.order_id)
          const customer = customerById.get(order?.customer_id ?? -1)
          return {
            isWh: false as const,
            stopOrder: d.stop_order,
            label: customer?.name ?? 'Unknown',
            items: (itemsByDelivery[d.id] ?? []).map(i => ({ product_id: i.product_id, cases: i.cases })),
            orderId: d.order_id as number | undefined,
          }
        })
        const whStops = truckDrops.length > 0 ? [{
          isWh: true as const,
          stopOrder: truckDrops[0].stop_order,
          label: 'Warehouse',
          items: truckDrops.map(d => ({ product_id: d.product_id, cases: d.cases })),
          orderId: undefined as number | undefined,
        }] : []
        const stops = [...custStops, ...whStops].sort((a, b) => a.stopOrder - b.stopOrder)

        const pidSet = new Set(stops.flatMap(s => s.items.map(i => i.product_id)))
        const activeProds = products.filter(p => pidSet.has(p.id))

        const totals: Record<string, number> = {}
        for (const stop of stops)
          for (const item of stop.items)
            totals[item.product_id] = (totals[item.product_id] ?? 0) + item.cases

        const head = [['Client', ...activeProds.map(p => getProductAbbr(p))]]

        const stopsRows: string[][] = stops.map((stop, idx) => [
          `${idx + 1}. ${stop.label}`,
          ...activeProds.map(p => {
            const item = stop.items.find(i => i.product_id === p.id)
            if (!item) return '—'
            const isEmpako = !stop.isWh && stop.orderId != null
              ? (orderItemsByOrderId[stop.orderId]?.find(oi => oi.product_id === p.id)?.empako ?? false)
              : false
            return isEmpako ? `${item.cases}\n40x1` : String(item.cases)
          }),
        ])

        const empakaLabels = stops
          .filter(s => !s.isWh && s.orderId != null &&
            (orderItemsByOrderId[s.orderId]?.some(oi => oi.empako) ?? false))
          .map(s => ({
            clientName: s.label,
            note: orderById.get(s.orderId!)?.empaka_note || s.label,
          }))

        // Always reserve space for heading + at least 2 label lines at the bottom
        const empakaH = empLineH * (1 + Math.max(2, empakaLabels.length)) + 2
        const tableAvailH = qh - titleH - empakaH

        // Rows containing "\n" (e.g. "100\n40x1") render taller than rowH because
        // they have two lines of text. Account for that extra height before computing
        // how many filler rows can fit.
        const doubleLineH   = 7  // empirical 2-line cell height in mm at 6.5pt font
        const numDoubleRows = stopsRows.filter(row => row.some(cell => cell.includes('\n'))).length
        const naturalH      = rowH * (2 + stopsRows.length - numDoubleRows)
                            + doubleLineH * numDoubleRows
        const numFillers    = Math.max(0, Math.floor((tableAvailH - naturalH) / rowH))
        const emptyRow      = new Array(1 + activeProds.length).fill('')

        const body: string[][] = [
          ...stopsRows,
          ...Array(numFillers).fill(null).map(() => [...emptyRow]),
          ['Total', ...activeProds.map(p => String(totals[p.id] ?? 0))],
        ]

        return { truck, head, body, totalRow: body.length - 1, empakaLabels }
      })

      function drawCutLines() {
        doc.setDrawColor(160, 160, 160)
        doc.setLineWidth(0.25)
        ;(doc as any).setLineDash([2.5, 2.5])
        doc.line(cutX, 0, cutX, ph)
        doc.line(0, cutY, pw, cutY)
        ;(doc as any).setLineDash([])
        doc.setDrawColor(0, 0, 0)
        doc.setLineWidth(0.2)
      }

      // Create all pages with cut lines first so table borders render on top
      const numPages = Math.max(1, Math.ceil(tables.length / 4))
      for (let p = 0; p < numPages; p++) {
        if (p > 0) doc.addPage()
        drawCutLines()
      }

      for (let i = 0; i < tables.length; i++) {
        const quadIdx = i % 4
        doc.setPage(Math.floor(i / 4) + 1)

        const t  = tables[i]
        const qx = QX[quadIdx]
        const qy = QY[quadIdx]

        doc.setFontSize(8)
        doc.setFont('helvetica', 'bold')
        doc.text(t.truck.name, qx, qy + 5)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.text(dateLabel, qx + qw, qy + 5, { align: 'right' })

        autoTable(doc, {
          startY: qy + titleH,
          head: t.head,
          body: t.body,
          margin: { left: qx, right: pw - qx - qw, top: 0, bottom: 0 },
          theme: 'grid',
          styles: {
            fontSize: 6.5,
            cellPadding: { top: 1, bottom: 1, left: 1.5, right: 1.5 },
            minCellHeight: rowH,
            overflow: 'linebreak',   // wrap text, never truncate
            halign: 'center',
          },
          headStyles: {
            fillColor: [28, 25, 23] as [number, number, number],
            textColor: 255,
            fontSize: 6.5,
            minCellHeight: rowH,
            overflow: 'linebreak',
            halign: 'center',
          },
          // Client column narrower so product columns have room for numbers
          columnStyles: { 0: { cellWidth: 28, halign: 'left' as const } },
          didParseCell: (data: any) => {
            if (data.section === 'body' && data.row.index === t.totalRow) {
              data.cell.styles.fontStyle = 'bold'
              data.cell.styles.fillColor = [240, 240, 240]
            }
          },
        })

        // Always draw empaka section at a fixed position anchored to the quadrant bottom
        const labelLines = Math.max(2, t.empakaLabels.length)
        let y = qy + qh - empLineH * (1 + labelLines)
        doc.setFontSize(6)
        doc.setFont('helvetica', 'bold')
        doc.text('40x1 Labels', qx, y)
        y += empLineH
        if (t.empakaLabels.length === 0) {
          doc.setFont('helvetica', 'normal')
          doc.text('None', qx, y)
        } else {
          for (const lbl of t.empakaLabels) {
            doc.setFont('helvetica', 'bold')
            doc.text(lbl.clientName, qx, y)
            const nameW = doc.getTextWidth(lbl.clientName)
            doc.setFont('helvetica', 'normal')
            doc.text(`: ${lbl.note}`, qx + nameW, y)
            y += empLineH
          }
        }
      }

      doc.save(`delivery-summary-${date}.pdf`)
    } finally {
      setExporting(false)
    }
  }, [activeTrucks, deliveriesByTruck, dropsByTruck, itemsByDelivery, orderById, customerById, orderItemsByOrderId, products, date, dateLabel])

  return (
    <div className="min-h-screen bg-canvas">
      <div className="sticky top-12 z-30 bg-canvas border-b border-stone-200/60 shadow-sm px-5 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-semibold text-stone-800 tracking-tight">Delivery Summary</h1>
          <p className="text-xs font-sans text-stone-400 mt-0.5">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportPDF}
            disabled={exporting || activeTrucks.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-sm font-sans text-stone-700 hover:border-stone-300 hover:bg-stone-50 disabled:opacity-40 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
          <DayPicker date={date} />
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 space-y-3">
        {activeTrucks.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-stone-400 text-base">No deliveries scheduled for this date.</p>
          </div>
        ) : (
          activeTrucks.map(truck => (
            <TruckSummary
              key={truck.id}
              truck={truck}
              deliveries={deliveriesByTruck[truck.id] ?? []}
              itemsByDelivery={itemsByDelivery}
              drops={dropsByTruck[truck.id] ?? []}
              products={products}
              orderById={orderById}
              customerById={customerById}
              orderItemsByOrderId={orderItemsByOrderId}
              expanded={expandedTrucks.has(truck.id)}
              onToggle={() => toggle(truck.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
