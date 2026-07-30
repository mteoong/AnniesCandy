'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { DayPicker } from '@/components/DayPicker'
import type { DeliveryProduct, Customer, Truck, Order, OrderItem, Delivery, DeliveryItem, WarehouseDrop } from '@/lib/delivery-types'
import { getProductAbbr, CONDITIONAL_SHOW_PRODUCT_IDS } from '@/lib/delivery-types'
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
  note?: string
  expanded: boolean
  onToggle: () => void
}

// ── TruckSummary ──────────────────────────────────────────────────────────────

export function TruckSummary({
  truck, deliveries, itemsByDelivery, drops,
  products, orderById, customerById, orderItemsByOrderId,
  note, expanded, onToggle,
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
      for (const item of stop.items) productTotals[item.product_id] = (productTotals[item.product_id] ?? 0) + item.cases
    } else {
      for (const drop of stop.drops) productTotals[drop.product_id] = (productTotals[drop.product_id] ?? 0) + drop.cases
    }
  }

  const visibleProducts = products.filter(p =>
    !CONDITIONAL_SHOW_PRODUCT_IDS.has(p.id) || (productTotals[p.id] ?? 0) > 0
  )

  const empakaStops = useMemo(() =>
    unifiedStops.filter((s): s is CustomerStop => {
      if (s.kind !== 'customer' || !s.order) return false
      const ois = orderItemsByOrderId[s.order.id] ?? []
      return ois.some(i => i.empako)
    }),
    [unifiedStops, orderItemsByOrderId],
  )

  // Build per-stop row data for two-section table
  type SRowData = {
    stop: UnifiedStop
    idx: number
    label: string
    empakoMap: Record<string, boolean>
    itemMap: Record<string, number>
  }

  const allRows: SRowData[] = unifiedStops.map((stop, idx) => {
    if (stop.kind === 'warehouse') {
      const itemMap: Record<string, number> = {}
      for (const d of stop.drops) itemMap[d.product_id] = (itemMap[d.product_id] ?? 0) + d.cases
      return { stop, idx, label: 'Warehouse', empakoMap: {}, itemMap }
    }
    const itemMap: Record<string, number> = {}
    for (const item of stop.items) itemMap[item.product_id] = item.cases
    const empakoMap: Record<string, boolean> = {}
    const ois = stop.order ? (orderItemsByOrderId[stop.order.id] ?? []) : []
    for (const oi of ois) empakoMap[oi.product_id] = oi.empako ?? false
    return { stop, idx, label: stop.customer?.name ?? 'Unknown', empakoMap, itemMap }
  })

  const topRows = allRows.filter(r =>
    r.stop.kind === 'warehouse' || Object.entries(r.itemMap).some(([pid, cs]) => !r.empakoMap[pid] && cs > 0)
  )
  const bottomRows = allRows.filter(r =>
    r.stop.kind === 'customer' && Object.entries(r.itemMap).some(([pid, cs]) => r.empakoMap[pid] && cs > 0)
  )
  const hasEmpako = bottomRows.length > 0

  const topTotals: Record<string, number> = {}
  for (const r of topRows)
    for (const [pid, cs] of Object.entries(r.itemMap))
      if (r.stop.kind === 'warehouse' || !r.empakoMap[pid]) topTotals[pid] = (topTotals[pid] ?? 0) + cs

  const bottomTotals: Record<string, number> = {}
  for (const r of bottomRows)
    for (const [pid, cs] of Object.entries(r.itemMap))
      if (r.empakoMap[pid]) bottomTotals[pid] = (bottomTotals[pid] ?? 0) + cs

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
        {unifiedStops.length === 0 ? (
          <p className="px-4 py-3 text-sm text-stone-400">No items recorded.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm summary-truck-table [&_td]:align-middle [&_th]:align-middle">
                <thead>
                  <tr className="bg-stone-50 sticky top-0 border-b border-stone-200">
                    <th className="text-left px-4 py-2 font-medium text-stone-500 whitespace-nowrap">Client</th>
                    {visibleProducts.map(p => (
                      <th key={p.id} className="px-3 py-2 font-medium text-stone-500 text-right whitespace-nowrap">
                        {getProductAbbr(p)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hasEmpako && (
                    <tr className="bg-stone-50 border-b border-stone-200">
                      <td colSpan={1 + visibleProducts.length} className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400 font-sans text-center">
                        20×1
                      </td>
                    </tr>
                  )}
                  {topRows.map(r => {
                    if (r.stop.kind === 'warehouse') {
                      return (
                        <tr key="warehouse" className="hover:bg-stone-50 border-b border-stone-100">
                          <td className="px-4 py-2 text-stone-700 font-medium whitespace-nowrap">
                            Warehouse
                          </td>
                          {visibleProducts.map(p => (
                            <td key={p.id} className="px-3 py-2 text-right text-stone-700">
                              {r.itemMap[p.id] != null ? r.itemMap[p.id] : <span className="text-stone-200">—</span>}
                            </td>
                          ))}
                        </tr>
                      )
                    }
                    const cs = r.stop as CustomerStop
                    return (
                      <tr key={cs.delivery.id} className="hover:bg-stone-50 border-b border-stone-100">
                        <td className="px-4 py-2 text-stone-700 whitespace-nowrap">
                          {r.label}
                        </td>
                        {visibleProducts.map(p => {
                          const val = !r.empakoMap[p.id] ? r.itemMap[p.id] : undefined
                          return (
                            <td key={p.id} className="px-3 py-2 text-right text-stone-700">
                              {val != null ? val : <span className="text-stone-200">—</span>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  <tr className={cn('bg-stone-100 border-b border-stone-200', !hasEmpako && 'border-b-0')}>
                    <td className="px-4 py-2 font-semibold text-stone-700">{hasEmpako ? 'Total (20×1)' : 'Total'}</td>
                    {visibleProducts.map(p => (
                      <td key={p.id} className="px-3 py-2 text-right font-semibold text-stone-800">
                        {topTotals[p.id] ?? 0}
                      </td>
                    ))}
                  </tr>
                  {hasEmpako && (
                    <>
                      <tr className="bg-stone-50 border-b border-stone-200">
                        <td colSpan={1 + visibleProducts.length} className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400 font-sans text-center">
                          40×1
                        </td>
                      </tr>
                      {bottomRows.map(r => {
                        const cs = r.stop as CustomerStop
                        return (
                          <tr key={`emp-${cs.delivery.id}`} className="hover:bg-stone-50 border-b border-stone-100">
                            <td className="px-4 py-2 text-stone-700 whitespace-nowrap">
                              {r.label}
                            </td>
                            {visibleProducts.map(p => {
                              const val = r.empakoMap[p.id] ? r.itemMap[p.id] : undefined
                              return (
                                <td key={p.id} className="px-3 py-2 text-right text-stone-700">
                                  {val != null ? val : <span className="text-stone-200">—</span>}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                      <tr className="bg-stone-100">
                        <td className="px-4 py-2 font-semibold text-stone-700">Total (40×1)</td>
                        {visibleProducts.map(p => (
                          <td key={p.id} className="px-3 py-2 text-right font-semibold text-stone-800">
                            {bottomTotals[p.id] ?? 0}
                          </td>
                        ))}
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {(note || empakaStops.length > 0) && (
              <div className="border-t border-stone-100 bg-stone-50/40 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 font-sans mb-2">
                  Notes
                </p>
                <p className="text-xs font-sans text-stone-700 whitespace-pre-wrap">
                  {[
                    note?.trim(),
                    ...empakaStops.map(stop => {
                      const label = stop.order?.empaka_note || stop.customer?.name || '—'
                      return `${stop.customer?.name ?? '—'}: ${label}`
                    }),
                  ].filter(Boolean).join('\n')}
                </p>
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
  const [truckNotes, setTruckNotes] = useState<Record<number, string>>({})
  useEffect(() => {
    const result: Record<number, string> = {}
    for (const t of trucks) {
      const v = localStorage.getItem(`truck-note-${t.id}-${date}`)
      if (v) result[t.id] = v
    }
    setTruckNotes(result)
  }, [])

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

        const head = [['Client', ...activeProds.map(p => getProductAbbr(p))]]

        // Split stops into top (non-empako + warehouse) and bottom (empako) sections
        const topStops = stops.filter(s => {
          if (s.isWh) return true
          return activeProds.some(p => {
            const isEmpako = s.orderId != null && (orderItemsByOrderId[s.orderId]?.find((oi: any) => oi.product_id === p.id)?.empako ?? false)
            const item = s.items.find((i: any) => i.product_id === p.id)
            return !isEmpako && item && item.cases > 0
          })
        })
        const botStops = stops.filter(s => {
          if (s.isWh) return false
          return activeProds.some(p => {
            const isEmpako = s.orderId != null && (orderItemsByOrderId[s.orderId]?.find((oi: any) => oi.product_id === p.id)?.empako ?? false)
            const item = s.items.find((i: any) => i.product_id === p.id)
            return isEmpako && item && item.cases > 0
          })
        })
        const pdfHasEmpako = botStops.length > 0

        const topTotals: Record<string, number> = {}
        for (const s of topStops)
          for (const item of s.items) {
            const isEmpako = !s.isWh && s.orderId != null && (orderItemsByOrderId[s.orderId]?.find((oi: any) => oi.product_id === item.product_id)?.empako ?? false)
            if (!isEmpako) topTotals[item.product_id] = (topTotals[item.product_id] ?? 0) + item.cases
          }
        const botTotals: Record<string, number> = {}
        for (const s of botStops)
          for (const item of s.items) {
            const isEmpako = s.orderId != null && (orderItemsByOrderId[s.orderId]?.find((oi: any) => oi.product_id === item.product_id)?.empako ?? false)
            if (isEmpako) botTotals[item.product_id] = (botTotals[item.product_id] ?? 0) + item.cases
          }

        const makeRow = (s: typeof stops[0], section: 'top' | 'bot'): string[] => [
          s.label,
          ...activeProds.map(p => {
            const item = s.items.find((i: any) => i.product_id === p.id)
            if (!item) return '—'
            if (s.isWh) return String(item.cases)
            const isEmpako = s.orderId != null && (orderItemsByOrderId[s.orderId]?.find((oi: any) => oi.product_id === p.id)?.empako ?? false)
            if (section === 'top') return isEmpako ? '—' : String(item.cases)
            return isEmpako ? String(item.cases) : '—'
          }),
        ]

        const empakaLabels = stops
          .filter(s => !s.isWh && s.orderId != null &&
            (orderItemsByOrderId[s.orderId]?.some((oi: any) => oi.empako) ?? false))
          .map(s => ({
            clientName: s.label,
            note: orderById.get(s.orderId!)?.empaka_note || s.label,
          }))

        const truckNote = truckNotes[truck.id] ?? ''
        const noteLineCount = truckNote ? truckNote.split('\n').filter((l: string) => l.trim()).length : 0
        const totalSectionLines = noteLineCount + empakaLabels.length
        const empakaH = empLineH * (1 + Math.max(2, totalSectionLines === 0 ? 1 : totalSectionLines)) + 2
        const tableAvailH = qh - titleH - empakaH

        const sectionRowStyle = { halign: 'center', valign: 'middle', fontStyle: 'bold', textColor: [80, 80, 80] }
        const twentyRow = [{ content: '20×1', colSpan: 1 + activeProds.length, styles: sectionRowStyle }]
        const topRows = topStops.map(s => makeRow(s, 'top'))
        const topTotalRow = [pdfHasEmpako ? 'Total (20×1)' : 'Total', ...activeProds.map(p => String(topTotals[p.id] ?? 0))]
        const separatorRow = [{ content: '40×1', colSpan: 1 + activeProds.length, styles: sectionRowStyle }]
        const botRows = botStops.map(s => makeRow(s, 'bot'))
        const botTotalRow = ['Total (40×1)', ...activeProds.map(p => String(botTotals[p.id] ?? 0))]

        // 1 head row + all body rows (section headers and totals count as rows)
        const naturalRowCount = pdfHasEmpako
          ? 1 + 1 + topRows.length + 1 + 1 + botRows.length + 1
          : 1 + topRows.length + 1
        const numFillers = Math.max(0, Math.floor((tableAvailH - rowH * naturalRowCount) / rowH))
        const emptyRow: any[] = new Array(1 + activeProds.length).fill('')

        let topSubtotalIdx: number
        let botTotalIdx: number | null = null
        let body: any[][]

        if (pdfHasEmpako) {
          const topFillers = Math.ceil(numFillers / 2)
          const botFillers = numFillers - topFillers
          topSubtotalIdx = 1 + topRows.length + topFillers
          botTotalIdx = 1 + topRows.length + topFillers + 1 + 1 + botRows.length + botFillers
          body = [
            twentyRow,
            ...topRows,
            ...Array(topFillers).fill(null).map(() => [...emptyRow]),
            topTotalRow,
            separatorRow,
            ...botRows,
            ...Array(botFillers).fill(null).map(() => [...emptyRow]),
            botTotalRow,
          ]
        } else {
          topSubtotalIdx = topRows.length + numFillers
          body = [...topRows, ...Array(numFillers).fill(null).map(() => [...emptyRow]), topTotalRow]
        }

        return { truck, head, body, topSubtotalIdx, botTotalIdx, empakaLabels, truckNote }
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
            cellPadding: { top: 0.6, bottom: 0.6, left: 1.2, right: 1.2 },
            minCellHeight: rowH,
            overflow: 'linebreak',
            halign: 'center',
            valign: 'middle',
            lineWidth: 0.05,
          },
          bodyStyles: {
            fillColor: false as any,
          },
          headStyles: {
            fillColor: [190, 190, 190] as [number, number, number],
            textColor: [40, 40, 40] as [number, number, number],
            fontSize: 6.5,
            minCellHeight: rowH,
            overflow: 'linebreak',
            halign: 'center',
            valign: 'middle',
            fontStyle: 'bold',
          },
          // Client column narrower so product columns have room for numbers
          columnStyles: { 0: { cellWidth: 28, halign: 'left' as const } },
          didParseCell: (data: any) => {
            if (data.section !== 'body') return
            const row = data.row.index
            const t = tables[i]
            if (row === t.topSubtotalIdx || row === t.botTotalIdx) {
              data.cell.styles.fontStyle = 'bold'
              data.cell.styles.fillColor = [240, 240, 240]
            }
          },
        })

        // Always draw notes section at a fixed position anchored to the quadrant bottom
        const noteLines = t.truckNote ? t.truckNote.split('\n').filter((l: string) => l.trim()) : []
        const totalContentLines = noteLines.length + t.empakaLabels.length
        const reservedLines = Math.max(2, totalContentLines === 0 ? 1 : totalContentLines)
        let y = qy + qh - empLineH * (1 + reservedLines)
        doc.setFontSize(6)
        doc.setFont('helvetica', 'bold')
        doc.text('Notes', qx, y)
        y += empLineH
        if (totalContentLines === 0) {
          doc.setFont('helvetica', 'normal')
          doc.text('—', qx, y)
        } else {
          for (const line of noteLines) {
            doc.setFont('helvetica', 'normal')
            doc.text(line, qx, y)
            y += empLineH
          }
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
  }, [activeTrucks, deliveriesByTruck, dropsByTruck, itemsByDelivery, orderById, customerById, orderItemsByOrderId, products, date, dateLabel, truckNotes])

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
              note={truckNotes[truck.id]}
              expanded={expandedTrucks.has(truck.id)}
              onToggle={() => toggle(truck.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
