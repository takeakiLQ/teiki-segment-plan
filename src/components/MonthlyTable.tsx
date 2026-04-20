import { useMemo } from 'react'
import { usePlanStore } from '../store'
import { WorkerCategoryLabels, WorkerCategoryOrder } from '../types'
import { budgetProfitOf, budgetRevenueOf, computeMonthly, percent, priorYm, yen } from '../utils/calculations'
import { formatYmShort } from '../utils/month'

export default function MonthlyTable() {
  const plan = usePlanStore((s) => s.plan)
  const rows = useMemo(() => computeMonthly(plan), [plan])

  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0)
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0)
  const totalProfit = totalRevenue - totalCost
  const totalNew = rows.reduce((s, r) => s + r.newTotal, 0)
  const totalEnd = rows.reduce((s, r) => s + r.endTotal, 0)
  const totalNet = totalNew - totalEnd
  const totalsByCat = WorkerCategoryOrder.reduce((acc, c) => {
    acc[c] = { newCases: 0, endingCases: 0 }
    for (const r of rows) {
      acc[c].newCases += r.byCategory[c].newCases
      acc[c].endingCases += r.byCategory[c].endingCases
    }
    return acc
  }, {} as Record<string, { newCases: number; endingCases: number }>)

  // 累計純増減
  let running = 0
  const cumulativeNets = rows.map((r) => (running += r.newTotal - r.endTotal, running))

  // 前年実績の参照 lookup（-12ヶ月 の対応月）
  const priorLookup = useMemo(() => {
    const m = new Map<string, { revenue: number; grossProfit: number }>()
    if (plan.priorYear) {
      for (const d of plan.priorYear.monthlyData) {
        m.set(d.month, { revenue: d.revenue ?? 0, grossProfit: d.grossProfit ?? 0 })
      }
    }
    return m
  }, [plan.priorYear])
  const hasPriorYear = !!plan.priorYear && plan.priorYear.monthlyData.length > 0
  const priorTotals = useMemo(() => {
    let rev = 0, gp = 0
    if (plan.priorYear) {
      for (const d of plan.priorYear.monthlyData) {
        rev += d.revenue ?? 0
        gp += d.grossProfit ?? 0
      }
    }
    return { rev, gp, margin: rev > 0 ? gp / rev : 0 }
  }, [plan.priorYear])

  // 年度予算（月別 effective 値）
  const budgetByMonth = useMemo(() => rows.map((r) => ({
    month: r.month,
    revenue: budgetRevenueOf(plan, r.month),
    grossProfit: budgetProfitOf(plan, r.month),
  })), [rows, plan])
  const budgetTotals = useMemo(() => {
    let rev = 0, gp = 0
    for (const b of budgetByMonth) { rev += b.revenue; gp += b.grossProfit }
    return { rev, gp, margin: rev > 0 ? gp / rev : 0 }
  }, [budgetByMonth])
  const hasBudget = (plan.budget?.revenue ?? 0) > 0 || (plan.budget?.grossProfit ?? 0) > 0
    || Object.keys(plan.budget?.revenueByMonth ?? {}).length > 0
    || Object.keys(plan.budget?.grossProfitByMonth ?? {}).length > 0

  // マイスター売上（月次 + 合計）
  const totalMeister = useMemo(() => {
    return rows.reduce((s, r) => s + (plan.meisterRevenueByMonth?.[r.month] ?? 0), 0)
  }, [rows, plan.meisterRevenueByMonth])
  const hasMeister = totalMeister > 0

  return (
    <div className="card">
      <div className="row between">
        <h3>月次 明細テーブル</h3>
        <button className="small ghost" onClick={() => exportCsv(plan.name, rows)}>CSV エクスポート</button>
      </div>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              {rows.map((r) => (<th key={r.month}>{formatYmShort(r.month)}</th>))}
              <th style={{ background: '#e2e8f0' }}>年間合計</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={rows.length + 2} style={{ background: '#f1f5f9', fontWeight: 600 }}>■ 案件数</td></tr>
            {WorkerCategoryOrder.map((cat) => (
              <tr key={`cnt-${cat}`}>
                <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                {rows.map((r) => (
                  <td className="mono" key={r.month}>{r.byCategory[cat].count.toLocaleString()}</td>
                ))}
                <td></td>
              </tr>
            ))}
            <tr>
              <td><strong>合計件数</strong></td>
              {rows.map((r) => (<td className="mono" key={r.month}><strong>{r.totalCount.toLocaleString()}</strong></td>))}
              <td></td>
            </tr>
            <tr>
              <td>獲得 / 終了 / 入替（合計）</td>
              {rows.map((r) => (
                <td className="mono" key={r.month}>
                  <span style={{ color: '#16a34a' }}>+{r.newTotal}</span>
                  {' / '}
                  <span style={{ color: '#dc2626' }}>-{r.endTotal}</span>
                  {r.transfersTotal > 0 && <span className="muted"> / ⇄{r.transfersTotal}</span>}
                </td>
              ))}
              <td className="mono" style={{ background: '#f1f5f9' }}>
                <span style={{ color: '#16a34a' }}>+{totalNew.toLocaleString()}</span>
                {' / '}
                <span style={{ color: '#dc2626' }}>-{totalEnd.toLocaleString()}</span>
              </td>
            </tr>
            <tr style={{ background: '#f8fafc' }}>
              <td><strong>純増減（獲得−終了）</strong></td>
              {rows.map((r) => {
                const net = r.newTotal - r.endTotal
                return (
                  <td className="mono" key={`net-${r.month}`} style={{ fontWeight: 600, color: net > 0 ? '#16a34a' : net < 0 ? '#dc2626' : undefined }}>
                    {net > 0 ? `+${net}` : net}
                  </td>
                )
              })}
              <td className="mono" style={{ background: '#e2e8f0', fontWeight: 700, color: totalNet > 0 ? '#16a34a' : totalNet < 0 ? '#dc2626' : undefined }}>
                {totalNet > 0 ? '+' : ''}{totalNet.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td>累計純増減</td>
              {cumulativeNets.map((cum, i) => (
                <td className="mono" key={`cum-${i}`} style={{ color: cum > 0 ? '#16a34a' : cum < 0 ? '#dc2626' : '#64748b' }}>
                  {cum > 0 ? '+' : ''}{cum.toLocaleString()}
                </td>
              ))}
              <td className="mono" style={{ background: '#f1f5f9' }}>
                {(cumulativeNets[cumulativeNets.length - 1] ?? 0).toLocaleString()}
              </td>
            </tr>
            <tr><td colSpan={rows.length + 2} style={{ background: '#ecfdf5', fontWeight: 600, color: '#065f46' }}>＋獲得（配車比率按分）</td></tr>
            {WorkerCategoryOrder.map((cat) => (
              <tr key={`acq-${cat}`}>
                <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                {rows.map((r) => (
                  <td className="mono" key={r.month} style={{ color: r.byCategory[cat].newCases > 0 ? '#16a34a' : undefined }}>
                    {r.byCategory[cat].newCases}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700, color: '#16a34a' }}>
                  {totalsByCat[cat].newCases.toLocaleString()}
                </td>
              </tr>
            ))}
            <tr><td colSpan={rows.length + 2} style={{ background: '#fef2f2', fontWeight: 600, color: '#991b1b' }}>－終了（配車比率按分）</td></tr>
            {WorkerCategoryOrder.map((cat) => (
              <tr key={`end-${cat}`}>
                <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                {rows.map((r) => (
                  <td className="mono" key={r.month} style={{ color: r.byCategory[cat].endingCases > 0 ? '#dc2626' : undefined }}>
                    {r.byCategory[cat].endingCases}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700, color: '#dc2626' }}>
                  {totalsByCat[cat].endingCases.toLocaleString()}
                </td>
              </tr>
            ))}

            <tr><td colSpan={rows.length + 2} style={{ background: '#f1f5f9', fontWeight: 600 }}>■ 売上（円）</td></tr>
            {WorkerCategoryOrder.map((cat) => (
              <tr key={`rev-${cat}`}>
                <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                {rows.map((r) => (
                  <td className="mono" key={r.month}>{yen(r.byCategory[cat].revenue)}</td>
                ))}
                <td></td>
              </tr>
            ))}
            <tr>
              <td><strong>売上合計</strong></td>
              {rows.map((r) => (<td className="mono" key={r.month}><strong>{yen(r.totalRevenue)}</strong></td>))}
              <td className="mono"><strong>{yen(totalRevenue)}</strong></td>
            </tr>

            <tr><td colSpan={rows.length + 2} style={{ background: '#f1f5f9', fontWeight: 600 }}>■ 原価（円）</td></tr>
            {WorkerCategoryOrder.map((cat) => (
              <tr key={`cost-${cat}`}>
                <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                {rows.map((r) => (
                  <td className="mono" key={r.month}>{yen(r.byCategory[cat].cost)}</td>
                ))}
                <td></td>
              </tr>
            ))}
            <tr>
              <td><strong>原価合計</strong></td>
              {rows.map((r) => (<td className="mono" key={r.month}><strong>{yen(r.totalCost)}</strong></td>))}
              <td className="mono"><strong>{yen(totalCost)}</strong></td>
            </tr>

            <tr><td colSpan={rows.length + 2} style={{ background: '#f1f5f9', fontWeight: 600 }}>■ 粗利</td></tr>
            <tr>
              <td><strong>粗利</strong></td>
              {rows.map((r) => (<td className="mono" key={r.month}><strong>{yen(r.totalProfit)}</strong></td>))}
              <td className="mono"><strong>{yen(totalProfit)}</strong></td>
            </tr>
            <tr>
              <td>粗利率（マイスター含む）</td>
              {rows.map((r) => (<td className="mono" key={r.month}>{percent(r.margin)}</td>))}
              <td className="mono">{percent(totalRevenue ? totalProfit / totalRevenue : 0)}</td>
            </tr>

            {hasMeister && (
              <>
                <tr><td colSpan={rows.length + 2} style={{ background: '#f5f3ff', fontWeight: 600, color: '#6b21a8' }}>■ マイスター影響 参照</td></tr>
                <tr>
                  <td className="muted">マイスター売上</td>
                  {rows.map((r) => {
                    const mr = plan.meisterRevenueByMonth?.[r.month] ?? 0
                    return (
                      <td key={`mr-${r.month}`} className="mono muted" style={{ color: mr > 0 ? '#7c3aed' : undefined }}>
                        {mr > 0 ? `¥${yen(mr)}` : '—'}
                      </td>
                    )
                  })}
                  <td className="mono" style={{ background: '#f5f3ff', color: '#7c3aed', fontWeight: 700 }}>
                    ¥{yen(totalMeister)}
                  </td>
                </tr>
                <tr>
                  <td className="muted">粗利率（マイスター除く）</td>
                  {rows.map((r) => {
                    const mr = plan.meisterRevenueByMonth?.[r.month] ?? 0
                    const ex = r.totalRevenue > 0 ? (r.totalProfit - mr) / r.totalRevenue : 0
                    return (
                      <td key={`gmx-${r.month}`} className="mono muted">
                        {r.totalRevenue > 0 ? `${(ex * 100).toFixed(1)}%` : '—'}
                      </td>
                    )
                  })}
                  <td className="mono muted" style={{ background: '#f5f3ff' }}>
                    {totalRevenue > 0 ? `${(((totalProfit - totalMeister) / totalRevenue) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted" style={{ fontSize: 11 }}>マイスター比率（対売上）</td>
                  {rows.map((r) => {
                    const mr = plan.meisterRevenueByMonth?.[r.month] ?? 0
                    const ratio = r.totalRevenue > 0 ? mr / r.totalRevenue : 0
                    return (
                      <td key={`mrr-${r.month}`} className="mono muted" style={{ fontSize: 11 }}>
                        {mr > 0 && r.totalRevenue > 0 ? `${(ratio * 100).toFixed(2)}%` : '—'}
                      </td>
                    )
                  })}
                  <td className="mono muted" style={{ background: '#f5f3ff', fontSize: 11 }}>
                    {totalMeister > 0 && totalRevenue > 0 ? `${((totalMeister / totalRevenue) * 100).toFixed(2)}%` : '—'}
                  </td>
                </tr>
              </>
            )}

            {hasBudget && (
              <>
                <tr><td colSpan={rows.length + 2} style={{ background: '#fef3c7', fontWeight: 600, color: '#92400e' }}>
                  ■ 年度予算 対比
                </td></tr>
                <tr>
                  <td className="muted">売上予算</td>
                  {budgetByMonth.map((b) => (
                    <td key={`bu-rev-${b.month}`} className="mono muted">{b.revenue > 0 ? yen(b.revenue) : '—'}</td>
                  ))}
                  <td className="mono muted" style={{ background: '#fffbeb', fontWeight: 700 }}>
                    {budgetTotals.rev > 0 ? yen(budgetTotals.rev) : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">粗利予算</td>
                  {budgetByMonth.map((b) => (
                    <td key={`bu-gp-${b.month}`} className="mono muted">{b.grossProfit !== 0 ? yen(b.grossProfit) : '—'}</td>
                  ))}
                  <td className="mono muted" style={{ background: '#fffbeb', fontWeight: 700 }}>
                    {budgetTotals.gp !== 0 ? yen(budgetTotals.gp) : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">予算 粗利率</td>
                  {budgetByMonth.map((b) => {
                    const mg = b.revenue > 0 ? b.grossProfit / b.revenue : null
                    return (
                      <td key={`bu-mg-${b.month}`} className="mono muted">
                        {mg == null ? '—' : `${(mg * 100).toFixed(1)}%`}
                      </td>
                    )
                  })}
                  <td className="mono muted" style={{ background: '#fffbeb' }}>
                    {budgetTotals.rev > 0 ? `${(budgetTotals.margin * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">対予算 売上差</td>
                  {rows.map((r, i) => {
                    const b = budgetByMonth[i]
                    if (!b || b.revenue === 0) return <td key={`bd-rev-${r.month}`} className="mono muted">—</td>
                    const diff = r.totalRevenue - b.revenue
                    const rate = b.revenue > 0 ? r.totalRevenue / b.revenue : 0
                    return (
                      <td key={`bd-rev-${r.month}`} className="mono" style={{ fontSize: 11, color: diff >= 0 ? '#16a34a' : '#dc2626' }}>
                        {diff >= 0 ? '+' : ''}{yen(diff)}<br />
                        <span style={{ fontSize: 10 }}>達成 {(rate * 100).toFixed(1)}%</span>
                      </td>
                    )
                  })}
                  <td className="mono" style={{ background: '#f1f5f9', fontSize: 11, color: (totalRevenue - budgetTotals.rev) >= 0 ? '#16a34a' : '#dc2626' }}>
                    {budgetTotals.rev > 0 ? (
                      <>
                        {totalRevenue - budgetTotals.rev >= 0 ? '+' : ''}{yen(totalRevenue - budgetTotals.rev)}<br />
                        <span style={{ fontSize: 10 }}>達成 {((totalRevenue / budgetTotals.rev) * 100).toFixed(1)}%</span>
                      </>
                    ) : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">対予算 粗利差</td>
                  {rows.map((r, i) => {
                    const b = budgetByMonth[i]
                    if (!b || b.grossProfit === 0) return <td key={`bd-gp-${r.month}`} className="mono muted">—</td>
                    const diff = r.totalProfit - b.grossProfit
                    const rate = b.grossProfit !== 0 ? r.totalProfit / b.grossProfit : 0
                    return (
                      <td key={`bd-gp-${r.month}`} className="mono" style={{ fontSize: 11, color: diff >= 0 ? '#16a34a' : '#dc2626' }}>
                        {diff >= 0 ? '+' : ''}{yen(diff)}<br />
                        <span style={{ fontSize: 10 }}>達成 {(rate * 100).toFixed(1)}%</span>
                      </td>
                    )
                  })}
                  <td className="mono" style={{ background: '#f1f5f9', fontSize: 11, color: (totalProfit - budgetTotals.gp) >= 0 ? '#16a34a' : '#dc2626' }}>
                    {budgetTotals.gp !== 0 ? (
                      <>
                        {totalProfit - budgetTotals.gp >= 0 ? '+' : ''}{yen(totalProfit - budgetTotals.gp)}<br />
                        <span style={{ fontSize: 10 }}>達成 {((totalProfit / budgetTotals.gp) * 100).toFixed(1)}%</span>
                      </>
                    ) : '—'}
                  </td>
                </tr>
              </>
            )}

            {hasPriorYear && (
              <>
                <tr><td colSpan={rows.length + 2} style={{ background: '#ede9fe', fontWeight: 600, color: '#5b21b6' }}>
                  ■ 前年比 参照（{plan.priorYear!.fiscalYear}）
                </td></tr>
                <tr>
                  <td className="muted">前年 売上</td>
                  {rows.map((r) => {
                    const py = priorLookup.get(priorYm(r.month))
                    return (
                      <td key={`py-rev-${r.month}`} className="mono muted">
                        {py && py.revenue > 0 ? yen(py.revenue) : '—'}
                      </td>
                    )
                  })}
                  <td className="mono muted" style={{ background: '#f5f3ff' }}>
                    {priorTotals.rev > 0 ? yen(priorTotals.rev) : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">前年 粗利</td>
                  {rows.map((r) => {
                    const py = priorLookup.get(priorYm(r.month))
                    return (
                      <td key={`py-gp-${r.month}`} className="mono muted">
                        {py && py.revenue > 0 ? yen(py.grossProfit) : '—'}
                      </td>
                    )
                  })}
                  <td className="mono muted" style={{ background: '#f5f3ff' }}>
                    {priorTotals.rev > 0 ? yen(priorTotals.gp) : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">前年 粗利率</td>
                  {rows.map((r) => {
                    const py = priorLookup.get(priorYm(r.month))
                    const margin = py && py.revenue > 0 ? py.grossProfit / py.revenue : null
                    return (
                      <td key={`py-gm-${r.month}`} className="mono muted">
                        {margin == null ? '—' : `${(margin * 100).toFixed(1)}%`}
                      </td>
                    )
                  })}
                  <td className="mono muted" style={{ background: '#f5f3ff' }}>
                    {priorTotals.rev > 0 ? `${(priorTotals.margin * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">前年比 売上</td>
                  {rows.map((r) => {
                    const py = priorLookup.get(priorYm(r.month))
                    if (!py || py.revenue === 0) return <td key={`py-d-${r.month}`} className="mono muted">—</td>
                    const diff = r.totalRevenue - py.revenue
                    const rate = py.revenue > 0 ? r.totalRevenue / py.revenue : 0
                    return (
                      <td key={`py-d-${r.month}`} className="mono" style={{ fontSize: 11, color: diff >= 0 ? '#16a34a' : '#dc2626' }}>
                        {diff >= 0 ? '+' : ''}{yen(diff)}<br />
                        <span style={{ fontSize: 10 }}>{(rate * 100).toFixed(1)}%</span>
                      </td>
                    )
                  })}
                  <td className="mono" style={{ background: '#f1f5f9', fontSize: 11, color: (totalRevenue - priorTotals.rev) >= 0 ? '#16a34a' : '#dc2626' }}>
                    {priorTotals.rev > 0 ? (
                      <>
                        {totalRevenue - priorTotals.rev >= 0 ? '+' : ''}{yen(totalRevenue - priorTotals.rev)}<br />
                        <span style={{ fontSize: 10 }}>{((totalRevenue / priorTotals.rev) * 100).toFixed(1)}%</span>
                      </>
                    ) : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">前年比 粗利</td>
                  {rows.map((r) => {
                    const py = priorLookup.get(priorYm(r.month))
                    if (!py || py.revenue === 0) return <td key={`py-dg-${r.month}`} className="mono muted">—</td>
                    const diff = r.totalProfit - py.grossProfit
                    const rate = py.grossProfit !== 0 ? r.totalProfit / py.grossProfit : 0
                    return (
                      <td key={`py-dg-${r.month}`} className="mono" style={{ fontSize: 11, color: diff >= 0 ? '#16a34a' : '#dc2626' }}>
                        {diff >= 0 ? '+' : ''}{yen(diff)}<br />
                        <span style={{ fontSize: 10 }}>{(rate * 100).toFixed(1)}%</span>
                      </td>
                    )
                  })}
                  <td className="mono" style={{ background: '#f1f5f9', fontSize: 11, color: (totalProfit - priorTotals.gp) >= 0 ? '#16a34a' : '#dc2626' }}>
                    {priorTotals.gp !== 0 ? (
                      <>
                        {totalProfit - priorTotals.gp >= 0 ? '+' : ''}{yen(totalProfit - priorTotals.gp)}<br />
                        <span style={{ fontSize: 10 }}>{((totalProfit / priorTotals.gp) * 100).toFixed(1)}%</span>
                      </>
                    ) : '—'}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function exportCsv(name: string, rows: ReturnType<typeof computeMonthly>) {
  const header = [
    '月',
    ...WorkerCategoryOrder.map((c) => `${WorkerCategoryLabels[c]}件数`),
    '合計件数',
    '獲得合計', '終了合計', '入替',
    ...WorkerCategoryOrder.map((c) => `${WorkerCategoryLabels[c]}獲得`),
    ...WorkerCategoryOrder.map((c) => `${WorkerCategoryLabels[c]}終了`),
    ...WorkerCategoryOrder.map((c) => `${WorkerCategoryLabels[c]}売上`),
    '売上合計',
    ...WorkerCategoryOrder.map((c) => `${WorkerCategoryLabels[c]}原価`),
    '原価合計', '粗利', '粗利率(%)',
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.month,
        ...WorkerCategoryOrder.map((c) => r.byCategory[c].count),
        r.totalCount,
        r.newTotal, r.endTotal, r.transfersTotal,
        ...WorkerCategoryOrder.map((c) => r.byCategory[c].newCases),
        ...WorkerCategoryOrder.map((c) => r.byCategory[c].endingCases),
        ...WorkerCategoryOrder.map((c) => r.byCategory[c].revenue),
        r.totalRevenue,
        ...WorkerCategoryOrder.map((c) => r.byCategory[c].cost),
        r.totalCost, r.totalProfit, (r.margin * 100).toFixed(2),
      ].join(','),
    )
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}_月次推移.csv`
  a.click()
  URL.revokeObjectURL(url)
}
