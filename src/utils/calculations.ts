import type {
  CategoryConfig,
  CategoryMap,
  CategoryMonthlyCell,
  MonthlyRow,
  Plan,
  PriorYearCaseDetail,
  PriorYearPlan,
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
/** カテゴリの1件1日あたり原価（円）を返す。rate モードは revenuePerCase を使って算出、amount モードはそのまま。 */
export function costPerCasePerDay(
  plan: Plan,
  cat: WorkerCategory,
  ym: string,
): number {
  const cfg = effectiveConfigAt(plan, cat, ym)
  const revPerCase = effectiveRevenuePerCaseAt(plan, ym)
  if (cfg.costModel === 'rate') return revPerCase * cfg.costRate / 100
  return cfg.costAmount
}

/** 非対角入替（from ≠ to）1件1日あたりの粗利インパクト（円）= oldCost - newCost。
 *  正の値なら「低原価カテゴリへ移動 → 粗利改善」、負なら「高原価カテゴリへ移動 → 粗利悪化」。
 */
export function nonDiagonalProfitPerCasePerDay(
  plan: Plan,
  from: WorkerCategory,
  to: WorkerCategory,
  ym: string,
): number {
  if (from === to) return 0
  return costPerCasePerDay(plan, from, ym) - costPerCasePerDay(plan, to, ym)
}

/** 非対角入替の、指定ペアの「指定月以前の累計移動件数」。 */
export function cumulativeNonDiagonalCount(
  transfers: TransferEvent[],
  untilYm: string,
  from: WorkerCategory,
  to: WorkerCategory,
): number {
  if (from === to) return 0
  let s = 0
  for (const t of transfers) {
    if (t.from !== from || t.to !== to) continue
    if (ymLte(t.month, untilYm)) s += t.count
  }
  return s
}

/** 手数料率を差し引いた実効倍率を返す。入力 X 円/件/日 × factor = 実効原価増。
 *  例: 運送店=18%手数料 → factor = 0.82。業者=0%手数料 → factor = 1.0。
 */
export function costUpliftFactor(plan: Plan, cat: WorkerCategory): number {
  const pct = plan.costUpliftCommissionRate?.[cat] ?? 0
  if (!Number.isFinite(pct) || pct <= 0) return 1
  if (pct >= 100) return 0
  return (100 - pct) / 100
}

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
  // 終了案件の累計件数（終了コホート単価 補正用）
  let cumTerm = 0

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
    cumTerm += termTotal

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
    const upliftPartner = effectiveDiagonalUpliftAt(plan, ym, 'partner') * costUpliftFactor(plan, 'partner')
    const upliftVendor = effectiveDiagonalUpliftAt(plan, ym, 'vendor') * costUpliftFactor(plan, 'vendor')
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

    // (6) 単価アップの累計を全体の売上・原価に加算（別計算）
    const piCum = cumulativePriceIncreaseAt(plan, ym)
    totalRevenue += piCum.revenue
    totalCost += piCum.cost

    // (6.5) 部分 原価改定 / 単価改定（指定カテゴリの N件に対する加算）
    const costRev = costRevisionImpactAt(plan, ym)
    totalCost += costRev
    const priceRev = priceRevisionImpactAt(plan, ym)
    totalRevenue += priceRev.revenue
    totalCost += priceRev.costAdd

    // (7) コホートdelta（獲得分が継続単価と違う場合の差分）
    //  継続単価 × 件数 で計算されている base に対して、獲得分だけ単価・粗利が異なる分を +/- 調整
    const cohortD = cohortDeltaAt(plan, ym)
    totalRevenue += cohortD.deltaRevenue
    totalCost += cohortD.deltaCost

    // (7.5) 終了コホート単価 補正（終了案件の実勢単価がプール平均と異なる場合）
    //   現行モデル: 件数減少分を「プール単価 P で失った」と仮定
    //   実態: 終了案件の単価が p_t なら、失うのは (p_t × days) のみ
    //   補正 = (P − p_t) × 累計終了件数 × days
    //   原価は同じ実効原価率で比例補正（割り切りモデル）
    //   p_t は effectiveTerminationUnitPrice（前年ベース+調整 or 手動override）
    const termUnitPrice = effectiveTerminationUnitPrice(plan)
    let termRevAdj = 0
    let termCostAdj = 0
    if (termUnitPrice > 0 && termUnitPrice !== revPerCase && cumTerm > 0) {
      termRevAdj = Math.round((revPerCase - termUnitPrice) * cumTerm * days)
      // 実効原価率: 当月のベース原価 / ベース売上 で按分
      const baseRev = totalRevenue - termRevAdj - piCum.revenue - cohortD.deltaRevenue - priceRev.revenue
      const baseCost = totalCost - termCostAdj - piCum.cost - cohortD.deltaCost - costRev - priceRev.costAdd
      const effRate = baseRev > 0 ? baseCost / baseRev : 0
      termCostAdj = Math.round(termRevAdj * effRate)
      totalRevenue += termRevAdj
      totalCost += termCostAdj
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
   単価アップ（累積型・還元率付き）
   ==================================================== */

/** 当月時点の累計単価アップ（売上・原価・粗利）*/
export function cumulativePriceIncreaseAt(
  plan: Plan,
  ym: string,
): { revenue: number; cost: number; profit: number } {
  let revenue = 0
  let cost = 0
  for (const ev of plan.priceIncreases ?? []) {
    if (!ev || !ev.month) continue
    if (ymLte(ev.month, ym)) {
      revenue += ev.amount
      cost += Math.round((ev.amount * ev.returnRate) / 100)
    }
  }
  return { revenue, cost, profit: revenue - cost }
}

/* ====================================================
   コホート別 単価・粗利（FY2026）

   【ベースライン自動導出モデル】
   - 前年ベース単価は、案件明細 (priorYear.cases) があれば「計算日単価 = 予定売上/月 ÷ 月平均営業日数」の
     平均から自動導出する。case データがなければ手動フィールド（priorAcquisitionUnitPrice /
     priorTerminationUnitPrice / annualSummary.terminationUnitPrice / plan.revenuePerCase）にフォールバック。
   - FY2026 計画値 = 前年ベース + 調整（Abs + base×Pct/100）
   - 獲得: priorAcquisitionUnitPrice (override) + acquisitionUnitPriceUp{Abs,Pct}
   - 終了: priorTerminationUnitPrice (override) + terminationUnitPriceAdj{Abs,Pct}
     ※ 追加で `terminationUnitPrice` が > 0 に設定されていれば、最終値の手動オーバーライドとして扱う
   ==================================================== */

/** 明細からメイン+サブ合計の計算日単価（円/件/日）を算出。case なしなら undefined を返す。 */
function derivedAvgCalcUnitFromCases(
  cases: PriorYearCaseDetail[] | undefined,
  kind: 'acq' | 'term',
  avgWorkingDays: number,
): number | undefined {
  if (!cases || cases.length === 0 || avgWorkingDays <= 0) return undefined
  const rows = cases.filter((c) => c.kind === kind)
  if (rows.length === 0) return undefined
  let sum = 0
  for (const r of rows) {
    const rev = r.plannedRevenue ?? 0
    sum += rev / avgWorkingDays
  }
  return Math.round(sum / rows.length)
}

/** 前年の月平均営業日数（priorYear.workingDaysByMonth の平均）。未設定は defaultWorkingDays。 */
function priorAvgWorkingDays(plan: Plan): number {
  const py = plan.priorYear
  if (!py) return plan.defaultWorkingDays || 20
  const months = monthsRange(py.baseMonth, py.horizonMonths)
  const vals = months.map((m) => py.workingDaysByMonth?.[m] ?? py.defaultWorkingDays ?? 20)
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : py.defaultWorkingDays || 20
}

/** 前年 獲得単価ベース（計画の前年ベース値）。明細から自動 or 手動override or fallback。 */
export function effectiveAcquisitionBasePrice(plan: Plan): number {
  const manual = plan.cohortPricing?.priorAcquisitionUnitPrice ?? 0
  if (manual > 0) return manual
  const avgWd = priorAvgWorkingDays(plan)
  const derived = derivedAvgCalcUnitFromCases(plan.priorYear?.cases, 'acq', avgWd)
  if (derived && derived > 0) return derived
  // 最終フォールバック: annualSummary.acquisitionUnitPrice または プール単価
  const sum = plan.priorYear?.annualSummary?.acquisitionUnitPrice ?? 0
  if (sum > 0) return sum
  return plan.revenuePerCase ?? 0
}

/** 前年 終了単価ベース。明細 → 手動override(priorTerminationUnitPrice) → annualSummary → プール単価 */
export function effectiveTerminationBasePrice(plan: Plan): number {
  const manual = plan.cohortPricing?.priorTerminationUnitPrice ?? 0
  if (manual > 0) return manual
  const avgWd = priorAvgWorkingDays(plan)
  const derived = derivedAvgCalcUnitFromCases(plan.priorYear?.cases, 'term', avgWd)
  if (derived && derived > 0) return derived
  const sum = plan.priorYear?.annualSummary?.terminationUnitPrice ?? 0
  if (sum > 0) return sum
  return plan.revenuePerCase ?? 0
}

/** FY2026 獲得単価（前年ベース + Abs + %） */
export function effectiveAcquisitionUnitPrice(plan: Plan): number {
  const c = plan.cohortPricing
  if (!c) return plan.revenuePerCase
  const base = effectiveAcquisitionBasePrice(plan)
  const abs = c.acquisitionUnitPriceUpAbs ?? 0
  const pct = c.acquisitionUnitPriceUpPct ?? 0
  return base + abs + (base * pct) / 100
}

/** FY2026 終了単価（前年ベース + 調整）。`terminationUnitPrice` が > 0 なら手動 override として最優先。 */
export function effectiveTerminationUnitPrice(plan: Plan): number {
  const c = plan.cohortPricing
  if (!c) return plan.revenuePerCase
  const override = c.terminationUnitPrice ?? 0
  if (override > 0) return override
  const base = effectiveTerminationBasePrice(plan)
  const abs = c.terminationUnitPriceAdjAbs ?? 0
  const pct = c.terminationUnitPriceAdjPct ?? 0
  return base + abs + (base * pct) / 100
}

/** セグメント別 獲得1案件1日あたり粗利
 *  分解:
 *    prior     = 前年獲得単価 × (1 - 当年原価率)         （前年水準の粗利/日）
 *    priceGain = (当年獲得単価 - 前年獲得単価) × (1 - 原価率) （単価UPによる自動粗利増）
 *    uplift    = 手動指定の追加粗利/日                    （単価UP以外の粗利改善）
 *    current   = prior + priceGain + uplift              （新規獲得の実効粗利/日）
 */
export function effectiveAcquisitionProfitPerCaseDay(
  plan: Plan,
  cat: WorkerCategory,
): { prior: number; priceGain: number; uplift: number; current: number } {
  const priorUnit = effectiveAcquisitionBasePrice(plan)
  const acqUnit = effectiveAcquisitionUnitPrice(plan)
  const rate = plan.categories[cat]?.costRate ?? 0
  const prior = priorUnit * (1 - rate / 100)
  const priceGain = (acqUnit - priorUnit) * (1 - rate / 100)
  const uplift = plan.cohortPricing?.acquisitionProfitUplift?.[cat] ?? 0
  return { prior, priceGain, uplift, current: prior + priceGain + uplift }
}

/** 指定月時点の累計獲得件数（セグメント別・整数按分ベース） */
export function cumulativeAcquisitionsUpTo(plan: Plan, upToMonth: string): CategoryMap<number> {
  const months = monthsRange(plan.baseMonth, plan.horizonMonths)
  const cum: CategoryMap<number> = { partner: 0, vendor: 0, employment: 0 }
  for (const m of months) {
    if (!ymLte(m, upToMonth)) break
    const mt = plan.monthlyTotals.find((x) => x.month === m)
    const total = Math.max(0, Math.round(mt?.acquisitionTotal ?? 0))
    if (total <= 0) continue
    const ratio = effectiveRatio(plan, m, 'acquisition')
    const dist = distributeIntegers(total, ratio)
    cum.partner += dist.partner
    cum.vendor += dist.vendor
    cum.employment += dist.employment
  }
  return cum
}

/** 指定月のコホートdelta（継続ベースとの差分）
 *  Δ売上 = 累計獲得件数 × (獲得単価 − 継続単価) × 営業日数
 *  Δ粗利 = Σ_p (累計獲得[p] × uplift[p]) × 営業日数
 */
export function cohortDeltaAt(plan: Plan, ym: string): {
  deltaRevenue: number
  deltaCost: number
  deltaProfit: number
  cumA: CategoryMap<number>
  acqUnitPrice: number
  basePrice: number
  days: number
} {
  const basePrice = plan.revenuePerCase ?? 0
  const acqUnitPrice = effectiveAcquisitionUnitPrice(plan)
  const days = workingDaysOf(plan, ym)
  const cumA = cumulativeAcquisitionsUpTo(plan, ym)
  const priceDelta = acqUnitPrice - basePrice

  const uplift = plan.cohortPricing?.acquisitionProfitUplift ?? { partner: 0, vendor: 0, employment: 0 }

  // 単価差分はカテゴリごとに cost/profit を分解:
  //   profit_contribution = priceDelta × (1 - rate[cat])  → 粗利に行く
  //   cost_contribution   = priceDelta × rate[cat]        → 原価に行く
  let deltaRevenue = 0
  let deltaProfitFromPrice = 0
  let deltaProfitFromUplift = 0
  for (const cat of WorkerCategoryOrder) {
    const rate = (plan.categories[cat]?.costRate ?? 0) / 100
    const n = cumA[cat]
    deltaRevenue += n * priceDelta * days
    deltaProfitFromPrice += n * priceDelta * (1 - rate) * days
    deltaProfitFromUplift += n * (uplift[cat] ?? 0) * days
  }
  deltaRevenue = Math.round(deltaRevenue)
  const deltaProfit = Math.round(deltaProfitFromPrice + deltaProfitFromUplift)
  const deltaCost = deltaRevenue - deltaProfit

  return { deltaRevenue, deltaCost, deltaProfit, cumA, acqUnitPrice, basePrice, days }
}

/** 当月新規（当月に発生した単価アップ分）のみ */
export function monthlyNewPriceIncreaseAt(
  plan: Plan,
  ym: string,
): { amount: number; weightedReturnRate: number; profit: number } {
  let amount = 0
  let costSum = 0
  for (const ev of plan.priceIncreases ?? []) {
    if (ev.month === ym) {
      amount += ev.amount
      costSum += Math.round((ev.amount * ev.returnRate) / 100)
    }
  }
  const weightedReturnRate = amount > 0 ? (costSum / amount) * 100 : 0
  return { amount, weightedReturnRate, profit: amount - costSum }
}

/* ====================================================
   前年実績から FY2026 初期値を導出するヘルパー
   ==================================================== */

/** 前年実績の期末件数（FY2025 3月末 = FY2026 4月期首 に相当） */
export function computePriorYearEndCounts(py: PriorYearPlan): CategoryMap<number> {
  const months = monthsRange(py.baseMonth, py.horizonMonths)
  const counts: CategoryMap<number> = { ...py.initialCounts }

  for (const m of months) {
    const d = py.monthlyData.find((x) => x.month === m)
    // 獲得・終了（カテゴリ別データがあればそれを使用、なければ合計を均等按分）
    if (d) {
      if (d.acquisitionByCategory) {
        counts.partner += d.acquisitionByCategory.partner
        counts.vendor += d.acquisitionByCategory.vendor
        counts.employment += d.acquisitionByCategory.employment
      } else if (d.acquisition > 0) {
        // フォールバック：ratio で按分
        const dist = distributeIntegers(d.acquisition, py.acquisitionRatio)
        counts.partner += dist.partner
        counts.vendor += dist.vendor
        counts.employment += dist.employment
      }
      if (d.terminationByCategory) {
        counts.partner -= d.terminationByCategory.partner
        counts.vendor -= d.terminationByCategory.vendor
        counts.employment -= d.terminationByCategory.employment
      } else if (d.termination > 0) {
        const dist = distributeIntegers(d.termination, py.terminationRatio)
        counts.partner -= dist.partner
        counts.vendor -= dist.vendor
        counts.employment -= dist.employment
      }
    }
    // 入替（非対角のみ件数に影響。対角は件数に影響しないのでスキップ）
    for (const t of py.transfers) {
      if (t.month === m && t.from !== t.to) {
        counts[t.from] -= t.count
        counts[t.to] += t.count
      }
    }
  }

  for (const c of WorkerCategoryOrder) counts[c] = Math.max(0, Math.round(counts[c]))
  return counts
}

/** 前年実績の月次シリーズ（ダッシュボード可視化用） */
export interface PriorYearMonthlySeriesRow {
  month: string
  beginCounts: CategoryMap<number>
  endCounts: CategoryMap<number>
  acquisition: number
  termination: number
  acquisitionByCategory: CategoryMap<number>
  terminationByCategory: CategoryMap<number>
  net: number
  revenue: number
  grossProfit: number
  margin: number     // 0-1
  workingDays: number
  daily: number      // revenue / workingDays
}

export function computePriorYearMonthlySeries(py: PriorYearPlan): PriorYearMonthlySeriesRow[] {
  const months = monthsRange(py.baseMonth, py.horizonMonths)
  const result: PriorYearMonthlySeriesRow[] = []

  let prevCounts: CategoryMap<number> = { ...py.initialCounts }

  for (const m of months) {
    const d = py.monthlyData.find((x) => x.month === m)
    const counts: CategoryMap<number> = { ...prevCounts }

    // カテゴリ別 獲得/終了 を算出
    const acqBy: CategoryMap<number> = d?.acquisitionByCategory
      ? { ...d.acquisitionByCategory }
      : (d?.acquisition ? distributeIntegers(d.acquisition, py.acquisitionRatio) : { partner: 0, vendor: 0, employment: 0 })
    const termBy: CategoryMap<number> = d?.terminationByCategory
      ? { ...d.terminationByCategory }
      : (d?.termination ? distributeIntegers(d.termination, py.terminationRatio) : { partner: 0, vendor: 0, employment: 0 })

    counts.partner += acqBy.partner - termBy.partner
    counts.vendor += acqBy.vendor - termBy.vendor
    counts.employment += acqBy.employment - termBy.employment

    for (const t of py.transfers) {
      if (t.month === m && t.from !== t.to) {
        counts[t.from] -= t.count
        counts[t.to] += t.count
      }
    }
    for (const c of WorkerCategoryOrder) counts[c] = Math.max(0, Math.round(counts[c]))

    const acq = d?.acquisition ?? (acqBy.partner + acqBy.vendor + acqBy.employment)
    const term = d?.termination ?? (termBy.partner + termBy.vendor + termBy.employment)
    const revenue = d?.revenue ?? 0
    const gp = d?.grossProfit ?? 0
    const margin = revenue > 0 ? gp / revenue : 0
    const days = py.workingDaysByMonth?.[m] ?? py.defaultWorkingDays
    const daily = days > 0 ? revenue / days : 0

    result.push({
      month: m,
      beginCounts: { ...prevCounts },
      endCounts: { ...counts },
      acquisition: acq,
      termination: term,
      acquisitionByCategory: acqBy,
      terminationByCategory: termBy,
      net: acq - term,
      revenue,
      grossProfit: gp,
      margin,
      workingDays: days,
      daily,
    })
    prevCounts = counts
  }

  return result
}

/** 指定月の平均単価を前年実績から逆算（円/1件/1日）
 *  単価 = 月次売上 / (平均件数 × 営業日数)
 *  平均件数 = (月初件数 + 月末件数) / 2
 */
export function estimateRevenuePerCaseAtMonth(
  py: PriorYearPlan,
  ym: string,
): number | null {
  const series = computePriorYearMonthlySeries(py)
  const row = series.find((r) => r.month === ym)
  if (!row || row.revenue <= 0) return null
  const beginTotal = row.beginCounts.partner + row.beginCounts.vendor + row.beginCounts.employment
  const endTotal = row.endCounts.partner + row.endCounts.vendor + row.endCounts.employment
  const avgCount = (beginTotal + endTotal) / 2
  if (avgCount <= 0 || row.workingDays <= 0) return null
  return row.revenue / avgCount / row.workingDays
}

/** 前年最終月の実績 × マイスター・社員を考慮した合算原価率比較
 *  effective: アプリに入れる値（マイスター補正なし / 原価計算を正しく再現）
 *  trueRate:  マイスター非カバーの運送店+業者の実態原価率（現場感）
 */
export function estimateCostRatesComparisonWithMeister(py: PriorYearPlan): {
  month: string
  revenue: number
  profit: number
  cost: number
  socialRevenue: number
  meisterRevenue: number
  effectiveCombinedRate: number  // マイスター考慮なし
  trueCombinedRate: number        // マイスター考慮あり
} | null {
  const series = computePriorYearMonthlySeries(py)
  for (let i = series.length - 1; i >= 0; i--) {
    const r = series[i]
    if (r.revenue <= 0) continue
    const totalEnd = r.endCounts.partner + r.endCounts.vendor + r.endCounts.employment
    if (totalEnd <= 0) continue

    const socialShare = r.endCounts.employment / totalEnd
    const socialRevenue = socialShare * r.revenue
    const meisterRevenue = py.monthlyData.find((d) => d.month === r.month)?.meisterRevenue ?? 0
    const cost = r.revenue - r.grossProfit

    // Effective (マイスター考慮なし): 社員のみ0%扱い
    const rvRevEffective = r.revenue - socialRevenue
    const rvCostEffective = cost  // 社員 cost 0 前提
    const effectiveCombinedRate = rvRevEffective > 0 ? (rvCostEffective / rvRevEffective) * 100 : 0

    // True (マイスター考慮あり): 社員 + マイスター両方 0%扱い
    const zeroCostRev = socialRevenue + meisterRevenue
    const rvRevTrue = r.revenue - zeroCostRev
    const rvCostTrue = cost  // 社員+マイスター の cost はそれぞれ 0
    const trueCombinedRate = rvRevTrue > 0 ? (rvCostTrue / rvRevTrue) * 100 : 0

    return {
      month: r.month,
      revenue: r.revenue,
      profit: r.grossProfit,
      cost,
      socialRevenue,
      meisterRevenue,
      effectiveCombinedRate: Math.round(effectiveCombinedRate * 100) / 100,
      trueCombinedRate: Math.round(trueCombinedRate * 100) / 100,
    }
  }
  return null
}

/** 前年最終月の実績から、セグメント別原価率を推定（R=V 仮定）
 *  社員(employment)原価率 = 0%
 *  運送店・業者 の合算原価率を逆算（2分の1ずつ等しいと仮定）
 *  戻り値: { partner, vendor, employment, combinedRate } （% 単位）
 */
export function estimateSegmentCostRatesFromPriorLastMonth(
  py: PriorYearPlan,
): {
  partner: number
  vendor: number
  employment: number
  combinedRate: number
  month: string
} | null {
  const series = computePriorYearMonthlySeries(py)
  // 最後に売上/粗利がある月を使う
  for (let i = series.length - 1; i >= 0; i--) {
    const r = series[i]
    if (r.revenue <= 0) continue
    const totalEnd = r.endCounts.partner + r.endCounts.vendor + r.endCounts.employment
    if (totalEnd <= 0) continue
    // 単価共通前提 → 件数シェア = 売上シェア
    const eShare = r.endCounts.employment / totalEnd
    const eRevenue = eShare * r.revenue
    // 社員原価 0% → 社員粗利 = 社員売上
    const rvRevenue = r.revenue - eRevenue
    const rvProfit = r.grossProfit - eRevenue
    if (rvRevenue <= 0) continue
    const rvCost = rvRevenue - rvProfit
    const combinedRate = (rvCost / rvRevenue) * 100
    return {
      partner: Math.round(combinedRate * 100) / 100,
      vendor: Math.round(combinedRate * 100) / 100,
      employment: 0,
      combinedRate: Math.round(combinedRate * 100) / 100,
      month: r.month,
    }
  }
  return null
}

/** 前年最終月の合算原価率を、案件数比に応じて運送店/業者に分離
 *  deltaPt = 業者原価率 − 運送店原価率（pt）
 *  basis:
 *    'effective' (既定) = マイスター考慮なし。合算率 = reportedCost / (reportedRev − socialRev)
 *                        → この率を FY2026 運用時に使うと FY2025 reported 粗利率を再現
 *    'true'             = マイスター考慮あり。合算率 = reportedCost / (reportedRev − socialRev − meister)
 *                        → マイスターを外した「真の運営粗利率」を基準。FY2026 で meister=0 にすると粗利率が下がる
 *
 *  R=partnerCount, V=vendorCount, wR=R/(R+V), wV=V/(R+V) とすると
 *    rR = combined − wV · Δ
 *    rV = combined + wR · Δ
 *  案件数加重平均は combined と一致する。
 */
export function estimateSegmentCostRatesWithDelta(
  py: PriorYearPlan,
  deltaPt: number,
  basis: 'effective' | 'true' = 'effective',
): {
  partner: number
  vendor: number
  employment: number
  combinedRate: number
  partnerCount: number
  vendorCount: number
  partnerWeight: number
  vendorWeight: number
  deltaPt: number
  basis: 'effective' | 'true'
  month: string
} | null {
  const series = computePriorYearMonthlySeries(py)
  for (let i = series.length - 1; i >= 0; i--) {
    const r = series[i]
    if (r.revenue <= 0) continue
    const R = r.endCounts.partner
    const V = r.endCounts.vendor
    const E = r.endCounts.employment
    const totalEnd = R + V + E
    if (totalEnd <= 0) continue
    const eShare = E / totalEnd
    const eRevenue = eShare * r.revenue
    // basis = 'true' の時は meister 売上も 0%原価扱いで分母から抜く
    const meister = basis === 'true'
      ? (py.monthlyData.find((d) => d.month === r.month)?.meisterRevenue ?? 0)
      : 0
    const rvRevenue = r.revenue - eRevenue - meister
    const rvProfit = r.grossProfit - eRevenue - meister
    if (rvRevenue <= 0) continue
    const rvCost = rvRevenue - rvProfit
    const combined = (rvCost / rvRevenue) * 100
    const rvTotal = R + V
    if (rvTotal <= 0) continue
    const wR = R / rvTotal
    const wV = V / rvTotal
    const rR = combined - wV * deltaPt
    const rV = combined + wR * deltaPt
    return {
      partner: Math.round(rR * 100) / 100,
      vendor: Math.round(rV * 100) / 100,
      employment: 0,
      combinedRate: Math.round(combined * 100) / 100,
      partnerCount: R,
      vendorCount: V,
      partnerWeight: Math.round(wR * 10000) / 10000,
      vendorWeight: Math.round(wV * 10000) / 10000,
      deltaPt,
      basis,
      month: r.month,
    }
  }
  return null
}

/** 前年の最終月の単価
 *  basis:
 *    'reported' (既定) = 会計実績 / 件数 / 日数。新モデル（マイスターは案件プール内の代走分）では
 *                       revenue は案件プールなので reported 基準が正解。FY2026-04 日計 = FY2025-03 日計で連続。
 *    'ops'             = マイスター分を抜いた単価。旧モデル参考用。
 */
export function estimatePriorYearLastMonthUnitPrice(
  py: PriorYearPlan,
  basis: 'reported' | 'ops' = 'reported',
): {
  month: string
  unitPrice: number            // basis に応じた単価
  reportedUnitPrice: number    // マイスター込み（参考）
  opsUnitPrice: number         // マイスター除外（参考）
  revenue: number              // basis に応じた revenue
  meisterRevenue: number
  workingDays: number
  avgCount: number
  margin: number
  basis: 'ops' | 'reported'
} | null {
  const series = computePriorYearMonthlySeries(py)
  for (let i = series.length - 1; i >= 0; i--) {
    const r = series[i]
    if (r.revenue > 0) {
      const beginTotal = r.beginCounts.partner + r.beginCounts.vendor + r.beginCounts.employment
      const endTotal = r.endCounts.partner + r.endCounts.vendor + r.endCounts.employment
      const avgCount = (beginTotal + endTotal) / 2
      if (avgCount <= 0 || r.workingDays <= 0) continue
      const meisterRevenue = py.monthlyData.find((d) => d.month === r.month)?.meisterRevenue ?? 0
      const reportedUnitPrice = r.revenue / avgCount / r.workingDays
      const opsRev = r.revenue - meisterRevenue
      const opsUnitPrice = opsRev / avgCount / r.workingDays
      const unitPrice = basis === 'ops' ? opsUnitPrice : reportedUnitPrice
      return {
        month: r.month,
        unitPrice,
        reportedUnitPrice,
        opsUnitPrice,
        revenue: basis === 'ops' ? opsRev : r.revenue,
        meisterRevenue,
        workingDays: r.workingDays,
        avgCount,
        margin: r.margin,
        basis,
      }
    }
  }
  return null
}

/** 前年実績から逆算した平均単価（円/1件/1日） */
export function estimateAverageRevenuePerCase(py: PriorYearPlan): number | null {
  const months = monthsRange(py.baseMonth, py.horizonMonths)
  let sumRev = 0
  let sumCountDays = 0

  let prevCounts: CategoryMap<number> = { ...py.initialCounts }

  for (const m of months) {
    const d = py.monthlyData.find((x) => x.month === m)
    const counts: CategoryMap<number> = { ...prevCounts }

    if (d) {
      if (d.acquisitionByCategory) {
        counts.partner += d.acquisitionByCategory.partner
        counts.vendor += d.acquisitionByCategory.vendor
        counts.employment += d.acquisitionByCategory.employment
      } else if (d.acquisition > 0) {
        const dist = distributeIntegers(d.acquisition, py.acquisitionRatio)
        counts.partner += dist.partner
        counts.vendor += dist.vendor
        counts.employment += dist.employment
      }
      if (d.terminationByCategory) {
        counts.partner -= d.terminationByCategory.partner
        counts.vendor -= d.terminationByCategory.vendor
        counts.employment -= d.terminationByCategory.employment
      } else if (d.termination > 0) {
        const dist = distributeIntegers(d.termination, py.terminationRatio)
        counts.partner -= dist.partner
        counts.vendor -= dist.vendor
        counts.employment -= dist.employment
      }
    }
    for (const t of py.transfers) {
      if (t.month === m && t.from !== t.to) {
        counts[t.from] -= t.count
        counts[t.to] += t.count
      }
    }
    for (const c of WorkerCategoryOrder) counts[c] = Math.max(0, counts[c])

    const beginTotal = prevCounts.partner + prevCounts.vendor + prevCounts.employment
    const endTotal = counts.partner + counts.vendor + counts.employment
    const avgCount = (beginTotal + endTotal) / 2
    const days = py.workingDaysByMonth?.[m] ?? py.defaultWorkingDays

    if (d?.revenue && avgCount > 0 && days > 0) {
      sumRev += d.revenue
      sumCountDays += avgCount * days
    }

    prevCounts = counts
  }

  if (sumCountDays <= 0) return null
  return sumRev / sumCountDays
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

/* ====================================================
   月次 粗利率ブリッジ（Dashboard 可視化用）
   営業向け：配車ミックス／同区分uplift／単価アップを pt 分解
   ==================================================== */

export interface MarginBridgeRow {
  month: string
  fy: 'prior' | 'current'
  // 月末件数とカテゴリ構成比（%）
  countPartner: number
  countVendor: number
  countEmployment: number
  totalCount: number
  sharePartner: number   // 0-100
  shareVendor: number
  shareEmployment: number
  // 獲得/終了/純入替（構成比変動ドライバー）
  acquisition: number
  termination: number
  transfersNet: CategoryMap<number>  // 各カテゴリの純入替（+in, -out）
  // 金額（円）— 事業運営（マイスター除外）
  baseRevenue: number     // 基礎売上（counts × 単価 × 営業日数）
  baseCost: number        // 基礎原価（uplift・単価アップ・コホートdelta を除外）
  upliftCost: number      // 同区分入替 累積 uplift による原価
  priceupRevenue: number  // 単価アップ 累積 売上
  priceupCost: number     // 単価アップ 累積 原価（還元分）
  cohortRevenueDelta: number
  cohortCostDelta: number
  priceRevRevenue: number // 部分単価改定による売上加算（累積）
  costRevCost: number     // 部分原価改定による原価加算（累積）
  totalRevenue: number            // 事業運営 売上（マイスター除外）
  totalCost: number
  totalProfit: number             // 事業運営 粗利
  meisterRevenue: number          // マイスター売上（0%原価）
  revenueWithMeister: number      // 事業運営 + マイスター
  profitWithMeister: number
  // 粗利率と pt 分解（小数、0.78 = 78%）
  baseMargin: number               // 基礎粗利率（ミックス × カテゴリ原価率）
  initialMarginRef: number         // 期首件数 × 当月カテゴリ原価率 で計算した基準粗利率
  acqtermPt: number                // 獲得/終了 累積による mix 変動の pt 寄与
  transferPt: number               // 入替（非対角）による mix 変動の pt 寄与
  priceupPt: number                // 単価アップ（+コホート）による pt 寄与（fraction, 0.01 = +1pt）
  revisionPt: number               // 部分改定（単価+ / 原価+）による pt 寄与（売上正・原価負）
  upliftPt: number                 // 同区分uplift による pt 寄与（通常 <= 0）
  effectiveMargin: number          // 事業運営 実効粗利率（マイスター除外）= base + priceupPt + upliftPt
  meisterPt: number                // マイスターを加えた時の pt 寄与（通常 >= 0）
  marginWithMeister: number        // マイスター込み 実効粗利率 = effectiveMargin + meisterPt
  // 営業日数と日計
  workingDays: number
  daily: number  // totalRevenue / workingDays
}

/** 部分 原価改定 の月次影響額（円）= 全 CostRevision の effectiveMonth <= ym の合計。
 *  カテゴリ別 手数料率 (costUpliftCommissionRate) を差し引いた実効額で計上する。 */
export function costRevisionImpactAt(plan: Plan, ym: string): number {
  const days = workingDaysOf(plan, ym)
  let total = 0
  for (const cr of plan.costRevisions ?? []) {
    if (!ymLte(cr.effectiveMonth, ym)) continue
    const factor = costUpliftFactor(plan, cr.category)
    total += cr.count * cr.amountPerCaseDay * factor * days
  }
  return Math.round(total)
}

/** 部分 単価改定 の月次影響額（円）= 全 PriceRevision の effectiveMonth <= ym の合計（売上のみ加算、原価は変えない＝純粗利増） */
export function priceRevisionImpactAt(plan: Plan, ym: string): { revenue: number; costAdd: number } {
  const days = workingDaysOf(plan, ym)
  const base = effectiveRevenuePerCaseAt(plan, ym)
  let rev = 0
  for (const pr of plan.priceRevisions ?? []) {
    if (!ymLte(pr.effectiveMonth, ym)) continue
    const perDay = pr.amountPerCaseDay ?? (base * (pr.pctOfBase ?? 0) / 100)
    rev += pr.count * perDay * days
  }
  // 原価は追随させない（単価改定は純マージン寄与とする設計）
  return { revenue: Math.round(rev), costAdd: 0 }
}

/** マイスター代走による原価削減額を計算（代走先の cost rate ぶん、cost amount モードでは対応困難なので 0）
 *  model: 案件プールのうちマイスターが代走した meisterRevenue 円分は 0%原価。
 *         通常の代走先カテゴリ原価率で計算されるはずだった原価が丸々浮く。
 */
export function meisterCostSavingAt(plan: Plan, ym: string, meisterRevenue: number): number {
  if (meisterRevenue <= 0) return 0
  const alloc = plan.meisterAllocation ?? { partner: 100, vendor: 0, employment: 0 }
  const totalAlloc = (alloc.partner ?? 0) + (alloc.vendor ?? 0) + (alloc.employment ?? 0)
  if (totalAlloc <= 0) return 0
  let saving = 0
  for (const cat of WorkerCategoryOrder) {
    const share = (alloc[cat] ?? 0) / totalAlloc
    if (share <= 0) continue
    const cfg = effectiveConfigAt(plan, cat, ym)
    // rate モードのみ対応（amount モードはそもそも revenue 非線形で扱い困難）
    const rate = cfg.costModel === 'rate' ? cfg.costRate / 100 : 0
    saving += meisterRevenue * share * rate
  }
  return Math.round(saving)
}

/** 指定月の件数構成 × 当月カテゴリ原価率 で純ミックス粗利率を算出（uplift・単価UP・コホート除外） */
function blendedMixMarginAt(
  plan: Plan,
  counts: CategoryMap<number>,
  ym: string,
): number {
  const days = workingDaysOf(plan, ym)
  const revPerCase = effectiveRevenuePerCaseAt(plan, ym)
  let rev = 0
  let cost = 0
  for (const cat of WorkerCategoryOrder) {
    const cfg = effectiveConfigAt(plan, cat, ym)
    const c = Math.max(0, counts[cat])
    const r = c * revPerCase * days
    const co =
      cfg.costModel === 'rate'
        ? (r * cfg.costRate) / 100
        : c * cfg.costAmount * days
    rev += r
    cost += co
  }
  return rev > 0 ? (rev - cost) / rev : 0
}

/** FY2026 の月次粗利率ブリッジを返す（12ヶ月） */
export function computeMarginBridge(plan: Plan): MarginBridgeRow[] {
  const months = monthsRange(plan.baseMonth, plan.horizonMonths)
  const result: MarginBridgeRow[] = []

  let prevCounts: CategoryMap<number> = { ...plan.initialCounts }
  // 獲得/終了のみ反映（入替なし）の並行カウント
  let prevAcqTermCounts: CategoryMap<number> = { ...plan.initialCounts }
  const cumDiag: { partner: number; vendor: number } = { partner: 0, vendor: 0 }
  let cumTerm = 0

  for (const ym of months) {
    const counts: CategoryMap<number> = { ...prevCounts }
    const countsAcqTerm: CategoryMap<number> = { ...prevAcqTermCounts }

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
      countsAcqTerm[c] += acqDist[c]
      countsAcqTerm[c] -= termDist[c]
    }
    cumTerm += termTotal

    const transfersNet: CategoryMap<number> = { partner: 0, vendor: 0, employment: 0 }
    for (const t of plan.transfers) {
      if (t.month !== ym) continue
      if (t.from !== t.to) {
        counts[t.from] -= t.count
        counts[t.to] += t.count
        transfersNet[t.from] -= t.count
        transfersNet[t.to] += t.count
      }
    }
    cumDiag.partner += diagonalCount(plan.transfers, ym, 'partner')
    cumDiag.vendor += diagonalCount(plan.transfers, ym, 'vendor')

    for (const c of WorkerCategoryOrder) {
      counts[c] = Math.max(0, Math.round(counts[c]))
      countsAcqTerm[c] = Math.max(0, Math.round(countsAcqTerm[c]))
    }

    const days = workingDaysOf(plan, ym)
    const revPerCase = effectiveRevenuePerCaseAt(plan, ym)
    const upliftP = effectiveDiagonalUpliftAt(plan, ym, 'partner') * costUpliftFactor(plan, 'partner')
    const upliftV = effectiveDiagonalUpliftAt(plan, ym, 'vendor') * costUpliftFactor(plan, 'vendor')
    const diagCostP = Math.round(cumDiag.partner * upliftP * days)
    const diagCostV = Math.round(cumDiag.vendor * upliftV * days)
    const upliftCost = diagCostP + diagCostV

    // 基礎（uplift 除外）
    let baseRevenue = 0
    let baseCost = 0
    for (const cat of WorkerCategoryOrder) {
      const cfg = effectiveConfigAt(plan, cat, ym)
      const count = counts[cat]
      const rev = Math.round(count * revPerCase * days)
      const cost =
        cfg.costModel === 'rate'
          ? Math.round((rev * cfg.costRate) / 100)
          : Math.round(count * cfg.costAmount * days)
      baseRevenue += rev
      baseCost += cost
    }

    // 単価アップ（累積）
    const pi = cumulativePriceIncreaseAt(plan, ym)
    // コホート delta
    const coh = cohortDeltaAt(plan, ym)
    // 部分改定
    const costRev = costRevisionImpactAt(plan, ym)
    const priceRev = priceRevisionImpactAt(plan, ym)

    // 終了コホート単価 補正（売上＆原価を実効原価率で比例補正）
    const termUnitPrice = effectiveTerminationUnitPrice(plan)
    let termRevAdj = 0
    let termCostAdj = 0
    if (termUnitPrice > 0 && termUnitPrice !== revPerCase && cumTerm > 0) {
      termRevAdj = Math.round((revPerCase - termUnitPrice) * cumTerm * days)
      const effRate = baseRevenue > 0 ? baseCost / baseRevenue : 0
      termCostAdj = Math.round(termRevAdj * effRate)
    }

    const totalRevenue = baseRevenue + pi.revenue + coh.deltaRevenue + priceRev.revenue + termRevAdj
    const totalCost = baseCost + upliftCost + pi.cost + coh.deltaCost + costRev + priceRev.costAdd + termCostAdj
    const totalProfit = totalRevenue - totalCost

    const baseMargin = baseRevenue > 0 ? (baseRevenue - baseCost) / baseRevenue : 0
    // ── シナリオ分解：ベース粗利率を「期首 + 獲得終了 + 入替」に分解
    //    すべて「当月カテゴリ原価率・当月単価・当月日数」で計算するので、
    //    差分は純粋に件数ミックスの違いに由来する
    const initialMarginRef = blendedMixMarginAt(plan, plan.initialCounts, ym)
    const acqtermOnlyMargin = blendedMixMarginAt(plan, countsAcqTerm, ym)
    const acqtermPt = acqtermOnlyMargin - initialMarginRef
    const transferPt = baseMargin - acqtermOnlyMargin

    // ── 逐次加算で pt を分解（base → +priceup → +revision → −uplift）
    const revAfterPriceup = baseRevenue + pi.revenue + coh.deltaRevenue
    const costAfterPriceup = baseCost + pi.cost + coh.deltaCost
    const marginAfterPriceup = revAfterPriceup > 0
      ? (revAfterPriceup - costAfterPriceup) / revAfterPriceup : baseMargin
    const priceupPt = marginAfterPriceup - baseMargin

    const revAfterRev = revAfterPriceup + priceRev.revenue
    const costAfterRev = costAfterPriceup + costRev + priceRev.costAdd
    const marginAfterRev = revAfterRev > 0
      ? (revAfterRev - costAfterRev) / revAfterRev : marginAfterPriceup
    const revisionPt = marginAfterRev - marginAfterPriceup

    const upliftPtExact = totalRevenue > 0 ? -upliftCost / totalRevenue : 0
    const effectiveMargin = totalRevenue > 0 ? totalProfit / totalRevenue : 0

    // マイスター = 案件プール内の代走分 (0%原価)。売上は不変、代走先の原価率ぶん原価が減る。
    const meisterRevenue = plan.meisterRevenueByMonth?.[ym] ?? 0
    const meisterCostSaving = meisterCostSavingAt(plan, ym, meisterRevenue)
    // revenueWithMeister = 案件プール（=totalRevenue、加算なし）
    const revenueWithMeister = totalRevenue
    const profitWithMeister = totalProfit + meisterCostSaving
    const marginWithMeister =
      revenueWithMeister > 0 ? profitWithMeister / revenueWithMeister : effectiveMargin
    const meisterPt = marginWithMeister - effectiveMargin

    const total = counts.partner + counts.vendor + counts.employment

    result.push({
      month: ym,
      fy: 'current',
      countPartner: counts.partner,
      countVendor: counts.vendor,
      countEmployment: counts.employment,
      totalCount: total,
      sharePartner: total > 0 ? (counts.partner / total) * 100 : 0,
      shareVendor: total > 0 ? (counts.vendor / total) * 100 : 0,
      shareEmployment: total > 0 ? (counts.employment / total) * 100 : 0,
      acquisition: acqTotal,
      termination: termTotal,
      transfersNet,
      baseRevenue,
      baseCost,
      upliftCost,
      priceupRevenue: pi.revenue,
      priceupCost: pi.cost,
      cohortRevenueDelta: coh.deltaRevenue,
      cohortCostDelta: coh.deltaCost,
      priceRevRevenue: priceRev.revenue,
      costRevCost: costRev + priceRev.costAdd,
      totalRevenue,
      totalCost,
      totalProfit,
      meisterRevenue,
      revenueWithMeister,
      profitWithMeister,
      baseMargin,
      initialMarginRef,
      acqtermPt,
      transferPt,
      priceupPt,
      revisionPt,
      upliftPt: upliftPtExact,
      effectiveMargin,
      meisterPt,
      marginWithMeister,
      workingDays: days,
      daily: days > 0 ? totalRevenue / days : 0,
    })

    prevCounts = counts
    prevAcqTermCounts = countsAcqTerm
  }

  return result
}

/** 前年実績の月次粗利率ブリッジ（実績の revenue/profit と前年の uplift 設定から逆算）
 *  plan が与えられている場合、ミックス分解（期首 / 獲得終了 / 入替）を plan の原価率基準で計算。
 *  FY2025 の displayed baseMargin は actual-derived のままで、分解は「plan 原価率での参考値」。
 */
export function computePriorYearMarginBridge(
  py: PriorYearPlan,
  plan?: Plan,
): MarginBridgeRow[] {
  const months = monthsRange(py.baseMonth, py.horizonMonths)
  const series = computePriorYearMonthlySeries(py)
  const result: MarginBridgeRow[] = []

  const cumDiag: { partner: number; vendor: number } = { partner: 0, vendor: 0 }
  // 獲得/終了のみ反映（入替なし）のカウント
  let prevAcqTermCounts: CategoryMap<number> = { ...py.initialCounts }

  for (let i = 0; i < months.length; i++) {
    const ym = months[i]
    const row = series[i]
    const days = row.workingDays
    const reportedRev = row.revenue           // 会計実績 (案件プール、マイスター代走分も含む)
    const reportedProfit = row.grossProfit    // 会計実績 (マイスター代走による原価減も織り込み済み)
    const meisterRevenue = py.monthlyData.find((d) => d.month === ym)?.meisterRevenue ?? 0

    // 新モデル: マイスターは代走分なので売上は reported 不変。
    // 原価削減は plan の allocation × 原価率（plan が無ければ 0）で推定
    const meisterCostSaving = plan ? meisterCostSavingAt(plan, ym, meisterRevenue) : 0
    const opsRev = reportedRev                            // 売上は変わらない
    const opsProfit = Math.max(0, reportedProfit - meisterCostSaving) // マイスターを除いた粗利
    const opsCost = opsRev - opsProfit

    // 同区分 uplift
    cumDiag.partner += diagonalCount(py.transfers, ym, 'partner')
    cumDiag.vendor += diagonalCount(py.transfers, ym, 'vendor')
    const ovr = py.diagonalUpliftByMonth?.find((r) => r.month === ym)
    const upliftP = ovr?.partner ?? py.diagonalUplift?.partner ?? 0
    const upliftV = ovr?.vendor ?? py.diagonalUplift?.vendor ?? 0
    const diagCostP = Math.round(cumDiag.partner * upliftP * days)
    const diagCostV = Math.round(cumDiag.vendor * upliftV * days)
    const upliftCost = diagCostP + diagCostV

    // 前年には priceIncreases / cohortDelta は無いので 0
    // base = uplift 除外の事業運営粗利率
    const effectiveMargin = opsRev > 0 ? opsProfit / opsRev : 0
    const baseMargin = opsRev > 0 ? (opsProfit + upliftCost) / opsRev : 0
    const upliftPtExact = opsRev > 0 ? -upliftCost / opsRev : 0
    const priceupPt = 0

    const marginWithMeister = reportedRev > 0 ? reportedProfit / reportedRev : effectiveMargin
    const meisterPt = marginWithMeister - effectiveMargin

    // acqterm 累積（入替除く）の並行カウント
    const countsAcqTerm: CategoryMap<number> = { ...prevAcqTermCounts }
    const acqBy = row.acquisitionByCategory
    const termBy = row.terminationByCategory
    countsAcqTerm.partner += acqBy.partner - termBy.partner
    countsAcqTerm.vendor += acqBy.vendor - termBy.vendor
    countsAcqTerm.employment += acqBy.employment - termBy.employment
    for (const c of WorkerCategoryOrder) countsAcqTerm[c] = Math.max(0, Math.round(countsAcqTerm[c]))

    // ミックス分解（plan がある場合のみ pt 寄与を計算）
    let initialMarginRef = 0
    let acqtermPt = 0
    let transferPt = 0
    if (plan) {
      initialMarginRef = blendedMixMarginAt(plan, py.initialCounts, ym)
      const acqtermOnlyMargin = blendedMixMarginAt(plan, countsAcqTerm, ym)
      const fullMargin = blendedMixMarginAt(plan, row.endCounts, ym)
      acqtermPt = acqtermOnlyMargin - initialMarginRef
      transferPt = fullMargin - acqtermOnlyMargin
    }

    // transfersNet for this month
    const transfersNet: CategoryMap<number> = { partner: 0, vendor: 0, employment: 0 }
    for (const t of py.transfers) {
      if (t.month === ym && t.from !== t.to) {
        transfersNet[t.from] -= t.count
        transfersNet[t.to] += t.count
      }
    }

    const total = row.endCounts.partner + row.endCounts.vendor + row.endCounts.employment

    result.push({
      month: ym,
      fy: 'prior',
      countPartner: row.endCounts.partner,
      countVendor: row.endCounts.vendor,
      countEmployment: row.endCounts.employment,
      totalCount: total,
      sharePartner: total > 0 ? (row.endCounts.partner / total) * 100 : 0,
      shareVendor: total > 0 ? (row.endCounts.vendor / total) * 100 : 0,
      shareEmployment: total > 0 ? (row.endCounts.employment / total) * 100 : 0,
      acquisition: row.acquisition,
      termination: row.termination,
      transfersNet,
      baseRevenue: opsRev,            // 案件プール売上（reportedRev と同値、新モデル）
      baseCost: opsCost - upliftCost, // uplift 前の ops 原価（マイスター効果も除外したもの）
      upliftCost,
      priceupRevenue: 0,
      priceupCost: 0,
      cohortRevenueDelta: 0,
      cohortCostDelta: 0,
      priceRevRevenue: 0,
      costRevCost: 0,
      totalRevenue: opsRev,           // 案件プール売上（マイスター代走分も含む内数）
      totalCost: opsCost,             // マイスター代走なしを仮定した原価
      totalProfit: opsProfit,         // マイスターなしの粗利
      meisterRevenue,
      revenueWithMeister: reportedRev,   // = 売上（代走は内数なので同額）
      profitWithMeister: reportedProfit, // = 実績粗利（代走による原価減を反映済み）
      baseMargin,
      initialMarginRef,
      acqtermPt,
      transferPt,
      priceupPt,
      revisionPt: 0,
      upliftPt: upliftPtExact,
      effectiveMargin,
      meisterPt,
      marginWithMeister,
      workingDays: days,
      daily: row.daily,
    })

    prevAcqTermCounts = countsAcqTerm
  }

  return result
}
