// ドメイン型定義（ポートフォリオ型 / 配車比率モデル）

export type WorkerCategory = 'partner' | 'vendor' | 'employment'

export const WorkerCategoryLabels: Record<WorkerCategory, string> = {
  partner: '運送店',
  vendor: '業者',
  employment: '社員',
}

export const WorkerCategoryOrder: WorkerCategory[] = ['partner', 'vendor', 'employment']

export type CostModel = 'rate' | 'amount'

/** カテゴリごとの原価設定（売上単価はカテゴリ非依存で Plan レベル）
 *  月次原価 = 件数 × 1日あたり原価 × 計算日数（costModel='amount'）
 *  月次原価 = 月次売上 × 原価率 / 100（costModel='rate'）
 */
export interface CategoryConfig {
  /** @deprecated A案への移行により Plan.revenuePerCase を使用。互換のため型は残す */
  revenuePerCase?: number
  /** 原価の表現方法 */
  costModel: CostModel
  /** 原価率（%）costModel='rate' の時に使用 */
  costRate: number
  /** 1案件 × 1日 あたりの原価（円）costModel='amount' の時に使用 */
  costAmount: number
}

export type CategoryMap<T> = Record<WorkerCategory, T>

/** 配車比率（合計100%になるように運用。sumが0以外であれば自動的に正規化して計算） */
export type Ratios = CategoryMap<number>

/** 月次の 獲得総数 / 終了総数（カテゴリ別は比率で按分） */
export interface MonthlyTotal {
  /** yyyy-mm */
  month: string
  /** 当月の獲得総件数 */
  acquisitionTotal: number
  /** 当月の終了総件数 */
  terminationTotal: number
}

/** FY2026 コホート別 単価・粗利設定
 *  継続・終了コホートは plan.revenuePerCase と plan.categories[cat].costRate（= 2026-03 snapshot）を使用。
 *  獲得コホートのみ前年獲得をベースに調整。
 */
export interface CohortPricing {
  /** 前年（FY2025）獲得案件の平均単価（円/1件/日） */
  priorAcquisitionUnitPrice: number
  /** FY2026 獲得単価の調整（絶対額 円/日） */
  acquisitionUnitPriceUpAbs: number
  /** FY2026 獲得単価の調整（%）— 絶対額と合算 */
  acquisitionUnitPriceUpPct: number
  /** セグメント別 1案件1日あたり 粗利UP額（円） */
  acquisitionProfitUplift: CategoryMap<number>
}

/** 単価アップ（累積型・還元率付き）
 *  - 適用月以降、売上・粗利にそれぞれ加算
 *  - 複数月の積み上げ（新しいイベントは累計に加わる）
 *  - 例: 4月 1300万×還元60% と 5月 100万×還元50% の2件があれば
 *    5月以降の月次売上は +1400万、月次粗利は +570万 (=520+50)
 */
export interface PriceIncrease {
  id: string
  /** 適用開始月 yyyy-mm */
  month: string
  /** 当月新規の売上アップ額（円） */
  amount: number
  /** 還元率 %（仕入先への還元。0-100） */
  returnRate: number
  memo?: string
}

/** 月別の配車比率オーバーライド（未指定月はデフォルト比率を使用） */
export interface MonthlyRatioOverride {
  /** yyyy-mm */
  month: string
  /** 獲得比率のオーバーライド（未指定・合計0ならデフォルトを使用） */
  acquisition?: Ratios
  /** 終了比率のオーバーライド */
  termination?: Ratios
}

/** 同区分入替による 1件1日あたり の仕入単価引き上げ額（円）
 *  社員→社員は常に0のため保持しない（計算でも0として扱う）
 */
export interface DiagonalUplift {
  partner: number
  vendor: number
}

/** 月別の同区分uplift上書き（未指定項目はデフォルト値を使用） */
export interface MonthlyDiagonalUpliftOverride {
  /** yyyy-mm */
  month: string
  partner?: number
  vendor?: number
}

/** 入替（カテゴリ間移動） */
export interface TransferEvent {
  id: string
  month: string
  from: WorkerCategory
  to: WorkerCategory
  count: number
  memo?: string
}

/** 部分 原価改定（特定カテゴリの N件 に対して 月M以降 +X円/件/日 が継続的に上乗せ） */
export interface CostRevision {
  id: string
  effectiveMonth: string       // yyyy-mm
  category: WorkerCategory     // 対象カテゴリ
  count: number                // 対象件数
  amountPerCaseDay: number     // +X円/件/日（原価増）
  memo?: string
}

/** 部分 単価改定（特定カテゴリの N件 に対して 月M以降 売上が +X円/件/日 or +X% 継続加算） */
export interface PriceRevision {
  id: string
  effectiveMonth: string
  category: WorkerCategory
  count: number
  amountPerCaseDay?: number    // +X円/件/日（売上増分・絶対額）
  pctOfBase?: number           // +X%（revenuePerCase の%）
  memo?: string
}

/** 条件変更の対象：
 *  'revenue' = 全体の1日あたり単価（Planレベル）を改定
 *  WorkerCategory = そのカテゴリの原価を改定
 */
export type ChangeTarget = WorkerCategory | 'revenue'

/** 条件変更（単価 or カテゴリ原価の改定） effectiveMonth 以降に適用 */
export interface ConditionChange {
  id: string
  effectiveMonth: string
  /** 対象。'revenue' は全体の単価改定、カテゴリ名はそのカテゴリの原価改定 */
  category: ChangeTarget
  newRevenuePerCase?: number   // category='revenue' の時に使用
  newCostModel?: CostModel     // category=<cat> の時に使用
  newCostRate?: number
  newCostAmount?: number
  reason?: string
}

/** 計画本体 */
export interface Plan {
  id: string
  name: string
  /** 基準月 yyyy-mm */
  baseMonth: string
  /** 通常12ヶ月、最大36ヶ月 */
  horizonMonths: number
  /** 基準月期首の初期件数 */
  initialCounts: CategoryMap<number>
  /** 1日あたりの案件単価（全カテゴリ共通・円） */
  revenuePerCase: number
  /** カテゴリの原価設定（単価はPlanレベル） */
  categories: CategoryMap<CategoryConfig>

  /** 獲得配車比率（%） カテゴリ別の配分比（デフォルト） */
  acquisitionRatio: Ratios
  /** 終了配車比率（%） デフォルト */
  terminationRatio: Ratios
  /** 月別の配車比率オーバーライド */
  monthlyRatios: MonthlyRatioOverride[]
  /** 月次の獲得・終了合計件数 */
  monthlyTotals: MonthlyTotal[]
  /** 月ごとの計算日数（yyyy-mm → 日数）。未設定月はデフォルト日数を使用 */
  workingDaysByMonth: Record<string, number>
  /** デフォルトの計算日数（通常 20 日） */
  defaultWorkingDays: number
  /** 同区分入替の原価引き上げ額（デフォルト・年度一律）。1件1日あたり円 */
  diagonalUplift: DiagonalUplift
  /** 同区分入替 原価引き上げ額の月別上書き */
  diagonalUpliftByMonth: MonthlyDiagonalUpliftOverride[]
  /** 月次マイスター売上（yyyy-mm → 円）。案件プール内の「マイスター代走分」を表す。
   *  0%原価で、代走先カテゴリの原価率ぶんだけ原価を削減する（粗利増）。売上自体は不変。 */
  meisterRevenueByMonth: Record<string, number>
  /** マイスターの代走先分布（合計100%）。既定は partner:100 (運送店枠の代走がメイン) */
  meisterAllocation: CategoryMap<number>
  /** 単価アップ（累積型、還元率付き） */
  priceIncreases: PriceIncrease[]
  /** FY2026 コホート別単価・粗利設定（継続・終了は plan.revenuePerCase と plan.categories の原価率） */
  cohortPricing: CohortPricing
  /** 年度予算（売上・粗利） */
  budget: AnnualBudget

  /** 入替 */
  transfers: TransferEvent[]
  /** 条件変更（旧式: 全体単価/カテゴリ原価率の改定） */
  conditionChanges: ConditionChange[]
  /** 部分 原価改定（N件に対する +X円/件/日 の継続加算） */
  costRevisions: CostRevision[]
  /** 部分 単価改定（N件に対する売上の +X円/件/日 or +X% の継続加算） */
  priceRevisions: PriceRevision[]
  /** 前年実績（参考表示用。計算には影響しない） */
  priorYear?: PriorYearPlan
  updatedAt?: string
}

/** 年度予算（年間合計 + 月別上書き）
 *  月別上書きが無い月は annual / horizonMonths で均等按分して扱います。
 */
export interface AnnualBudget {
  /** 年間売上予算（円） */
  revenue: number
  /** 年間粗利予算（円） */
  grossProfit: number
  /** 月別 売上予算（yyyy-mm → 円）。未設定月は均等按分 */
  revenueByMonth: Record<string, number>
  /** 月別 粗利予算（yyyy-mm → 円）。未設定月は均等按分 */
  grossProfitByMonth: Record<string, number>
}

/* ======= 前年実績（参考データ） ======= */

/** 前年の月次データ */
export interface PriorYearMonthly {
  /** yyyy-mm 形式（前年の月） */
  month: string
  /** 獲得総件数（合計・acquisitionByCategory が与えられている場合はその合計） */
  acquisition: number
  /** 終了総件数（合計） */
  termination: number
  /** カテゴリ別 獲得件数（任意・より詳細な実績） */
  acquisitionByCategory?: CategoryMap<number>
  /** カテゴリ別 終了件数 */
  terminationByCategory?: CategoryMap<number>
  /** 前年 売上（円・参考） */
  revenue?: number
  /** 前年 粗利（円・参考） */
  grossProfit?: number
  /** マイスター売上（円・参考）
   *  営業社員が運送店/業者/雇用枠を代走した分の売上相当額。
   *  粗利には既にマイスター効果が織り込まれているため、**情報表示専用**。 */
  meisterRevenue?: number
  memo?: string
}

/** 前年実績の年次集計（参考値。計算には影響しない、計画の妥当性チェックと引き継ぎ用） */
export interface PriorYearAnnualSummary {
  /** 獲得案件の平均単価（円/日） */
  acquisitionUnitPrice?: number
  /** 獲得案件の粗利率（%、合算） */
  acquisitionMarginPct?: number
  /** 終了案件の平均単価（円/日） */
  terminationUnitPrice?: number
  /** 終了案件の粗利率（%、合算） */
  terminationMarginPct?: number
}

/** 前年実績プラン */
export interface PriorYearPlan {
  /** 会計年度ラベル 例 "FY2025" */
  fiscalYear: string
  /** 開始月 yyyy-mm */
  baseMonth: string
  horizonMonths: number
  initialCounts: CategoryMap<number>
  acquisitionRatio: Ratios
  terminationRatio: Ratios
  monthlyData: PriorYearMonthly[]
  transfers: TransferEvent[]
  /** 月ごとの計算日数（yyyy-mm → 日数） */
  workingDaysByMonth: Record<string, number>
  defaultWorkingDays: number
  /** 同区分入替の原価引き上げ額（前年実績値） */
  diagonalUplift: DiagonalUplift
  /** 月別上書き */
  diagonalUpliftByMonth: MonthlyDiagonalUpliftOverride[]
  /** 年次集計サマリー（オプション・参考値） */
  annualSummary?: PriorYearAnnualSummary
}

// 計算結果

export interface CategoryMonthlyCell {
  count: number
  /** 当月に獲得された件数（按分後の整数） */
  newCases: number
  /** 当月に終了した件数（按分後の整数） */
  endingCases: number
  revenue: number
  cost: number
  profit: number
  effectiveRevenuePerCase: number
  costModel: CostModel
  effectiveCostRate?: number
  effectiveCostAmount?: number
}

export interface MonthlyRow {
  month: string
  byCategory: CategoryMap<CategoryMonthlyCell>
  totalCount: number
  totalRevenue: number
  totalCost: number
  totalProfit: number
  margin: number
  newTotal: number
  endTotal: number
  transfersTotal: number
}
