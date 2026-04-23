/**
 * Claude (Anthropic) tool definitions と実行ディスパッチャ。
 *
 * 設計方針:
 * - **読取系ツール** (`inspect_plan`, `compute_monthly`, `list_snapshots`, `diff_snapshots` 等)
 *   はユーザー承認なしで自動実行
 * - **書込系ツール** (`propose_plan_update`, `save_knowledge`) は承認キューに入れて
 *   UI で「適用する/しない」を選ばせる
 * - tool_input は JSON Schema で定義。Claude が正しく値を生成できるよう明確に書く
 */

import type { Plan } from '../types'
import type { PriorYearCaseDetail } from '../types'
import type { AssistantKnowledge, PlanSnapshot } from './types'
import {
  computeMonthly,
  computeMarginBridge,
  computePriorYearMonthlySeries,
  cumulativePriceIncreaseAt,
  effectiveAcquisitionBasePrice,
  effectiveAcquisitionUnitPrice,
  effectiveTerminationBasePrice,
  effectiveTerminationUnitPrice,
} from '../utils/calculations'
import { monthsRange } from '../utils/month'

/** Claude に渡す tool スキーマ */
export const ASSISTANT_TOOLS = [
  {
    name: 'inspect_plan',
    description:
      '現在の FY2026 計画（plan）の主要パラメータをざっくり取得する。'
      + ' 初期件数・カテゴリ原価率・配車比率・獲得/終了単価などをまとめて返す。'
      + ' 特定の期間や案件明細は対象外。',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'compute_monthly',
    description:
      'FY2026 12ヶ月の月次計算結果（売上・原価・粗利・粗利率・日計・件数構成比）を計算して返す。'
      + ' 年間合計も返す。粗利率の月次推移や前年同月比較の質問に使う。',
    input_schema: {
      type: 'object' as const,
      properties: {
        months: {
          type: 'array',
          items: { type: 'string', description: 'yyyy-mm 形式の月指定。指定した月のみ返す' },
          description: '（省略可）特定月のみに絞る。未指定なら12ヶ月分すべて',
        },
      },
    },
  },
  {
    name: 'compute_margin_bridge',
    description:
      '月次粗利率の分解ブリッジを取得する（期首ベース / 獲得終了Pt / 入替Pt / 単価UPPt / 改定Pt / uplift / マイスターPt）。'
      + ' 「なぜ○月の粗利率が△△％上がった？」のような因果分析に使う。',
    input_schema: {
      type: 'object' as const,
      properties: {
        month: { type: 'string', description: '対象月 yyyy-mm（例: 2026-11）' },
      },
      required: ['month'],
    },
  },
  {
    name: 'inspect_prior_year',
    description:
      '前年（FY2025）実績データの要約を取得する。月次の売上・粗利・獲得/終了件数・案件明細サマリーを含む。'
      + ' 前年同月比較や、前年傾向の分析に使う。',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'search_cases',
    description:
      '前年（FY2025）案件明細を条件検索する。月・kind（獲得/終了）・カテゴリ・メイン/サブ・支店などで絞り込み、'
      + ' 該当件数と一部のサンプル（最大 10 件）を返す。個別の案件特定や傾向分析に使う。',
    input_schema: {
      type: 'object' as const,
      properties: {
        planMonth: { type: 'string', description: '（省略可）yyyy-mm' },
        kind: { type: 'string', enum: ['acq', 'term'], description: '（省略可）獲得 acq / 終了 term' },
        ptCategory: { type: 'string', enum: ['partner', 'vendor', 'employment'], description: '（省略可）運送店=partner / 業者=vendor / 社員=employment' },
        mainSub: { type: 'string', enum: ['メイン', 'サブ'], description: '（省略可）' },
        branch: { type: 'string', description: '（省略可）支店名で部分一致' },
        caseType: { type: 'string', description: '（省略可）案件区分（新規/増車/入替/復活等）' },
        limit: { type: 'number', description: '返すサンプル件数。未指定 10、最大 50' },
      },
    },
  },
  {
    name: 'simulate_plan_update',
    description:
      'plan に仮の修正を当てた「シナリオ試算」を行う。実際の plan は変更されない。'
      + ' 「業者の3月比率を○%にしたら粗利率はどうなる？」等の what-if に使う。'
      + ' patch は plan の部分オブジェクト（例: acquisitionRatio, cohortPricing など）。',
    input_schema: {
      type: 'object' as const,
      properties: {
        patch: {
          type: 'object',
          description: 'plan に Object.assign するパッチ。深い merge ではなく浅い差分のみ',
        },
      },
      required: ['patch'],
    },
  },
  {
    name: 'propose_plan_update',
    description:
      'plan への正式な変更を提案する。ユーザー承認後に実行される（自動では反映されない）。'
      + ' 承認ダイアログで差分が表示されるので、どのフィールドをどう変えたいか具体的に指定すること。',
    input_schema: {
      type: 'object' as const,
      properties: {
        patch: {
          type: 'object',
          description: 'plan に Object.assign する patch',
        },
        rationale: { type: 'string', description: 'なぜこの変更なのか、ユーザー向けの簡潔な説明' },
      },
      required: ['patch', 'rationale'],
    },
  },
  {
    name: 'save_knowledge',
    description:
      'ユーザーが教えた前提知識・ナレッジを保存する。以後の会話で自動的に文脈として参照される。'
      + ' 例: 「運送店の手数料は18%」「マイスターは社員代走で1h=3000円」。',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: '記録する内容（1〜200字程度を推奨）' },
        tags: { type: 'array', items: { type: 'string' }, description: '任意のタグ' },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_snapshots',
    description:
      '過去の plan スナップショット一覧を取得する（日時・ラベル・保存理由）。'
      + ' 「X月と比べて何が変わった？」の比較に使う前の下調べ。',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'diff_snapshot',
    description:
      '指定したスナップショットと現在の plan の差分を取得する。主要パラメータのみ比較し、変化したフィールド一覧を返す。',
    input_schema: {
      type: 'object' as const,
      properties: {
        snapshotId: { type: 'string', description: 'list_snapshots で得た id' },
      },
      required: ['snapshotId'],
    },
  },
]

export type ToolName =
  | 'inspect_plan'
  | 'compute_monthly'
  | 'compute_margin_bridge'
  | 'inspect_prior_year'
  | 'search_cases'
  | 'simulate_plan_update'
  | 'propose_plan_update'
  | 'save_knowledge'
  | 'list_snapshots'
  | 'diff_snapshot'

export interface ToolContext {
  plan: Plan
  knowledge: AssistantKnowledge[]
  snapshots: PlanSnapshot[]
}

export interface ToolExecutionResult {
  /** Claude に戻す JSON 文字列 */
  resultJSON: string
  /** UI 表示用の短い要約 */
  summary: string
  /** 承認待ちフラグ。true なら UI 側で確認を取ってから適用 */
  pendingApproval?: {
    kind: 'plan_update' | 'save_knowledge'
    payload: any
  }
}

/** plan に patch を当てた新 plan を返す（浅いマージ）。 */
function applyPatchShallow(plan: Plan, patch: Partial<Plan>): Plan {
  return { ...plan, ...(patch as any) }
}

function summarizeMonthlyRow(r: any): any {
  return {
    month: r.month,
    count: r.totalCount,
    acq: r.acquisition,
    term: r.termination,
    revenue: r.totalRevenue,
    cost: r.totalCost,
    profit: r.totalProfit,
    margin: r.margin,
    daily: r.daily,
    shares: {
      partner: Math.round(r.sharePartner * 10) / 10,
      vendor: Math.round(r.shareVendor * 10) / 10,
      employment: Math.round(r.shareEmployment * 10) / 10,
    },
  }
}

/** ツール実行ディスパッチャ */
export async function executeTool(
  name: ToolName,
  input: any,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  switch (name) {
    case 'inspect_plan': {
      const p = ctx.plan
      const out = {
        businessUnit: undefined as string | undefined,  // App が埋める
        fiscalYear: 'FY2026',
        baseMonth: p.baseMonth,
        revenuePerCase: p.revenuePerCase,
        initialCounts: p.initialCounts,
        categories: p.categories,
        acquisitionRatio: p.acquisitionRatio,
        terminationRatio: p.terminationRatio,
        monthlyRatios_count: p.monthlyRatios?.length ?? 0,
        monthlyTotals: p.monthlyTotals,
        acquisitionUnitPrice: Math.round(effectiveAcquisitionUnitPrice(p)),
        acquisitionBase: Math.round(effectiveAcquisitionBasePrice(p)),
        terminationUnitPrice: Math.round(effectiveTerminationUnitPrice(p)),
        terminationBase: Math.round(effectiveTerminationBasePrice(p)),
        cohortPricing: p.cohortPricing,
        costUpliftCommissionRate: p.costUpliftCommissionRate,
        diagonalUplift: p.diagonalUplift,
        transfersCount: p.transfers?.length ?? 0,
        priceIncreasesCount: p.priceIncreases?.length ?? 0,
        costRevisionsCount: p.costRevisions?.length ?? 0,
        priceRevisionsCount: p.priceRevisions?.length ?? 0,
        budget: p.budget,
        hasPriorYear: !!p.priorYear,
        hasCases: (p.priorYear?.cases?.length ?? 0) > 0,
        caseCount: p.priorYear?.cases?.length ?? 0,
      }
      return {
        resultJSON: JSON.stringify(out, null, 2),
        summary: `plan 概要を取得（初期 ${Object.values(p.initialCounts).reduce((a, b) => a + b, 0)} 件・予算 ¥${p.budget?.revenue?.toLocaleString() ?? 0}）`,
      }
    }

    case 'compute_monthly': {
      const rows = computeMonthly(ctx.plan)
      const filtered = Array.isArray(input?.months) && input.months.length > 0
        ? rows.filter((r) => input.months.includes(r.month))
        : rows
      const simplified = filtered.map(summarizeMonthlyRow)
      const tot = filtered.reduce(
        (s, r) => ({
          revenue: s.revenue + r.totalRevenue,
          cost: s.cost + r.totalCost,
          profit: s.profit + r.totalProfit,
        }),
        { revenue: 0, cost: 0, profit: 0 },
      )
      return {
        resultJSON: JSON.stringify({
          months: simplified,
          total: { ...tot, margin: tot.revenue > 0 ? tot.profit / tot.revenue : 0 },
        }, null, 2),
        summary: `${filtered.length} ヶ月の計算結果を取得（売上 ¥${(tot.revenue / 1_000_000).toFixed(1)}M / 粗利 ¥${(tot.profit / 1_000_000).toFixed(1)}M）`,
      }
    }

    case 'compute_margin_bridge': {
      const bridge = computeMarginBridge(ctx.plan)
      const row = bridge.find((r) => r.month === input.month)
      if (!row) {
        return {
          resultJSON: JSON.stringify({ error: `月 ${input.month} が見つからない` }),
          summary: `月 ${input.month} の粗利率ブリッジ取得失敗`,
        }
      }
      const pct = (v: number) => Math.round(v * 10000) / 100
      const out = {
        month: row.month,
        期首ベース粗利率: pct(row.initialMarginRef),
        獲得終了Pt: pct(row.acqtermPt),
        入替Pt: pct(row.transferPt),
        ベース粗利率: pct(row.baseMargin),
        単価UPPt: pct(row.priceupPt),
        改定Pt: pct(row.revisionPt),
        upliftPt: pct(row.upliftPt),
        運営実効粗利率: pct(row.effectiveMargin),
        マイスターPt: pct(row.meisterPt),
        実効粗利率_含マイスター: pct(row.marginWithMeister),
      }
      return {
        resultJSON: JSON.stringify(out, null, 2),
        summary: `${row.month} 粗利率ブリッジ: ベース ${pct(row.baseMargin)}% / 実効 ${pct(row.marginWithMeister)}%`,
      }
    }

    case 'inspect_prior_year': {
      const py = ctx.plan.priorYear
      if (!py) {
        return {
          resultJSON: JSON.stringify({ error: '前年実績データがありません' }),
          summary: '前年実績データなし',
        }
      }
      const series = computePriorYearMonthlySeries(py)
      const totals = series.reduce((s, r) => ({
        revenue: s.revenue + r.revenue,
        gp: s.gp + r.grossProfit,
      }), { revenue: 0, gp: 0 })
      const out = {
        fiscalYear: py.fiscalYear,
        baseMonth: py.baseMonth,
        initialCounts: py.initialCounts,
        annualSummary: py.annualSummary,
        totals: {
          revenue: totals.revenue,
          grossProfit: totals.gp,
          margin: totals.revenue > 0 ? totals.gp / totals.revenue : 0,
        },
        monthlySeries: series.map((r) => ({
          month: r.month,
          rev: r.revenue,
          gp: r.grossProfit,
          acq: r.acquisition,
          term: r.termination,
        })),
        caseCount: py.cases?.length ?? 0,
      }
      return {
        resultJSON: JSON.stringify(out, null, 2),
        summary: `前年実績: 売上 ¥${(totals.revenue / 1_000_000).toFixed(1)}M / 粗利 ¥${(totals.gp / 1_000_000).toFixed(1)}M`,
      }
    }

    case 'search_cases': {
      const cases: PriorYearCaseDetail[] = ctx.plan.priorYear?.cases ?? []
      const filtered = cases.filter((c) => {
        if (input?.planMonth && c.planMonth !== input.planMonth) return false
        if (input?.kind && c.kind !== input.kind) return false
        if (input?.ptCategory && c.ptCategory !== input.ptCategory) return false
        if (input?.mainSub && c.mainSub !== input.mainSub) return false
        if (input?.branch && !(c.branch ?? '').includes(input.branch)) return false
        if (input?.caseType && c.caseType !== input.caseType) return false
        return true
      })
      const limit = Math.min(Number(input?.limit) || 10, 50)
      const samples = filtered.slice(0, limit).map((c) => ({
        sfId: c.sfId,
        planMonth: c.planMonth,
        kind: c.kind,
        branch: c.branch,
        customer: c.customer,
        caseType: c.caseType,
        pt: c.ptCategory,
        mainSub: c.mainSub,
        contractUnitPrice: c.contractUnitPrice,
        plannedWorkDays: c.plannedWorkDays,
        workingHoursPerDay: c.workingHoursPerDay,
        revenue: c.plannedRevenue,
        gp: c.plannedGP,
      }))
      return {
        resultJSON: JSON.stringify({ totalMatched: filtered.length, samples }, null, 2),
        summary: `${filtered.length} 件ヒット（サンプル ${samples.length} 件返却）`,
      }
    }

    case 'simulate_plan_update': {
      if (!input?.patch || typeof input.patch !== 'object') {
        return {
          resultJSON: JSON.stringify({ error: 'patch が必要' }),
          summary: 'simulate 失敗: patch 未指定',
        }
      }
      const simulatedPlan = applyPatchShallow(ctx.plan, input.patch)
      const rows = computeMonthly(simulatedPlan)
      const tot = rows.reduce((s, r) => ({
        rev: s.rev + r.totalRevenue,
        gp: s.gp + r.totalProfit,
      }), { rev: 0, gp: 0 })
      const base = computeMonthly(ctx.plan).reduce((s, r) => ({
        rev: s.rev + r.totalRevenue,
        gp: s.gp + r.totalProfit,
      }), { rev: 0, gp: 0 })
      return {
        resultJSON: JSON.stringify({
          before: { revenue: base.rev, grossProfit: base.gp, margin: base.rev > 0 ? base.gp / base.rev : 0 },
          after: { revenue: tot.rev, grossProfit: tot.gp, margin: tot.rev > 0 ? tot.gp / tot.rev : 0 },
          delta: {
            revenue: tot.rev - base.rev,
            grossProfit: tot.gp - base.gp,
            margin: (tot.rev > 0 ? tot.gp / tot.rev : 0) - (base.rev > 0 ? base.gp / base.rev : 0),
          },
          monthly: rows.map(summarizeMonthlyRow),
        }, null, 2),
        summary: `シミュレーション完了: 売上差 ${((tot.rev - base.rev) / 1_000_000).toFixed(1)}M / 粗利差 ${((tot.gp - base.gp) / 1_000_000).toFixed(1)}M`,
      }
    }

    case 'propose_plan_update': {
      // UI 側で承認ダイアログを出して、承認されたら patch を適用する
      return {
        resultJSON: JSON.stringify({
          status: 'pending_approval',
          patch: input.patch,
          rationale: input.rationale,
        }, null, 2),
        summary: `plan 更新を提案: ${input.rationale ?? ''}`,
        pendingApproval: {
          kind: 'plan_update',
          payload: { patch: input.patch, rationale: input.rationale },
        },
      }
    }

    case 'save_knowledge': {
      return {
        resultJSON: JSON.stringify({ status: 'pending_approval', content: input.content, tags: input.tags }, null, 2),
        summary: `ナレッジ保存を提案: ${String(input.content).slice(0, 40)}…`,
        pendingApproval: {
          kind: 'save_knowledge',
          payload: { content: input.content, tags: input.tags ?? [] },
        },
      }
    }

    case 'list_snapshots': {
      const list = ctx.snapshots.map((s) => ({
        id: s.id,
        savedAt: s.savedAt,
        label: s.label,
        reason: s.reason,
      }))
      return {
        resultJSON: JSON.stringify(list, null, 2),
        summary: `${list.length} 件のスナップショット`,
      }
    }

    case 'diff_snapshot': {
      const snap = ctx.snapshots.find((s) => s.id === input.snapshotId)
      if (!snap) {
        return {
          resultJSON: JSON.stringify({ error: 'snapshotId not found' }),
          summary: `snapshot ${input.snapshotId} が見つからない`,
        }
      }
      // 主要フィールドのみ差分
      const key = (p: Plan) => ({
        revenuePerCase: p.revenuePerCase,
        initialCounts: p.initialCounts,
        categories: p.categories,
        acquisitionRatio: p.acquisitionRatio,
        terminationRatio: p.terminationRatio,
        cohortPricing: p.cohortPricing,
        diagonalUplift: p.diagonalUplift,
        costUpliftCommissionRate: p.costUpliftCommissionRate,
        budget: p.budget,
        monthlyTotals: p.monthlyTotals,
        monthlyRatios_count: p.monthlyRatios?.length ?? 0,
        transfersCount: p.transfers?.length ?? 0,
        priceIncreasesCount: p.priceIncreases?.length ?? 0,
      })
      const a = key(snap.plan)
      const b = key(ctx.plan)
      const diff: Record<string, { from: any; to: any }> = {}
      for (const k of Object.keys(a) as (keyof typeof a)[]) {
        const aJson = JSON.stringify(a[k])
        const bJson = JSON.stringify(b[k])
        if (aJson !== bJson) diff[k as string] = { from: a[k], to: b[k] }
      }
      return {
        resultJSON: JSON.stringify({ snapshotId: snap.id, savedAt: snap.savedAt, label: snap.label, diff }, null, 2),
        summary: `${Object.keys(diff).length} フィールド変化 (vs ${snap.label ?? snap.savedAt})`,
      }
    }
  }
}
