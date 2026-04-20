import { useMemo, useRef, useState } from 'react'
import { createEmptyPlan, usePlanStore } from '../store'
import type { Plan } from '../types'
import { formatYmShort, monthsRange } from '../utils/month'

/** 円を読みやすく */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('ja-JP')
}

/** 小数点第2位まで丸める */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
/** 表示用：必要なら第2位まで、不要な末尾0は省く */
function fmtDays(n: number): string {
  return Number.isFinite(n) ? round2(n).toString() : ''
}

/** 月ごとの計算日数カード */
function WorkingDaysCard() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])
  const fileRef = useRef<HTMLInputElement>(null)

  function exportJson() {
    const obj = {
      defaultWorkingDays: plan.defaultWorkingDays,
      workingDays: { ...plan.workingDaysByMonth },
    }
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'fy-workingdays.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const obj = JSON.parse(text)
      if (obj == null || typeof obj !== 'object') throw new Error('JSONは { ... } 形式')
      const nextByMonth = { ...plan.workingDaysByMonth }
      let updatedMonths = 0
      if (obj.workingDays && typeof obj.workingDays === 'object' && !Array.isArray(obj.workingDays)) {
        for (const [k, v] of Object.entries(obj.workingDays)) {
          const n = Number(v)
          if (!/^\d{4}-\d{2}$/.test(k)) continue
          if (Number.isFinite(n) && n > 0) {
            nextByMonth[k] = Math.round(n * 100) / 100
            updatedMonths += 1
          }
        }
      }
      const nextDefault = obj.defaultWorkingDays != null
        ? Math.max(0.01, Math.round(Number(obj.defaultWorkingDays) * 100) / 100)
        : plan.defaultWorkingDays
      if (updatedMonths === 0 && nextDefault === plan.defaultWorkingDays) {
        alert('読み込める workingDays / defaultWorkingDays が見つかりませんでした。')
      } else {
        if (!confirm(`「${file.name}」を取り込みます（既存値にマージ）。\n更新される月数: ${updatedMonths}\nデフォルト日数: ${nextDefault}`)) return
        setPlan((p) => ({ ...p, workingDaysByMonth: nextByMonth, defaultWorkingDays: nextDefault }))
        alert(`取り込みました。月別上書き ${updatedMonths} 件、デフォルト ${nextDefault} 日。`)
      }
    } catch (err: any) {
      alert('読み込みに失敗しました: ' + (err?.message ?? err))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function getDays(m: string): number {
    const v = plan.workingDaysByMonth?.[m]
    return typeof v === 'number' && v > 0 ? v : plan.defaultWorkingDays
  }
  function setDays(m: string, v: number) {
    setPlan((p) => {
      const next = { ...p.workingDaysByMonth }
      if (v > 0) next[m] = round2(v)
      else delete next[m]
      return { ...p, workingDaysByMonth: next }
    })
  }
  function setDefault(v: number) {
    setPlan((p) => ({ ...p, defaultWorkingDays: Math.max(0.01, round2(v)) }))
  }
  function fillAll(v: number) {
    const r = round2(v)
    if (!confirm(`全月の計算日数を ${r} 日で上書きしますか？`)) return
    setPlan((p) => {
      const next: Record<string, number> = {}
      for (const m of months) next[m] = r
      return { ...p, workingDaysByMonth: next }
    })
  }
  function clearOverrides() {
    if (!confirm('月別オーバーライドを削除しますか？（全月がデフォルト日数に戻ります）')) return
    setPlan((p) => ({ ...p, workingDaysByMonth: {} }))
  }

  const total = round2(months.reduce((s, m) => s + getDays(m), 0))

  return (
    <div className="card">
      <div className="row between">
        <h3>月ごとの計算日数（日単価 × 計算日数 = 月次売上）</h3>
        <div className="row">
          <button className="small ghost" onClick={exportJson}>JSON書き出し</button>
          <button className="small ghost" onClick={() => fileRef.current?.click()}>JSON読み込み</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={importJson} />
          <button className="small ghost" onClick={() => {
            const v = Number(prompt('全月に揃える日数（小数点第2位まで）', String(plan.defaultWorkingDays)) ?? '0')
            if (!Number.isNaN(v) && v > 0) fillAll(v)
          }}>全月一括</button>
          <button className="small ghost" onClick={clearOverrides}>月別をクリア</button>
        </div>
      </div>
      <div className="form-grid" style={{ marginBottom: 10 }}>
        <div>
          <label>デフォルト計算日数（未指定月に適用・小数可）</label>
          <input
            type="number"
            min={0.01}
            max={31}
            step={0.01}
            value={fmtDays(plan.defaultWorkingDays)}
            onChange={(e) => setDefault(Number(e.target.value) || 20)}
          />
        </div>
      </div>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>月</th>
              {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
              <th style={{ background: '#e2e8f0' }}>年間合計</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>計算日数</td>
              {months.map((m) => {
                const isOverride = typeof plan.workingDaysByMonth?.[m] === 'number'
                return (
                  <td key={`wd-${m}`} style={{ padding: 2 }}>
                    <input
                      type="number"
                      min={0}
                      max={31}
                      step={0.01}
                      value={fmtDays(getDays(m))}
                      onChange={(e) => setDays(m, Number(e.target.value) || 0)}
                      style={{ width: 76, padding: '2px 6px', textAlign: 'right', color: isOverride ? '#0f172a' : '#94a3b8' }}
                      title={isOverride ? '月別上書き' : 'デフォルト値'}
                    />
                  </td>
                )
              })}
              <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700 }}>{total}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        小数点第2位まで入力できます（例: 20.83）。値が灰色＝デフォルト。個別に上書きした月は黒字で表示されます。0 または空にするとデフォルトに戻ります。
      </div>
    </div>
  )
}

/** 年度予算カード */
function BudgetCard() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  const b = plan.budget ?? { revenue: 0, grossProfit: 0, revenueByMonth: {}, grossProfitByMonth: {} }
  const margin = b.revenue > 0 ? b.grossProfit / b.revenue : 0

  function updateAnnual(field: 'revenue' | 'grossProfit', v: number) {
    setPlan((p) => ({ ...p, budget: { ...p.budget, [field]: Math.max(0, Math.round(v)) } }))
  }
  function setMonthly(field: 'revenueByMonth' | 'grossProfitByMonth', m: string, v: number) {
    setPlan((p) => {
      const next = { ...p.budget[field] }
      if (v > 0) next[m] = Math.round(v)
      else delete next[m]
      return { ...p, budget: { ...p.budget, [field]: next } }
    })
  }
  function distributeEqual(field: 'revenue' | 'grossProfit') {
    const annual = field === 'revenue' ? b.revenue : b.grossProfit
    if (annual <= 0) return alert('先に年間予算を入力してください。')
    if (!confirm(`年間予算を12ヶ月で均等按分して上書きしますか？`)) return
    const per = Math.round(annual / months.length)
    setPlan((p) => {
      const next: Record<string, number> = {}
      for (const m of months) next[m] = per
      return { ...p, budget: { ...p.budget, [`${field}ByMonth`]: next } }
    })
  }
  function clearMonthly(field: 'revenueByMonth' | 'grossProfitByMonth') {
    if (!confirm('月別予算をクリアして「均等按分」に戻しますか？')) return
    setPlan((p) => ({ ...p, budget: { ...p.budget, [field]: {} } }))
  }

  function effMonthly(field: 'revenueByMonth' | 'grossProfitByMonth', m: string): number {
    const v = b[field]?.[m]
    if (typeof v === 'number' && v > 0) return v
    const annual = field === 'revenueByMonth' ? b.revenue : b.grossProfit
    return months.length > 0 ? Math.round(annual / months.length) : 0
  }

  const monthlyRevTotal = months.reduce((s, m) => s + effMonthly('revenueByMonth', m), 0)
  const monthlyGpTotal = months.reduce((s, m) => s + effMonthly('grossProfitByMonth', m), 0)

  return (
    <div className="card">
      <h3>年度予算（売上・粗利）</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        年間の売上・粗利予算を登録すると、月次テーブルに「予算」「対予算差」「達成率」が表示されます。
        月別の凸凹がある場合は、下の月別予算で月ごとに上書きできます。
      </div>

      <div className="form-grid" style={{ marginBottom: 10 }}>
        <div>
          <label>年間 売上予算（円）</label>
          <input type="number" min={0} value={b.revenue}
            onChange={(e) => updateAnnual('revenue', Number(e.target.value) || 0)} />
        </div>
        <div>
          <label>年間 粗利予算（円）</label>
          <input type="number" min={0} value={b.grossProfit}
            onChange={(e) => updateAnnual('grossProfit', Number(e.target.value) || 0)} />
        </div>
        <div>
          <label>年間 粗利率（自動）</label>
          <input readOnly value={b.revenue > 0 ? `${(margin * 100).toFixed(1)}%` : '—'}
            style={{ background: '#f8fafc', color: b.revenue > 0 ? (margin >= 0 ? '#16a34a' : '#dc2626') : '#94a3b8' }} />
        </div>
      </div>

      <div className="row between" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 13 }}>月別 予算（省略可）</h3>
        <div className="row">
          <button className="small ghost" onClick={() => distributeEqual('revenue')}>売上を均等按分</button>
          <button className="small ghost" onClick={() => distributeEqual('grossProfit')}>粗利を均等按分</button>
          <button className="small ghost" onClick={() => clearMonthly('revenueByMonth')}>売上 月別クリア</button>
          <button className="small ghost" onClick={() => clearMonthly('grossProfitByMonth')}>粗利 月別クリア</button>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
        空欄／0 はグレー表示＝「均等按分（年間÷{months.length}）」で評価されます。個別に上書きすると黒字で表示。
      </div>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
              <th style={{ background: '#e2e8f0' }}>年間合計</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: '#0ea5e9', fontWeight: 600 }}>売上予算</td>
              {months.map((m) => {
                const isOverride = typeof b.revenueByMonth?.[m] === 'number'
                const display = effMonthly('revenueByMonth', m)
                return (
                  <td key={`br-${m}`} style={{ padding: 2 }}>
                    <input type="number" min={0} value={display}
                      onChange={(e) => setMonthly('revenueByMonth', m, Number(e.target.value) || 0)}
                      style={{ width: 96, padding: '2px 6px', textAlign: 'right', color: isOverride ? '#0ea5e9' : '#94a3b8' }} />
                  </td>
                )
              })}
              <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700, color: '#0ea5e9' }}>
                {monthlyRevTotal.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td style={{ color: '#16a34a', fontWeight: 600 }}>粗利予算</td>
              {months.map((m) => {
                const isOverride = typeof b.grossProfitByMonth?.[m] === 'number'
                const display = effMonthly('grossProfitByMonth', m)
                return (
                  <td key={`bg-${m}`} style={{ padding: 2 }}>
                    <input type="number" value={display}
                      onChange={(e) => setMonthly('grossProfitByMonth', m, Number(e.target.value) || 0)}
                      style={{ width: 96, padding: '2px 6px', textAlign: 'right', color: isOverride ? '#16a34a' : '#94a3b8' }} />
                  </td>
                )
              })}
              <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700, color: '#16a34a' }}>
                {monthlyGpTotal.toLocaleString()}
              </td>
            </tr>
            <tr style={{ background: '#f8fafc' }}>
              <td><strong>粗利率（自動）</strong></td>
              {months.map((m) => {
                const rev = effMonthly('revenueByMonth', m)
                const gp = effMonthly('grossProfitByMonth', m)
                const mg = rev > 0 ? gp / rev : 0
                return (
                  <td key={`bmm-${m}`} className="mono" style={{ fontWeight: 600 }}>
                    {rev > 0 ? `${(mg * 100).toFixed(1)}%` : '—'}
                  </td>
                )
              })}
              <td className="mono" style={{ background: '#e2e8f0', fontWeight: 700 }}>
                {monthlyRevTotal > 0 ? `${((monthlyGpTotal / monthlyRevTotal) * 100).toFixed(1)}%` : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** FY2026 マイスター見込みカード（EventsPanel からも利用） */
export function MeisterCard() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  const [pctInput, setPctInput] = useState(10)
  const [avgInput, setAvgInput] = useState(18_000_000)

  // 前年同月マッピング（2026-04 → 2025-04 などの-12ヶ月キー）
  function priorYmOf(m: string) {
    const d = new Date(`${m}-01`)
    d.setMonth(d.getMonth() - 12)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  const priorByMonth = useMemo(() => {
    const map: Record<string, number> = {}
    if (plan.priorYear) {
      for (const d of plan.priorYear.monthlyData) {
        if (d.meisterRevenue && d.meisterRevenue > 0) map[d.month] = d.meisterRevenue
      }
    }
    return map
  }, [plan.priorYear])

  const priorTotal = Object.values(priorByMonth).reduce((s, v) => s + v, 0)
  const priorCount = Object.keys(priorByMonth).length
  const priorAvg = priorCount > 0 ? priorTotal / priorCount : 0

  const currentByMonth = plan.meisterRevenueByMonth ?? {}
  const currentTotal = months.reduce((s, m) => s + (currentByMonth[m] ?? 0), 0)
  const currentAvg = months.length > 0 ? currentTotal / months.length : 0
  const yoyRatio = priorTotal > 0 ? currentTotal / priorTotal : 0

  function setMonth(m: string, v: number) {
    setPlan((p) => {
      const next = { ...p.meisterRevenueByMonth }
      if (v > 0) next[m] = Math.round(v)
      else delete next[m]
      return { ...p, meisterRevenueByMonth: next }
    })
  }

  function clearAll() {
    if (!confirm('FY2026 マイスター見込みを全てクリアしますか？')) return
    setPlan((p) => ({ ...p, meisterRevenueByMonth: {} }))
  }

  /** 月平均額 × 12ヶ月 で一律 */
  function applyAverage(amount: number) {
    if (amount <= 0) return
    if (!confirm(`全月を平均 ¥${fmt(amount)}/月 で設定します（年計 ¥${fmt(amount * months.length)}）。よろしいですか？`)) return
    setPlan((p) => {
      const next: Record<string, number> = {}
      for (const m of months) next[m] = Math.round(amount)
      return { ...p, meisterRevenueByMonth: next }
    })
  }

  /** 前年の月次パターン × (1 + pct/100) */
  function applyPercentFromPriorYear(pct: number) {
    if (priorCount === 0) {
      alert('前年のマイスター実績データがありません。先に前年実績を登録してください。')
      return
    }
    const newTotal = Math.round(priorTotal * (1 + pct / 100))
    if (!confirm(
      `前年月次パターン × ${pct >= 0 ? '+' : ''}${pct}% で設定します。\n` +
      `  前年計 ¥${fmt(priorTotal)} → 当年計 ¥${fmt(newTotal)}\n` +
      `  前年平均 ¥${fmt(priorAvg)} → 当年平均 ¥${fmt(priorAvg * (1 + pct / 100))}`
    )) return
    setPlan((p) => {
      const next: Record<string, number> = {}
      for (const m of months) {
        const prior = priorByMonth[priorYmOf(m)] ?? 0
        next[m] = Math.round(prior * (1 + pct / 100))
      }
      return { ...p, meisterRevenueByMonth: next }
    })
  }

  return (
    <div className="card" style={{ background: '#faf5ff', borderColor: '#d8b4fe' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ color: '#6b21a8', margin: 0 }}>FY2026 マイスター見込み</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            営業社員が代走する分の売上見込み。<strong>売上は案件プール不変、代走先の原価率ぶん原価が減って粗利が増える</strong>。
          </div>
        </div>
      </div>

      {/* 代走先 allocation UI */}
      <div className="card" style={{ background: '#fff', marginTop: 8 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>代走先の分布（合計100%）</h3>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          マイスターがどのカテゴリ枠の代走をしているかの分布。浮く原価の計算に使われます（運送店枠の代走なら運送店原価率ぶんの粗利増）。
        </div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['partner', 'vendor', 'employment'] as const).map((cat) => {
            const alloc = plan.meisterAllocation ?? { partner: 100, vendor: 0, employment: 0 }
            const val = alloc[cat] ?? 0
            const labels = { partner: '運送店', vendor: '業者', employment: '社員' }
            return (
              <div key={cat} className="row" style={{ gap: 4, alignItems: 'center' }}>
                <span className={`badge ${cat}`}>{labels[cat]}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={val}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)))
                    setPlan((p) => ({
                      ...p,
                      meisterAllocation: {
                        ...(p.meisterAllocation ?? { partner: 100, vendor: 0, employment: 0 }),
                        [cat]: v,
                      },
                    }))
                  }}
                  style={{ width: 60, textAlign: 'right' }}
                />
                <span className="muted" style={{ fontSize: 11 }}>%</span>
              </div>
            )
          })}
          <div className="muted" style={{ fontSize: 11 }}>
            合計:{' '}
            <strong
              style={{
                color:
                  ((plan.meisterAllocation?.partner ?? 0) +
                    (plan.meisterAllocation?.vendor ?? 0) +
                    (plan.meisterAllocation?.employment ?? 0)) ===
                  100
                    ? '#16a34a'
                    : '#dc2626',
              }}
            >
              {(plan.meisterAllocation?.partner ?? 0) +
                (plan.meisterAllocation?.vendor ?? 0) +
                (plan.meisterAllocation?.employment ?? 0)}
              %
            </strong>
          </div>
          <button
            className="small ghost"
            onClick={() =>
              setPlan((p) => ({
                ...p,
                meisterAllocation: { partner: 100, vendor: 0, employment: 0 },
              }))
            }
          >
            既定（運送店100%）
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="kpi-grid" style={{ marginTop: 10 }}>
        <div className="kpi" style={{ background: '#fff' }}>
          <div className="label">前年 マイスター計</div>
          <div className="value mono" style={{ color: '#64748b' }}>¥{fmt(priorTotal)}</div>
          <div className="sub">月平均 ¥{fmt(priorAvg)}</div>
        </div>
        <div className="kpi" style={{ background: '#fff' }}>
          <div className="label">当年 マイスター計（計画）</div>
          <div className="value mono" style={{ color: '#7c3aed' }}>¥{fmt(currentTotal)}</div>
          <div className="sub">月平均 ¥{fmt(currentAvg)}</div>
        </div>
        <div className="kpi" style={{ background: '#fff' }}>
          <div className="label">対前年</div>
          <div className="value mono" style={{ color: yoyRatio >= 1 ? '#16a34a' : '#dc2626' }}>
            {priorTotal > 0 ? `${(yoyRatio * 100).toFixed(1)}%` : '—'}
          </div>
          <div className="sub">差 {currentTotal >= priorTotal ? '+' : ''}¥{fmt(currentTotal - priorTotal)}</div>
        </div>
      </div>

      {/* クイック調整 */}
      <div className="card" style={{ background: '#fff', marginTop: 8 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>クイック調整</h3>
        <div className="form-grid">
          <div>
            <label>① 前年から +X% UP</label>
            <div className="row" style={{ gap: 6 }}>
              <input
                type="number"
                value={pctInput}
                onChange={(e) => setPctInput(Number(e.target.value) || 0)}
                style={{ width: 90 }}
              />
              <span className="muted" style={{ fontSize: 12 }}>%</span>
              <button className="small" onClick={() => applyPercentFromPriorYear(pctInput)}>適用</button>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              予想: ¥{fmt(priorAvg * (1 + pctInput / 100))}/月、年計 ¥{fmt(priorTotal * (1 + pctInput / 100))}
            </div>
          </div>
          <div>
            <label>② 月平均 Y円 を全月</label>
            <div className="row" style={{ gap: 6 }}>
              <input
                type="number"
                value={avgInput}
                onChange={(e) => setAvgInput(Number(e.target.value) || 0)}
                style={{ width: 140 }}
              />
              <span className="muted" style={{ fontSize: 12 }}>円/月</span>
              <button className="small" onClick={() => applyAverage(avgInput)}>適用</button>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              年計 ¥{fmt(avgInput * months.length)}
            </div>
          </div>
          <div>
            <label>プリセット</label>
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              <button className="small ghost" onClick={() => applyPercentFromPriorYear(0)}>前年同額</button>
              <button className="small ghost" onClick={() => applyPercentFromPriorYear(5)}>+5%</button>
              <button className="small ghost" onClick={() => applyPercentFromPriorYear(10)}>+10%</button>
              <button className="small ghost" onClick={() => applyPercentFromPriorYear(15)}>+15%</button>
              <button className="small ghost" onClick={() => applyAverage(18_000_000)}>月1800万</button>
              <button className="small ghost" onClick={() => applyAverage(20_000_000)}>月2000万</button>
              <button className="small danger" onClick={clearAll}>クリア</button>
            </div>
          </div>
        </div>
      </div>

      {/* 月次テーブル（当年・前年同月・前年比%） */}
      <div className="scroll-x" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>項目</th>
              {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
              <th style={{ background: '#e2e8f0' }}>年間合計</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: '#7c3aed', fontWeight: 600 }}>FY2026 計画</td>
              {months.map((m) => {
                const v = currentByMonth[m] ?? 0
                return (
                  <td key={`mr-${m}`} style={{ padding: 2 }}>
                    <input
                      type="number"
                      min={0}
                      value={v}
                      onChange={(e) => setMonth(m, Number(e.target.value) || 0)}
                      style={{ width: 108, padding: '2px 6px', textAlign: 'right', color: '#7c3aed' }}
                    />
                  </td>
                )
              })}
              <td className="mono" style={{ background: '#f1f5f9', color: '#7c3aed', fontWeight: 700 }}>
                ¥{fmt(currentTotal)}
              </td>
            </tr>
            <tr>
              <td className="muted">前年同月（FY2025）</td>
              {months.map((m) => {
                const priorV = priorByMonth[priorYmOf(m)] ?? 0
                return (
                  <td key={`py-${m}`} className="mono muted" style={{ fontSize: 12 }}>
                    {priorV > 0 ? `¥${fmt(priorV)}` : '—'}
                  </td>
                )
              })}
              <td className="mono muted" style={{ background: '#f1f5f9' }}>
                ¥{fmt(priorTotal)}
              </td>
            </tr>
            <tr>
              <td className="muted" style={{ fontSize: 11 }}>対前年</td>
              {months.map((m) => {
                const cur = currentByMonth[m] ?? 0
                const priorV = priorByMonth[priorYmOf(m)] ?? 0
                const r = priorV > 0 ? (cur / priorV) * 100 : 0
                return (
                  <td key={`yoy-${m}`} className="mono muted" style={{ fontSize: 11, color: r >= 100 ? '#16a34a' : r > 0 ? '#dc2626' : undefined }}>
                    {priorV > 0 && cur > 0 ? `${r.toFixed(0)}%` : '—'}
                  </td>
                )
              })}
              <td className="mono" style={{
                background: '#f1f5f9',
                color: yoyRatio >= 1 ? '#16a34a' : yoyRatio > 0 ? '#dc2626' : undefined,
                fontWeight: 700,
              }}>
                {priorTotal > 0 ? `${(yoyRatio * 100).toFixed(1)}%` : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function SettingsPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const replacePlan = usePlanStore((s) => s.replacePlan)
  const resetToSample = usePlanStore((s) => s.resetToSample)
  const fileRef = useRef<HTMLInputElement>(null)

  function exportJson() {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${plan.name || 'plan'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const obj = JSON.parse(text) as Plan
      replacePlan(obj)
      alert('インポートしました。')
    } catch (err) {
      alert('JSON の解析に失敗しました。')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <div className="card">
        <h3>計画の基本設定</h3>
        <div className="form-grid">
          <div>
            <label>計画名</label>
            <input value={plan.name} onChange={(e) => setPlan((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label>基準月（この月を 1 ヶ月目として表示）</label>
            <input
              type="month"
              value={plan.baseMonth}
              onChange={(e) => setPlan((p) => ({ ...p, baseMonth: e.target.value }))}
            />
          </div>
          <div>
            <label>期間（月）</label>
            <input
              type="number"
              min={3}
              max={36}
              value={plan.horizonMonths}
              onChange={(e) => setPlan((p) => ({ ...p, horizonMonths: Math.max(3, Math.min(36, Number(e.target.value) || 12)) }))}
            />
          </div>
        </div>
      </div>

      <WorkingDaysCard />

      <BudgetCard />

      <div className="card">
        <h3>データのインポート／エクスポート</h3>
        <div className="row">
          <button onClick={exportJson}>JSON エクスポート</button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>JSON インポート</button>
          <input type="file" accept="application/json" ref={fileRef} style={{ display: 'none' }} onChange={importJson} />
          <button className="ghost" onClick={() => {
            if (confirm('空の計画にリセットしますか？現在のデータは失われます。')) replacePlan(createEmptyPlan(plan.name))
          }}>空にリセット</button>
          <button className="ghost" onClick={() => {
            if (confirm('サンプルデータで上書きしますか？')) resetToSample()
          }}>サンプル読み込み</button>
        </div>
      </div>

      <div className="card">
        <h3>モデル解説</h3>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 8 }}>
          <p><strong>売上・原価は日単価ベース</strong>です。月次売上 = 件数 × 1日あたり単価 × その月の計算日数。</p>
        </div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
          <p><strong>ポートフォリオ型</strong>: 案件を1件ずつ管理するのではなく、カテゴリ（運送店/業者/社員）ごとの <strong>件数</strong> と <strong>単価・原価</strong> で月次の売上・粗利を算出します。</p>
          <p><strong>月次計算の流れ</strong>:</p>
          <ol style={{ paddingLeft: 18 }}>
            <li>前月の件数 + 当月の 獲得 − 終了 + 入替差分 ＝ 当月件数</li>
            <li>カテゴリ毎：件数 × 1日あたり売上 × その月の計算日数 ＝ 売上</li>
            <li>カテゴリ毎：原価モデルが「率」なら 売上×% 、「額」なら 件数 × 1日あたり原価 × 計算日数</li>
            <li>カテゴリ毎の 売上・原価 の月合計から粗利・粗利率を算出</li>
          </ol>
          <p><strong>条件変更</strong> は「適用月」以降に カテゴリの単価・原価率/金額を書き換えます（過去月は変更されません）。</p>
        </div>
      </div>
    </div>
  )
}
