import { useQuery } from '@tanstack/react-query'

export type QoplaReportType = 'X' | 'Z'

export interface QoplaCategorySale {
  categoryName: string
  totalSales: number
}

export interface QoplaPaymentAmount {
  paymentMethod: string
  amount: number
  tip: number
}

export interface QoplaVatAmount {
  vatRate: number
  amount: number
  refundedAmount: number
}

export interface QoplaReceiptCount {
  receiptType: string
  count: number
  amount: number
}

export interface QoplaReport {
  id: string
  reportNumber: number
  reportType: QoplaReportType
  createdAt: string
  startDate: string
  endDate: string
  shopId: string
  shopName: string
  posName: string
  totalSales: number
  totalNetSales: number
  grandTotalSales: number
  grandTotalNet: number
  sumSoldProducts: number
  sumReceipts: number
  tip: number
  categoryTotalSales: QoplaCategorySale[]
  paymentMethodAndAmounts: QoplaPaymentAmount[]
  vatRatesAndNetAmounts: QoplaVatAmount[]
  vatRateAmountWithRefunds: QoplaVatAmount[]
  refunds: QoplaReceiptCount | null
  discounts: QoplaReceiptCount | null
}

export interface QoplaShopReports {
  shopId: string
  shopName: string
  totalCount: number
  items: QoplaReport[]
}

interface FetchOptions {
  reportType: QoplaReportType
  pageNumber?: number
  pageItems?: number
  shopId?: string
}

async function fetchReports(opts: FetchOptions): Promise<QoplaShopReports[]> {
  const params = new URLSearchParams({
    action: 'reports',
    reportType: opts.reportType,
    page: String(opts.pageNumber ?? 1),
    items: String(opts.pageItems ?? 10),
  })
  if (opts.shopId) params.set('shopId', opts.shopId)

  const res = await fetch(`/api/qopla?${params.toString()}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Qopla rapport-API fel')
  return json.reports
}

export function useQoplaReports(opts: FetchOptions) {
  return useQuery({
    queryKey: ['qopla-reports', opts.reportType, opts.pageNumber ?? 1, opts.pageItems ?? 10, opts.shopId ?? 'all'],
    queryFn: () => fetchReports(opts),
    staleTime: opts.reportType === 'Z' ? 10 * 60 * 1000 : 2 * 60 * 1000,
    refetchInterval: opts.reportType === 'X' ? 2 * 60 * 1000 : false,
  })
}

export function aggregateCategorySales(shops: QoplaShopReports[]): QoplaCategorySale[] {
  const totals = new Map<string, number>()
  for (const shop of shops) {
    const latest = shop.items[0]
    if (!latest) continue
    for (const cat of latest.categoryTotalSales) {
      totals.set(cat.categoryName, (totals.get(cat.categoryName) ?? 0) + cat.totalSales)
    }
  }
  return [...totals.entries()]
    .map(([categoryName, totalSales]) => ({ categoryName, totalSales }))
    .sort((a, b) => b.totalSales - a.totalSales)
}
