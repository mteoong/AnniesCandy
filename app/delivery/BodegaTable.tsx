'use client'

import { cn } from '@/lib/utils'
import { CONDITIONAL_SHOW_PRODUCT_IDS, getProductAbbr } from '@/lib/delivery-types'
import type { DeliveryProduct, BodegaRow } from '@/lib/delivery-types'

type Props = {
  products: DeliveryProduct[]
  bodegas: BodegaRow[]
  editable: boolean
  onCellChange: (orderId: number, productId: string, raw: string) => void
}

export function BodegaTable({ products, bodegas, editable, onCellChange }: Props) {
  const visibleProducts = products.filter(p => {
    if (!CONDITIONAL_SHOW_PRODUCT_IDS.has(p.id)) return true
    return bodegas.some(row => (row.items[p.id]?.cases ?? 0) > 0)
  })

  const totals: Record<string, number> = {}
  for (const row of bodegas) {
    for (const p of visibleProducts) {
      totals[p.id] = (totals[p.id] ?? 0) + (row.items[p.id]?.cases ?? 0)
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm [&_td]:align-middle [&_th]:align-middle border-collapse">
        <thead>
          <tr className="bg-stone-50 border-b border-stone-200">
            <th className="text-left px-4 py-2 font-medium text-stone-500 whitespace-nowrap">Customer</th>
            {visibleProducts.map(p => (
              <th key={p.id} className="px-3 py-2 font-medium text-stone-500 text-right whitespace-nowrap">
                {getProductAbbr(p)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodegas.map(row => (
            <tr key={row.orderId} className="hover:bg-stone-50 border-b border-stone-100">
              <td className="px-4 py-2 text-stone-700 whitespace-nowrap">{row.customerName}</td>
              {visibleProducts.map(p => {
                const cases = row.items[p.id]?.cases ?? 0
                return (
                  <td key={p.id} className="px-3 py-2 text-right text-stone-700">
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        value={cases === 0 ? '' : cases}
                        placeholder="—"
                        onChange={e => onCellChange(row.orderId, p.id, e.target.value || '0')}
                        onFocus={e => e.target.select()}
                        className={cn(
                          'w-14 text-right bg-transparent border border-transparent rounded',
                          'focus:outline-none focus:border-stone-300 focus:bg-white focus:px-1',
                          '[appearance:textfield] text-sm',
                          cases > 0 ? 'text-stone-700' : 'text-stone-300 placeholder:text-stone-200',
                        )}
                      />
                    ) : cases > 0 ? cases : (
                      <span className="text-stone-200">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-stone-100">
            <td className="px-4 py-2 font-semibold text-stone-700">Total</td>
            {visibleProducts.map(p => (
              <td key={p.id} className="px-3 py-2 text-right font-semibold text-stone-800">
                {(totals[p.id] ?? 0) > 0 ? totals[p.id] : <span className="text-stone-300 font-normal">—</span>}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
