import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { usePlanStore } from '../store'
import { computeMonthly, percent, sumRows, yen } from '../utils/calculations'
import { formatYmShort } from '../utils/month'

export default function Dashboard() {
  const plan = usePlanStore((s) => s.plan)
  const rows = useMemo(() => computeMonthly(plan), [plan])
  const total = useMemo(() => sumRows(rows), [rows])

  const chartData = rows.map((r) => ({
    month: formatYmShort(r.month),
    売上: r.revenue,
    原価: r.costTotal,
    粗利: r.grossProfit,
    粗利率: Math.round(r.grossMargin * 1000) / 10,
  }))

  const categoryData = rows.map((r) => ({
    month: formatYmShort(r.month),
    パートナー: r.costByCategory.partner,
    協力会社: r.costByCategory.vendor,
    D職: r.costByCategory.dposition,
    FS: r.costByCategory.fs,
  }))

  const avgMargin = total.revenue > 0 ? total.grossProfit / total.revenue : 0

  return (
    <div>
      <div className="kpi-grid">
        <Kpi label={`${plan.horizonMonths}ヶ月 売上計`} value={`¥${yen(total.revenue)}`} />
        <Kpi label={`${plan.horizonMonths}ヶ月 粗利計`} value={`¥${yen(total.grossProfit)}`} sub={`粗利率 ${percent(avgMargin)}`} />
        <Kpi label="期末 案件数" value={`${rows[rows.length - 1]?.activeProjectCount ?? 0}`} sub={`期首 ${rows[0]?.activeProjectCount ?? 0}`} />
        <Kpi label="期末 稼働者数" value={`${rows[rows.length - 1]?.activeWorkerCount ?? 0}`} sub={`期首 ${rows[0]?.activeWorkerCount ?? 0}`} />
      </div>

      <div className="card">
        <div className="row between">
          <h3>月次 売上・原価・粗利</h3>
          <div className="legend">
            <span><i style={{ background: '#38bdf8' }} />売上</span>
            <span><i style={{ background: '#ef4444' }} />原価</span>
            <span><i style={{ background: '#22c55e' }} />粗利</span>
            <span><i style={{ background: '#f59e0b' }} />粗利率</span>
          </div>
        </div>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis yAxisId="left" stroke="#94a3b8" tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`} />
              <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" unit="%" />
              <Tooltip
                contentStyle={{ background: '#0b1220', border: '1px solid #334155' }}
                formatter={(value: number, name) => {
                  if (name === '粗利率') return [`${value}%`, name]
                  return [`¥${yen(value)}`, name]
                }}
              />
              <Legend />
              <Bar yAxisId="left" dataKey="売上" fill="#38bdf8" />
              <Bar yAxisId="left" dataKey="原価" fill="#ef4444" />
              <Line yAxisId="left" dataKey="粗利" stroke="#22c55e" strokeWidth={2} />
              <Line yAxisId="right" dataKey="粗利率" stroke="#f59e0b" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>稼働者区分別 原価の月次推移</h3>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={categoryData}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`} />
              <Tooltip
                contentStyle={{ background: '#0b1220', border: '1px solid #334155' }}
                formatter={(v: number, n) => [`¥${yen(v)}`, n]}
              />
              <Legend />
              <Bar dataKey="パートナー" stackId="cost" fill="#60a5fa" />
              <Bar dataKey="協力会社" stackId="cost" fill="#a78bfa" />
              <Bar dataKey="D職" stackId="cost" fill="#f472b6" />
              <Bar dataKey="FS" stackId="cost" fill="#34d399" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
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
