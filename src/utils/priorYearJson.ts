/**
 * 前年実績データの JSON 入出力
 *
 * 公開スキーマ（ユーザーが手で書きやすい形）:
 *
 * {
 *   "fiscalYear": "FY2025",
 *   "baseMonth": "2025-04",
 *   "horizonMonths": 12,
 *   "defaultWorkingDays": 20,
 *   "workingDays": { "2025-04": 21, "2025-05": 20, ... },
 *   "initialCounts": { "partner": 2200, "vendor": 1500, "employment": 800 },
 *   "acquisitionRatio": { "partner": 50, "vendor": 35, "employment": 15 },
 *   "terminationRatio": { "partner": 50, "vendor": 35, "employment": 15 },
 *
 *   // 月次データ：dict（推奨）か array の片方で
 *   "months": {
 *     "2025-04": { "revenue": 1315411885, "grossProfit": 300000000, "acquisition": 150, "termination": 130, "memo": "期初" },
 *     "2025-05": { "revenue": 1257008755 }
 *   },
 *   // または
 *   "monthlyData": [
 *     { "month": "2025-04", "revenue": 1315411885, "grossProfit": 300000000 }
 *   ],
 *
 *   // 入替：list か matrix の片方 or 両方（マージされる）
 *   "transfers": [
 *     { "month": "2025-04", "from": "partner", "to": "vendor", "count": 10, "memo": "社員化" }
 *   ],
 *   "transferMatrix": {
 *     "2025-04": {
 *       "partner":    { "vendor": 10, "employment": 5 },
 *       "vendor":     { "partner": 3, "employment": 8 },
 *       "employment": { "partner": 1, "vendor": 2 }
 *     }
 *   }
 * }
 */

import type {
  DiagonalUplift,
  MonthlyDiagonalUpliftOverride,
  PriorYearMonthly,
  PriorYearPlan,
  Ratios,
  TransferEvent,
  WorkerCategory,
} from '../types'
import { addMonths } from './month'

const CATS: WorkerCategory[] = ['partner', 'vendor', 'employment']
const isCat = (v: any): v is WorkerCategory => CATS.includes(v)

function numOr(v: any, fallback: number): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function isObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

/**
 * 現在の PriorYearPlan を「読みやすいJSON」として書き出す
 */
export function serializePriorYearJson(py: PriorYearPlan): any {
  const months: Record<string, any> = {}
  for (const d of py.monthlyData) {
    const entry: any = {}
    if (d.acquisition) entry.acquisition = d.acquisition
    if (d.termination) entry.termination = d.termination
    if (d.acquisitionByCategory) {
      const a = d.acquisitionByCategory
      if (a.partner || a.vendor || a.employment) {
        entry.acquisitionByCategory = { partner: a.partner ?? 0, vendor: a.vendor ?? 0, employment: a.employment ?? 0 }
      }
    }
    if (d.terminationByCategory) {
      const t = d.terminationByCategory
      if (t.partner || t.vendor || t.employment) {
        entry.terminationByCategory = { partner: t.partner ?? 0, vendor: t.vendor ?? 0, employment: t.employment ?? 0 }
      }
    }
    if (d.revenue !== undefined && d.revenue !== 0) entry.revenue = d.revenue
    if (d.grossProfit !== undefined && d.grossProfit !== 0) entry.grossProfit = d.grossProfit
    if (d.meisterRevenue !== undefined && d.meisterRevenue !== 0) entry.meisterRevenue = d.meisterRevenue
    if (d.memo) entry.memo = d.memo
    if (Object.keys(entry).length > 0) months[d.month] = entry
  }

  const transfers = py.transfers.map((t) => {
    const o: any = { month: t.month, from: t.from, to: t.to, count: t.count }
    if (t.memo) o.memo = t.memo
    return o
  })

  const workingDays: Record<string, number> = {}
  for (const [k, v] of Object.entries(py.workingDaysByMonth || {})) {
    if (typeof v === 'number' && v > 0) workingDays[k] = v
  }

  // 同区分入替 uplift
  const diagonalUplift = {
    partner: py.diagonalUplift?.partner ?? 0,
    vendor: py.diagonalUplift?.vendor ?? 0,
  }
  const diagonalUpliftByMonth: Record<string, any> = {}
  for (const o of py.diagonalUpliftByMonth ?? []) {
    const entry: any = {}
    if (typeof o.partner === 'number' && o.partner >= 0) entry.partner = o.partner
    if (typeof o.vendor === 'number' && o.vendor >= 0) entry.vendor = o.vendor
    if (Object.keys(entry).length > 0) diagonalUpliftByMonth[o.month] = entry
  }

  return {
    fiscalYear: py.fiscalYear,
    baseMonth: py.baseMonth,
    horizonMonths: py.horizonMonths,
    defaultWorkingDays: py.defaultWorkingDays,
    workingDays,
    initialCounts: py.initialCounts,
    acquisitionRatio: py.acquisitionRatio,
    terminationRatio: py.terminationRatio,
    diagonalUplift,
    diagonalUpliftByMonth,
    months,
    transfers,
  }
}

/**
 * ユーザーが書いた JSON（一部省略可）を PriorYearPlan に寛容に変換する
 *  - existing を渡すと「マージ」: JSON に無い項目は既存値を保持
 *  - existing 未指定時はデフォルト値で埋める
 */
export function parsePriorYearJson(
  input: any,
  currentBaseMonth: string,
  existing?: PriorYearPlan,
): PriorYearPlan {
  if (!isObject(input)) {
    throw new Error('JSON はオブジェクト形式で書いてください（{ ... }）')
  }

  // ベース（既存 or デフォルト）
  const base: PriorYearPlan = existing ?? {
    fiscalYear: 'FY前年',
    baseMonth: addMonths(currentBaseMonth, -12),
    horizonMonths: 12,
    initialCounts: { partner: 0, vendor: 0, employment: 0 },
    acquisitionRatio: { partner: 50, vendor: 35, employment: 15 },
    terminationRatio: { partner: 50, vendor: 35, employment: 15 },
    monthlyData: [],
    transfers: [],
    workingDaysByMonth: {},
    defaultWorkingDays: 20,
    diagonalUplift: { partner: 0, vendor: 0 },
    diagonalUpliftByMonth: [],
  }

  // スカラー項目：あれば上書き
  const fiscalYear = typeof input.fiscalYear === 'string' && input.fiscalYear.length > 0
    ? input.fiscalYear
    : base.fiscalYear
  const baseMonth = typeof input.baseMonth === 'string' && /^\d{4}-\d{2}$/.test(input.baseMonth)
    ? input.baseMonth
    : base.baseMonth
  const horizonMonths = input.horizonMonths != null
    ? Math.max(1, Math.min(36, Math.round(numOr(input.horizonMonths, base.horizonMonths))))
    : base.horizonMonths
  const defaultWorkingDays = input.defaultWorkingDays != null
    ? Math.max(0.01, Math.round(numOr(input.defaultWorkingDays, base.defaultWorkingDays) * 100) / 100)
    : base.defaultWorkingDays

  // workingDaysByMonth：マージ（既存を保持しつつ、入力分で上書き）
  const workingDaysByMonth: Record<string, number> = { ...base.workingDaysByMonth }
  if (isObject(input.workingDays)) {
    for (const [k, v] of Object.entries(input.workingDays)) {
      const n = numOr(v, 0)
      if (n > 0) workingDaysByMonth[k] = Math.round(n * 100) / 100
    }
  }

  // initialCounts：オブジェクトごと上書き（省略時は既存）
  const initialCounts = isObject(input.initialCounts) ? {
    partner: Math.max(0, Math.round(numOr(input.initialCounts.partner, base.initialCounts.partner))),
    vendor: Math.max(0, Math.round(numOr(input.initialCounts.vendor, base.initialCounts.vendor))),
    employment: Math.max(0, Math.round(numOr(input.initialCounts.employment, base.initialCounts.employment))),
  } : base.initialCounts

  const acquisitionRatio: Ratios = isObject(input.acquisitionRatio) ? {
    partner: numOr(input.acquisitionRatio.partner, base.acquisitionRatio.partner),
    vendor: numOr(input.acquisitionRatio.vendor, base.acquisitionRatio.vendor),
    employment: numOr(input.acquisitionRatio.employment, base.acquisitionRatio.employment),
  } : base.acquisitionRatio
  const terminationRatio: Ratios = isObject(input.terminationRatio) ? {
    partner: numOr(input.terminationRatio.partner, base.terminationRatio.partner),
    vendor: numOr(input.terminationRatio.vendor, base.terminationRatio.vendor),
    employment: numOr(input.terminationRatio.employment, base.terminationRatio.employment),
  } : base.terminationRatio

  // ----- 月次データ：月ごとにマージ -----
  const monthByYm = new Map<string, PriorYearMonthly>()
  for (const d of base.monthlyData) monthByYm.set(d.month, { ...d })
  const pushMonth = (month: string, v: any) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return
    const cur = monthByYm.get(month) ?? { month, acquisition: 0, termination: 0 }
    if (v.acquisition != null) cur.acquisition = Math.max(0, Math.round(numOr(v.acquisition, 0)))
    if (v.termination != null) cur.termination = Math.max(0, Math.round(numOr(v.termination, 0)))
    // カテゴリ別の獲得
    if (isObject(v.acquisitionByCategory)) {
      const a = v.acquisitionByCategory
      cur.acquisitionByCategory = {
        partner: Math.max(0, Math.round(numOr(a.partner, cur.acquisitionByCategory?.partner ?? 0))),
        vendor: Math.max(0, Math.round(numOr(a.vendor, cur.acquisitionByCategory?.vendor ?? 0))),
        employment: Math.max(0, Math.round(numOr(a.employment, cur.acquisitionByCategory?.employment ?? 0))),
      }
      // 合計が未指定または 0 なら自動計算
      const catSum = cur.acquisitionByCategory.partner + cur.acquisitionByCategory.vendor + cur.acquisitionByCategory.employment
      if (v.acquisition == null && catSum > 0) cur.acquisition = catSum
    }
    if (isObject(v.terminationByCategory)) {
      const t = v.terminationByCategory
      cur.terminationByCategory = {
        partner: Math.max(0, Math.round(numOr(t.partner, cur.terminationByCategory?.partner ?? 0))),
        vendor: Math.max(0, Math.round(numOr(t.vendor, cur.terminationByCategory?.vendor ?? 0))),
        employment: Math.max(0, Math.round(numOr(t.employment, cur.terminationByCategory?.employment ?? 0))),
      }
      const catSum = cur.terminationByCategory.partner + cur.terminationByCategory.vendor + cur.terminationByCategory.employment
      if (v.termination == null && catSum > 0) cur.termination = catSum
    }
    if (v.revenue != null) cur.revenue = Math.max(0, Math.round(numOr(v.revenue, 0)))
    if (v.grossProfit != null) cur.grossProfit = Math.round(numOr(v.grossProfit, 0))
    if (v.meisterRevenue != null) cur.meisterRevenue = Math.max(0, Math.round(numOr(v.meisterRevenue, 0)))
    if (typeof v.memo === 'string' && v.memo) cur.memo = v.memo
    monthByYm.set(month, cur)
  }
  if (isObject(input.months)) {
    for (const [m, v] of Object.entries(input.months)) {
      if (isObject(v)) pushMonth(m, v)
    }
  }
  if (Array.isArray(input.monthlyData)) {
    for (const row of input.monthlyData) {
      if (isObject(row) && typeof row.month === 'string') pushMonth(row.month, row)
    }
  }
  const monthlyData: PriorYearMonthly[] = [...monthByYm.values()].filter((d) => !(
    d.acquisition === 0 && d.termination === 0 &&
    !d.acquisitionByCategory && !d.terminationByCategory &&
    (d.revenue ?? 0) === 0 && (d.grossProfit ?? 0) === 0 &&
    (d.meisterRevenue ?? 0) === 0 &&
    !d.memo
  ))

  // ----- 入替：既存＋入力をマージ（同じキーは入力優先） -----
  //  対角（同区分入替）も受け入れる
  const transferMap = new Map<string, TransferEvent>()
  for (const t of base.transfers) transferMap.set(`${t.month}|${t.from}|${t.to}`, { ...t })
  const addTransfer = (month: string, from: WorkerCategory, to: WorkerCategory, count: number, memo?: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return
    const c = Math.max(0, Math.round(count))
    const key = `${month}|${from}|${to}`
    if (c <= 0) {
      transferMap.delete(key)
      return
    }
    const existing = transferMap.get(key)
    if (existing) {
      existing.count = c
      if (memo) existing.memo = memo
    } else {
      transferMap.set(key, {
        id: makeId(),
        month, from, to, count: c,
        ...(memo ? { memo } : {}),
      })
    }
  }
  if (Array.isArray(input.transfers)) {
    for (const t of input.transfers) {
      if (!isObject(t)) continue
      if (!isCat(t.from) || !isCat(t.to)) continue
      addTransfer(String(t.month ?? ''), t.from, t.to, numOr(t.count, 0), typeof t.memo === 'string' ? t.memo : undefined)
    }
  }
  if (isObject(input.transferMatrix)) {
    for (const [month, mat] of Object.entries(input.transferMatrix)) {
      if (!isObject(mat)) continue
      for (const from of CATS) {
        const row = (mat as any)[from]
        if (!isObject(row)) continue
        for (const to of CATS) {
          // 対角も許容（同区分入替）
          const v = (row as any)[to]
          if (v == null) continue
          addTransfer(month, from, to, numOr(v, 0))
        }
      }
    }
  }
  const transfers: TransferEvent[] = [...transferMap.values()]

  // ----- 同区分 uplift（デフォルト + 月別） -----
  const diagonalUplift: DiagonalUplift = {
    partner: isObject(input.diagonalUplift) ? Math.max(0, Math.round(numOr(input.diagonalUplift.partner, base.diagonalUplift.partner))) : base.diagonalUplift.partner,
    vendor: isObject(input.diagonalUplift) ? Math.max(0, Math.round(numOr(input.diagonalUplift.vendor, base.diagonalUplift.vendor))) : base.diagonalUplift.vendor,
  }

  const upliftMap = new Map<string, MonthlyDiagonalUpliftOverride>()
  for (const o of base.diagonalUpliftByMonth) upliftMap.set(o.month, { ...o })
  if (isObject(input.diagonalUpliftByMonth)) {
    for (const [month, v] of Object.entries(input.diagonalUpliftByMonth)) {
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      if (!isObject(v)) continue
      const cur = upliftMap.get(month) ?? { month }
      if ((v as any).partner != null) {
        const n = numOr((v as any).partner, -1)
        if (n >= 0) cur.partner = Math.round(n)
      }
      if ((v as any).vendor != null) {
        const n = numOr((v as any).vendor, -1)
        if (n >= 0) cur.vendor = Math.round(n)
      }
      upliftMap.set(month, cur)
    }
  }
  const diagonalUpliftByMonth: MonthlyDiagonalUpliftOverride[] = [...upliftMap.values()]
    .filter((o) => o.partner !== undefined || o.vendor !== undefined)

  return {
    fiscalYear,
    baseMonth,
    horizonMonths,
    initialCounts,
    acquisitionRatio,
    terminationRatio,
    monthlyData,
    transfers,
    workingDaysByMonth,
    defaultWorkingDays,
    diagonalUplift,
    diagonalUpliftByMonth,
  }
}

/**
 * 空欄テンプレート（FY2025 をイメージ）を生成
 */
export function samplePriorYearJson(currentBaseMonth: string): any {
  const base = addMonths(currentBaseMonth, -12)
  const months: Record<string, any> = {}
  for (let i = 0; i < 12; i++) {
    months[addMonths(base, i)] = {
      revenue: 0,
      grossProfit: 0,
      acquisition: 0,
      termination: 0,
    }
  }
  return {
    fiscalYear: 'FY2025',
    baseMonth: base,
    horizonMonths: 12,
    defaultWorkingDays: 20,
    workingDays: {
      [addMonths(base, 0)]: 21,
      [addMonths(base, 1)]: 20,
    },
    initialCounts: { partner: 2200, vendor: 1500, employment: 800 },
    acquisitionRatio: { partner: 50, vendor: 35, employment: 15 },
    terminationRatio: { partner: 50, vendor: 35, employment: 15 },
    months,
    transfers: [
      { month: base, from: 'partner', to: 'vendor', count: 0, memo: '例：外注化' },
      { month: base, from: 'partner', to: 'employment', count: 0, memo: '例：社員化' },
    ],
    transferMatrix: {
      [addMonths(base, 0)]: {
        partner:    { partner: 0, vendor: 0, employment: 0 },
        vendor:     { partner: 0, vendor: 0, employment: 0 },
        employment: { partner: 0, vendor: 0, employment: 0 },
      },
    },
    diagonalUplift: { partner: 0, vendor: 0 },
    diagonalUpliftByMonth: {
      [addMonths(base, 0)]: { partner: 0, vendor: 0 },
    },
  }
}
