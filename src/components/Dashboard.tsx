import { Fragment, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { usePlanStore } from '../store'
import { WorkerCategoryLabels, WorkerCategoryOrder } from '../types'
import type { Plan } from '../types'
import {
  budgetProfitOf,
  budgetRevenueOf,
  computeMarginBridge,
  computeMonthly,
  computePriorYearMarginBridge,
  computePriorYearMonthlySeries,
  estimatePriorYearLastMonthUnitPrice,
  meisterCostSavingAt,
  percent,
  priorYm,
  workingDaysOf,
  yen,
} from '../utils/calculations'
import type { MarginBridgeRow } from '../utils/calculations'
import { formatYmShort, monthsRange, parseYm } from '../utils/month'

const CATEGORY_COLORS: Record<string, string> = {
  運送店: '#2563eb',
  業者: '#7c3aed',
  社員: '#059669',
}

/** 売上系（青）/ 粗利系（緑）で色を分離し、FY は solid(FY2025実績) / dashed(FY2026計画) で区別 */
const REVENUE_COLOR = '#0ea5e9'          // 線色（両FY 共通、青）
const REVENUE_COLOR_DARK = '#0369a1'     // bar FY2025（濃い青）
const REVENUE_COLOR_LIGHT = '#38bdf8'    // bar FY2026（明るい青）
const PROFIT_COLOR = '#10b981'           // 線色（両FY 共通、緑）
const PROFIT_COLOR_DARK = '#047857'      // bar FY2025（濃い緑）
const PROFIT_COLOR_LIGHT = '#34d399'     // bar FY2026（明るい緑）
// Compat（残っている参照用・段階的に置換）
const FY_COLORS = {
  current: REVENUE_COLOR_LIGHT,
  prior: REVENUE_COLOR_DARK,
}
const FY_PROFIT_COLORS = {
  current: PROFIT_COLOR_LIGHT,
  prior: PROFIT_COLOR_DARK,
}

/** baseMonth から Japanese FY ラベル（4月開始） */
function fiscalYearLabel(baseMonth: string): string {
  const { year, month1 } = parseYm(baseMonth)
  const fy = month1 >= 4 ? year : year - 1
  return `FY${fy}`
}

function shortYm(ym: string): string {
  const { year, month1 } = parseYm(ym)
  return `${String(year).slice(2)}/${String(month1).padStart(2, '0')}`
}

export default function Dashboard() {
  const plan = usePlanStore((s) => s.plan)
  const rows = useMemo(() => computeMonthly(plan), [plan])

  // 新モデル: マイスターは案件プール内の代走分 (0%原価)。売上は変えず、原価を削減。
  // 運営のみ（マイスター代走なしを仮定）
  const totalOpsRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0)
  const totalOpsCost = rows.reduce((s, r) => s + r.totalCost, 0)
  const totalOpsProfit = totalOpsRevenue - totalOpsCost
  const opsMargin = totalOpsRevenue > 0 ? totalOpsProfit / totalOpsRevenue : 0
  // マイスター集計（代走による原価削減効果）
  const totalMeister = rows.reduce((s, r) => s + (plan.meisterRevenueByMonth?.[r.month] ?? 0), 0)
  const totalMeisterCostSaving = rows.reduce(
    (s, r) => s + meisterCostSavingAt(plan, r.month, plan.meisterRevenueByMonth?.[r.month] ?? 0),
    0,
  )
  // 含マイスター（会計/P&L 整合）: 売上は変わらず、粗利だけ増える
  const totalRevenue = totalOpsRevenue
  const totalProfit = totalOpsProfit + totalMeisterCostSaving
  const avgMargin = totalRevenue > 0 ? totalProfit / totalRevenue : 0

  // 年度予算
  const budgetRevTotal = useMemo(
    () => rows.reduce((s, r) => s + budgetRevenueOf(plan, r.month), 0),
    [rows, plan],
  )
  const budgetProfitTotal = useMemo(
    () => rows.reduce((s, r) => s + budgetProfitOf(plan, r.month), 0),
    [rows, plan],
  )
  const budgetMargin = budgetRevTotal > 0 ? budgetProfitTotal / budgetRevTotal : 0
  const hasBudget = budgetRevTotal > 0

  // 前年実績
  const py = plan.priorYear
  const priorSeries = useMemo(
    () => (py ? computePriorYearMonthlySeries(py) : []),
    [py],
  )
  const priorLookup = useMemo(() => {
    const m = new Map<string, { revenue: number; grossProfit: number }>()
    if (py) {
      for (const d of py.monthlyData) {
        m.set(d.month, { revenue: d.revenue ?? 0, grossProfit: d.grossProfit ?? 0 })
      }
    }
    return m
  }, [py])
  const hasPriorYear = priorLookup.size > 0
  const priorLast = useMemo(
    () => (py ? estimatePriorYearLastMonthUnitPrice(py) : null),
    [py],
  )

  // FY2025 前年 合計
  const priorRevTotal = priorSeries.reduce((s, r) => s + r.revenue, 0)
  const priorProfitTotal = priorSeries.reduce((s, r) => s + r.grossProfit, 0)

  // 平均日計（FY2026 計画 & FY2025 実績）
  const currentAvgDaily = useMemo(() => {
    let sumRev = 0, sumDays = 0
    for (const r of rows) {
      sumRev += r.totalRevenue
      sumDays += workingDaysOf(plan, r.month)
    }
    return sumDays > 0 ? sumRev / sumDays : 0
  }, [rows, plan])

  const priorAvgDaily = useMemo(() => {
    if (priorSeries.length === 0) return 0
    let sumRev = 0, sumDays = 0
    for (const r of priorSeries) {
      sumRev += r.revenue
      sumDays += r.workingDays
    }
    return sumDays > 0 ? sumRev / sumDays : 0
  }, [priorSeries])

  const currentFY = fiscalYearLabel(plan.baseMonth)
  const priorFY = py?.fiscalYear || '前年'

  // ------ 24ヶ月連続タイムライン（日計 + 粗利率） ------
  const timelineData = useMemo(() => {
    const data: any[] = []
    // 前月値を保持して差額計算
    let prevCurrentDaily: number | null = null
    let prevPriorDaily: number | null = null
    // 前年
    for (const r of priorSeries) {
      const daily = Math.round(r.daily)
      data.push({
        ym: r.month,
        label: shortYm(r.month),
        fy: priorFY,
        日計前年: daily,
        日計当年: null,
        粗利率前年: Math.round(r.margin * 1000) / 10,
        粗利率当年: null,
        delta前年: prevPriorDaily != null ? daily - prevPriorDaily : null,
        delta当年: null,
      })
      prevPriorDaily = daily
    }
    // 当年（新モデル: 売上は案件プール不変、粗利はマイスター原価減を加算）
    for (const r of rows) {
      const days = workingDaysOf(plan, r.month)
      const meister = plan.meisterRevenueByMonth?.[r.month] ?? 0
      const costSaving = meisterCostSavingAt(plan, r.month, meister)
      const daily = days > 0 ? Math.round(r.totalRevenue / days) : 0  // 売上=プール不変
      const marginIncl = r.totalRevenue > 0 ? (r.totalProfit + costSaving) / r.totalRevenue : r.margin
      data.push({
        ym: r.month,
        label: shortYm(r.month),
        fy: currentFY,
        日計前年: null,
        日計当年: daily,
        粗利率前年: null,
        粗利率当年: Math.round(marginIncl * 1000) / 10,
        delta前年: null,
        delta当年: prevCurrentDaily != null ? daily - prevCurrentDaily : null,
      })
      prevCurrentDaily = daily
    }
    return data
  }, [priorSeries, rows, plan, currentFY, priorFY])

  // ------ 同月比較（fiscal month axis） 日計トレンド（新モデル: 案件プール不変、マイスターは売上に影響しない） ------
  const fiscalTrendData = useMemo(() => {
    // 第一パス: 日計を算出
    const raw = rows.map((r) => {
      const days = workingDaysOf(plan, r.month)
      const currentDaily = days > 0 ? Math.round(r.totalRevenue / days) : 0
      const pyKey = priorYm(r.month)
      const pyRow = priorSeries.find((x) => x.month === pyKey)
      const priorDaily = pyRow ? Math.round(pyRow.daily) : null
      const delta = priorDaily != null ? currentDaily - priorDaily : null
      const { month1 } = parseYm(r.month)
      return { r, month1, currentDaily, priorDaily, delta }
    })
    // 4月（当年/前年）基準値
    const aprilCurrent = raw[0]?.currentDaily ?? 0
    const aprilPrior = raw[0]?.priorDaily ?? null
    return raw.map((x) => ({
      fm: `${x.month1}月`,
      [currentFY]: x.currentDaily,
      [priorFY]: x.priorDaily,
      前月差: x.delta,
      vs4月_当年: aprilCurrent > 0 ? x.currentDaily - aprilCurrent : null,
      vs4月_前年: aprilPrior != null && x.priorDaily != null ? x.priorDaily - aprilPrior : null,
    }))
  }, [rows, priorSeries, plan, currentFY, priorFY])

  // ------ 同月比較 粗利率トレンド（新モデル: マイスターは原価削減、売上は不変） ------
  const fiscalMarginData = useMemo(() => {
    const raw = rows.map((r) => {
      const meister = plan.meisterRevenueByMonth?.[r.month] ?? 0
      const costSaving = meisterCostSavingAt(plan, r.month, meister)
      const currentMargin = r.totalRevenue > 0 ? (r.totalProfit + costSaving) / r.totalRevenue : r.margin
      const pyKey = priorYm(r.month)
      const pyRow = priorSeries.find((x) => x.month === pyKey)
      const priorMargin = pyRow ? pyRow.margin : null
      const delta = priorMargin != null ? currentMargin - priorMargin : null
      const { month1 } = parseYm(r.month)
      return { month1, currentMargin, priorMargin, delta }
    })
    const aprilCurrent = raw[0]?.currentMargin ?? 0
    const aprilPrior = raw[0]?.priorMargin ?? null
    return raw.map((x) => ({
      fm: `${x.month1}月`,
      [currentFY]: Math.round(x.currentMargin * 1000) / 10,
      [priorFY]: x.priorMargin != null ? Math.round(x.priorMargin * 1000) / 10 : null,
      前月差: x.delta != null ? Math.round(x.delta * 1000) / 10 : null,
      vs4月_当年: aprilCurrent > 0 ? Math.round((x.currentMargin - aprilCurrent) * 1000) / 10 : null,
      vs4月_前年: aprilPrior != null && x.priorMargin != null
        ? Math.round((x.priorMargin - aprilPrior) * 1000) / 10 : null,
    }))
  }, [rows, priorSeries, plan, currentFY, priorFY])

  // ------ 日計/粗利率 の共通 Y軸 domain（前年同月・24ヶ月連続 で共通化） ------
  const dailyDomain = useMemo<[number | string, number | string]>(() => {
    const vals: number[] = []
    for (const d of fiscalTrendData) {
      const v1 = (d as any)[currentFY]
      const v2 = (d as any)[priorFY]
      if (typeof v1 === 'number') vals.push(v1)
      if (typeof v2 === 'number') vals.push(v2)
    }
    for (const d of timelineData) {
      if (typeof d.日計前年 === 'number') vals.push(d.日計前年)
      if (typeof d.日計当年 === 'number') vals.push(d.日計当年)
    }
    if (vals.length === 0) return ['auto', 'auto']
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || max * 0.05
    return [Math.max(0, Math.floor((min - pad) / 1000000) * 1000000), Math.ceil((max + pad) / 1000000) * 1000000]
  }, [fiscalTrendData, timelineData, currentFY, priorFY])

  // 粗利率は 22%〜25% 固定、0.5% 刻みのグリッド
  const marginDomain: [number, number] = [22, 25]
  const marginTicks = [22, 22.5, 23, 23.5, 24, 24.5, 25]

  // ------ 案件数推移（24ヶ月連続 + 構成比overlay） ------
  const countTimelineData = useMemo(() => {
    const data: any[] = []
    for (const r of priorSeries) {
      const total = r.endCounts.partner + r.endCounts.vendor + r.endCounts.employment
      data.push({
        ym: r.month,
        label: shortYm(r.month),
        運送店: r.endCounts.partner,
        業者: r.endCounts.vendor,
        社員: r.endCounts.employment,
        運送店率: total > 0 ? Math.round(r.endCounts.partner / total * 1000) / 10 : 0,
        業者率: total > 0 ? Math.round(r.endCounts.vendor / total * 1000) / 10 : 0,
      })
    }
    for (const r of rows) {
      const p = r.byCategory.partner.count
      const v = r.byCategory.vendor.count
      const e = r.byCategory.employment.count
      const total = p + v + e
      data.push({
        ym: r.month,
        label: shortYm(r.month),
        運送店: p,
        業者: v,
        社員: e,
        運送店率: total > 0 ? Math.round(p / total * 1000) / 10 : 0,
        業者率: total > 0 ? Math.round(v / total * 1000) / 10 : 0,
      })
    }
    return data
  }, [priorSeries, rows])

  // ------ 配車比率 多角分析（24ヶ月連続） ------
  const dispatchAnalysisData = useMemo(() => {
    const data: any[] = []

    // helper: 非対角 transfers の純流入/流出
    function transferNet(month: string, transfers: any[]): { partner: number; vendor: number; employment: number } {
      const net = { partner: 0, vendor: 0, employment: 0 }
      for (const t of transfers) {
        if (t.month === month && t.from !== t.to) {
          net[t.from as 'partner' | 'vendor' | 'employment'] -= t.count
          net[t.to as 'partner' | 'vendor' | 'employment'] += t.count
        }
      }
      return net
    }

    // FY2025
    for (const r of priorSeries) {
      const total = r.endCounts.partner + r.endCounts.vendor + r.endCounts.employment
      const acqTotal = r.acquisitionByCategory.partner + r.acquisitionByCategory.vendor + r.acquisitionByCategory.employment
      const termTotal = r.terminationByCategory.partner + r.terminationByCategory.vendor + r.terminationByCategory.employment
      const tnet = plan.priorYear ? transferNet(r.month, plan.priorYear.transfers) : { partner: 0, vendor: 0, employment: 0 }
      data.push({
        ym: r.month,
        label: shortYm(r.month),
        fy: priorFY,
        isPrior: true,
        // プール構成比 (%)
        pool運送店: total > 0 ? Math.round(r.endCounts.partner / total * 1000) / 10 : 0,
        pool業者: total > 0 ? Math.round(r.endCounts.vendor / total * 1000) / 10 : 0,
        pool社員: total > 0 ? Math.round(r.endCounts.employment / total * 1000) / 10 : 0,
        // 獲得分布 (%)
        acq運送店: acqTotal > 0 ? Math.round(r.acquisitionByCategory.partner / acqTotal * 1000) / 10 : 0,
        acq業者: acqTotal > 0 ? Math.round(r.acquisitionByCategory.vendor / acqTotal * 1000) / 10 : 0,
        acq社員: acqTotal > 0 ? Math.round(r.acquisitionByCategory.employment / acqTotal * 1000) / 10 : 0,
        // 終了分布 (%)
        term運送店: termTotal > 0 ? Math.round(r.terminationByCategory.partner / termTotal * 1000) / 10 : 0,
        term業者: termTotal > 0 ? Math.round(r.terminationByCategory.vendor / termTotal * 1000) / 10 : 0,
        term社員: termTotal > 0 ? Math.round(r.terminationByCategory.employment / termTotal * 1000) / 10 : 0,
        // 純増 by cat (件数、+/-)
        net運送店: r.acquisitionByCategory.partner - r.terminationByCategory.partner,
        net業者: r.acquisitionByCategory.vendor - r.terminationByCategory.vendor,
        net社員: r.acquisitionByCategory.employment - r.terminationByCategory.employment,
        // 入替 非対角 純流入 (+流入 / -流出)
        tx運送店: tnet.partner,
        tx業者: tnet.vendor,
        tx社員: tnet.employment,
        // 参考
        total: total,
        acqTotal,
        termTotal,
      })
    }

    // FY2026
    for (const r of rows) {
      const p = r.byCategory.partner.count
      const v = r.byCategory.vendor.count
      const e = r.byCategory.employment.count
      const total = p + v + e
      const acqP = r.byCategory.partner.newCases
      const acqV = r.byCategory.vendor.newCases
      const acqE = r.byCategory.employment.newCases
      const termP = r.byCategory.partner.endingCases
      const termV = r.byCategory.vendor.endingCases
      const termE = r.byCategory.employment.endingCases
      const acqTotal = acqP + acqV + acqE
      const termTotal = termP + termV + termE
      const tnet = transferNet(r.month, plan.transfers)
      data.push({
        ym: r.month,
        label: shortYm(r.month),
        fy: currentFY,
        isPrior: false,
        pool運送店: total > 0 ? Math.round(p / total * 1000) / 10 : 0,
        pool業者: total > 0 ? Math.round(v / total * 1000) / 10 : 0,
        pool社員: total > 0 ? Math.round(e / total * 1000) / 10 : 0,
        acq運送店: acqTotal > 0 ? Math.round(acqP / acqTotal * 1000) / 10 : 0,
        acq業者: acqTotal > 0 ? Math.round(acqV / acqTotal * 1000) / 10 : 0,
        acq社員: acqTotal > 0 ? Math.round(acqE / acqTotal * 1000) / 10 : 0,
        term運送店: termTotal > 0 ? Math.round(termP / termTotal * 1000) / 10 : 0,
        term業者: termTotal > 0 ? Math.round(termV / termTotal * 1000) / 10 : 0,
        term社員: termTotal > 0 ? Math.round(termE / termTotal * 1000) / 10 : 0,
        net運送店: acqP - termP,
        net業者: acqV - termV,
        net社員: acqE - termE,
        tx運送店: tnet.partner,
        tx業者: tnet.vendor,
        tx社員: tnet.employment,
        total,
        acqTotal,
        termTotal,
      })
    }
    return data
  }, [priorSeries, rows, plan, priorFY, currentFY])

  // ------ FY2025 獲得/終了/純増減（12ヶ月） ------
  const priorAcqData = useMemo(
    () => priorSeries.map((r) => ({ label: `${parseYm(r.month).month1}月`, 獲得: r.acquisition })),
    [priorSeries],
  )
  const priorTermData = useMemo(
    () => priorSeries.map((r) => ({ label: `${parseYm(r.month).month1}月`, 終了: r.termination })),
    [priorSeries],
  )
  const priorNetData = useMemo(
    () => priorSeries.map((r) => ({ label: `${parseYm(r.month).month1}月`, 純増減: r.net })),
    [priorSeries],
  )

  // ------ FY2026 獲得/終了/純増減（12ヶ月） ------
  const currentAcqData = useMemo(
    () => rows.map((r) => ({ label: `${parseYm(r.month).month1}月`, 獲得: r.newTotal })),
    [rows],
  )
  const currentTermData = useMemo(
    () => rows.map((r) => ({ label: `${parseYm(r.month).month1}月`, 終了: r.endTotal })),
    [rows],
  )
  const currentNetData = useMemo(
    () => rows.map((r) => ({ label: `${parseYm(r.month).month1}月`, 純増減: r.newTotal - r.endTotal })),
    [rows],
  )

  // ------ 粗利率ブリッジ（月次 pt 分解） ------
  const currentBridge = useMemo(() => computeMarginBridge(plan), [plan])
  const priorBridge = useMemo(
    () => (py ? computePriorYearMarginBridge(py, plan) : []),
    [py, plan],
  )
  const bridgeTimeline: MarginBridgeRow[] = useMemo(
    () => [...priorBridge, ...currentBridge],
    [priorBridge, currentBridge],
  )
  // ブリッジ Chart 用データ（分解バー + 実効粗利率ライン）
  const bridgeChartData = useMemo(() => {
    return bridgeTimeline.map((b) => ({
      ym: b.month,
      label: shortYm(b.month),
      fy: b.fy === 'current' ? currentFY : priorFY,
      ベース: Math.round(b.baseMargin * 1000) / 10,
      期首ベース: Math.round(b.initialMarginRef * 1000) / 10,
      獲得終了影響: Math.round(b.acqtermPt * 1000) / 10,
      入替影響: Math.round(b.transferPt * 1000) / 10,
      単価UP影響: Math.round(b.priceupPt * 1000) / 10,
      uplift影響: Math.round(b.upliftPt * 1000) / 10,
      マイスター影響: Math.round(b.meisterPt * 1000) / 10,
      実効粗利率: Math.round(b.effectiveMargin * 1000) / 10,
      実効粗利率含M: Math.round(b.marginWithMeister * 1000) / 10,
      運送店: Math.round(b.sharePartner * 10) / 10,
      業者: Math.round(b.shareVendor * 10) / 10,
      社員: Math.round(b.shareEmployment * 10) / 10,
      獲得: b.acquisition,
      終了: b.termination,
      upliftCost: b.upliftCost,
      priceupRev: b.priceupRevenue,
      priceupCost: b.priceupCost,
      meisterRev: b.meisterRevenue,
    }))
  }, [bridgeTimeline, currentFY, priorFY])
  const bridgeHasData = bridgeTimeline.some((b) => b.totalRevenue > 0)

  // ------ 24ヶ月 売上・粗利 額（運営+マイスター 積み上げ） ------
  const amountsData = useMemo(() => {
    const data: any[] = []
    // 新モデル: 売上は案件プール（meister内数）。バーの stack を 期首/純増/単価UP/コホート に分解
    // 粗利は pt × totalRevenue で yen 換算して分解
    for (const b of priorBridge) {
      const totRev = b.totalRevenue
      const costSaving = b.profitWithMeister - b.totalProfit
      const totProfit = b.profitWithMeister
      // 粗利分解（pt × totalRevenue で yen換算）
      const initialProfit = b.initialMarginRef * totRev
      const acqtermProfit = b.acqtermPt * totRev
      const transferProfit = b.transferPt * totRev
      const priceupProfit = b.priceupPt * totRev
      const upliftProfitImpact = b.upliftPt * totRev  // 通常負
      const meisterProfitImpact = b.meisterPt * totRev  // 通常正
      data.push({
        ym: b.month,
        label: shortYm(b.month),
        fy: priorFY,
        isPrior: true,
        期首ベース売上: Math.round(b.baseRevenue),
        純増分売上: 0,
        単価UP売上: 0,
        コホート売上: 0,
        単価改定売上: 0,
        合計売上: Math.round(totRev),
        マイスター売上: Math.round(b.meisterRevenue),
        運営粗利: Math.round(b.totalProfit),
        マイスター原価減: Math.round(costSaving),
        合計粗利: Math.round(totProfit),
        最終粗利率: totRev > 0 ? Math.round((totProfit / totRev) * 1000) / 10 : 0,
        予算売上: null,
        予算粗利: null,
        // 粗利分解
        期首ベース粗利: Math.round(initialProfit),
        獲得終了粗利影響: Math.round(acqtermProfit),
        入替粗利影響: Math.round(transferProfit),
        単価UP粗利: Math.round(priceupProfit),
        改定粗利影響: 0,
        uplift粗利影響: Math.round(upliftProfitImpact),
        マイスター粗利影響: Math.round(meisterProfitImpact),
        原価改定影響額: 0,
      })
    }
    // 期首件数
    const initialTotal =
      plan.initialCounts.partner + plan.initialCounts.vendor + plan.initialCounts.employment
    for (const b of currentBridge) {
      const budRev = budgetRevenueOf(plan, b.month)
      const budProf = budgetProfitOf(plan, b.month)
      const totRev = b.totalRevenue
      const costSaving = b.profitWithMeister - b.totalProfit
      const totProfit = b.profitWithMeister

      // 売上分解（FY2026）
      const days = b.workingDays
      const revPC = plan.revenuePerCase ?? 0
      const baseInitial = initialTotal * revPC * days              // 期首件数 × 単価 × 日数
      const baseCurrent = b.baseRevenue                            // currentCounts × 単価 × 日数 (includes rounding per cat)
      const netChange = baseCurrent - baseInitial                  // 純増分売上（件数増減由来）
      const priceup = b.priceupRevenue
      const cohort = b.cohortRevenueDelta
      const priceRevRev = b.priceRevRevenue
      const costRev = b.costRevCost
      // 粗利分解（pt × totalRevenue で yen換算）
      const initialProfit = b.initialMarginRef * totRev
      const acqtermProfit = b.acqtermPt * totRev
      const transferProfit = b.transferPt * totRev
      const priceupProfit = b.priceupPt * totRev
      const revisionProfit = b.revisionPt * totRev   // 改定による粗利寄与
      const upliftProfitImpact = b.upliftPt * totRev  // 通常負
      const meisterProfitImpact = b.meisterPt * totRev  // 通常正
      data.push({
        ym: b.month,
        label: shortYm(b.month),
        fy: currentFY,
        isPrior: false,
        期首ベース売上: Math.round(baseInitial),
        純増分売上: Math.round(netChange),
        単価UP売上: Math.round(priceup),
        コホート売上: Math.round(cohort),
        単価改定売上: Math.round(priceRevRev),
        合計売上: Math.round(totRev),
        マイスター売上: Math.round(b.meisterRevenue),
        運営粗利: Math.round(b.totalProfit),
        マイスター原価減: Math.round(costSaving),
        合計粗利: Math.round(totProfit),
        最終粗利率: totRev > 0 ? Math.round((totProfit / totRev) * 1000) / 10 : 0,
        予算売上: budRev > 0 ? budRev : null,
        予算粗利: budProf > 0 ? budProf : null,
        // 粗利分解
        期首ベース粗利: Math.round(initialProfit),
        獲得終了粗利影響: Math.round(acqtermProfit),
        入替粗利影響: Math.round(transferProfit),
        単価UP粗利: Math.round(priceupProfit),
        改定粗利影響: Math.round(revisionProfit),
        uplift粗利影響: Math.round(upliftProfitImpact),
        マイスター粗利影響: Math.round(meisterProfitImpact),
        // 参考
        原価改定影響額: Math.round(costRev),
      })
    }
    return data
  }, [priorBridge, currentBridge, plan, priorFY, currentFY])

  // ------ KPI 計算 ------
  const revGap = totalRevenue - budgetRevTotal
  const profitGap = totalProfit - budgetProfitTotal
  const marginGap = avgMargin - budgetMargin
  const dailyYoY = priorAvgDaily > 0 ? currentAvgDaily / priorAvgDaily : 0

  return (
    <div>
      {/* ==== 1段目: KPI ==== */}
      <div className="kpi-grid">
        <KpiStructured
          label={`${currentFY} 売上計画`}
          value={`¥${yen(totalRevenue)}`}
          budget={hasBudget ? `¥${yen(budgetRevTotal)}` : undefined}
          rate={hasBudget && budgetRevTotal > 0 ? totalRevenue / budgetRevTotal : undefined}
          gap={hasBudget ? revGap : undefined}
          extraSub={totalMeister > 0 ? `案件プール売上（マイスター ¥${yen(totalMeister)} は代走分で内数）` : undefined}
        />
        <KpiStructured
          label={`${currentFY} 粗利計画（含マイスター効果）`}
          value={`¥${yen(totalProfit)}`}
          budget={hasBudget && budgetProfitTotal !== 0 ? `¥${yen(budgetProfitTotal)}` : undefined}
          rate={hasBudget && budgetProfitTotal !== 0 ? totalProfit / budgetProfitTotal : undefined}
          gap={hasBudget && budgetProfitTotal !== 0 ? profitGap : undefined}
          extraSub={totalMeisterCostSaving > 0 ? `運営粗利 ¥${yen(totalOpsProfit)} + マイスター原価減 ¥${yen(totalMeisterCostSaving)}` : undefined}
        />
        <KpiStructured
          label={`${currentFY} 粗利率計画（含マイスター効果）`}
          value={percent(avgMargin)}
          budget={hasBudget && budgetMargin > 0 ? percent(budgetMargin) : undefined}
          rate={undefined}
          gapText={hasBudget && budgetMargin > 0
            ? `${marginGap >= 0 ? '+' : ''}${(marginGap * 100).toFixed(1)} pt`
            : undefined}
          gapColor={marginGap >= 0 ? '#16a34a' : '#dc2626'}
          extraSub={totalMeisterCostSaving > 0 ? `運営のみ ${percent(opsMargin)} / マイスター効果 +${((avgMargin - opsMargin) * 100).toFixed(2)}pt` : undefined}
        />
        <KpiStructured
          label={`平均 日計（月平均ベース）`}
          value={`¥${yen(Math.round(currentAvgDaily))}/日`}
          budget={priorAvgDaily > 0 ? `¥${yen(Math.round(priorAvgDaily))}/日` : undefined}
          budgetLabel="前年"
          rate={dailyYoY || undefined}
          rateLabel="対前年"
          gap={priorAvgDaily > 0 ? Math.round(currentAvgDaily - priorAvgDaily) : undefined}
          gapUnit="/日"
        />
      </div>

      {/* ==== 1.5段目: パラメータ集約カード ==== */}
      <ParamCardsRow plan={plan} priorFY={priorFY} currentFY={currentFY} />

      {/* ==== 2段目: 直近実績 ==== */}
      {priorLast && (
        <div className="card" style={{ background: '#ede9fe', borderColor: '#c4b5fd' }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ margin: 0, color: '#5b21b6' }}>
                直近実績：{priorLast.month}（{currentFY} 開始直前月）
              </h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {currentFY} 以降の連続性をチェックする基準値。
                <strong>reported 基準</strong>（会計実績＝案件プール、マイスター代走も内数）で表示。
              </div>
            </div>
          </div>
          <div className="kpi-grid" style={{ marginTop: 10 }}>
            <Kpi
              label="日計（reported）"
              value={`¥${yen(Math.round((priorLast.reportedUnitPrice * priorLast.avgCount)))}/日`}
              sub={`会計売上 ÷ 営業日数 = 案件プール日計`}
            />
            <Kpi
              label="1日単価 reported"
              value={`¥${yen(Math.round(priorLast.reportedUnitPrice))}/日`}
              sub={`ops基準 ¥${yen(Math.round(priorLast.opsUnitPrice))}/日 ・ 平均件数 ${Math.round(priorLast.avgCount).toLocaleString()}件`}
            />
            <Kpi label="粗利率（reported）" value={percent(priorLast.margin)} sub="マイスター代走効果 込み" />
            <Kpi label="営業日数" value={`${priorLast.workingDays} 日`} sub="前年最終月" />
          </div>
        </div>
      )}

      {/* ==== 3段目: 日計 + 粗利率 同月比較（2列） + 連続タイムライン ==== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* 3-A 日計トレンド（前年vs当年の同月比較） */}
        <div className="card" style={{ margin: 0 }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14 }}>💴 日計トレンド（前年同月比較）</h3>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                1日あたり売上（マイスター込み）
              </div>
            </div>
            <div className="row" style={{ gap: 10, fontSize: 11 }}>
              {hasPriorYear && <span><i style={{ background: REVENUE_COLOR_LIGHT, display: 'inline-block', width: 12, height: 2, marginRight: 4 }} />{priorFY} 実線</span>}
              <span><i style={{ background: 'transparent', borderTop: `2px dashed ${REVENUE_COLOR_DARK}`, display: 'inline-block', width: 12, height: 0, marginRight: 4 }} />{currentFY} 点線</span>
            </div>
          </div>
          <div style={{ width: '100%', height: 280, marginTop: 10 }}>
            <ResponsiveContainer>
              <LineChart data={fiscalTrendData}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="fm" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`} domain={dailyDomain} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                  formatter={(value: any, name: any, props: any) => {
                    if (value == null) return ['—', name]
                    if (name === '前月差' || name === 'vs4月_当年' || name === 'vs4月_前年') return null as any
                    const p = props?.payload ?? {}
                    const isCurrent = name === currentFY
                    const vs4 = isCurrent ? p.vs4月_当年 : p.vs4月_前年
                    const vs4Str = vs4 != null
                      ? ` [vs 4月 ${vs4 >= 0 ? '+' : ''}¥${yen(vs4)}]`
                      : ''
                    const delta = p.前月差
                    const deltaStr = isCurrent && delta != null ? ` (前年差 ${delta >= 0 ? '+' : ''}¥${yen(delta)})` : ''
                    return [`¥${yen(Number(value))}/日${deltaStr}${vs4Str}`, name]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {hasPriorYear && <Line type="monotone" dataKey={priorFY} stroke={REVENUE_COLOR_LIGHT} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />}
                <Line type="monotone" dataKey={currentFY} stroke={REVENUE_COLOR_DARK} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3-A' 粗利率トレンド（前年vs当年の同月比較） */}
        <div className="card" style={{ margin: 0 }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14 }}>📈 粗利率トレンド（前年同月比較）</h3>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                最終粗利率（マイスター込み）
              </div>
            </div>
            <div className="row" style={{ gap: 10, fontSize: 11 }}>
              {hasPriorYear && <span><i style={{ background: PROFIT_COLOR_LIGHT, display: 'inline-block', width: 12, height: 2, marginRight: 4 }} />{priorFY} 実線</span>}
              <span><i style={{ background: 'transparent', borderTop: `2px dashed ${PROFIT_COLOR_DARK}`, display: 'inline-block', width: 12, height: 0, marginRight: 4 }} />{currentFY} 点線</span>
            </div>
          </div>
          <div style={{ width: '100%', height: 280, marginTop: 10 }}>
            <ResponsiveContainer>
              <LineChart data={fiscalMarginData}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="fm" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} unit="%" domain={marginDomain} ticks={marginTicks} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                  formatter={(value: any, name: any, props: any) => {
                    if (value == null) return ['—', name]
                    if (name === '前月差' || name === 'vs4月_当年' || name === 'vs4月_前年') return null as any
                    const p = props?.payload ?? {}
                    const isCurrent = name === currentFY
                    const vs4 = isCurrent ? p.vs4月_当年 : p.vs4月_前年
                    const vs4Str = vs4 != null
                      ? ` [vs 4月 ${vs4 >= 0 ? '+' : ''}${Number(vs4).toFixed(2)}pt]`
                      : ''
                    const delta = p.前月差
                    const deltaStr =
                      isCurrent && delta != null
                        ? ` (前年差 ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pt)`
                        : ''
                    return [`${Number(value).toFixed(2)}%${deltaStr}${vs4Str}`, name]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {hasPriorYear && <Line type="monotone" dataKey={priorFY} stroke={PROFIT_COLOR_LIGHT} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />}
                <Line type="monotone" dataKey={currentFY} stroke={PROFIT_COLOR_DARK} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 3-B 連続タイムライン（24月）— 日計 / 粗利率 を左右に分割 */}
      {hasPriorYear && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* 左: 日計 24ヶ月連続 */}
          <div className="card" style={{ margin: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>💴 日計 24ヶ月連続</h3>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {priorFY} 実績 → {currentFY} 計画。{priorLast?.month ?? '前年末'} と当年4月の段差に注目。
            </div>
            <div style={{ width: '100%', height: 240, marginTop: 10 }}>
              <ResponsiveContainer>
                <LineChart data={timelineData}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`} domain={dailyDomain} />
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                    formatter={(value: any, name: any) => value == null ? ['—', name] : [`¥${yen(Number(value))}/日`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="日計前年" name={`${priorFY} 日計`} stroke={REVENUE_COLOR_LIGHT} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="日計当年" name={`${currentFY} 日計`} stroke={REVENUE_COLOR_DARK} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* 右: 粗利率 24ヶ月連続 */}
          <div className="card" style={{ margin: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>📈 粗利率 24ヶ月連続</h3>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              両年ともマイスター込みの最終粗利率で描画。
            </div>
            <div style={{ width: '100%', height: 240, marginTop: 10 }}>
              <ResponsiveContainer>
                <LineChart data={timelineData}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={11} unit="%" domain={marginDomain} ticks={marginTicks} />
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                    formatter={(value: any, name: any) => value == null ? ['—', name] : [`${Number(value).toFixed(2)}%`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="粗利率前年" name={`${priorFY} 粗利率`} stroke={PROFIT_COLOR_LIGHT} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="粗利率当年" name={`${currentFY} 粗利率`} stroke={PROFIT_COLOR_DARK} strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ==== 4段目-0: 月次 売上・粗利 額（24ヶ月 運営+マイスター積み上げ） ==== */}
      {bridgeHasData && (
        <>
          <div className="card">
            <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>💴 月次 売上（24ヶ月連続・運営 + マイスター 積み上げ）</h3>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  売上 = <strong>期首件数×単価</strong> + <strong>純増分</strong> + <strong>単価UP</strong> + <strong>コホート</strong>（単価改定分）の積み上げ。
                  マイスター代走分は <strong>内数</strong>（tooltip 参照）。赤点線=予算売上。
                </div>
              </div>
              <div className="row" style={{ gap: 12, fontSize: 11 }}>
                <span><i style={{ background: REVENUE_COLOR_LIGHT, width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />{priorFY} 実績</span>
                <span><i style={{ background: REVENUE_COLOR_DARK, width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />{currentFY} 期首ベース</span>
                <span><i style={{ background: '#fbbf24', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />純増分</span>
                <span><i style={{ background: '#a78bfa', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />単価UP</span>
                <span><i style={{ background: '#f472b6', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />コホート</span>
                <span><i style={{ background: '#06b6d4', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />改定</span>
              </div>
            </div>
            <div style={{ width: '100%', height: 340, marginTop: 10 }}>
              <ResponsiveContainer>
                <ComposedChart data={amountsData}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" tickFormatter={(v) => `${(v / 100000000).toFixed(1)}億`} />
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                    formatter={(value: any, name: any) => {
                      if (value == null) return ['—', name]
                      return [`¥${yen(Math.round(Number(value)))}`, name]
                    }}
                    labelFormatter={(label: any, payload: any) => {
                      const p = payload?.[0]?.payload
                      if (!p) return label
                      const meister = p.マイスター売上 ?? 0
                      const total = p.合計売上 ?? 0
                      return `${label} (${p.fy}) — 計 ¥${yen(total)}${meister > 0 ? `（うちマイスター代走 ¥${yen(meister)}）` : ''}`
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="期首ベース売上"
                    stackId="rev"
                    name="期首ベース売上"
                    fill="#94a3b8"
                  >
                    {amountsData.map((d, i) => (
                      <Cell key={i} fill={d.isPrior ? REVENUE_COLOR_LIGHT : REVENUE_COLOR_DARK} />
                    ))}
                  </Bar>
                  <Bar dataKey="純増分売上" stackId="rev" name="純増分売上（件数変動）" fill="#fbbf24" />
                  <Bar dataKey="単価UP売上" stackId="rev" name="単価UP売上（累計）" fill="#a78bfa" />
                  <Bar dataKey="コホート売上" stackId="rev" name="コホート売上（獲得単価差）" fill="#f472b6" />
                  <Bar dataKey="単価改定売上" stackId="rev" name="単価改定売上（部分改定）" fill="#06b6d4" />
                  <Line type="monotone" dataKey="予算売上" name="予算売上" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>💰 月次 粗利（内訳 ± 表示／最終粗利率ライン）</h3>
                <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
                  粗利 = <strong>期首ベース</strong> ± <strong>獲得終了ミックス</strong> ± <strong>入替ミックス</strong> +{' '}
                  <strong>単価UP</strong> − <strong>同区分uplift</strong> + <strong>マイスター原価減</strong>。
                  マイナス寄与は 0軸の下に伸びます。右軸=最終粗利率%。
                </div>
              </div>
              <div className="row" style={{ gap: 10, fontSize: 11, flexWrap: 'wrap' }}>
                <span><i style={{ background: PROFIT_COLOR_LIGHT, width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />{priorFY} 期首</span>
                <span><i style={{ background: PROFIT_COLOR_DARK, width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />{currentFY} 期首</span>
                <span><i style={{ background: '#64748b', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />獲得終了</span>
                <span><i style={{ background: '#9333ea', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />入替</span>
                <span><i style={{ background: '#fbbf24', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />単価UP</span>
                <span><i style={{ background: '#06b6d4', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />改定</span>
                <span><i style={{ background: '#dc2626', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />uplift(−)</span>
                <span><i style={{ background: '#f59e0b', width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />マイスター</span>
                <span><i style={{ background: PROFIT_COLOR, width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 4 }} />最終粗利率</span>
              </div>
            </div>
            <div style={{ width: '100%', height: 380, marginTop: 10 }}>
              <ResponsiveContainer>
                <ComposedChart data={amountsData}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis yAxisId="left" stroke="#64748b" tickFormatter={(v) => `${(v / 100000000).toFixed(2)}億`} />
                  <YAxis yAxisId="right" orientation="right" stroke={PROFIT_COLOR} unit="%" domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                    formatter={(value: any, name: any) => {
                      if (value == null) return ['—', name]
                      if (name === '最終粗利率') return [`${value}%`, name]
                      const n = Number(value)
                      return [`${n >= 0 ? '' : '−'}¥${yen(Math.abs(Math.round(n)))}`, name]
                    }}
                    labelFormatter={(label: any, payload: any) => {
                      const p = payload?.[0]?.payload
                      if (!p) return label
                      const total = p.合計粗利 ?? 0
                      return `${label} (${p.fy}) — 計 ¥${yen(total)}`
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {/* 期首ベース粗利（メインスタック） FY色分け（粗利パレット: 濃/明） */}
                  <Bar yAxisId="left" dataKey="期首ベース粗利" stackId="profit" name="期首ベース粗利" fill="#94a3b8">
                    {amountsData.map((d, i) => (
                      <Cell key={i} fill={d.isPrior ? PROFIT_COLOR_LIGHT : PROFIT_COLOR_DARK} />
                    ))}
                  </Bar>
                  {/* 以下のスタックは +/- 両方取りうる */}
                  <Bar yAxisId="left" dataKey="獲得終了粗利影響" stackId="profit" name="獲得終了 ミックス影響" fill="#64748b" />
                  <Bar yAxisId="left" dataKey="入替粗利影響" stackId="profit" name="入替 ミックス影響" fill="#9333ea" />
                  <Bar yAxisId="left" dataKey="単価UP粗利" stackId="profit" name="単価UP 粗利" fill="#fbbf24" />
                  <Bar yAxisId="left" dataKey="uplift粗利影響" stackId="profit" name="同区分uplift 影響(−)" fill="#dc2626" />
                  <Bar yAxisId="left" dataKey="改定粗利影響" stackId="profit" name="改定（単価+/原価-） 粗利影響" fill="#06b6d4" />
                  <Bar yAxisId="left" dataKey="マイスター粗利影響" stackId="profit" name="マイスター 原価減" fill="#f59e0b" />
                  <Line yAxisId="left" type="monotone" dataKey="予算粗利" name="予算粗利" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls />
                  <Line yAxisId="right" type="monotone" dataKey="最終粗利率" name="最終粗利率" stroke={PROFIT_COLOR} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4, textAlign: 'center' }}>
              各スタックの合計 = 最終粗利（含マイスター）。マイナス値は 0軸の下に伸び、正味の貢献度が見えます。
            </div>
          </div>
        </>
      )}

      {/* ==== 4段目: 案件数推移（24ヶ月 + 配車比率overlay） ==== */}
      {hasPriorYear && (
        <div className="card">
          <h3 style={{ margin: 0 }}>案件数の推移（24ヶ月連続）＋ 運送店・業者の構成比</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            前年実績→当年計画を連続表示。積み上げは件数、ライン(右軸)は運送店・業者の構成比%。
          </div>
          <div style={{ width: '100%', height: 320, marginTop: 10 }}>
            <ResponsiveContainer>
              <ComposedChart data={countTimelineData}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                <YAxis yAxisId="left" stroke="#64748b" />
                <YAxis yAxisId="right" orientation="right" stroke="#64748b" unit="%" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                  formatter={(value: any, name: any) => {
                    if (value == null) return ['—', name]
                    if (typeof name === 'string' && name.endsWith('率')) return [`${value}%`, name]
                    return [`${Number(value).toLocaleString()}件`, name]
                  }}
                />
                <Legend />
                <Bar yAxisId="left" dataKey="運送店" stackId="count" fill={CATEGORY_COLORS.運送店} />
                <Bar yAxisId="left" dataKey="業者" stackId="count" fill={CATEGORY_COLORS.業者} />
                <Bar yAxisId="left" dataKey="社員" stackId="count" fill={CATEGORY_COLORS.社員} />
                <Line yAxisId="right" type="monotone" dataKey="運送店率" stroke="#1e40af" strokeWidth={2} dot={{ r: 2 }} />
                <Line yAxisId="right" type="monotone" dataKey="業者率" stroke="#5b21b6" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ==== 4-B: 配車比率 多角分析（24ヶ月連続） ==== */}
      {hasPriorYear && (
        <div className="card">
          <h3 style={{ margin: 0 }}>📊 配車比率 多角分析（24ヶ月連続）</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
            ①案件プール構成比 / ②獲得配車比率 / ③枠切配車比率 / ④純増（獲得−終了） / ⑤非対角入替によるカテゴリ間シフト を並列表示。
            <span style={{ color: '#2563eb' }}>■ 運送店</span>{' '}
            <span style={{ color: '#7c3aed' }}>■ 業者</span>{' '}
            <span style={{ color: '#059669' }}>■ 社員</span>
          </div>

          {/* ① プール構成比 (100% stacked) */}
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13, margin: '0 0 6px', color: '#475569' }}>① 案件プール構成比（期末件数の%）</h3>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={dispatchAnalysisData} stackOffset="expand">
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                    formatter={(value: any, name: any) => [`${value}%`, name]}
                    labelFormatter={(label: any, payload: any) => {
                      const p = payload?.[0]?.payload
                      return p ? `${label} (${p.fy}) — 計 ${p.total.toLocaleString()}件` : label
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="pool運送店" stackId="pool" name="運送店" fill="#2563eb" />
                  <Bar dataKey="pool業者" stackId="pool" name="業者" fill="#7c3aed" />
                  <Bar dataKey="pool社員" stackId="pool" name="社員" fill="#059669" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ②③ 獲得／終了 配車比率（100%） 2列 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
            <div>
              <h3 style={{ fontSize: 13, margin: '0 0 6px', color: '#166534' }}>② 新規獲得 配車比率（%）</h3>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
                  <BarChart data={dispatchAnalysisData} stackOffset="expand">
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                    <YAxis stroke="#64748b" fontSize={10} tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                      formatter={(value: any, name: any) => [`${value}%`, name]}
                      labelFormatter={(label: any, payload: any) => {
                        const p = payload?.[0]?.payload
                        return p ? `${label} (${p.fy}) — 獲得 ${p.acqTotal}件` : label
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="acq運送店" stackId="acq" name="運送店" fill="#2563eb" />
                    <Bar dataKey="acq業者" stackId="acq" name="業者" fill="#7c3aed" />
                    <Bar dataKey="acq社員" stackId="acq" name="社員" fill="#059669" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: 13, margin: '0 0 6px', color: '#991b1b' }}>③ 枠切（終了）配車比率（%）</h3>
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
                  <BarChart data={dispatchAnalysisData} stackOffset="expand">
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                    <YAxis stroke="#64748b" fontSize={10} tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                      formatter={(value: any, name: any) => [`${value}%`, name]}
                      labelFormatter={(label: any, payload: any) => {
                        const p = payload?.[0]?.payload
                        return p ? `${label} (${p.fy}) — 終了 ${p.termTotal}件` : label
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="term運送店" stackId="term" name="運送店" fill="#2563eb" />
                    <Bar dataKey="term業者" stackId="term" name="業者" fill="#7c3aed" />
                    <Bar dataKey="term社員" stackId="term" name="社員" fill="#059669" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ④ 純増（獲得−終了）件数 カテゴリ別 */}
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13, margin: '0 0 6px', color: '#0369a1' }}>④ 純増（獲得−終了）件数 カテゴリ別</h3>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={dispatchAnalysisData}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${v}件`} />
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                    formatter={(value: any, name: any) => [`${value >= 0 ? '+' : ''}${value}件`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="net運送店" name="運送店 純増" fill="#2563eb" />
                  <Bar dataKey="net業者" name="業者 純増" fill="#7c3aed" />
                  <Bar dataKey="net社員" name="社員 純増" fill="#059669" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              プラス=増員、マイナス=減員。社員は原則±0（同数原則）を目指す。
            </div>
          </div>

          {/* ⑤ 非対角入替による純シフト */}
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13, margin: '0 0 6px', color: '#6b21a8' }}>
              ⑤ 入替（非対角）によるカテゴリ間 純シフト
            </h3>
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={dispatchAnalysisData}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `${v}件`} />
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
                    formatter={(value: any, name: any) => [`${value >= 0 ? '+' : ''}${value}件`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="tx運送店" name="運送店 純流入" fill="#2563eb" />
                  <Bar dataKey="tx業者" name="業者 純流入" fill="#7c3aed" />
                  <Bar dataKey="tx社員" name="社員 純流入" fill="#059669" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              プラス=そのカテゴリに流入（例: 運送店に業者が移った）、マイナス=流出。同区分（R→R 等）は対象外。
            </div>
          </div>
        </div>
      )}

      {/* ==== 5段目: 獲得/終了/純増減（FY年ごとに分離 2段構成） ==== */}
      {hasPriorYear && (
        <>
          {/* FY2025 行 */}
          <div style={{
            background: '#f5f3ff',
            padding: '8px 14px',
            borderRadius: 8,
            margin: '16px 0 8px',
            color: '#5b21b6',
            fontSize: 13,
            fontWeight: 700,
          }}>
            {priorFY}（実績）
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="card">
              <h3 style={{ color: '#16a34a', margin: 0, fontSize: 13 }}>獲得 — {priorFY}</h3>
              <div style={{ width: '100%', height: 220, marginTop: 6 }}>
                <ResponsiveContainer>
                  <BarChart data={priorAcqData}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                      formatter={(v: any) => [`${v}件`, '獲得']} />
                    <Bar dataKey="獲得" fill="#86efac" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h3 style={{ color: '#dc2626', margin: 0, fontSize: 13 }}>終了 — {priorFY}</h3>
              <div style={{ width: '100%', height: 220, marginTop: 6 }}>
                <ResponsiveContainer>
                  <BarChart data={priorTermData}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                      formatter={(v: any) => [`${v}件`, '終了']} />
                    <Bar dataKey="終了" fill="#fca5a5" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h3 style={{ color: '#0ea5e9', margin: 0, fontSize: 13 }}>純増減 — {priorFY}</h3>
              <div style={{ width: '100%', height: 220, marginTop: 6 }}>
                <ResponsiveContainer>
                  <BarChart data={priorNetData}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                      formatter={(v: any) => [v > 0 ? `+${v}件` : `${v}件`, '純増減']} />
                    <Bar dataKey="純増減" fill="#bae6fd" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* FY2026 行 */}
          <div style={{
            background: '#ecfeff',
            padding: '8px 14px',
            borderRadius: 8,
            margin: '16px 0 8px',
            color: '#0369a1',
            fontSize: 13,
            fontWeight: 700,
          }}>
            {currentFY}（計画）
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="card">
              <h3 style={{ color: '#16a34a', margin: 0, fontSize: 13 }}>獲得 — {currentFY}</h3>
              <div style={{ width: '100%', height: 220, marginTop: 6 }}>
                <ResponsiveContainer>
                  <BarChart data={currentAcqData}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                      formatter={(v: any) => [`${v}件`, '獲得']} />
                    <Bar dataKey="獲得" fill="#16a34a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h3 style={{ color: '#dc2626', margin: 0, fontSize: 13 }}>終了 — {currentFY}</h3>
              <div style={{ width: '100%', height: 220, marginTop: 6 }}>
                <ResponsiveContainer>
                  <BarChart data={currentTermData}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                      formatter={(v: any) => [`${v}件`, '終了']} />
                    <Bar dataKey="終了" fill="#dc2626" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h3 style={{ color: '#0ea5e9', margin: 0, fontSize: 13 }}>純増減 — {currentFY}</h3>
              <div style={{ width: '100%', height: 220, marginTop: 6 }}>
                <ResponsiveContainer>
                  <BarChart data={currentNetData}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                      formatter={(v: any) => [v > 0 ? `+${v}件` : `${v}件`, '純増減']} />
                    <Bar dataKey="純増減" fill="#0ea5e9" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ==== マイスター効果の見える化 ==== */}
      {bridgeHasData && (
        <MeisterImpactSection
          priorRows={priorBridge}
          currentRows={currentBridge}
          priorFY={priorFY}
          currentFY={currentFY}
        />
      )}

      {/* ==== 6段目: 粗利率ブリッジ（月次・pt分解） ==== */}
      {bridgeHasData && (
        <MarginBridgeSection
          rows={bridgeTimeline}
          chartData={bridgeChartData}
          priorFY={priorFY}
          currentFY={currentFY}
        />
      )}

      {/* 前年実績未登録 */}
      {!hasPriorYear && (
        <div className="card muted" style={{ fontSize: 13 }}>
          前年実績（📆 前年実績画面）を登録すると、連続タイムライン・FY区分グラフなどが表示されます。
        </div>
      )}
    </div>
  )
}

/** 粗利率ブリッジ：月次の pt 分解を チャート + テーブルで表示 */
/** マイスター効果ダイレクト表示：売上・粗利率にマイスターがどれだけ寄与しているか */
function MeisterImpactSection({
  priorRows,
  currentRows,
  priorFY,
  currentFY,
}: {
  priorRows: MarginBridgeRow[]
  currentRows: MarginBridgeRow[]
  priorFY: string
  currentFY: string
}) {
  function agg(arr: MarginBridgeRow[]) {
    // 新モデル: totalRevenue = 案件プール（マイスター代走分を内数で含む）
    const rev = arr.reduce((s, r) => s + r.totalRevenue, 0)
    const opsProfit = arr.reduce((s, r) => s + r.totalProfit, 0)  // マイスター代走なし仮定の粗利
    const meister = arr.reduce((s, r) => s + r.meisterRevenue, 0)
    const costSaving = arr.reduce((s, r) => s + (r.profitWithMeister - r.totalProfit), 0)
    const profitIncl = opsProfit + costSaving  // マイスター効果反映後の粗利
    const marginOps = rev > 0 ? opsProfit / rev : 0
    const marginIncl = rev > 0 ? profitIncl / rev : marginOps
    const liftPt = marginIncl - marginOps
    const meisterShare = rev > 0 ? meister / rev : 0
    return {
      opsRev: rev,
      opsProfit,
      meister,
      costSaving,
      revIncl: rev,
      profitIncl,
      marginOps,
      marginIncl,
      liftPt,
      meisterShare,
    }
  }

  const prior = agg(priorRows)
  const current = agg(currentRows)

  // 「もし meister share を前年と同じにしたら」のシミュレーション（新モデル）
  // 売上は不変なので case pool 内で meister 割合を合わせる
  const priorMeisterShare = prior.meisterShare
  const currentSimMeister = current.opsRev * priorMeisterShare
  // 当年の平均原価削減率（costSaving / meister）を推定してシミュレーション粗利を算出
  const currentSavingRate = current.meister > 0 ? current.costSaving / current.meister : 0.757
  const currentSimCostSaving = currentSimMeister * currentSavingRate
  const currentSimProfitIncl = current.opsProfit + currentSimCostSaving
  const currentSimMarginIncl = current.opsRev > 0 ? currentSimProfitIncl / current.opsRev : 0

  // 比較（前年 vs 当年）
  const meisterDelta = current.meister - prior.meister
  const liftDelta = current.liftPt - prior.liftPt

  return (
    <div className="card" style={{ background: '#fff7ed', borderColor: '#fdba74', marginTop: 12 }}>
      <h3 style={{ margin: 0, color: '#9a3412' }}>
        ✨ マイスター効果 — 粗利率をどれだけ押し上げているか
      </h3>
      <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
        マイスター（営業社員代走）は <strong>案件プール内の「代走分」</strong>で、代走先カテゴリの原価が浮く分だけ粗利が増えます（売上は不変）。
        <strong>「マイスター無し」=代走なし仮定の粗利率</strong>、<strong>「マイスター込み」=代走効果反映後の粗利率</strong>。
        代走先は「月次イベント → マイスター」で比率調整（既定は運送店 100%）。
      </div>

      {/* 前年 / 当年 並列 */}
      <div className="row" style={{ gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
        {/* 前年カード */}
        <div
          className="card"
          style={{ flex: 1, minWidth: 320, background: '#f5f3ff', borderColor: '#c4b5fd', margin: 0 }}
        >
          <h3 style={{ margin: 0, color: '#5b21b6', fontSize: 13 }}>{priorFY} 実績</h3>
          <div className="kpi-grid" style={{ marginTop: 8 }}>
            <div className="kpi" style={{ background: '#fff' }}>
              <div className="label">マイスター売上</div>
              <div className="value mono" style={{ color: '#d97706' }}>¥{yen(prior.meister)}</div>
              <div className="sub">売上比 {(prior.meisterShare * 100).toFixed(2)}%</div>
            </div>
            <div className="kpi" style={{ background: '#fff' }}>
              <div className="label">マイスター無しの粗利率</div>
              <div className="value mono" style={{ color: '#64748b' }}>{(prior.marginOps * 100).toFixed(2)}%</div>
              <div className="sub">運営のみ</div>
            </div>
            <div className="kpi" style={{ background: '#fff' }}>
              <div className="label">マイスター込み粗利率</div>
              <div className="value mono" style={{ color: '#16a34a' }}>{(prior.marginIncl * 100).toFixed(2)}%</div>
              <div className="sub">会計上の粗利率</div>
            </div>
            <div className="kpi" style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
              <div className="label">マイスター効果</div>
              <div className="value mono" style={{ color: '#d97706' }}>
                +{(prior.liftPt * 100).toFixed(2)}pt
              </div>
              <div className="sub">原価減 +¥{yen(Math.round(prior.costSaving))}（代走売上 ¥{yen(prior.meister)}）</div>
            </div>
          </div>
        </div>

        {/* 当年カード */}
        <div
          className="card"
          style={{ flex: 1, minWidth: 320, background: '#ecfeff', borderColor: '#67e8f9', margin: 0 }}
        >
          <h3 style={{ margin: 0, color: '#0369a1', fontSize: 13 }}>{currentFY} 計画</h3>
          <div className="kpi-grid" style={{ marginTop: 8 }}>
            <div className="kpi" style={{ background: '#fff' }}>
              <div className="label">マイスター売上（計画）</div>
              <div className="value mono" style={{ color: '#d97706' }}>¥{yen(current.meister)}</div>
              <div className="sub">
                売上比 {(current.meisterShare * 100).toFixed(2)}%{' '}
                <span style={{ color: meisterDelta >= 0 ? '#16a34a' : '#dc2626' }}>
                  ({meisterDelta >= 0 ? '+' : ''}¥{yen(meisterDelta)})
                </span>
              </div>
            </div>
            <div className="kpi" style={{ background: '#fff' }}>
              <div className="label">マイスター無しの粗利率</div>
              <div className="value mono" style={{ color: '#64748b' }}>{(current.marginOps * 100).toFixed(2)}%</div>
              <div className="sub">運営のみ（失った場合）</div>
            </div>
            <div className="kpi" style={{ background: '#fff' }}>
              <div className="label">マイスター込み粗利率</div>
              <div className="value mono" style={{ color: '#16a34a' }}>{(current.marginIncl * 100).toFixed(2)}%</div>
              <div className="sub">会計上の粗利率</div>
            </div>
            <div className="kpi" style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
              <div className="label">マイスター効果</div>
              <div className="value mono" style={{ color: '#d97706' }}>
                +{(current.liftPt * 100).toFixed(2)}pt
                <span style={{ fontSize: 11, marginLeft: 6, color: liftDelta >= 0 ? '#16a34a' : '#dc2626' }}>
                  ({liftDelta >= 0 ? '+' : ''}{(liftDelta * 100).toFixed(2)}pt)
                </span>
              </div>
              <div className="sub">原価減 +¥{yen(Math.round(current.costSaving))}（代走売上 ¥{yen(current.meister)}）</div>
            </div>
          </div>
        </div>
      </div>

      {/* 「もし前年同率なら」シミュレーション */}
      <div
        className="card"
        style={{ marginTop: 12, background: '#fffaf0', borderColor: '#fde68a' }}
      >
        <h3 style={{ margin: 0, fontSize: 13, color: '#92400e' }}>
          🔮 もし {currentFY} のマイスター売上比が {priorFY} と同じ（{(priorMeisterShare * 100).toFixed(2)}%）だったら
        </h3>
        <div className="row" style={{ gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>想定マイスター売上</div>
            <div className="mono" style={{ fontWeight: 700, fontSize: 18, color: '#d97706' }}>
              ¥{yen(Math.round(currentSimMeister))}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              計画 ¥{yen(current.meister)} との差:{' '}
              <span style={{ color: currentSimMeister - current.meister > 0 ? '#dc2626' : '#16a34a' }}>
                {currentSimMeister - current.meister >= 0 ? '+' : ''}¥{yen(Math.round(currentSimMeister - current.meister))}
              </span>
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>想定 マイスター込み粗利率</div>
            <div className="mono" style={{ fontWeight: 700, fontSize: 18, color: '#16a34a' }}>
              {(currentSimMarginIncl * 100).toFixed(2)}%
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              計画 {(current.marginIncl * 100).toFixed(2)}% との差:{' '}
              <span style={{ color: currentSimMarginIncl - current.marginIncl > 0 ? '#16a34a' : '#dc2626' }}>
                {currentSimMarginIncl - current.marginIncl >= 0 ? '+' : ''}{((currentSimMarginIncl - current.marginIncl) * 100).toFixed(2)}pt
              </span>
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>目安</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {currentSimMeister > current.meister
                ? '計画はマイスターを前年より縮小している'
                : currentSimMeister < current.meister
                ? '計画はマイスターを前年より拡大している'
                : '前年と同水準の計画'}
            </div>
          </div>
        </div>
      </div>

      {/* 読み方 */}
      <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.7 }}>
        <strong>読み方:</strong>
        「マイスター無し粗利率」が事業運営の真の実力。マイスターを上乗せすると
        「マイスター込み粗利率」に 0%原価の分だけ直接乗る。
        <strong>マイスター代走 1 円 = 代走先の原価率ぶんの粗利増</strong>（例: 運送店代走で原価率75%なら 1円代走 → 0.75円の粗利増）。売上は変わらず原価だけ下がる。
        営業の判断材料として、運営で稼げる率とマイスターで補正する率を分けて見る。
      </div>
    </div>
  )
}

function MarginBridgeSection({
  rows,
  chartData,
  priorFY,
  currentFY,
}: {
  rows: MarginBridgeRow[]
  chartData: any[]
  priorFY: string
  currentFY: string
}) {
  // 年間集計
  const priorRows = rows.filter((r) => r.fy === 'prior')
  const currentRows = rows.filter((r) => r.fy === 'current')
  const sumAgg = (arr: MarginBridgeRow[]) => {
    const rev = arr.reduce((s, r) => s + r.totalRevenue, 0)
    const profit = arr.reduce((s, r) => s + r.totalProfit, 0)
    const uplift = arr.reduce((s, r) => s + r.upliftCost, 0)
    const priceupNet = arr.reduce((s, r) => s + (r.priceupRevenue - r.priceupCost), 0)
    const meister = arr.reduce((s, r) => s + r.meisterRevenue, 0)
    const revIncl = rev + meister
    const profitIncl = profit + meister
    const margin = rev > 0 ? profit / rev : 0
    const marginIncl = revIncl > 0 ? profitIncl / revIncl : margin
    // 期首ベース & mix分解: 年度内で月次加重平均（実効粗利率に対する貢献pt）
    const weightedAcqterm = rev > 0
      ? arr.reduce((s, r) => s + r.acqtermPt * r.totalRevenue, 0) / rev
      : 0
    const weightedTransfer = rev > 0
      ? arr.reduce((s, r) => s + r.transferPt * r.totalRevenue, 0) / rev
      : 0
    const initialRef = arr.length > 0 ? arr[0].initialMarginRef : 0
    return {
      rev,
      profit,
      margin,
      marginIncl,
      upliftPt: rev > 0 ? -uplift / rev : 0,
      priceupPt: rev > 0 ? priceupNet / rev : 0,
      meisterPt: marginIncl - margin,
      meisterRev: meister,
      initialRef,
      acqtermPt: weightedAcqterm,
      transferPt: weightedTransfer,
    }
  }
  const priorAgg = sumAgg(priorRows)
  const currentAgg = sumAgg(currentRows)

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>
            🧭 月次 粗利率ブリッジ — 配車比率 × 同区分uplift × 単価アップ
          </h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
            各月の粗利率がどのレバーで動いたかを pt で分解。
            <strong style={{ color: '#0ea5e9' }}>青=配車ミックス基礎</strong>／
            <strong style={{ color: '#16a34a' }}>緑=単価アップ（還元後）</strong>／
            <strong style={{ color: '#dc2626' }}>赤=同区分入替uplift</strong>
            の合計が <strong>実効粗利率</strong>。
          </div>
        </div>
        <div className="row" style={{ gap: 16, fontSize: 12 }}>
          {priorRows.length > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div className="muted">{priorFY}年平均（運営/含M）</div>
              <div className="mono" style={{ fontWeight: 700, color: '#7c3aed' }}>
                {(priorAgg.margin * 100).toFixed(2)}%
                <span style={{ color: '#64748b', fontSize: 11, margin: '0 4px' }}>→</span>
                <span style={{ color: '#d97706' }}>{(priorAgg.marginIncl * 100).toFixed(2)}%</span>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                期首{(priorAgg.initialRef * 100).toFixed(2)}% / 獲得終了 {(priorAgg.acqtermPt * 100).toFixed(2)}pt / 入替 {(priorAgg.transferPt * 100).toFixed(2)}pt
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                uplift {(priorAgg.upliftPt * 100).toFixed(2)}pt / マイスター +{(priorAgg.meisterPt * 100).toFixed(2)}pt
              </div>
            </div>
          )}
          {currentRows.length > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div className="muted">{currentFY}年平均（運営/含M）</div>
              <div className="mono" style={{ fontWeight: 700, color: '#0ea5e9' }}>
                {(currentAgg.margin * 100).toFixed(2)}%
                <span style={{ color: '#64748b', fontSize: 11, margin: '0 4px' }}>→</span>
                <span style={{ color: '#d97706' }}>{(currentAgg.marginIncl * 100).toFixed(2)}%</span>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                期首{(currentAgg.initialRef * 100).toFixed(2)}% / 獲得終了 {(currentAgg.acqtermPt * 100).toFixed(2)}pt / 入替 {(currentAgg.transferPt * 100).toFixed(2)}pt
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                uplift {(currentAgg.upliftPt * 100).toFixed(2)}pt / 単価UP +{(currentAgg.priceupPt * 100).toFixed(2)}pt / マイスター +{(currentAgg.meisterPt * 100).toFixed(2)}pt
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ブリッジチャート（Bar: 分解pt / Line: 実効粗利率） */}
      <div style={{ width: '100%', height: 360, marginTop: 12 }}>
        <ResponsiveContainer>
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#64748b" fontSize={10} />
            <YAxis yAxisId="left" stroke="#64748b" unit="%" domain={[0, 'auto']} />
            <YAxis yAxisId="right" orientation="right" stroke="#64748b" unit="pt" domain={[-5, 5]} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 }}
              formatter={(value: any, name: any) => {
                if (value == null) return ['—', name]
                if (name === '実効粗利率' || name === 'ベース' || name === '実効粗利率含M')
                  return [`${value}%`, name === '実効粗利率含M' ? '実効粗利率(含マイスター)' : name]
                if (
                  name === '単価UP影響' ||
                  name === 'uplift影響' ||
                  name === 'マイスター影響' ||
                  name === '獲得終了影響' ||
                  name === '入替影響'
                )
                  return [`${value >= 0 ? '+' : ''}${value}pt`, name]
                return [value, name]
              }}
              labelFormatter={(label: any, payload: any) => {
                const fy = payload?.[0]?.payload?.fy
                return `${label}${fy ? ` (${fy})` : ''}`
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="right" dataKey="獲得終了影響" fill="#64748b" />
            <Bar yAxisId="right" dataKey="入替影響" fill="#9333ea" />
            <Bar yAxisId="right" dataKey="単価UP影響" fill="#16a34a" />
            <Bar yAxisId="right" dataKey="uplift影響" fill="#dc2626" />
            <Bar yAxisId="right" dataKey="マイスター影響" fill="#f59e0b" />
            <Line yAxisId="left" type="monotone" dataKey="ベース" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} />
            <Line yAxisId="left" type="monotone" dataKey="実効粗利率" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 3 }} />
            <Line yAxisId="left" type="monotone" dataKey="実効粗利率含M" stroke="#d97706" strokeWidth={2} strokeDasharray="3 3" dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: -4, textAlign: 'center' }}>
        左軸：粗利率% （ベース / 運営実効 / <span style={{ color: '#d97706' }}>マイスター込み</span>）
        右軸：pt影響 （<span style={{ color: '#64748b' }}>獲得終了</span> / <span style={{ color: '#9333ea' }}>入替</span> / <span style={{ color: '#16a34a' }}>単価UP</span> / <span style={{ color: '#dc2626' }}>uplift</span> / <span style={{ color: '#f59e0b' }}>マイスター</span>）
      </div>

      {/* 詳細テーブル */}
      <div className="scroll-x" style={{ marginTop: 16 }}>
        <table style={{ fontSize: 11 }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ verticalAlign: 'middle' }}>月</th>
              <th colSpan={3} style={{ background: '#f1f5f9' }}>配車比率（件数構成比 %）</th>
              <th colSpan={3} style={{ background: '#fef9c3' }}>当月変動</th>
              <th rowSpan={2} style={{ verticalAlign: 'middle', background: '#e0f2fe', color: '#334155' }}>
                期首<br />ベース
              </th>
              <th rowSpan={2} style={{ verticalAlign: 'middle', background: '#f1f5f9', color: '#334155' }}>
                ± 獲得<br />終了影響
              </th>
              <th rowSpan={2} style={{ verticalAlign: 'middle', background: '#f3e8ff', color: '#6b21a8' }}>
                ± 入替<br />影響
              </th>
              <th rowSpan={2} style={{ verticalAlign: 'middle', background: '#e0f2fe' }}>
                ベース<br />粗利率
              </th>
              <th rowSpan={2} style={{ verticalAlign: 'middle', background: '#fee2e2' }}>
                ▼ 同区分<br />uplift
              </th>
              <th rowSpan={2} style={{ verticalAlign: 'middle', background: '#dcfce7' }}>
                ▲ 単価UP<br />(還元後)
              </th>
              <th rowSpan={2} style={{ verticalAlign: 'middle', background: '#bae6fd', color: '#0c4a6e' }}>
                運営<br />実効粗利率
              </th>
              <th rowSpan={2} style={{ verticalAlign: 'middle', background: '#fed7aa', color: '#9a3412' }}>
                ▲ マイスター<br />影響
              </th>
              <th rowSpan={2} style={{ verticalAlign: 'middle', background: '#fef3c7', color: '#854d0e' }}>
                実効粗利率<br />(含マイスター)
              </th>
              <th rowSpan={2} style={{ verticalAlign: 'middle' }}>前月差<br />(運営)</th>
            </tr>
            <tr>
              <th style={{ background: '#f1f5f9', fontSize: 10 }}>運送店</th>
              <th style={{ background: '#f1f5f9', fontSize: 10 }}>業者</th>
              <th style={{ background: '#f1f5f9', fontSize: 10 }}>社員</th>
              <th style={{ background: '#fef9c3', fontSize: 10 }}>獲得</th>
              <th style={{ background: '#fef9c3', fontSize: 10 }}>終了</th>
              <th style={{ background: '#fef9c3', fontSize: 10 }}>入替(非対角)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prevMargin = i > 0 ? rows[i - 1].effectiveMargin : null
              const delta = prevMargin != null ? r.effectiveMargin - prevMargin : null
              const transfersAbs =
                Math.abs(r.transfersNet.partner) + Math.abs(r.transfersNet.vendor) + Math.abs(r.transfersNet.employment)
              const isFYHeader = i === 0 || r.fy !== rows[i - 1].fy
              const fyLabel = r.fy === 'current' ? currentFY : priorFY
              return (
                <Fragment key={r.month}>
                  {isFYHeader && (
                    <tr>
                      <td
                        colSpan={16}
                        style={{
                          background: r.fy === 'current' ? '#ecfeff' : '#f5f3ff',
                          color: r.fy === 'current' ? '#0369a1' : '#5b21b6',
                          fontWeight: 700,
                          fontSize: 12,
                          padding: '4px 10px',
                        }}
                      >
                        {fyLabel}
                        {r.fy === 'prior' && (
                          <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 8, opacity: 0.7 }}>
                            ※ 獲得終了 / 入替 pt は plan 原価率基準の参考値
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{shortYm(r.month)}</td>
                    <td className="mono" style={{ color: '#2563eb' }}>{r.sharePartner.toFixed(1)}</td>
                    <td className="mono" style={{ color: '#7c3aed' }}>{r.shareVendor.toFixed(1)}</td>
                    <td className="mono" style={{ color: '#059669' }}>{r.shareEmployment.toFixed(1)}</td>
                    <td className="mono" style={{ color: '#16a34a' }}>{r.acquisition > 0 ? `+${r.acquisition}` : '0'}</td>
                    <td className="mono" style={{ color: '#dc2626' }}>{r.termination > 0 ? `-${r.termination}` : '0'}</td>
                    <td className="mono muted">{transfersAbs > 0 ? `±${transfersAbs / 2}` : '—'}</td>
                    <td className="mono" style={{ background: '#f0f9ff', color: '#475569' }}>
                      {(r.initialMarginRef * 100).toFixed(2)}%
                    </td>
                    <td
                      className="mono"
                      style={{
                        color: r.acqtermPt > 0 ? '#16a34a' : r.acqtermPt < 0 ? '#dc2626' : '#64748b',
                        background: '#f8fafc',
                      }}
                      title="期首件数から、獲得/終了の累積で構成比が変わったことによる pt影響"
                    >
                      {Math.abs(r.acqtermPt) > 0.00005
                        ? `${r.acqtermPt >= 0 ? '+' : ''}${(r.acqtermPt * 100).toFixed(2)}pt`
                        : '—'}
                    </td>
                    <td
                      className="mono"
                      style={{
                        color: r.transferPt > 0 ? '#16a34a' : r.transferPt < 0 ? '#dc2626' : '#64748b',
                        background: '#faf5ff',
                      }}
                      title="入替（非対角）による mix 変動の pt影響"
                    >
                      {Math.abs(r.transferPt) > 0.00005
                        ? `${r.transferPt >= 0 ? '+' : ''}${(r.transferPt * 100).toFixed(2)}pt`
                        : '—'}
                    </td>
                    <td className="mono" style={{ background: '#f0f9ff', fontWeight: 600 }}>
                      {(r.baseMargin * 100).toFixed(2)}%
                    </td>
                    <td className="mono" style={{ color: r.upliftPt < 0 ? '#dc2626' : '#64748b', background: '#fef2f2' }}>
                      {r.upliftPt !== 0 ? `${(r.upliftPt * 100).toFixed(2)}pt` : '—'}
                    </td>
                    <td className="mono" style={{ color: r.priceupPt > 0 ? '#16a34a' : '#64748b', background: '#f0fdf4' }}>
                      {Math.abs(r.priceupPt) > 0.00005 ? `+${(r.priceupPt * 100).toFixed(2)}pt` : '—'}
                    </td>
                    <td
                      className="mono"
                      style={{
                        background: '#e0f2fe',
                        fontWeight: 700,
                        color: r.effectiveMargin >= r.baseMargin ? '#0c4a6e' : '#9a3412',
                      }}
                    >
                      {(r.effectiveMargin * 100).toFixed(2)}%
                    </td>
                    <td
                      className="mono"
                      style={{
                        color: r.meisterPt > 0 ? '#d97706' : '#64748b',
                        background: '#fff7ed',
                        fontSize: 11,
                      }}
                      title={r.meisterRevenue > 0 ? `マイスター売上: ¥${yen(Math.round(r.meisterRevenue))}` : 'マイスター売上なし'}
                    >
                      {r.meisterPt > 0.00005 ? `+${(r.meisterPt * 100).toFixed(2)}pt` : '—'}
                    </td>
                    <td
                      className="mono"
                      style={{
                        background: '#fef3c7',
                        fontWeight: 700,
                        color: '#854d0e',
                      }}
                    >
                      {(r.marginWithMeister * 100).toFixed(2)}%
                    </td>
                    <td className="mono" style={{ color: delta == null ? '#94a3b8' : delta >= 0 ? '#16a34a' : '#dc2626' }}>
                      {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(2)}pt`}
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 読み方メモ */}
      <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.7 }}>
        <strong>営業マン向けの読み方（左から右へ、粗利率がどう変わっていくか）:</strong><br />
        ・<strong>期首ベース</strong> = 期首件数の構成比 × カテゴリ原価率 で決まる <strong>年度内で不動の基準粗利率</strong>。「何も動かなかったら」のゼロ点。<br />
        ・<strong>± 獲得終了影響</strong> = 期首から毎月累積する獲得/終了で構成比がどう動いたか（例：<strong>社員が減って運送店が増えると下がる</strong>）。通常マイナスに効く月が多いのが実情。<br />
        ・<strong>± 入替影響</strong> = 非対角入替（運送店⇔業者 等）による構成比シフトの寄与。営業が意識的に動かせるレバー。<br />
        ・<strong>ベース粗利率</strong> = 期首ベース ± 獲得終了 ± 入替 の合計。<strong>純粋なミックスの結果</strong>。<br />
        ・<strong>▼ 同区分uplift</strong> = 同区分入替（運送店→運送店 等）の累積による原価上昇。件数が増えるほど月次負担が重くなる固定コスト。<br />
        ・<strong>▲ 単価UP</strong> = 単価アップ（還元率差し引き後）の純粗利増。<br />
        ・<strong>運営 実効粗利率 = ベース − uplift + 単価UP</strong>。<strong>事業運営そのものの月次収益力</strong>（マイスター除外）。営業の本来勝負する数字。<br />
        ・<strong>▲ マイスター影響</strong> = 営業社員代走売上（0%原価）の上乗せ pt。補正手段として別建て。<br />
        ・<strong>実効粗利率(含マイスター)</strong> = 運営実効 + マイスター影響。会計/経営層に出る見かけの粗利率。<br />
        ・<em>FY2025 の獲得終了/入替 pt は 現在の plan 原価率を当てた参考値（FY2025 の当時の原価率ではない）。</em>
      </div>
    </div>
  )
}

/** 構造化KPI（計画合計 / 予算 / 対予算比 / 差額） */
function KpiStructured({
  label, value, budget, budgetLabel, rate, rateLabel, gap, gapText, gapColor, gapUnit, extraSub,
}: {
  label: string
  value: string
  budget?: string
  /** budget 表示のラベル（デフォルト「予算」） */
  budgetLabel?: string
  rate?: number
  rateLabel?: string
  gap?: number
  gapText?: string
  gapColor?: string
  gapUnit?: string
  /** 追加の sub 情報（例: 運営＋マイスター内訳） */
  extraSub?: string
}) {
  const ratePct = rate != null ? rate * 100 : null
  const rateColorDefault = ratePct != null ? (ratePct >= 100 ? '#16a34a' : '#dc2626') : '#64748b'
  const gapDisplay = gapText ?? (gap != null ? `${gap >= 0 ? '+' : ''}¥${yen(gap)}${gapUnit ?? ''}` : undefined)
  const gapColorFinal = gapColor ?? (gap != null ? (gap >= 0 ? '#16a34a' : '#dc2626') : '#64748b')
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value mono">{value}</div>
      {budget && (
        <div className="sub" style={{ fontSize: 11, marginTop: 2 }}>
          {budgetLabel ?? '予算'}: {budget}
        </div>
      )}
      {ratePct != null && (
        <div className="sub" style={{ fontSize: 12, fontWeight: 700, color: rateColorDefault, marginTop: 2 }}>
          {rateLabel ?? '対予算比'} {ratePct.toFixed(1)}%
        </div>
      )}
      {gapDisplay && (
        <div className="sub" style={{ fontSize: 11, fontWeight: 600, color: gapColorFinal, marginTop: 1 }}>
          差額 {gapDisplay}
        </div>
      )}
      {extraSub && (
        <div className="sub" style={{ fontSize: 10, color: '#64748b', marginTop: 2, lineHeight: 1.4 }}>
          {extraSub}
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value mono">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

type NavView = 'dashboard' | 'monthly' | 'categories' | 'events' | 'priorYear' | 'settings'
function navigateTo(view: NavView, opts?: { subTab?: string; anchor?: string }) {
  window.dispatchEvent(new CustomEvent('navigate-to-view', { detail: { view, ...opts } }))
}

/** Dashboard パラメータ一覧カード群：FY2026 の主要設定値を前年と並記 */
function ParamCardsRow({
  plan,
  priorFY,
  currentFY,
}: {
  plan: Plan
  priorFY: string
  currentFY: string
}) {
  const py = plan.priorYear
  const hasPriorYear = !!py

  // FY2026 年間 集計
  const currentRows = useMemo(() => computeMonthly(plan), [plan])
  const currentAcq = currentRows.reduce((s, r) => s + r.newTotal, 0)
  const currentTerm = currentRows.reduce((s, r) => s + r.endTotal, 0)
  const currentNet = currentAcq - currentTerm
  const currentMeister = Object.values(plan.meisterRevenueByMonth ?? {}).reduce((s, v) => s + v, 0)

  // FY2025 年間 集計
  const priorAcq = py ? py.monthlyData.reduce((s, d) => s + (d.acquisition ?? 0), 0) : 0
  const priorTerm = py ? py.monthlyData.reduce((s, d) => s + (d.termination ?? 0), 0) : 0
  const priorNet = priorAcq - priorTerm
  const priorMeister = py ? py.monthlyData.reduce((s, d) => s + (d.meisterRevenue ?? 0), 0) : 0

  // 獲得単価
  const priorAcqUnit = py?.annualSummary?.acquisitionUnitPrice ?? plan.cohortPricing?.priorAcquisitionUnitPrice ?? 0
  const acqUnitAdj = (plan.cohortPricing?.acquisitionUnitPriceUpAbs ?? 0)
    + (priorAcqUnit * (plan.cohortPricing?.acquisitionUnitPriceUpPct ?? 0)) / 100
  const currentAcqUnit = priorAcqUnit + acqUnitAdj
  // 終了単価（FY2025 実績のみ、FY2026 は仮に revenuePerCase と仮定）
  const priorTermUnit = py?.annualSummary?.terminationUnitPrice ?? 0

  // 案件単価（プール）
  const currentRevPC = plan.revenuePerCase
  // FY2025 reported 基準単価
  const priorLast = py ? estimatePriorYearLastMonthUnitPrice(py, 'reported') : null
  const priorRevPC = priorLast ? Math.round(priorLast.reportedUnitPrice) : 0

  // 入替（非対角）累計件数
  const currentTransfers = plan.transfers.reduce((s, t) => (t.from !== t.to ? s + t.count : s), 0)
  const priorTransfers = py ? py.transfers.reduce((s, t) => (t.from !== t.to ? s + t.count : s), 0) : 0

  // 改定 年間累積影響（20日換算） 単価改定=売上増 / 原価改定=原価増
  const months = monthsRange(plan.baseMonth, plan.horizonMonths)
  let priceRevYearly = 0
  for (const pr of plan.priceRevisions ?? []) {
    const remain = months.filter((m) => m >= pr.effectiveMonth).length
    const perDay = pr.amountPerCaseDay ?? ((plan.revenuePerCase ?? 0) * (pr.pctOfBase ?? 0) / 100)
    priceRevYearly += pr.count * perDay * 20 * remain
  }
  let costRevYearly = 0
  for (const cr of plan.costRevisions ?? []) {
    const remain = months.filter((m) => m >= cr.effectiveMonth).length
    costRevYearly += cr.count * cr.amountPerCaseDay * 20 * remain
  }
  const revisionNetProfit = priceRevYearly - costRevYearly
  const hasRevision = priceRevYearly > 0 || costRevYearly > 0

  // 原価率（2026-03 snapshot）— 運送店 / 業者 / 社員
  const catRate = {
    partner: plan.categories.partner.costRate,
    vendor: plan.categories.vendor.costRate,
    employment: plan.categories.employment.costRate,
  }

  return (
    <div
      className="card"
      style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
    >
      <h3 style={{ margin: 0, fontSize: 14 }}>🎛 FY2026 主要パラメータ（年間）</h3>
      <div className="muted" style={{ fontSize: 11, marginTop: 2, marginBottom: 10 }}>
        カード右上の 🔗 をクリックすると、該当設定画面にジャンプします。前年との差額は括弧内。
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 8,
        }}
      >
        <LinkCard
          title="獲得 (年間)"
          value={`${currentAcq.toLocaleString()}件`}
          sub={hasPriorYear ? `前年 ${priorAcq.toLocaleString()}件` : undefined}
          delta={hasPriorYear ? currentAcq - priorAcq : undefined}
          deltaUnit="件"
          color="#16a34a"
          to="events"
          subTab="flow"
        />
        <LinkCard
          title="終了 (年間)"
          value={`${currentTerm.toLocaleString()}件`}
          sub={hasPriorYear ? `前年 ${priorTerm.toLocaleString()}件` : undefined}
          delta={hasPriorYear ? currentTerm - priorTerm : undefined}
          deltaUnit="件"
          deltaGoodPositive={false}
          color="#dc2626"
          to="events"
          subTab="flow"
        />
        <LinkCard
          title="純増 (年間)"
          value={`${currentNet >= 0 ? '+' : ''}${currentNet.toLocaleString()}件`}
          sub={hasPriorYear ? `前年 ${priorNet >= 0 ? '+' : ''}${priorNet.toLocaleString()}件` : undefined}
          delta={hasPriorYear ? currentNet - priorNet : undefined}
          deltaUnit="件"
          color="#0ea5e9"
          to="events"
          subTab="flow"
        />
        <LinkCard
          title="獲得単価 (円/件/日)"
          value={`¥${currentAcqUnit.toLocaleString()}`}
          sub={hasPriorYear
            ? `前年 ¥${priorAcqUnit.toLocaleString()}${acqUnitAdj !== 0 ? ` + 調整 ${acqUnitAdj >= 0 ? '+' : ''}¥${acqUnitAdj.toLocaleString()}` : ''}`
            : undefined}
          delta={hasPriorYear ? currentAcqUnit - priorAcqUnit : undefined}
          deltaUnit="円"
          color="#d97706"
          to="categories"
          anchor="cohort-pricing-card"
        />
        <LinkCard
          title="案件単価（プール）"
          value={`¥${currentRevPC.toLocaleString()}`}
          sub={hasPriorYear ? `前年最終月 ¥${priorRevPC.toLocaleString()}` : undefined}
          delta={hasPriorYear ? currentRevPC - priorRevPC : undefined}
          deltaUnit="円"
          color="#0284c7"
          to="categories"
          anchor="unit-price-card"
        />
        <LinkCard
          title="終了単価 (参考)"
          value={hasPriorYear ? `¥${priorTermUnit.toLocaleString()}` : '—'}
          sub="FY2025 実績ベース"
          color="#64748b"
          to="priorYear"
        />
        <LinkCard
          title="マイスター (年間)"
          value={`¥${(currentMeister / 1_000_000).toFixed(0)}M`}
          sub={
            hasPriorYear
              ? `月平均 ¥${(currentMeister / 12 / 1_000_000).toFixed(1)}M／前年 ¥${(priorMeister / 1_000_000).toFixed(0)}M（月平均 ¥${(priorMeister / 12 / 1_000_000).toFixed(1)}M）`
              : `月平均 ¥${(currentMeister / 12 / 1_000_000).toFixed(1)}M`
          }
          delta={hasPriorYear ? currentMeister - priorMeister : undefined}
          deltaUnit="円"
          deltaFormatM
          color="#9a3412"
          to="events"
          subTab="meister"
        />
        <LinkCard
          title="入替 (年間・非対角)"
          value={`${currentTransfers.toLocaleString()}件`}
          sub={hasPriorYear ? `前年 ${priorTransfers.toLocaleString()}件` : undefined}
          delta={hasPriorYear ? currentTransfers - priorTransfers : undefined}
          deltaUnit="件"
          color="#9333ea"
          to="events"
          subTab="transfer"
        />
        <LinkCard
          title="改定 年間影響（20日換算）"
          value={hasRevision
            ? `粗利 ${revisionNetProfit >= 0 ? '+' : '−'}¥${(Math.abs(revisionNetProfit) / 1_000_000).toFixed(1)}M`
            : '—'}
          sub={hasRevision
            ? `単価改定 +¥${(priceRevYearly / 1_000_000).toFixed(1)}M／原価改定 −¥${(costRevYearly / 1_000_000).toFixed(1)}M`
            : '未設定'}
          color="#06b6d4"
          to="events"
          subTab={priceRevYearly >= costRevYearly ? 'pricerev' : 'costrev'}
        />
        <LinkCard
          title="原価率（2026-03 snapshot）"
          value={`R ${catRate.partner.toFixed(1)}% / V ${catRate.vendor.toFixed(1)}%`}
          sub={`社員 ${catRate.employment.toFixed(1)}%`}
          color="#7c3aed"
          to="categories"
          anchor="category-rate-card"
        />
      </div>
      <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>
        ※ 前年（{priorFY}）= 実績 / 当年（{currentFY}）= 計画。同種項目が複数箇所に渡るため、変更時は各設定画面で。
      </div>
    </div>
  )
}

/** 値+前年差+リンクアイコン付きの小カード */
function LinkCard({
  title,
  value,
  sub,
  delta,
  deltaUnit,
  deltaFormatM,
  deltaGoodPositive = true,
  color,
  to,
  subTab,
  anchor,
}: {
  title: string
  value: string
  sub?: string
  delta?: number
  deltaUnit?: string
  deltaFormatM?: boolean
  /** 増加=良い なら true (既定), 減少=良い なら false */
  deltaGoodPositive?: boolean
  color: string
  to: NavView
  subTab?: string
  anchor?: string
}) {
  const deltaIsGood = delta == null
    ? null
    : deltaGoodPositive
      ? delta >= 0
      : delta <= 0
  const deltaColor = delta == null ? '#94a3b8' : deltaIsGood ? '#16a34a' : '#dc2626'
  const deltaStr = delta == null
    ? ''
    : deltaFormatM
      ? `${delta >= 0 ? '+' : ''}¥${(delta / 1_000_000).toFixed(0)}M`
      : `${delta >= 0 ? '+' : ''}${Math.round(delta).toLocaleString()}${deltaUnit ?? ''}`

  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${color}33`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 6,
        padding: '8px 10px',
        position: 'relative',
      }}
    >
      <button
        onClick={() => navigateTo(to, { subTab, anchor })}
        title="設定画面にジャンプ"
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          padding: '2px 6px',
          fontSize: 10,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: color,
        }}
      >
        🔗
      </button>
      <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{title}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
      {sub && (
        <div className="muted" style={{ fontSize: 10, marginTop: 1 }}>{sub}</div>
      )}
      {deltaStr && (
        <div style={{ fontSize: 11, fontWeight: 700, color: deltaColor, marginTop: 2 }}>
          前年比 {deltaStr}
        </div>
      )}
    </div>
  )
}
