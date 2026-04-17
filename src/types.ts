// ドメイン型定義

export type WorkerCategory = 'partner' | 'vendor' | 'dposition' | 'fs'

export const WorkerCategoryLabels: Record<WorkerCategory, string> = {
  partner: 'パートナー',
  vendor: '協力会社',
  dposition: 'D職',
  fs: 'FS',
}

/** 稼働者区分ごとのデフォルト原価率（％） */
export interface CategoryDefaults {
  partner: number
  vendor: number
  dposition: number
  fs: number
}

/** 案件（定期収益の源泉） */
export interface Project {
  id: string
  name: string
  client?: string
  /** yyyy-mm 形式 */
  startMonth: string
  /** yyyy-mm 形式。終了未定の場合は null */
  endMonth: string | null
  /** 月次の基本単価（円） */
  unitPrice: number
  /** 単価改定履歴（effectiveMonth 以降に newPrice が適用） */
  priceChanges: PriceChange[]
  memo?: string
}

export interface PriceChange {
  id: string
  effectiveMonth: string // yyyy-mm
  newPrice: number
  reason?: string
}

/** 稼働者 */
export interface Worker {
  id: string
  name: string
  category: WorkerCategory
  /** 月次の仕入単価（円）。個別設定が無い場合は 0 で category のデフォルト原価率を使用 */
  monthlyCost: number
  /** 仕入原価の改定履歴 */
  costChanges: CostChange[]
}

export interface CostChange {
  id: string
  effectiveMonth: string
  newCost: number
  reason?: string
}

/** 案件への稼働者アサイン（入替も表現可） */
export interface Assignment {
  id: string
  projectId: string
  workerId: string
  startMonth: string // yyyy-mm
  endMonth: string | null // yyyy-mm or null (継続)
  /** アサイン時の個別原価率(%)。未設定なら worker.monthlyCost を優先し、無ければ category デフォルト */
  overrideCostRate?: number | null
  memo?: string
}

/** 計画（ユーザー × 計画ID） */
export interface Plan {
  id: string
  name: string
  /** 基準月 yyyy-mm。この月から 12 ヶ月を表示 */
  baseMonth: string
  horizonMonths: number // 通常 12
  categoryDefaults: CategoryDefaults
  projects: Project[]
  workers: Worker[]
  assignments: Assignment[]
  updatedAt?: string
}

/** 月次集計（計算結果） */
export interface MonthlyRow {
  month: string // yyyy-mm
  revenue: number
  costTotal: number
  costByCategory: Record<WorkerCategory, number>
  grossProfit: number
  grossMargin: number // 0-1
  activeProjectCount: number
  activeWorkerCount: number
  newProjects: number
  endingProjects: number
}
