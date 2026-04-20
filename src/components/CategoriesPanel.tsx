import { useMemo } from 'react'
import { usePlanStore } from '../store'
import type { CategoryConfig, CostModel, WorkerCategory } from '../types'
import { WorkerCategoryLabels, WorkerCategoryOrder } from '../types'
import {
  computePriorYearEndCounts,
  estimateAverageRevenuePerCase,
  estimatePriorYearLastMonthUnitPrice,
  yen,
} from '../utils/calculations'

export default function CategoriesPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)

  function updateCategory(cat: WorkerCategory, patch: Partial<CategoryConfig>) {
    setPlan((p) => ({
      ...p,
      categories: { ...p.categories, [cat]: { ...p.categories[cat], ...patch } },
    }))
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
      `期首件数 + 最終月(${priorLast.month})の単価で反映します（直近トレンドに寄せる）:\n\n` +
      `  件数: 合計 ${totalInitial.toLocaleString()} → ${(end.partner + end.vendor + end.employment).toLocaleString()}\n` +
      `  単価: ¥${plan.revenuePerCase.toLocaleString()} → ¥${Math.round(priorLast.unitPrice).toLocaleString()}`
    if (!confirm(msg)) return
    setPlan((p) => ({
      ...p,
      initialCounts: end,
      revenuePerCase: Math.round(priorLast.unitPrice),
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
            <input
              type="number"
              min={0}
              value={plan.revenuePerCase}
              onChange={(e) => updateRevenuePerCase(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label>月次売上の試算（{days} 営業日 × 期首件数 {totalInitial.toLocaleString()} 件）</label>
            <input
              readOnly
              value={`¥${yen(plan.revenuePerCase * days * totalInitial)}`}
              style={{ background: '#f8fafc', color: '#475569', fontFamily: 'inherit' }}
            />
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
