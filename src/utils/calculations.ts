import type {
  Assignment,
  CategoryDefaults,
  MonthlyRow,
  Plan,
  Project,
  Worker,
  WorkerCategory,
} from '../types'
import { monthsRange, ymLte, ymLt } from './month'

/** ym 時点で有効な単価を返す */
export function priceAt(project: Project, ym: string): number {
  let price = project.unitPrice
  const sorted = [...project.priceChanges].sort((a, b) =>
    a.effectiveMonth.localeCompare(b.effectiveMonth),
  )
  for (const pc of sorted) {
    if (ymLte(pc.effectiveMonth, ym)) price = pc.newPrice
  }
  return price
}

/** ym 時点で有効な仕入単価を返す */
export function costAt(worker: Worker, ym: string): number {
  let cost = worker.monthlyCost
  const sorted = [...worker.costChanges].sort((a, b) =>
    a.effectiveMonth.localeCompare(b.effectiveMonth),
  )
  for (const cc of sorted) {
    if (ymLte(cc.effectiveMonth, ym)) cost = cc.newCost
  }
  return cost
}

/** 案件が ym 月にアクティブか（開始月 <= ym <= 終了月） */
export function isProjectActive(p: Project, ym: string): boolean {
  if (!ymLte(p.startMonth, ym)) return false
  if (p.endMonth && ymLt(p.endMonth, ym)) return false
  return true
}

/** アサインが ym 月にアクティブか */
export function isAssignmentActive(a: Assignment, ym: string): boolean {
  if (!ymLte(a.startMonth, ym)) return false
  if (a.endMonth && ymLt(a.endMonth, ym)) return false
  return true
}

/** アサインのその月の原価を返す
 *  優先順位: overrideCostRate(%) × 案件単価 → worker.monthlyCost(実績) → category デフォ(%) × 案件単価
 */
export function assignmentCostAt(
  a: Assignment,
  project: Project,
  worker: Worker,
  ym: string,
  defaults: CategoryDefaults,
): number {
  if (a.overrideCostRate != null && a.overrideCostRate > 0) {
    return Math.round((priceAt(project, ym) * a.overrideCostRate) / 100)
  }
  const workerCost = costAt(worker, ym)
  if (workerCost > 0) return workerCost
  const rate = defaults[worker.category] ?? 0
  return Math.round((priceAt(project, ym) * rate) / 100)
}

/** 計画全体から 12(または horizon) ヶ月分の集計を作る */
export function computeMonthly(plan: Plan): MonthlyRow[] {
  const months = monthsRange(plan.baseMonth, plan.horizonMonths)
  const projectMap = new Map(plan.projects.map((p) => [p.id, p]))
  const workerMap = new Map(plan.workers.map((w) => [w.id, w]))

  return months.map((ym, idx) => {
    let revenue = 0
    let costTotal = 0
    const costByCategory: Record<WorkerCategory, number> = {
      partner: 0,
      vendor: 0,
      dposition: 0,
      fs: 0,
    }

    // 売上 = アクティブ案件の単価合計
    let activeProjectCount = 0
    let newProjects = 0
    let endingProjects = 0

    for (const p of plan.projects) {
      if (isProjectActive(p, ym)) {
        revenue += priceAt(p, ym)
        activeProjectCount += 1
        if (p.startMonth === ym) newProjects += 1
        if (p.endMonth === ym) endingProjects += 1
      }
    }

    // 原価 = アクティブアサインの合計
    let activeWorkerCount = 0
    for (const a of plan.assignments) {
      if (!isAssignmentActive(a, ym)) continue
      const p = projectMap.get(a.projectId)
      const w = workerMap.get(a.workerId)
      if (!p || !w) continue
      if (!isProjectActive(p, ym)) continue // 案件が終わっていればアサインも無視
      const c = assignmentCostAt(a, p, w, ym, plan.categoryDefaults)
      costTotal += c
      costByCategory[w.category] += c
      activeWorkerCount += 1
    }

    const grossProfit = revenue - costTotal
    const grossMargin = revenue > 0 ? grossProfit / revenue : 0

    return {
      month: ym,
      revenue,
      costTotal,
      costByCategory,
      grossProfit,
      grossMargin,
      activeProjectCount,
      activeWorkerCount,
      newProjects,
      endingProjects,
    }
  })
}

/** 合計行を作る */
export function sumRows(rows: MonthlyRow[]) {
  const total = {
    revenue: 0,
    costTotal: 0,
    grossProfit: 0,
    costByCategory: { partner: 0, vendor: 0, dposition: 0, fs: 0 } as Record<
      WorkerCategory,
      number
    >,
  }
  for (const r of rows) {
    total.revenue += r.revenue
    total.costTotal += r.costTotal
    total.grossProfit += r.grossProfit
    total.costByCategory.partner += r.costByCategory.partner
    total.costByCategory.vendor += r.costByCategory.vendor
    total.costByCategory.dposition += r.costByCategory.dposition
    total.costByCategory.fs += r.costByCategory.fs
  }
  return total
}

export function yen(n: number): string {
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('ja-JP')
}
export function percent(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '-'
  return `${(n * 100).toFixed(digits)}%`
}
