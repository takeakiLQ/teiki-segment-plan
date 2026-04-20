import type {
  CategoryConfig,
  CategoryMap,
  CategoryMonthlyCell,
  MonthlyRow,
  Plan,
  Ratios,
  WorkerCategory,
} from '../types'
import { WorkerCategoryOrder } from '../types'
import { addMonths, monthsRange, ymLte } from './month'

/** ym 時点で有効な Plan-level の単価（円/日）を返す（'revenue' 対象の条件変更を反映） */
export function effectiveRevenuePerCaseAt(plan: Plan, ym: string): number {
  let r = plan.revenuePerCase ?? 0
  const changes = plan.conditionChanges
    .filter((c) => c.category === 'revenue' && c.newRevenuePerCase != null && ymLte(c.effectiveMonth, ym))
    .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth))
  for (const c of changes) {
    r = c.newRevenuePerCase!
  }
  return r
}

/** ym 時点で有効なカテゴリの原価設定を返す（そのカテゴリ対象の条件変更を反映） */
export function effectiveConfigAt(plan: Plan, cat: WorkerCategory, ym: string): CategoryConfig {
  const cfg: CategoryConfig = { ...plan.categories[cat] }
  const changes = plan.conditionChanges
    .filter((c) => c.category === cat && ymLte(c.effectiveMonth, ym))
    .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth))
  for (const c of changes) {
    if (c.newCostModel != null) cfg.costModel = c.newCostModel
    if (c.newCostRate != null) cfg.costRate = c.newCostRate
    if (c.newCostAmount != null) cfg.costAmount = c.newCostAmount
  }
  return cfg
}

/** 整数配分（最大剰余法 / Hamilton method）
 *  total 件をカテゴリ比率 ratio に従って「合計が必ず total になる整数」で配分する。
 *  比率の合計が 0 の場合は全て 0。
 *  端数は小数部の大きいカテゴリから優先的に +1。
 */
export function distributeIntegers(total: number, ratio: Ratios): CategoryMap<number> {
  const order = WorkerCategoryOrder
  const result: CategoryMap<number> = { partner: 0, vendor: 0, employment: 0 }
  const sumRatio = order.reduce((s, c) => s + Math.max(0, ratio[c] ?? 0), 0)
  const t = Math.max(0, Math.round(total))
  if (sumRatio <= 0 || t === 0) return result

  const exact: CategoryMap<number> = { partner: 0, vendor: 0, employment: 0 }
  let floorSum = 0
  for (const c of order) {
    const r = Math.max(0, ratio[c] ?? 0)
    exact[c] = (t * r) / sumRatio
    result[c] = Math.floor(exact[c])
    floorSum += result[c]
  }
  let remainder = t - floorSum
  if (remainder > 0) {
    const fractions = order
      .map((c) => ({ c, frac: exact[c] - Math.floor(exact[c]) }))
      // 端数が同値のときは比率の大きい方、さらに同値ならカテゴリ定義順
      .sort((a, b) => {
        if (b.frac !== a.frac) return b.frac - a.frac
        const ra = Math.max(0, ratio[a.c] ?? 0)
        const rb = Math.max(0, ratio[b.c] ?? 0)
        return rb - ra
      })
    for (let i = 0; i < fractions.length && remainder > 0; i++) {
      result[fractions[i].c] += 1
      remainder -= 1
    }
  }
  return result
}

/** 指定月の売上予算を返す（月別上書き → 年間÷期間で均等按分） */
export function budgetRevenueOf(plan: Plan, ym: string): number {
  const ovr = plan.budget?.revenueByMonth?.[ym]
  if (typeof ovr === 'number' && ovr > 0) return ovr
  const annual = plan.budget?.revenue ?? 0
  const months = plan.horizonMonths || 12
  return months > 0 ? annual / months : 0
}

/** 指定月の粗利予算を返す */
export function budgetProfitOf(plan: Plan, ym: string): number {
  const ovr = plan.budget?.grossProfitByMonth?.[ym]
  if (typeof ovr === 'number' && ovr > 0) return ovr
  const annual = plan.budget?.grossProfit ?? 0
  const months = plan.horizonMonths || 12
  return months > 0 ? annual / months : 0
}

/** 指定月の計算日数を返す（月別上書き → デフォルト → 20） */
export function workingDaysOf(plan: Plan, ym: string): number {
  const v = plan.workingDaysByMonth?.[ym]
  if (typeof v === 'number' && v > 0) return v
  if (typeof plan.defaultWorkingDays === 'number' && plan.defaultWorkingDays > 0) return plan.defaultWorkingDays
  return 20
}

/** 指定月に有効な 同区分uplift（partner/vendor）を返す */
export function effectiveDiagonalUpliftAt(
  plan: Plan,
  ym: string,
  cat: 'partner' | 'vendor',
): number {
  const ovr = plan.diagonalUpliftByMonth?.find((r) => r.month === ym)
  const v = ovr?.[cat]
  if (typeof v === 'number' && v >= 0) return v
  return plan.diagonalUplift?.[cat] ?? 0
}

/** 指定月に有効な配車比率を返す（月別オーバーライドがあればそれ、無ければデフォルト） */
export function effectiveRatio(
  plan: Plan,
  ym: string,
  kind: 'acquisition' | 'termination',
): Ratios {
  const ovr = plan.monthlyRatios?.find((r) => r.month === ym)
  const overrideR = kind === 'acquisition' ? ovr?.acquisition : ovr?.termination
  if (overrideR && ratioSum(overrideR) > 0) return overrideR
  return kind === 'acquisition' ? plan.acquisitionRatio : plan.terminationRatio
}

/** 前年の対応月を返す（単純に -12ヶ月） */
export function priorYm(ym: string): string {
  return addMonths(ym, -12)
}

/** 月次計算
 *  各月の処理順:
 *    (1) 前月件数を継承
 *    (2) その月の 獲得総数 / 終了総数 を「その月の配車比率」で按分（整数）して加減算
 *    (3) その月の 入替（from -count / to +count） を反映
 *    (4) マイナスは 0 にクランプ
 *    (5) カテゴリごとに、その月に有効な単価・原価で売上・原価・粗利を算出
 */
export function computeMonthly(plan: Plan): MonthlyRow[] {
  const months = monthsRange(plan.baseMonth, plan.horizonMonths)
  const rows: MonthlyRow[] = []

  let prevCounts: CategoryMap<number> = { ...plan.initialCounts }
  // 同区分入替の累計件数（partner/vendor）
  const cumDiag: { partner: number; vendor: number } = { partner: 0, vendor: 0 }

  for (const ym of months) {
    const counts: CategoryMap<number> = { ...prevCounts }

    // (2) 月次フロー：総数 × 月別比率 → 整数配分
    const mt = plan.monthlyTotals.find((m) => m.month === ym)
    const acqTotal = Math.max(0, Math.round(mt?.acquisitionTotal ?? 0))
    const termTotal = Math.max(0, Math.round(mt?.terminationTotal ?? 0))
    const acqR = effectiveRatio(plan, ym, 'acquisition')
    const termR = effectiveRatio(plan, ym, 'termination')
    const acqDist = distributeIntegers(acqTotal, acqR)
    const termDist = distributeIntegers(termTotal, termR)
    for (const c of WorkerCategoryOrder) {
      counts[c] += acqDist[c]
      counts[c] -= termDist[c]
    }

    // (3) 入替（対角は件数に影響なし、non-diagonal のみ counts を移動）
    let transfersTotal = 0
    for (const t of plan.transfers) {
      if (t.month !== ym) continue
      if (t.from !== t.to) {
        counts[t.from] -= t.count
        counts[t.to] += t.count
      }
      transfersTotal += t.count
    }

    // (3.5) 同区分入替の累計を更新（partner/vendor のみ）
    cumDiag.partner += diagonalCount(plan.transfers, ym, 'partner')
    cumDiag.vendor += diagonalCount(plan.transfers, ym, 'vendor')

    // (4) クランプ
    for (const c of WorkerCategoryOrder) {
      counts[c] = Math.max(0, Math.round(counts[c]))
    }

    // (5) 金額計算（日単価 × 計算日数）
    //  A案：売上単価は Plan レベル（全カテゴリ共通）。原価のみカテゴリごとに算出。
    //  + 同区分入替の累計件数 × uplift × 営業日数 を該当カテゴリの原価に加算
    const days = workingDaysOf(plan, ym)
    const revPerCase = effectiveRevenuePerCaseAt(plan, ym)
    const upliftPartner = effectiveDiagonalUpliftAt(plan, ym, 'partner')
    const upliftVendor = effectiveDiagonalUpliftAt(plan, ym, 'vendor')
    const diagCostPartner = Math.round(cumDiag.partner * upliftPartner * days)
    const diagCostVendor = Math.round(cumDiag.vendor * upliftVendor * days)

    const byCategory = {} as CategoryMap<CategoryMonthlyCell>
    let totalCount = 0
    let totalRevenue = 0
    let totalCost = 0
    for (const cat of WorkerCategoryOrder) {
      const cfg = effectiveConfigAt(plan, cat, ym)
      const count = counts[cat]
      const revenue = Math.round(count * revPerCase * days)
      let cost =
        cfg.costModel === 'rate'
          ? Math.round((revenue * cfg.costRate) / 100)
          : Math.round(count * cfg.costAmount * days)
      // 同区分入替 uplift を原価に加算
      if (cat === 'partner') cost += diagCostPartner
      else if (cat === 'vendor') cost += diagCostVendor
      const profit = revenue - cost
      byCategory[cat] = {
        count,
        newCases: acqDist[cat],
        endingCases: termDist[cat],
        revenue,
        cost,
        profit,
        effectiveRevenuePerCase: revPerCase,
        costModel: cfg.costModel,
        effectiveCostRate: cfg.costModel === 'rate' ? cfg.costRate : undefined,
        effectiveCostAmount: cfg.costModel === 'amount' ? cfg.costAmount : undefined,
      }
      totalCount += count
      totalRevenue += revenue
      totalCost += cost
    }

    const totalProfit = totalRevenue - totalCost
    const margin = totalRevenue > 0 ? totalProfit / totalRevenue : 0

    rows.push({
      month: ym,
      byCategory,
      totalCount,
      totalRevenue,
      totalCost,
      totalProfit,
      margin,
      newTotal: acqTotal,
      endTotal: termTotal,
      transfersTotal,
    })

    prevCounts = counts
  }

  return rows
}

export function yen(n: number): string {
  if (!Number.isFinite(n)) return '-'
  return Math.round(n).toLocaleString('ja-JP')
}
export function percent(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '-'
  return `${(n * 100).toFixed(digits)}%`
}

export function ratioSum(r: Ratios): number {
  return WorkerCategoryOrder.reduce((s, c) => s + (Number(r[c]) || 0), 0)
}

/* ====================================================
   入替マトリクス ヘルパー（TransferEvent[] を 3×3 マトリクスとして操作）
   ==================================================== */

import type { TransferEvent } from '../types'

/** 指定月 × from → to の件数を返す（無ければ 0） */
export function getTransferAmount(
  transfers: TransferEvent[],
  month: string,
  from: WorkerCategory,
  to: WorkerCategory,
): number {
  const t = transfers.find((x) => x.month === month && x.from === from && x.to === to)
  return t?.count ?? 0
}

/** (month, from, to) セルに件数を書き込む。0 にすると自動削除。対角も許容。 */
export function upsertTransferCell(
  transfers: TransferEvent[],
  month: string,
  from: WorkerCategory,
  to: WorkerCategory,
  count: number,
  makeId: () => string,
): TransferEvent[] {
  const c = Math.max(0, Math.round(count))
  const idx = transfers.findIndex((x) => x.month === month && x.from === from && x.to === to)
  if (c === 0) {
    if (idx >= 0) return transfers.filter((_, i) => i !== idx)
    return transfers
  }
  if (idx >= 0) {
    return transfers.map((x, i) => (i === idx ? { ...x, count: c } : x))
  }
  return [...transfers, { id: makeId(), month, from, to, count: c }]
}

/** from 区分の指定月の総転出件数（対角は除外：カテゴリ移動のみ） */
export function totalOutflow(transfers: TransferEvent[], month: string, from: WorkerCategory): number {
  return transfers.reduce(
    (s, t) => (t.month === month && t.from === from && t.to !== from ? s + t.count : s),
    0,
  )
}
/** to 区分の指定月の総転入件数（対角は除外） */
export function totalInflow(transfers: TransferEvent[], month: string, to: WorkerCategory): number {
  return transfers.reduce(
    (s, t) => (t.month === month && t.to === to && t.from !== to ? s + t.count : s),
    0,
  )
}

/** 同区分入替（対角）の当月件数 */
export function diagonalCount(transfers: TransferEvent[], month: string, cat: WorkerCategory): number {
  return transfers.reduce(
    (s, t) => (t.month === month && t.from === cat && t.to === cat ? s + t.count : s),
    0,
  )
}

/** 同区分入替の累計件数（指定月末時点） */
export function cumulativeDiagonalCount(
  transfers: TransferEvent[],
  upToMonth: string,
  cat: WorkerCategory,
): number {
  return transfers.reduce(
    (s, t) =>
      (ymLte(t.month, upToMonth) && t.from === cat && t.to === cat ? s + t.count : s),
    0,
  )
}

/** 非対角ペア（from != to）- 6ペア */
export const OFF_DIAGONAL_PAIRS: { from: WorkerCategory; to: WorkerCategory }[] = (() => {
  const arr: { from: WorkerCategory; to: WorkerCategory }[] = []
  for (const f of WorkerCategoryOrder) {
    for (const t of WorkerCategoryOrder) {
      if (f !== t) arr.push({ from: f, to: t })
    }
  }
  return arr
})()

/** 9ペア（対角含む）- UI用 */
export const ALL_TRANSFER_PAIRS: { from: WorkerCategory; to: WorkerCategory }[] = (() => {
  const arr: { from: WorkerCategory; to: WorkerCategory }[] = []
  for (const f of WorkerCategoryOrder) {
    for (const t of WorkerCategoryOrder) {
      arr.push({ from: f, to: t })
    }
  }
  return arr
})()
