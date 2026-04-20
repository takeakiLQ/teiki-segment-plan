import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import {
  budgetRevenueOf,
  computeMonthly,
  percent,
  priorYm,
  workingDaysOf,
  yen,
} from '../utils/calculations'
import { formatYmShort, parseYm } from '../utils/month'

const CATEGORY_COLORS: Record<string, string> = {
  運送店: '#2563eb',
  業者: '#7c3aed',
  社員: '#059669',
}

const TREND_COLORS = {
  current: '#0ea5e9',  // 当年計画
  prior: '#7c3aed',    // 前年実績
}

/** baseMonth から Japanese FY ラベル（4月開始） */
function fiscalYearLabel(baseMonth: string): string {
  const { year, month1 } = parseYm(baseMonth)
  const fy = month1 >= 4 ? year : year - 1
  return `FY${fy}`
}

export default function Dashboard() {
  const plan = usePlanStore((s) => s.plan)
  const rows = useMemo(() => computeMonthly(plan), [plan])

  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0)
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0)
  const totalProfit = totalRevenue - totalCost
  const avgMargin = totalRevenue > 0 ? totalProfit / totalRevenue : 0

  // 年度予算
  const budgetRevTotal = useMemo(
    () => rows.reduce((s, r) => s + budgetRevenueOf(plan, r.month), 0),
    [rows, plan],
  )
  const hasBudget = budgetRevTotal > 0

  // 前年実績 lookup
  const py = plan.priorYear
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

  // 前年 営業日数
  function priorDaysOf(ym: string): number {
    if (!py) return 20
    const v = py.workingDaysByMonth?.[ym]
    if (typeof v === 'number' && v > 0) return v
    if (typeof py.defaultWorkingDays === 'number' && py.defaultWorkingDays > 0) return py.defaultWorkingDays
    return 20
  }

  const currentFY = fiscalYearLabel(plan.baseMonth)
  const priorFY = py?.fiscalYear || '前年'

  // 日計トレンドデータ：fiscal month (4月...3月) 軸
  const trendData = useMemo(() => {
    return rows.map((r) => {
      const days = workingDaysOf(plan, r.month)
      const currentDaily = days > 0 ? Math.round(r.totalRevenue / days) : 0
      const pyKey = priorYm(r.month)
      const pyData = priorLookup.get(pyKey)
      const pyDays = priorDaysOf(pyKey)
      const priorDaily = pyData && pyData.revenue > 0 && pyDays > 0
        ? Math.round(pyData.revenue / pyDays)
        : null
      const { month1 } = parseYm(r.month)
      return {
        fm: `${month1}月`,
        [currentFY]: currentDaily,
        [priorFY]: priorDaily,
      }
    })
  }, [rows, plan, priorLookup, currentFY, priorFY])

  // 平均日計
  const currentAvgDaily = useMemo(() => {
    let sumRev = 0, sumDays = 0
    for (const r of rows) {
      sumRev += r.totalRevenue
      sumDays += workingDaysOf(plan, r.month)
    }
    return sumDays > 0 ? sumRev / sumDays : 0
  }, [rows, plan])
  const priorAvgDaily = useMemo(() => {
    if (!py) return 0
    let sumRev = 0, sumDays = 0
    for (const d of py.monthlyData) {
      sumRev += d.revenue ?? 0
      sumDays += priorDaysOf(d.month)
    }
    return sumDays > 0 ? sumRev / sumDays : 0
  }, [py])

  // 案件数構成（参考表示）
  const compositionData = rows.map((r) => {
    const obj: any = { month: formatYmShort(r.month) }
    for (const cat of WorkerCategoryOrder) {
      obj[WorkerCategoryLabels[cat]] = r.byCategory[cat].count
    }
    return obj
  })

  const firstRow = rows[0]
  const lastRow = rows[rows.length - 1]

  return (
    <div>
      <div className="kpi-grid">
        <Kpi
          label={`${currentFY} 売上計画`}
          value={`¥${yen(totalRevenue)}`}
          sub={hasBudget ? `対予算 ${percent(totalRevenue / budgetRevTotal)}` : undefined}
        />
        <Kpi
          label={`${currentFY} 粗利計画`}
          value={`¥${yen(totalProfit)}`}
          sub={`粗利率 ${percent(avgMargin)}`}
        />
        <Kpi
          label="平均 日計（計画）"
          value={`¥${yen(currentAvgDaily)} / 日`}
          sub={
            hasPriorYear && priorAvgDaily > 0
              ? `前年 ¥${yen(priorAvgDaily)}/日（${percent(currentAvgDaily / priorAvgDaily)}）`
              : undefined
          }
        />
        <Kpi
          label="期首 → 期末 案件数"
          value={`${(firstRow?.totalCount ?? 0).toLocaleString()} → ${(lastRow?.totalCount ?? 0).toLocaleString()}`}
          sub={`Δ ${((lastRow?.totalCount ?? 0) - (firstRow?.totalCount ?? 0)).toLocaleString()}件`}
        />
      </div>

      {/* 主役：日計トレンド */}
      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>日計トレンド（売上 ÷ 営業日数）</h3>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              営業日数の凸凹を除いた「1日あたり売上」の推移。本質的な売上力の増減が見えます。
            </div>
          </div>
          <div className="row" style={{ gap: 14, fontSize: 12 }}>
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: TREND_COLORS.current, borderRadius: 2, marginRight: 4 }} />
              {currentFY} <strong className="mono">¥{yen(currentAvgDaily)}</strong>/日
            </span>
            {hasPriorYear && priorAvgDaily > 0 && (
              <span>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: TREND_COLORS.prior, borderRadius: 2, marginRight: 4 }} />
                {priorFY} <strong className="mono">¥{yen(priorAvgDaily)}</strong>/日
                <span className="muted" style={{ marginLeft: 4 }}>
                  （対前年 {percent(currentAvgDaily / priorAvgDaily)}）
                </span>
              </span>
            )}
          </div>
        </div>
        <div style={{ width: '100%', height: 360, marginTop: 12 }}>
          <ResponsiveContainer>
            <LineChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="fm" stroke="#64748b" />
              <YAxis
                stroke="#64748b"
                tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                formatter={(v: any, name) => {
                  if (v == null) return ['—', name]
                  return [`¥${yen(Number(v))} / 日`, name]
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey={currentFY}
                stroke={TREND_COLORS.current}
                strokeWidth={3}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
              {hasPriorYear && (
                <Line
                  type="monotone"
                  dataKey={priorFY}
                  stroke={TREND_COLORS.prior}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ r: 3 }}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {!hasPriorYear && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            前年実績を登録すると、もう1本（前年の日計推移）が重ねて表示されます。
          </div>
        )}
      </div>

      {/* 補助：案件数構成 */}
      <div className="card">
        <h3>案件数の月次推移（カテゴリ別 積み上げ）</h3>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={compositionData}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="month" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                formatter={(v: number, n) => [`${v.toLocaleString()}件`, n]}
              />
              <Legend />
              {WorkerCategoryOrder.map((cat) => (
                <Bar
                  key={cat}
                  dataKey={WorkerCategoryLabels[cat]}
                  stackId="count"
                  fill={CATEGORY_COLORS[WorkerCategoryLabels[cat]]}
                />
              ))}
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
