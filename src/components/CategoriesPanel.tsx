import { useEffect, useMemo, useState } from 'react'
import { usePlanStore } from '../store'
import type { CategoryConfig, CategoryMap, CostModel, Plan, WorkerCategory } from '../types'
import { WorkerCategoryLabels, WorkerCategoryOrder } from '../types'
import {
  budgetRevenueOf,
  computeMonthly,
  computePriorYearEndCounts,
  computePriorYearMonthlySeries,
  effectiveAcquisitionProfitPerCaseDay,
  effectiveAcquisitionUnitPrice,
  estimateAverageRevenuePerCase,
  estimateCostRatesComparisonWithMeister,
  estimatePriorYearLastMonthUnitPrice,
  estimateSegmentCostRatesFromPriorLastMonth,
  estimateSegmentCostRatesWithDelta,
  yen,
} from '../utils/calculations'
import { monthsRange } from '../utils/month'

export default function CategoriesPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)

  function updateCategory(cat: WorkerCategory, patch: Partial<CategoryConfig>) {
    setPlan((p) => {
      const next = { ...p.categories[cat], ...patch }
      // 原価モデル切替時は不使用側の値をクリア（表示の紛らわしさ回避）
      if (patch.costModel === 'rate') next.costAmount = 0
      else if (patch.costModel === 'amount') next.costRate = 0
      return {
        ...p,
        categories: { ...p.categories, [cat]: next },
      }
    })
  }

  function updateInitialCount(cat: WorkerCategory, count: number) {
    setPlan((p) => ({
      ...p,
      initialCounts: { ...p.initialCounts, [cat]: Math.max(0, Math.round(count)) },
    }))
  }

  function updateRevenuePerCase(v: number) {
    setPlan((p) => ({ ...p, revenuePerCase: Math.max(0, Math.round(v)) }))
  }

  const totalInitial = WorkerCategoryOrder.reduce((s, c) => s + plan.initialCounts[c], 0)
  const days = plan.workingDaysByMonth?.[plan.baseMonth] ?? plan.defaultWorkingDays

  // 前年実績からの参考値
  const priorEnd = useMemo(
    () => (plan.priorYear ? computePriorYearEndCounts(plan.priorYear) : null),
    [plan.priorYear],
  )
  const priorAvgRevenue = useMemo(
    () => (plan.priorYear ? estimateAverageRevenuePerCase(plan.priorYear) : null),
    [plan.priorYear],
  )
  const priorLast = useMemo(
    () => (plan.priorYear ? estimatePriorYearLastMonthUnitPrice(plan.priorYear) : null),
    [plan.priorYear],
  )

  function applyEndCountsOnly() {
    if (!plan.priorYear) {
      alert('前年実績が未登録です。')
      return
    }
    const end = computePriorYearEndCounts(plan.priorYear)
    const msg =
      `期首件数のみを前年期末から引き継ぎます:\n\n` +
      `  運送店 ${plan.initialCounts.partner.toLocaleString()} → ${end.partner.toLocaleString()}\n` +
      `  業者   ${plan.initialCounts.vendor.toLocaleString()} → ${end.vendor.toLocaleString()}\n` +
      `  社員   ${plan.initialCounts.employment.toLocaleString()} → ${end.employment.toLocaleString()}`
    if (!confirm(msg)) return
    setPlan((p) => ({ ...p, initialCounts: end }))
  }

  function applyFromAverage() {
    if (!plan.priorYear) return
    const end = computePriorYearEndCounts(plan.priorYear)
    const avgRev = estimateAverageRevenuePerCase(plan.priorYear)
    const msg =
      `期首件数 + 平均単価（前年12ヶ月平均）で反映します:\n\n` +
      `  件数: 合計 ${totalInitial.toLocaleString()} → ${(end.partner + end.vendor + end.employment).toLocaleString()}\n` +
      (avgRev != null
        ? `  単価: ¥${plan.revenuePerCase.toLocaleString()} → ¥${Math.round(avgRev).toLocaleString()}（平均）`
        : '')
    if (!confirm(msg)) return
    setPlan((p) => ({
      ...p,
      initialCounts: end,
      revenuePerCase: avgRev != null ? Math.round(avgRev) : p.revenuePerCase,
    }))
  }

  function applyFromLastMonth() {
    if (!plan.priorYear || !priorLast) {
      alert('前年最終月のデータが見つかりません。')
      return
    }
    const end = computePriorYearEndCounts(plan.priorYear)
    const msg =
      `期首件数 + 最終月(${priorLast.month})の reported 単価で反映します（新モデル推奨）:\n\n` +
      `  件数: 合計 ${totalInitial.toLocaleString()} → ${(end.partner + end.vendor + end.employment).toLocaleString()}\n` +
      `  単価: ¥${plan.revenuePerCase.toLocaleString()} → ¥${Math.round(priorLast.unitPrice).toLocaleString()}（reported基準）\n\n` +
      `  [参考] reported 基準（案件プール=新モデル正解）: ¥${Math.round(priorLast.reportedUnitPrice).toLocaleString()}\n` +
      `        ops 基準（マイスター抜き・旧モデル）:      ¥${Math.round(priorLast.opsUnitPrice).toLocaleString()}\n\n` +
      `※ 新モデルではマイスターは案件プール内の代走分（売上は不変、代走先の原価率ぶん原価減）。\n` +
      `  reported 単価 × 件数 × 日数 = FY2025 最終月の会計売上と整合。`
    if (!confirm(msg)) return
    setPlan((p) => ({
      ...p,
      initialCounts: end,
      revenuePerCase: Math.round(priorLast.unitPrice),
    }))
  }

  /** 2026-03 実績からセグメント原価率を推定して反映（R=V仮定） */
  function applySegmentCostRatesFromLastMonth() {
    if (!plan.priorYear) {
      alert('前年実績が未登録です。')
      return
    }
    const derived = estimateSegmentCostRatesFromPriorLastMonth(plan.priorYear)
    if (!derived) {
      alert('前年実績から推定できません（データ不足）。')
      return
    }
    const msg =
      `${derived.month} 実績から推定されたセグメント別原価率（R=V仮定）:\n\n` +
      `  運送店: ${derived.partner.toFixed(2)}%\n` +
      `  業者:   ${derived.vendor.toFixed(2)}%\n` +
      `  社員:   ${derived.employment.toFixed(2)}%\n\n` +
      `これを FY2026 のベース原価率（期初スナップショット）として反映します。月次イベント（獲得/終了/入替の累積 uplift等）で実効率は変動します。`
    if (!confirm(msg)) return
    setPlan((p) => ({
      ...p,
      categories: {
        partner: { ...p.categories.partner, costModel: 'rate', costRate: derived.partner, costAmount: 0 },
        vendor: { ...p.categories.vendor, costModel: 'rate', costRate: derived.vendor, costAmount: 0 },
        employment: { ...p.categories.employment, costModel: 'rate', costRate: derived.employment, costAmount: 0 },
      },
    }))
  }

  return (
    <div>
      {plan.priorYear && (
        <div className="card" style={{ background: '#ede9fe', borderColor: '#c4b5fd' }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ margin: 0, color: '#5b21b6' }}>前年実績から初期値を反映</h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                FY2025 期末の件数をFY2026期首に引き継ぎ。単価は「平均」or「最終月」から選択。
              </div>
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button className="small ghost" onClick={applyEndCountsOnly}>期首件数のみ</button>
              <button className="small ghost" onClick={applyFromAverage}>件数+平均単価</button>
              <button className="small" onClick={applyFromLastMonth}>件数+最終月単価（推奨）</button>
              <button className="small" onClick={applySegmentCostRatesFromLastMonth} style={{ background: '#7c3aed' }}>
                2026-03 実績から原価率を推定
              </button>
            </div>
          </div>
          {priorEnd && (
            <div className="scroll-x" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>区分</th>
                    <th>FY2025 期末（件）</th>
                    <th>FY2026 現在の期首（件）</th>
                    <th>差</th>
                  </tr>
                </thead>
                <tbody>
                  {WorkerCategoryOrder.map((cat) => {
                    const endV = priorEnd[cat]
                    const curV = plan.initialCounts[cat]
                    const diff = curV - endV
                    return (
                      <tr key={`pyend-${cat}`}>
                        <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                        <td className="mono">{endV.toLocaleString()}</td>
                        <td className="mono">{curV.toLocaleString()}</td>
                        <td className="mono" style={{ color: diff === 0 ? '#94a3b8' : diff > 0 ? '#dc2626' : '#16a34a' }}>
                          {diff === 0 ? '—（一致）' : diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td><strong>合計</strong></td>
                    <td className="mono"><strong>{(priorEnd.partner + priorEnd.vendor + priorEnd.employment).toLocaleString()}</strong></td>
                    <td className="mono"><strong>{totalInitial.toLocaleString()}</strong></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <div className="scroll-x" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>1日あたり単価（参考）</th>
                  <th>値</th>
                  <th>備考</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="muted">当年 現在</td>
                  <td className="mono"><strong>¥{plan.revenuePerCase.toLocaleString()}</strong></td>
                  <td className="muted">FY2026 基準値</td>
                </tr>
                {priorAvgRevenue != null && (
                  <tr>
                    <td className="muted">前年 12ヶ月平均</td>
                    <td className="mono">¥{Math.round(priorAvgRevenue).toLocaleString()}</td>
                    <td className="muted">年間トータル÷(件数×日数)</td>
                  </tr>
                )}
                {priorLast && (
                  <tr style={{ background: '#ede9fe' }}>
                    <td><strong>前年 最終月（{priorLast.month}）★推奨</strong></td>
                    <td className="mono"><strong>¥{Math.round(priorLast.unitPrice).toLocaleString()}</strong></td>
                    <td className="muted">FY2026開始直前の単価。直近トレンド反映</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h3>案件単価（全カテゴリ共通）</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          請求単価は配車区分（運送店/業者/社員）に依らず同一です。入替は<strong>原価率の変動のみ</strong>をもたらし、売上は変動しません。
        </div>
        <div className="form-grid">
          <div>
            <label>1日あたり 案件単価（円）</label>
            <div className="row" style={{ gap: 4, alignItems: 'center' }}>
              <button
                className="small ghost"
                onClick={() => updateRevenuePerCase(plan.revenuePerCase - 100)}
                title="-100 円"
                style={{ padding: '4px 8px' }}
              >
                −100
              </button>
              <button
                className="small ghost"
                onClick={() => updateRevenuePerCase(plan.revenuePerCase - 10)}
                title="-10 円"
                style={{ padding: '4px 8px' }}
              >
                −10
              </button>
              <input
                type="number"
                min={0}
                step={1}
                value={plan.revenuePerCase}
                onChange={(e) => updateRevenuePerCase(Number(e.target.value) || 0)}
                style={{ flex: 1, minWidth: 100 }}
              />
              <button
                className="small ghost"
                onClick={() => updateRevenuePerCase(plan.revenuePerCase + 10)}
                title="+10 円"
                style={{ padding: '4px 8px' }}
              >
                +10
              </button>
              <button
                className="small ghost"
                onClick={() => updateRevenuePerCase(plan.revenuePerCase + 100)}
                title="+100 円"
                style={{ padding: '4px 8px' }}
              >
                +100
              </button>
            </div>
            {priorLast && (
              <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
                参考（{priorLast.month} 実績）:{' '}
                <button
                  className="small ghost"
                  onClick={() => updateRevenuePerCase(Math.round(priorLast.reportedUnitPrice))}
                  style={{ padding: '1px 6px', fontSize: 11 }}
                  title="クリックでこの値をセット"
                >
                  reported ¥{Math.round(priorLast.reportedUnitPrice).toLocaleString()}
                </button>
                {' / '}
                <button
                  className="small ghost"
                  onClick={() => updateRevenuePerCase(Math.round(priorLast.opsUnitPrice))}
                  style={{ padding: '1px 6px', fontSize: 11 }}
                  title="クリックでこの値をセット"
                >
                  ops ¥{Math.round(priorLast.opsUnitPrice).toLocaleString()}
                </button>
                {(() => {
                  const diff = plan.revenuePerCase - Math.round(priorLast.reportedUnitPrice)
                  if (diff === 0) return null
                  return (
                    <span style={{ color: '#64748b', marginLeft: 8 }}>
                      現在値は reported との差 {diff >= 0 ? '+' : ''}¥{diff.toLocaleString()}
                    </span>
                  )
                })()}
              </div>
            )}
          </div>
          <div>
            <label>月次売上の試算（{days} 営業日 × 期首件数 {totalInitial.toLocaleString()} 件）</label>
            <input
              readOnly
              value={`¥${yen(plan.revenuePerCase * days * totalInitial)}`}
              style={{ background: '#f8fafc', color: '#475569', fontFamily: 'inherit' }}
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              日計 = {totalInitial.toLocaleString()}件 × ¥{plan.revenuePerCase.toLocaleString()} ={' '}
              <strong>¥{yen(plan.revenuePerCase * totalInitial)}/日</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h3>カテゴリ別 期首件数・原価設定</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            単価は全カテゴリ共通。原価のみカテゴリで差をつけます。「条件変更」から月別の原価改定も可能です。
          </div>
        </div>

        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>区分</th>
                <th>期首件数</th>
                <th>原価モデル</th>
                <th>原価率（%）</th>
                <th>1日あたり原価（円）</th>
                <th>参考：期首月 粗利率</th>
              </tr>
            </thead>
            <tbody>
              {WorkerCategoryOrder.map((cat) => {
                const c = plan.categories[cat]
                const refRevenue = plan.revenuePerCase
                const refCost = c.costModel === 'rate' ? Math.round((refRevenue * c.costRate) / 100) : c.costAmount
                const refMargin = refRevenue > 0 ? (refRevenue - refCost) / refRevenue : 0
                return (
                  <tr key={cat}>
                    <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={plan.initialCounts[cat]}
                        onChange={(e) => updateInitialCount(cat, Number(e.target.value))}
                        style={{ maxWidth: 120, textAlign: 'right' }}
                      />
                    </td>
                    <td>
                      <select
                        value={c.costModel}
                        onChange={(e) => updateCategory(cat, { costModel: e.target.value as CostModel })}
                        style={{ maxWidth: 160 }}
                      >
                        <option value="rate">原価率(%)</option>
                        <option value="amount">1日あたり金額</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        disabled={c.costModel !== 'rate'}
                        value={c.costRate}
                        onChange={(e) => updateCategory(cat, { costRate: Number(e.target.value) })}
                        style={{ maxWidth: 100, textAlign: 'right' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        disabled={c.costModel !== 'amount'}
                        value={c.costAmount}
                        onChange={(e) => updateCategory(cat, { costAmount: Number(e.target.value) })}
                        style={{ maxWidth: 140, textAlign: 'right' }}
                      />
                    </td>
                    <td className="mono">
                      {(refMargin * 100).toFixed(1)}%
                      <div className="muted" style={{ fontSize: 11 }}>原価 ¥{yen(refCost)} / 日</div>
                    </td>
                  </tr>
                )
              })}
              <tr>
                <td><strong>合計</strong></td>
                <td className="mono"><strong>{totalInitial.toLocaleString()} 件</strong></td>
                <td colSpan={4}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CohortPricingCard />

      <div className="card">
        <h3>参考：期首月のカテゴリ構成</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          期首件数と各カテゴリの原価から計算した「{plan.baseMonth} 時点」の構成比。
          売上 = 件数 × 1日あたり単価 ¥{yen(plan.revenuePerCase)} × {days} 日。
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>区分</th>
                <th>件数</th>
                <th>構成比</th>
                <th>売上</th>
                <th>原価</th>
                <th>粗利</th>
                <th>粗利率</th>
              </tr>
            </thead>
            <tbody>
              {WorkerCategoryOrder.map((cat) => {
                const count = plan.initialCounts[cat]
                const cfg = plan.categories[cat]
                const revenue = count * plan.revenuePerCase * days
                const cost = cfg.costModel === 'rate'
                  ? Math.round((revenue * cfg.costRate) / 100)
                  : count * cfg.costAmount * days
                const profit = revenue - cost
                const margin = revenue > 0 ? profit / revenue : 0
                const ratio = totalInitial > 0 ? count / totalInitial : 0
                return (
                  <tr key={cat}>
                    <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                    <td className="mono">{count.toLocaleString()}</td>
                    <td className="mono">{(ratio * 100).toFixed(1)}%</td>
                    <td className="mono">¥{yen(revenue)}</td>
                    <td className="mono">¥{yen(cost)}</td>
                    <td className="mono">¥{yen(profit)}</td>
                    <td className="mono">{(margin * 100).toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** FY2026 コホート単価設定カード（獲得案件） */
function CohortPricingCard() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const cp = plan.cohortPricing
  const priorSummary = plan.priorYear?.annualSummary

  const acqUnitPrice = effectiveAcquisitionUnitPrice(plan)
  const basePrice = plan.revenuePerCase ?? 0
  const priceDelta = acqUnitPrice - basePrice

  function updateCP(patch: Partial<typeof cp>) {
    setPlan((p) => ({ ...p, cohortPricing: { ...p.cohortPricing, ...patch } }))
  }
  function updateUplift(cat: WorkerCategory, v: number) {
    setPlan((p) => ({
      ...p,
      cohortPricing: {
        ...p.cohortPricing,
        acquisitionProfitUplift: { ...p.cohortPricing.acquisitionProfitUplift, [cat]: Math.round(v) },
      },
    }))
  }

  function copyFromBase() {
    if (!confirm('前年獲得単価に「2026-03 単価」を仮置きします。よろしいですか？')) return
    updateCP({ priorAcquisitionUnitPrice: basePrice })
  }
  function copyFromPriorSummary() {
    const v = priorSummary?.acquisitionUnitPrice
    if (!v) {
      alert('前年の獲得単価サマリーが未登録です。')
      return
    }
    if (!confirm(`前年獲得平均 ¥${v.toLocaleString()} を反映しますか？`)) return
    updateCP({ priorAcquisitionUnitPrice: v })
  }

  // ----- 予算ギャップ診断 -----
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])
  const rows = useMemo(() => computeMonthly(plan), [plan])
  const planTotalRev = rows.reduce((s, r) => s + r.totalRevenue, 0)
  const planTotalProfit = rows.reduce((s, r) => s + r.totalProfit, 0)
  const budgetRev = months.reduce((s, m) => s + budgetRevenueOf(plan, m), 0)
  const budgetProfit = useMemo(() => {
    const b = plan.budget
    const monthlyOverride = months.reduce((s, m) => s + (b.grossProfitByMonth?.[m] ?? 0), 0)
    if (monthlyOverride > 0) return monthlyOverride
    return b.grossProfit ?? 0
  }, [plan.budget, months])
  const hasBudget = budgetRev > 0 || budgetProfit > 0
  const revGap = planTotalRev - budgetRev
  const profitGap = planTotalProfit - budgetProfit

  // 「獲得件数をあと何件増やせば予算埋まるか」感度分析
  //  獲得1件×残平均月数×uplift(粗利)
  //  簡易: 獲得1件で年間どれだけ増えるか = acqUnitPrice × 平均残存月数 × 日数×1
  //  ここでは当年 12ヶ月の平均を取り、1件/月獲得ペースアップの効果を計算
  const avgDays = months.reduce((s, m) => s + (plan.workingDaysByMonth?.[m] ?? plan.defaultWorkingDays), 0) / months.length
  const effectivePerCasePerMonth_Rev = acqUnitPrice * avgDays
  // 獲得1件追加すると、年間でどれだけ貢献するか（獲得時期平均で半年くらい）
  const avgMonthsRemaining = months.length / 2 // avg months in which a new case contributes
  const perExtraCase_AnnualRevenue = Math.round(effectivePerCasePerMonth_Rev * avgMonthsRemaining)

  const weightedMarginPct = (() => {
    // 各カテゴリ原価率の期首件数加重平均を粗利率に
    const totalCount = plan.initialCounts.partner + plan.initialCounts.vendor + plan.initialCounts.employment
    if (totalCount <= 0) return 0
    const weighted = (
      plan.initialCounts.partner * plan.categories.partner.costRate +
      plan.initialCounts.vendor * plan.categories.vendor.costRate +
      plan.initialCounts.employment * plan.categories.employment.costRate
    ) / totalCount
    return 100 - weighted
  })()
  const perExtraCase_AnnualProfit = Math.round(perExtraCase_AnnualRevenue * weightedMarginPct / 100)

  const casesNeededForRevGap = (revGap < 0 && perExtraCase_AnnualRevenue > 0) ? Math.ceil(-revGap / perExtraCase_AnnualRevenue) : 0
  const casesNeededForProfitGap = (profitGap < 0 && perExtraCase_AnnualProfit > 0) ? Math.ceil(-profitGap / perExtraCase_AnnualProfit) : 0

  return (
    <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ color: '#166534', margin: 0 }}>FY2026 コホート別 単価・粗利（獲得案件）</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            継続・終了案件は上記の「案件単価」と「セグメント別原価率」（2026-03 snapshot）を使います。
            獲得案件だけ単価と粗利をここで調整。
          </div>
        </div>
      </div>

      {/* 前年実績サマリー参照 */}
      {(priorSummary || plan.priorYear) && <PriorYearAcquisitionSummary plan={plan} />}

      {/* マイスター考慮した原価率比較 */}
      {plan.priorYear && <MeisterAdjustedCostRateCard plan={plan} />}

      {/* Δpt で運送店/業者の原価率を分離 */}
      {plan.priorYear && <SegmentCostRateSplitterCard />}

      {/* 獲得単価設定 */}
      <div className="card" style={{ background: '#fff', marginTop: 10 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>① 獲得単価（全セグメント共通）</h3>
        <div className="form-grid">
          <div>
            <label>前年（FY2025）獲得案件 平均単価（円/日）</label>
            <div className="row" style={{ gap: 4 }}>
              <input
                type="number"
                min={0}
                value={cp.priorAcquisitionUnitPrice}
                onChange={(e) => updateCP({ priorAcquisitionUnitPrice: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                style={{ flex: 1 }}
              />
              {priorSummary?.acquisitionUnitPrice ? (
                <button className="small" onClick={copyFromPriorSummary} title={`前年実績 ¥${priorSummary.acquisitionUnitPrice.toLocaleString()} を反映`}>
                  前年実績 ¥{priorSummary.acquisitionUnitPrice.toLocaleString()} 引継
                </button>
              ) : (
                <button className="small ghost" onClick={copyFromBase} title="2026-03単価をコピー">継続単価コピー</button>
              )}
            </div>
          </div>
          <div>
            <label>調整 絶対額（+¥/日）</label>
            <input
              type="number"
              value={cp.acquisitionUnitPriceUpAbs}
              onChange={(e) => updateCP({ acquisitionUnitPriceUpAbs: Math.round(Number(e.target.value) || 0) })}
            />
          </div>
          <div>
            <label>調整 率（+%）</label>
            <input
              type="number"
              step={0.1}
              value={cp.acquisitionUnitPriceUpPct}
              onChange={(e) => updateCP({ acquisitionUnitPriceUpPct: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label>→ FY2026 獲得単価（自動）</label>
            <input
              readOnly
              value={`¥${yen(Math.round(acqUnitPrice))} / 日`}
              style={{
                background: '#ecfdf5',
                color: '#166534',
                fontWeight: 700,
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
          継続単価 ¥{yen(basePrice)} vs 獲得単価 ¥{yen(Math.round(acqUnitPrice))} = 差額{' '}
          <strong style={{ color: priceDelta > 0 ? '#16a34a' : priceDelta < 0 ? '#dc2626' : '#64748b' }}>
            {priceDelta >= 0 ? '+' : ''}¥{yen(priceDelta)}/日
          </strong>
          <span style={{ margin: '0 6px', color: '#94a3b8' }}>／</span>
          月換算（20営業日）{' '}
          <strong style={{ color: priceDelta > 0 ? '#16a34a' : priceDelta < 0 ? '#dc2626' : '#64748b' }}>
            {priceDelta >= 0 ? '+' : ''}¥{yen(priceDelta * 20)}/月・1案件あたり
          </strong>
          <br />
          <span className="muted">
            新規獲得1件あたり 売上UP 月額 = 差額 ×20日。獲得件数が溜まるほど累積的に効く（コホート効果）。
          </span>
        </div>
      </div>

      {/* セグメント別 獲得粗利UP */}
      <div className="card" style={{ background: '#fff', marginTop: 8 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>② セグメント別 1案件1日あたり 粗利UP（内訳）</h3>
        <div className="muted" style={{ fontSize: 11, marginBottom: 6, lineHeight: 1.5 }}>
          新規獲得粗利 = <strong>前年粗利</strong> + <strong>単価UP効果</strong>（①の単価UP × (1−原価率) で自動計算）+ <strong>追加UP</strong>（手動入力の追加分）。
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>区分</th>
                <th>2026-03 原価率</th>
                <th>前年獲得 粗利/日</th>
                <th>単価UP効果<br />(自動 +¥/日)</th>
                <th>追加UP<br />（+¥/日）</th>
                <th>→ 新規獲得 粗利/日</th>
                <th>→ 新規獲得 原価率</th>
              </tr>
            </thead>
            <tbody>
              {WorkerCategoryOrder.map((cat) => {
                const info = effectiveAcquisitionProfitPerCaseDay(plan, cat)
                const newRate = acqUnitPrice > 0 ? (1 - info.current / acqUnitPrice) * 100 : 0
                const carryoverRate = plan.categories[cat]?.costRate ?? 0
                return (
                  <tr key={`cu-${cat}`}>
                    <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                    <td className="mono">{carryoverRate.toFixed(1)}%</td>
                    <td className="mono muted">¥{yen(Math.round(info.prior))}</td>
                    <td
                      className="mono"
                      style={{
                        color: info.priceGain > 0 ? '#16a34a' : info.priceGain < 0 ? '#dc2626' : '#64748b',
                        background: '#f0fdf4',
                      }}
                    >
                      {info.priceGain !== 0 ? `${info.priceGain >= 0 ? '+' : ''}¥${yen(Math.round(info.priceGain))}` : '—'}
                    </td>
                    <td style={{ padding: 2 }}>
                      <input
                        type="number"
                        value={cp.acquisitionProfitUplift[cat]}
                        onChange={(e) => updateUplift(cat, Number(e.target.value) || 0)}
                        style={{ width: 96, textAlign: 'right' }}
                      />
                    </td>
                    <td className="mono" style={{ color: '#166534', fontWeight: 700 }}>
                      ¥{yen(Math.round(info.current))}
                    </td>
                    <td className="mono">{newRate.toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 予算ギャップ診断（営業部向けメッセージ） */}
      {hasBudget && (
        <div className="card" style={{
          background: (revGap < 0 || profitGap < 0) ? '#fef2f2' : '#dcfce7',
          borderColor: (revGap < 0 || profitGap < 0) ? '#fecaca' : '#22c55e',
          marginTop: 8,
        }}>
          <h3 style={{
            fontSize: 13,
            margin: '0 0 8px',
            color: (revGap < 0 || profitGap < 0) ? '#991b1b' : '#14532d',
          }}>
            🎯 予算ギャップ診断 — {(revGap < 0 || profitGap < 0) ? '要アクション' : '達成見込み'}
          </h3>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>項目</th>
                  <th>年度予算</th>
                  <th>現計画</th>
                  <th>差分</th>
                  <th>達成率</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>売上</strong></td>
                  <td className="mono">¥{yen(budgetRev)}</td>
                  <td className="mono">¥{yen(planTotalRev)}</td>
                  <td className="mono" style={{ color: revGap >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                    {revGap >= 0 ? '+' : ''}¥{yen(revGap)}
                  </td>
                  <td className="mono">{budgetRev > 0 ? `${((planTotalRev / budgetRev) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
                <tr>
                  <td><strong>粗利</strong></td>
                  <td className="mono">¥{yen(budgetProfit)}</td>
                  <td className="mono">¥{yen(planTotalProfit)}</td>
                  <td className="mono" style={{ color: profitGap >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                    {profitGap >= 0 ? '+' : ''}¥{yen(profitGap)}
                  </td>
                  <td className="mono">{budgetProfit > 0 ? `${((planTotalProfit / budgetProfit) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {(revGap < 0 || profitGap < 0) && (
            <div style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px dashed #dc2626', borderRadius: 6 }}>
              <div style={{ color: '#991b1b', fontWeight: 700, marginBottom: 6 }}>
                💡 営業部に伝えるべきメッセージ
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
                {revGap < 0 && perExtraCase_AnnualRevenue > 0 && (
                  <li>
                    <strong>売上ギャップ {`¥${yen(-revGap)}`}</strong> を埋めるには、
                    <strong style={{ color: '#dc2626' }}>{casesNeededForRevGap.toLocaleString()}件</strong>
                    の追加獲得が必要
                    <span className="muted" style={{ fontSize: 11 }}>
                      （獲得1件 = 年間平均 ¥{yen(perExtraCase_AnnualRevenue)}の売上貢献を想定）
                    </span>
                  </li>
                )}
                {profitGap < 0 && perExtraCase_AnnualProfit > 0 && (
                  <li>
                    <strong>粗利ギャップ {`¥${yen(-profitGap)}`}</strong> を埋めるには、
                    <strong style={{ color: '#dc2626' }}>{casesNeededForProfitGap.toLocaleString()}件</strong>
                    の追加獲得が必要
                    <span className="muted" style={{ fontSize: 11 }}>
                      （獲得1件 = 年間平均 ¥{yen(perExtraCase_AnnualProfit)}の粗利貢献を想定）
                    </span>
                  </li>
                )}
                <li className="muted" style={{ fontSize: 12 }}>
                  または、獲得単価 +¥X/日 UP、単価改定 +X% などで代替可能
                  （「月次イベント→単価アップ」タブで試算）
                </li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 粗利UP サマリー */}
      <div className="card" style={{ background: '#dcfce7', borderColor: '#22c55e', marginTop: 8 }}>
        <h3 style={{ color: '#14532d', fontSize: 13, margin: '0 0 8px' }}>
          ③ 新規獲得1案件あたり 粗利UP サマリー（FY2026 対 FY2025獲得分）
        </h3>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>区分</th>
                <th>前年獲得 粗利/日/案件</th>
                <th>FY2026獲得 粗利/日/案件</th>
                <th>UP額/日</th>
                <th>UP額 ×計算日数20日</th>
              </tr>
            </thead>
            <tbody>
              {WorkerCategoryOrder.map((cat) => {
                const info = effectiveAcquisitionProfitPerCaseDay(plan, cat)
                const totalUp = info.current - info.prior   // = priceGain + uplift
                const monthlyUp = totalUp * 20
                return (
                  <tr key={`sum-${cat}`}>
                    <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                    <td className="mono">¥{yen(Math.round(info.prior))}</td>
                    <td className="mono">¥{yen(Math.round(info.current))}</td>
                    <td
                      className="mono"
                      style={{ color: totalUp > 0 ? '#16a34a' : totalUp < 0 ? '#dc2626' : '#64748b', fontWeight: 700 }}
                      title={`単価UP効果 +¥${yen(Math.round(info.priceGain))} + 追加UP +¥${yen(info.uplift)}`}
                    >
                      {totalUp >= 0 ? '+' : ''}¥{yen(Math.round(totalUp))}
                    </td>
                    <td
                      className="mono"
                      style={{ color: monthlyUp > 0 ? '#16a34a' : monthlyUp < 0 ? '#dc2626' : '#64748b' }}
                    >
                      {monthlyUp >= 0 ? '+' : ''}¥{yen(Math.round(monthlyUp))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** 前年実績サマリー（獲得/終了のセグメント別件数＋平均単価/粗利率） */
function PriorYearAcquisitionSummary({ plan }: { plan: Plan }) {
  const py = plan.priorYear
  const series = useMemo(() => (py ? computePriorYearMonthlySeries(py) : []), [py])
  if (!py) return null
  const months = series.length || 12
  const summary = py.annualSummary

  const acqTotal: CategoryMap<number> = { partner: 0, vendor: 0, employment: 0 }
  const termTotal: CategoryMap<number> = { partner: 0, vendor: 0, employment: 0 }
  for (const r of series) {
    acqTotal.partner += r.acquisitionByCategory.partner || 0
    acqTotal.vendor += r.acquisitionByCategory.vendor || 0
    acqTotal.employment += r.acquisitionByCategory.employment || 0
    termTotal.partner += r.terminationByCategory.partner || 0
    termTotal.vendor += r.terminationByCategory.vendor || 0
    termTotal.employment += r.terminationByCategory.employment || 0
  }
  const acqSum = acqTotal.partner + acqTotal.vendor + acqTotal.employment
  const termSum = termTotal.partner + termTotal.vendor + termTotal.employment

  const avg = (n: number) => (months > 0 ? n / months : 0)

  return (
    <div className="card" style={{ background: '#fff', marginTop: 10 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>📊 前年（{py.fiscalYear}）実績サマリー（参考）</h3>

      {summary && (
        <div className="scroll-x" style={{ marginBottom: 10 }}>
          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th>獲得案件</th>
                <th>終了案件</th>
                <th className="muted">備考</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>平均単価</strong></td>
                <td className="mono">{summary.acquisitionUnitPrice ? `¥${summary.acquisitionUnitPrice.toLocaleString()}/日` : '—'}</td>
                <td className="mono">{summary.terminationUnitPrice ? `¥${summary.terminationUnitPrice.toLocaleString()}/日` : '—'}</td>
                <td className="muted" style={{ fontSize: 11 }}>市場単価トレンド把握用</td>
              </tr>
              <tr>
                <td><strong>粗利率（合算）</strong></td>
                <td className="mono muted">{summary.acquisitionMarginPct != null ? `${summary.acquisitionMarginPct}%` : '—'}</td>
                <td className="mono muted">{summary.terminationMarginPct != null ? `${summary.terminationMarginPct}%` : '—'}</td>
                <td className="muted" style={{ fontSize: 11 }}>合算値のため参考のみ</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>区分</th>
              <th>獲得 年計</th>
              <th>獲得 月平均</th>
              <th>終了 年計</th>
              <th>終了 月平均</th>
              <th>純増減 年計</th>
              <th>構成比（獲得）</th>
            </tr>
          </thead>
          <tbody>
            {WorkerCategoryOrder.map((cat) => {
              const net = acqTotal[cat] - termTotal[cat]
              const ratio = acqSum > 0 ? (acqTotal[cat] / acqSum) * 100 : 0
              return (
                <tr key={`pys-${cat}`}>
                  <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                  <td className="mono">{acqTotal[cat].toLocaleString()}件</td>
                  <td className="mono muted">{avg(acqTotal[cat]).toFixed(1)}件/月</td>
                  <td className="mono">{termTotal[cat].toLocaleString()}件</td>
                  <td className="mono muted">{avg(termTotal[cat]).toFixed(1)}件/月</td>
                  <td className="mono" style={{ color: net > 0 ? '#16a34a' : net < 0 ? '#dc2626' : '#64748b', fontWeight: 600 }}>
                    {net > 0 ? `+${net}` : net}件
                  </td>
                  <td className="mono muted">{ratio.toFixed(1)}%</td>
                </tr>
              )
            })}
            <tr>
              <td><strong>合計</strong></td>
              <td className="mono"><strong>{acqSum.toLocaleString()}件</strong></td>
              <td className="mono muted">{avg(acqSum).toFixed(1)}件/月</td>
              <td className="mono"><strong>{termSum.toLocaleString()}件</strong></td>
              <td className="mono muted">{avg(termSum).toFixed(1)}件/月</td>
              <td className="mono" style={{
                color: (acqSum - termSum) > 0 ? '#16a34a' : (acqSum - termSum) < 0 ? '#dc2626' : '#64748b',
                fontWeight: 700,
              }}>
                {acqSum - termSum > 0 ? `+${acqSum - termSum}` : `${acqSum - termSum}`}件
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        ＊FY2026 の獲得/終了の月次入力や配車比率設定の<strong>ベンチマーク</strong>としてお使いください。
      </div>
    </div>
  )
}

/** マイスター考慮した原価率比較カード */
function MeisterAdjustedCostRateCard({ plan }: { plan: Plan }) {
  const cmp = useMemo(
    () => (plan.priorYear ? estimateCostRatesComparisonWithMeister(plan.priorYear) : null),
    [plan.priorYear],
  )
  if (!cmp) return null

  const socialSharePct = (cmp.socialRevenue / cmp.revenue) * 100
  const meisterSharePct = (cmp.meisterRevenue / cmp.revenue) * 100
  const zeroCostSharePct = socialSharePct + meisterSharePct
  const gap = cmp.trueCombinedRate - cmp.effectiveCombinedRate

  return (
    <div className="card" style={{ background: '#fff7ed', borderColor: '#fdba74', marginTop: 10 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 8px', color: '#9a3412' }}>
        🔍 マイスター考慮した合算原価率の分析（{cmp.month} 実績）
      </h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        社員(D職) と マイスターはいずれも 原価率0%。両方を除外すると 運送店+業者 の「真の」原価率が見えます。
      </div>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>0%原価の内訳</th>
              <th>金額</th>
              <th>売上シェア</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className={`badge employment`}>社員 (D職)</span></td>
              <td className="mono">¥{yen(Math.round(cmp.socialRevenue))}</td>
              <td className="mono">{socialSharePct.toFixed(2)}%</td>
            </tr>
            <tr>
              <td>マイスター（営業社員代走）</td>
              <td className="mono">¥{yen(cmp.meisterRevenue)}</td>
              <td className="mono">{meisterSharePct.toFixed(2)}%</td>
            </tr>
            <tr>
              <td><strong>0%原価 合計</strong></td>
              <td className="mono"><strong>¥{yen(Math.round(cmp.socialRevenue + cmp.meisterRevenue))}</strong></td>
              <td className="mono"><strong>{zeroCostSharePct.toFixed(2)}%</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="scroll-x" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>推定方法</th>
              <th>運送店+業者 合算原価率</th>
              <th>用途</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>マイスター考慮<strong>なし</strong>（既定）</td>
              <td className="mono" style={{ fontWeight: 700, color: '#0ea5e9' }}>
                {cmp.effectiveCombinedRate.toFixed(2)}%
              </td>
              <td className="muted" style={{ fontSize: 12 }}>
                アプリ計算用（マイスター補正なしで総原価と一致）★
              </td>
            </tr>
            <tr style={{ background: '#fef3c7' }}>
              <td>マイスター考慮<strong>あり</strong></td>
              <td className="mono" style={{ fontWeight: 700, color: '#dc2626' }}>
                {cmp.trueCombinedRate.toFixed(2)}%
              </td>
              <td className="muted" style={{ fontSize: 12 }}>
                マイスター非カバー部分の実態原価率。現場感の数字
              </td>
            </tr>
            <tr>
              <td className="muted">差</td>
              <td className="mono muted">+{gap.toFixed(2)} pt</td>
              <td className="muted" style={{ fontSize: 11 }}>マイスター効果の寄与分</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.6 }}>
        <strong>アプリへの反映について:</strong> 上の「2026-03 実績から原価率を推定」ボタンは<strong>マイスター考慮なし</strong>（{cmp.effectiveCombinedRate.toFixed(2)}%）を使います。これで総原価が実績と一致します。<br />
        「真の」原価率（{cmp.trueCombinedRate.toFixed(2)}%）は<strong>参考情報</strong>として、現場での単価交渉や仕入先との会話に使えます。
      </div>
    </div>
  )
}

/** 合算原価率を Δpt で運送店/業者に分離するカード */
function SegmentCostRateSplitterCard() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)

  // 適用済み Δ = 現在の原価率から逆算（スライダーを明示的に保存しなくても状態が見える）
  //   rR = c − wV·Δ, rV = c + wR·Δ  から  Δ = rV − rR
  const appliedDelta = useMemo(() => {
    const rR = plan.categories.partner.costModel === 'rate' ? plan.categories.partner.costRate : 0
    const rV = plan.categories.vendor.costModel === 'rate' ? plan.categories.vendor.costRate : 0
    // どちらか片方だけ 0 の時（未設定状態）は 0 扱い
    if (rR === 0 && rV === 0) return 0
    return Math.round((rV - rR) * 100) / 100
  }, [
    plan.categories.partner.costModel,
    plan.categories.partner.costRate,
    plan.categories.vendor.costModel,
    plan.categories.vendor.costRate,
  ])

  // Δpt = 業者原価率 − 運送店原価率。初期値は適用済み Δ から復元
  const [delta, setDelta] = useState<number>(appliedDelta)
  // basis: 'effective' = マイスター考慮なし（reported整合）/ 'true' = マイスター考慮あり（現場実態）
  const [basis, setBasis] = useState<'effective' | 'true'>('true')

  // 外部から原価率が変わった時（他ボタンや JSON 読み込み等）はスライダーも追従
  useEffect(() => {
    setDelta(appliedDelta)
  }, [appliedDelta])

  const split = useMemo(
    () => (plan.priorYear ? estimateSegmentCostRatesWithDelta(plan.priorYear, delta, basis) : null),
    [plan.priorYear, delta, basis],
  )
  if (!split) return null

  const isDirty = Math.abs(delta - appliedDelta) > 0.005

  // 妥当性：原価率が負や100超にならないか
  const outOfRange = split.partner < 0 || split.vendor < 0 || split.partner > 100 || split.vendor > 100
  const maxAbsDelta = (() => {
    // 0 ≤ rR, rV ≤ 100 を満たす範囲内の |Δ| 上限
    const { combinedRate: c, partnerWeight: wR, vendorWeight: wV } = split
    if (wR <= 0 || wV <= 0) return 0
    // rR = c - wV·Δ ≥ 0 → Δ ≤ c/wV ;  rR ≤ 100 → Δ ≥ (c-100)/wV
    // rV = c + wR·Δ ≥ 0 → Δ ≥ -c/wR ; rV ≤ 100 → Δ ≤ (100-c)/wR
    const up = Math.min(c / wV, (100 - c) / wR)
    const dn = Math.max((c - 100) / wV, -c / wR)
    return Math.floor(Math.min(Math.abs(up), Math.abs(dn)) * 100) / 100
  })()

  function applySplit() {
    if (!split) return
    const msg =
      `${split.month} 実績からセグメント別原価率を反映します（Δ=${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pt）:\n\n` +
      `  運送店: ${split.partner.toFixed(2)}%\n` +
      `  業者:   ${split.vendor.toFixed(2)}%\n` +
      `  社員:   0.00%\n\n` +
      `案件数加重平均 = ${split.combinedRate.toFixed(2)}%（実績合算率と一致）`
    if (!confirm(msg)) return
    setPlan((p) => ({
      ...p,
      categories: {
        partner: { ...p.categories.partner, costModel: 'rate', costRate: split.partner, costAmount: 0 },
        vendor: { ...p.categories.vendor, costModel: 'rate', costRate: split.vendor, costAmount: 0 },
        employment: { ...p.categories.employment, costModel: 'rate', costRate: 0, costAmount: 0 },
      },
    }))
  }

  return (
    <div className="card" style={{ background: '#ecfeff', borderColor: '#67e8f9', marginTop: 10 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px', color: '#0e7490' }}>
          🎚 Δpt で運送店 / 業者の原価率を分離（{split.month} 実績）
        </h3>
        <div style={{ fontSize: 11, color: '#0e7490', textAlign: 'right', lineHeight: 1.4 }}>
          <div>
            適用済み Δ:{' '}
            <strong style={{ color: '#0891b2' }}>
              {appliedDelta >= 0 ? '+' : ''}{appliedDelta.toFixed(2)}pt
            </strong>
          </div>
          {isDirty && (
            <div style={{ color: '#dc2626', fontWeight: 600 }}>
              ⚠ 未適用: {delta >= 0 ? '+' : ''}{delta.toFixed(2)}pt
            </div>
          )}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
        合算原価率 <strong>{split.combinedRate.toFixed(2)}%</strong> は実績から一意。ここに「業者 − 運送店」のpt差 Δ を指定すると、
        案件数比（R:V = {split.partnerCount.toLocaleString()} : {split.vendorCount.toLocaleString()}）で加重平均が
        合算率と一致するように rR, rV を算出します。
      </div>

      {/* basis 切替 */}
      <div
        className="row"
        style={{
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 10,
          background: '#fff',
          padding: 8,
          borderRadius: 6,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>合算率の基準:</span>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, margin: 0, cursor: 'pointer' }}>
          <input
            type="radio"
            name="basis"
            checked={basis === 'true'}
            onChange={() => setBasis('true')}
          />
          <span>
            <strong>マイスター考慮あり</strong>（真の運営粗利率・<span style={{ color: '#d97706' }}>推奨</span>）
          </span>
        </label>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, margin: 0, cursor: 'pointer' }}>
          <input
            type="radio"
            name="basis"
            checked={basis === 'effective'}
            onChange={() => setBasis('effective')}
          />
          <span>
            <span style={{ color: '#64748b' }}>マイスター考慮なし</span>（reported整合）
          </span>
        </label>
      </div>

      <div className="muted" style={{ fontSize: 11, marginBottom: 10, lineHeight: 1.6, background: '#f8fafc', padding: 6, borderRadius: 4 }}>
        {basis === 'true' ? (
          <>
            <strong style={{ color: '#d97706' }}>★ 推奨基準</strong>：実績から社員+マイスター（共に 0%原価）を分母・分子の両方から抜いた
            「運送店+業者 の真の原価率」。FY2026 でマイスターを変動させたときに粗利率が連動して動きます。
          </>
        ) : (
          <>
            実績から社員のみを抜いた率。マイスターは reported に残るため、FY2026 でマイスター=0 にしても粗利率は FY2025 reported のまま保たれます（マイスター効果が見えない）。
          </>
        )}
      </div>

      <div className="muted" style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
        <strong>Δ=0</strong> は R=V仮定と同じ。現場感で「業者の方が仕入単価が高い → Δ=+2〜+5pt」等を入れてください。
        <strong>現在値は保存された原価率から逆算表示</strong>（Δ = 業者原価率 − 運送店原価率）。
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ fontSize: 12, fontWeight: 600, minWidth: 180 }}>
          Δpt（業者 − 運送店）
        </label>
        <input
          type="range"
          min={-25}
          max={25}
          step={0.1}
          value={delta}
          onChange={(e) => setDelta(Number(e.target.value))}
          style={{ flex: 1, minWidth: 200 }}
        />
        <input
          type="number"
          step={0.1}
          value={delta}
          onChange={(e) => setDelta(Number(e.target.value) || 0)}
          style={{ width: 80 }}
        />
        <span className="muted" style={{ fontSize: 11 }}>pt</span>
        <button className="small ghost" onClick={() => setDelta(0)}>Δ=0</button>
        {isDirty && (
          <button className="small ghost" onClick={() => setDelta(appliedDelta)}>
            適用済みに戻す ({appliedDelta >= 0 ? '+' : ''}{appliedDelta.toFixed(2)})
          </button>
        )}
      </div>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>区分</th>
              <th>案件数</th>
              <th>加重 w</th>
              <th>原価率（推定）</th>
              <th>粗利率</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="badge partner">運送店</span></td>
              <td className="mono">{split.partnerCount.toLocaleString()}件</td>
              <td className="mono muted">{(split.partnerWeight * 100).toFixed(1)}%</td>
              <td className="mono" style={{ fontWeight: 700, color: '#0ea5e9' }}>
                {split.partner.toFixed(2)}%
              </td>
              <td className="mono muted">{(100 - split.partner).toFixed(2)}%</td>
            </tr>
            <tr>
              <td><span className="badge vendor">業者</span></td>
              <td className="mono">{split.vendorCount.toLocaleString()}件</td>
              <td className="mono muted">{(split.vendorWeight * 100).toFixed(1)}%</td>
              <td className="mono" style={{ fontWeight: 700, color: '#dc2626' }}>
                {split.vendor.toFixed(2)}%
              </td>
              <td className="mono muted">{(100 - split.vendor).toFixed(2)}%</td>
            </tr>
            <tr style={{ background: '#f0f9ff' }}>
              <td><strong>案件数加重平均</strong></td>
              <td></td>
              <td></td>
              <td className="mono"><strong>{split.combinedRate.toFixed(2)}%</strong></td>
              <td className="muted" style={{ fontSize: 11 }}>←実績合算率と一致</td>
            </tr>
          </tbody>
        </table>
      </div>

      {outOfRange && (
        <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>
          ⚠ Δ が大きすぎて原価率が 0〜100% の範囲を外れます。|Δ| を {maxAbsDelta.toFixed(2)}pt 以下にしてください。
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button
          className="small"
          style={{ background: isDirty ? '#dc2626' : '#0891b2' }}
          onClick={applySplit}
          disabled={outOfRange || !isDirty}
          title={!isDirty ? '既に適用済みの値と同じです' : 'このΔを原価率に反映'}
        >
          {isDirty ? 'この値でセグメント別原価率を反映' : '✓ 適用済み'}
        </button>
        <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
          ※ 社員は常に 0.00% 固定
        </span>
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.6 }}>
        <strong>計算式:</strong> w<sub>R</sub> = R/(R+V), w<sub>V</sub> = V/(R+V) として<br />
        &nbsp;&nbsp;r<sub>R</sub> = 合算率 − w<sub>V</sub>·Δ ／ r<sub>V</sub> = 合算率 + w<sub>R</sub>·Δ<br />
        これにより「w<sub>R</sub>·r<sub>R</sub> + w<sub>V</sub>·r<sub>V</sub> = 合算率」が保たれるため、
        案件数比で按分しても 2026-03 の実績総原価は再現できます。
      </div>
    </div>
  )
}
