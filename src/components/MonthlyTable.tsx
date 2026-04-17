import { useMemo } from 'react'
import { usePlanStore } from '../store'
import { computeMonthly, percent, sumRows, yen } from '../utils/calculations'
import { formatYmShort } from '../utils/month'

export default function MonthlyTable() {
  const plan = usePlanStore((s) => s.plan)
  const rows = useMemo(() => computeMonthly(plan), [plan])
  const total = useMemo(() => sumRows(rows), [rows])

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
              {rows.map((r) => (
                <th key={r.month}>{formatYmShort(r.month)}</th>
              ))}
              <th>合計</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>売上</td>
              {rows.map((r) => (
                <td className="mono" key={r.month}>{yen(r.revenue)}</td>
              ))}
              <td className="mono"><strong>{yen(total.revenue)}</strong></td>
            </tr>
            <tr>
              <td>原価</td>
              {rows.map((r) => (
                <td className="mono" key={r.month}>{yen(r.costTotal)}</td>
              ))}
              <td className="mono"><strong>{yen(total.costTotal)}</strong></td>
            </tr>
            <tr>
              <td><span className="badge partner">パートナー</span></td>
              {rows.map((r) => (<td className="mono" key={r.month}>{yen(r.costByCategory.partner)}</td>))}
              <td className="mono">{yen(total.costByCategory.partner)}</td>
            </tr>
            <tr>
              <td><span className="badge vendor">協力会社</span></td>
              {rows.map((r) => (<td className="mono" key={r.month}>{yen(r.costByCategory.vendor)}</td>))}
              <td className="mono">{yen(total.costByCategory.vendor)}</td>
            </tr>
            <tr>
              <td><span className="badge dposition">D職</span></td>
              {rows.map((r) => (<td className="mono" key={r.month}>{yen(r.costByCategory.dposition)}</td>))}
              <td className="mono">{yen(total.costByCategory.dposition)}</td>
            </tr>
            <tr>
              <td><span className="badge fs">FS</span></td>
              {rows.map((r) => (<td className="mono" key={r.month}>{yen(r.costByCategory.fs)}</td>))}
              <td className="mono">{yen(total.costByCategory.fs)}</td>
            </tr>
            <tr>
              <td><strong>粗利</strong></td>
              {rows.map((r) => (
                <td className="mono" key={r.month}><strong>{yen(r.grossProfit)}</strong></td>
              ))}
              <td className="mono"><strong>{yen(total.grossProfit)}</strong></td>
            </tr>
            <tr>
              <td>粗利率</td>
              {rows.map((r) => (
                <td className="mono" key={r.month}>{percent(r.grossMargin)}</td>
              ))}
              <td className="mono">{percent(total.revenue ? total.grossProfit / total.revenue : 0)}</td>
            </tr>
            <tr>
              <td>アクティブ案件</td>
              {rows.map((r) => (<td className="mono" key={r.month}>{r.activeProjectCount}</td>))}
              <td></td>
            </tr>
            <tr>
              <td>新規 / 終了</td>
              {rows.map((r) => (
                <td className="mono" key={r.month}>
                  <span style={{ color: '#22c55e' }}>+{r.newProjects}</span>
                  {' / '}
                  <span style={{ color: '#ef4444' }}>-{r.endingProjects}</span>
                </td>
              ))}
              <td></td>
            </tr>
            <tr>
              <td>稼働者数</td>
              {rows.map((r) => (<td className="mono" key={r.month}>{r.activeWorkerCount}</td>))}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function exportCsv(name: string, rows: ReturnType<typeof computeMonthly>) {
  const header = ['月', '売上', '原価', 'パートナー', '協力会社', 'D職', 'FS', '粗利', '粗利率', 'アクティブ案件', '稼働者数']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([
      r.month,
      r.revenue, r.costTotal,
      r.costByCategory.partner, r.costByCategory.vendor, r.costByCategory.dposition, r.costByCategory.fs,
      r.grossProfit, (r.grossMargin * 100).toFixed(2) + '%',
      r.activeProjectCount, r.activeWorkerCount,
    ].join(','))
  }
  const blob = new Blob(["\ufeff" + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}_月次推移.csv`
  a.click()
  URL.revokeObjectURL(url)
}
