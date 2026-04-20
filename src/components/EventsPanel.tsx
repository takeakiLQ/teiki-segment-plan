import { Fragment, useMemo, useState } from 'react'
import { newId, usePlanStore } from '../store'
import type {
  ConditionChange,
  CostModel,
  MonthlyDiagonalUpliftOverride,
  MonthlyRatioOverride,
  MonthlyTotal,
  Ratios,
  WorkerCategory,
} from '../types'
import { WorkerCategoryLabels, WorkerCategoryOrder } from '../types'
import {
  ALL_TRANSFER_PAIRS,
  cumulativeDiagonalCount,
  diagonalCount,
  distributeIntegers,
  effectiveDiagonalUpliftAt,
  effectiveRatio,
  getTransferAmount,
  priorYm,
  ratioSum,
  totalInflow,
  totalOutflow,
  upsertTransferCell,
  workingDaysOf,
  yen,
} from '../utils/calculations'
import { formatYmShort, monthsRange } from '../utils/month'

type Tab = 'flow' | 'ratio' | 'transfer' | 'condition'

export default function EventsPanel() {
  const [tab, setTab] = useState<Tab>('flow')
  return (
    <div>
      <div className="row" style={{ marginBottom: 12, gap: 6, flexWrap: 'wrap' }}>
        <TabButton active={tab === 'flow'} onClick={() => setTab('flow')}>獲得 / 終了</TabButton>
        <TabButton active={tab === 'ratio'} onClick={() => setTab('ratio')}>配車比率（月別）</TabButton>
        <TabButton active={tab === 'transfer'} onClick={() => setTab('transfer')}>入替</TabButton>
        <TabButton active={tab === 'condition'} onClick={() => setTab('condition')}>条件変更</TabButton>
      </div>
      {tab === 'flow' && <FlowsPanel />}
      {tab === 'ratio' && <RatioPanel />}
      {tab === 'transfer' && <TransfersList />}
      {tab === 'condition' && <ConditionChangesList />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={active ? '' : 'ghost'}
      onClick={onClick}
      style={{ padding: '6px 12px', fontSize: 13 }}
    >
      {children}
    </button>
  )
}

/* ====================================================
   配車比率（デフォルト + 月別オーバーライド）
   ==================================================== */
function RatioPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  const acqSum = ratioSum(plan.acquisitionRatio)
  const termSum = ratioSum(plan.terminationRatio)

  function updateDefault(kind: 'acquisitionRatio' | 'terminationRatio', cat: WorkerCategory, v: number) {
    setPlan((p) => ({ ...p, [kind]: { ...p[kind], [cat]: Math.max(0, v) } }))
  }

  function normalize(kind: 'acquisitionRatio' | 'terminationRatio') {
    setPlan((p) => {
      const r = p[kind]
      const sum = ratioSum(r)
      if (sum <= 0) return p
      const next: Ratios = {
        partner: Math.round((r.partner / sum) * 100),
        vendor: Math.round((r.vendor / sum) * 100),
        employment: Math.round((r.employment / sum) * 100),
      }
      const diff = 100 - (next.partner + next.vendor + next.employment)
      next.partner += diff
      return { ...p, [kind]: next }
    })
  }

  function copyFromInitial(kind: 'acquisitionRatio' | 'terminationRatio') {
    setPlan((p) => {
      const total = p.initialCounts.partner + p.initialCounts.vendor + p.initialCounts.employment
      if (total <= 0) return p
      const next: Ratios = {
        partner: Math.round((p.initialCounts.partner / total) * 100),
        vendor: Math.round((p.initialCounts.vendor / total) * 100),
        employment: Math.round((p.initialCounts.employment / total) * 100),
      }
      const diff = 100 - (next.partner + next.vendor + next.employment)
      next.partner += diff
      return { ...p, [kind]: next }
    })
  }

  /* ---- 月別オーバーライド ---- */
  function addOverride() {
    // 既に登録されていない最初の月を選ぶ
    const firstFree = months.find((m) => !plan.monthlyRatios.some((r) => r.month === m)) ?? plan.baseMonth
    setPlan((p) => ({
      ...p,
      monthlyRatios: [...p.monthlyRatios, { month: firstFree, acquisition: { ...p.acquisitionRatio }, termination: { ...p.terminationRatio } }],
    }))
  }

  function updateOverride(idx: number, patch: Partial<MonthlyRatioOverride>) {
    setPlan((p) => {
      const arr = [...p.monthlyRatios]
      arr[idx] = { ...arr[idx], ...patch }
      return { ...p, monthlyRatios: arr }
    })
  }

  function updateOverrideRatio(idx: number, kind: 'acquisition' | 'termination', cat: WorkerCategory, v: number) {
    setPlan((p) => {
      const arr = [...p.monthlyRatios]
      const cur = arr[idx]
      const base = (kind === 'acquisition' ? cur.acquisition : cur.termination) ?? { ...p[`${kind}Ratio`] }
      const nextR = { ...base, [cat]: Math.max(0, v) }
      arr[idx] = { ...cur, [kind]: nextR }
      return { ...p, monthlyRatios: arr }
    })
  }

  function clearOverrideField(idx: number, kind: 'acquisition' | 'termination') {
    setPlan((p) => {
      const arr = [...p.monthlyRatios]
      const cur = { ...arr[idx] }
      if (kind === 'acquisition') cur.acquisition = undefined
      else cur.termination = undefined
      arr[idx] = cur
      return { ...p, monthlyRatios: arr }
    })
  }

  function removeOverride(idx: number) {
    if (!confirm('この月の比率オーバーライドを削除しますか？')) return
    setPlan((p) => ({ ...p, monthlyRatios: p.monthlyRatios.filter((_, i) => i !== idx) }))
  }

  return (
    <>
      <div className="card">
        <div className="row between">
          <h3>デフォルト配車比率（％）</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            月別オーバーライドが無い月はこの比率で按分されます。
          </div>
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>種別</th>
                {WorkerCategoryOrder.map((c) => (
                  <th key={c}><span className={`badge ${c}`}>{WorkerCategoryLabels[c]}</span></th>
                ))}
                <th>合計</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <RatioEditorRow
                label="獲得（デフォルト）"
                ratio={plan.acquisitionRatio}
                sum={acqSum}
                onChange={(c, v) => updateDefault('acquisitionRatio', c, v)}
                onNormalize={() => normalize('acquisitionRatio')}
                onCopyInitial={() => copyFromInitial('acquisitionRatio')}
              />
              <RatioEditorRow
                label="終了（デフォルト）"
                ratio={plan.terminationRatio}
                sum={termSum}
                onChange={(c, v) => updateDefault('terminationRatio', c, v)}
                onNormalize={() => normalize('terminationRatio')}
                onCopyInitial={() => copyFromInitial('terminationRatio')}
              />
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h3>月別オーバーライド（{plan.monthlyRatios.length}件）</h3>
          <button onClick={addOverride}>＋ 月別比率を追加</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          特定月だけ異なる比率にしたい場合に追加します。未上書きのカテゴリ／種別はデフォルト比率が使われます。
        </div>
        {plan.monthlyRatios.length === 0 && <div className="muted" style={{ fontSize: 12 }}>まだ月別オーバーライドはありません。</div>}
        {plan.monthlyRatios.map((o, idx) => {
          const acqSum2 = o.acquisition ? ratioSum(o.acquisition) : 0
          const termSum2 = o.termination ? ratioSum(o.termination) : 0
          return (
            <div key={idx} className="card" style={{ background: '#f8fafc' }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <div className="row">
                  <label style={{ margin: 0 }}>対象月</label>
                  <select value={o.month} onChange={(e) => updateOverride(idx, { month: e.target.value })}>
                    {months.map((m) => <option key={m} value={m}>{formatYmShort(m)}</option>)}
                  </select>
                </div>
                <button className="small danger" onClick={() => removeOverride(idx)}>この月を削除</button>
              </div>
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>種別</th>
                      {WorkerCategoryOrder.map((c) => (
                        <th key={c}><span className={`badge ${c}`}>{WorkerCategoryLabels[c]}</span></th>
                      ))}
                      <th>合計</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <OverrideRow
                      label="獲得"
                      ratio={o.acquisition}
                      defaultRatio={plan.acquisitionRatio}
                      sum={acqSum2}
                      onChange={(c, v) => updateOverrideRatio(idx, 'acquisition', c, v)}
                      onReset={() => clearOverrideField(idx, 'acquisition')}
                    />
                    <OverrideRow
                      label="終了"
                      ratio={o.termination}
                      defaultRatio={plan.terminationRatio}
                      sum={termSum2}
                      onChange={(c, v) => updateOverrideRatio(idx, 'termination', c, v)}
                      onReset={() => clearOverrideField(idx, 'termination')}
                    />
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function RatioEditorRow({
  label, ratio, sum, onChange, onNormalize, onCopyInitial,
}: {
  label: string
  ratio: Ratios
  sum: number
  onChange: (cat: WorkerCategory, v: number) => void
  onNormalize: () => void
  onCopyInitial: () => void
}) {
  const isValid = sum === 100
  return (
    <tr>
      <td><strong>{label}</strong></td>
      {WorkerCategoryOrder.map((c) => (
        <td key={c} style={{ padding: 4 }}>
          <input
            type="number"
            min={0}
            value={ratio[c]}
            onChange={(e) => onChange(c, Math.max(0, Math.round(Number(e.target.value) || 0)))}
            style={{ width: 72, textAlign: 'right' }}
          />
        </td>
      ))}
      <td className="mono" style={{ color: isValid ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
        {sum}%
      </td>
      <td>
        <div className="row" style={{ gap: 4 }}>
          <button className="small ghost" onClick={onCopyInitial}>期首比率</button>
          <button className="small ghost" onClick={onNormalize} disabled={isValid}>100%化</button>
        </div>
      </td>
    </tr>
  )
}

function OverrideRow({
  label, ratio, defaultRatio, sum, onChange, onReset,
}: {
  label: string
  ratio: Ratios | undefined
  defaultRatio: Ratios
  sum: number
  onChange: (cat: WorkerCategory, v: number) => void
  onReset: () => void
}) {
  const isOverride = !!ratio && sum > 0
  const display = ratio ?? defaultRatio
  const isValid = sum === 100
  return (
    <tr>
      <td>
        <strong>{label}</strong>{' '}
        {isOverride
          ? <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>上書き</span>
          : <span className="badge" style={{ background: '#e2e8f0', color: '#475569' }}>デフォルト</span>}
      </td>
      {WorkerCategoryOrder.map((c) => (
        <td key={c} style={{ padding: 4 }}>
          <input
            type="number"
            min={0}
            value={display[c]}
            onChange={(e) => onChange(c, Math.max(0, Math.round(Number(e.target.value) || 0)))}
            style={{ width: 72, textAlign: 'right', color: isOverride ? '#0f172a' : '#94a3b8' }}
          />
        </td>
      ))}
      <td className="mono" style={{ color: !isOverride ? '#94a3b8' : (isValid ? '#16a34a' : '#dc2626'), fontWeight: 700 }}>
        {isOverride ? `${sum}%` : '—'}
      </td>
      <td>
        {isOverride && <button className="small ghost" onClick={onReset}>デフォルトに戻す</button>}
      </td>
    </tr>
  )
}

/* ====================================================
   獲得 / 終了（月次総数入力 + プレビュー + 年間合計 + 純増減 + 前年参照）
   ==================================================== */
function FlowsPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  function getMonthlyTotal(m: string): MonthlyTotal | undefined {
    return plan.monthlyTotals.find((x) => x.month === m)
  }

  function upsertMonthlyTotal(m: string, patch: Partial<MonthlyTotal>) {
    setPlan((p) => {
      const idx = p.monthlyTotals.findIndex((x) => x.month === m)
      const base: MonthlyTotal = { month: m, acquisitionTotal: 0, terminationTotal: 0 }
      const next = idx >= 0 ? { ...p.monthlyTotals[idx], ...patch } : { ...base, ...patch }
      const arr = [...p.monthlyTotals]
      if (idx >= 0) arr[idx] = next
      else arr.push(next)
      const cleaned = arr.filter((x) => !(x.acquisitionTotal === 0 && x.terminationTotal === 0))
      return { ...p, monthlyTotals: cleaned }
    })
  }

  function bulkFill(field: 'acquisitionTotal' | 'terminationTotal', val: number) {
    const label = field === 'acquisitionTotal' ? '獲得' : '終了'
    if (!confirm(`全月の${label}総数を ${val} で上書きしますか？`)) return
    setPlan((p) => {
      const map = new Map(p.monthlyTotals.map((x) => [x.month, x]))
      for (const m of months) {
        const cur = map.get(m) ?? { month: m, acquisitionTotal: 0, terminationTotal: 0 }
        map.set(m, { ...cur, [field]: val })
      }
      const arr = [...map.values()].filter((x) => !(x.acquisitionTotal === 0 && x.terminationTotal === 0))
      return { ...p, monthlyTotals: arr }
    })
  }

  function clearAll() {
    if (!confirm('全ての獲得・終了総数を 0 にリセットしますか？')) return
    setPlan((p) => ({ ...p, monthlyTotals: [] }))
  }

  /** 年間合計（期間全体の合計） */
  const totals = useMemo(() => {
    let acq = 0, term = 0
    for (const m of months) {
      const mt = getMonthlyTotal(m)
      acq += mt?.acquisitionTotal ?? 0
      term += mt?.terminationTotal ?? 0
    }
    return { acq, term }
  }, [months, plan.monthlyTotals])

  /** プレビュー（月×カテゴリ） */
  const preview = useMemo(() => {
    return months.map((m) => {
      const mt = getMonthlyTotal(m)
      const acqR = effectiveRatio(plan, m, 'acquisition')
      const termR = effectiveRatio(plan, m, 'termination')
      const acq = distributeIntegers(mt?.acquisitionTotal ?? 0, acqR)
      const term = distributeIntegers(mt?.terminationTotal ?? 0, termR)
      const acqTotal = mt?.acquisitionTotal ?? 0
      const termTotal = mt?.terminationTotal ?? 0
      const isOverride = plan.monthlyRatios.some((r) => r.month === m && ((r.acquisition && ratioSum(r.acquisition) > 0) || (r.termination && ratioSum(r.termination) > 0)))
      return { month: m, acq, term, acqTotal, termTotal, net: acqTotal - termTotal, isOverride }
    })
  }, [months, plan.monthlyTotals, plan.acquisitionRatio, plan.terminationRatio, plan.monthlyRatios])

  /** 累計純増減 */
  const cumulativeNets = useMemo(() => {
    const arr: number[] = []
    let cum = 0
    for (const row of preview) {
      cum += row.net
      arr.push(cum)
    }
    return arr
  }, [preview])

  /** カテゴリ別 年間合計（獲得／終了） */
  const categoryTotals = useMemo(() => {
    const acq: Record<WorkerCategory, number> = { partner: 0, vendor: 0, employment: 0 }
    const term: Record<WorkerCategory, number> = { partner: 0, vendor: 0, employment: 0 }
    for (const row of preview) {
      for (const c of WorkerCategoryOrder) {
        acq[c] += row.acq[c]
        term[c] += row.term[c]
      }
    }
    return { acq, term }
  }, [preview])

  /** 前年参照 */
  const hasPriorYear = !!plan.priorYear && plan.priorYear.monthlyData.length > 0
  const priorLookup = useMemo(() => {
    const map = new Map<string, { acq: number; term: number }>()
    if (plan.priorYear) {
      for (const d of plan.priorYear.monthlyData) {
        map.set(d.month, { acq: d.acquisition, term: d.termination })
      }
    }
    return map
  }, [plan.priorYear])

  return (
    <>
      <div className="card">
        <div className="row between">
          <h3>月次の獲得・終了 総数</h3>
          <div className="row">
            <button className="small ghost" onClick={() => {
              const v = Number(prompt('毎月の獲得総数', '0') ?? '0')
              if (!Number.isNaN(v)) bulkFill('acquisitionTotal', Math.max(0, Math.round(v)))
            }}>獲得 一括入力</button>
            <button className="small ghost" onClick={() => {
              const v = Number(prompt('毎月の終了総数', '0') ?? '0')
              if (!Number.isNaN(v)) bulkFill('terminationTotal', Math.max(0, Math.round(v)))
            }}>終了 一括入力</button>
            <button className="small ghost" onClick={clearAll}>全クリア</button>
          </div>
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
                <td style={{ color: '#16a34a', fontWeight: 600 }}>＋獲得 総数</td>
                {months.map((m) => {
                  const mt = getMonthlyTotal(m)
                  return (
                    <td key={`a-${m}`} style={{ padding: 2 }}>
                      <input
                        type="number"
                        min={0}
                        value={mt?.acquisitionTotal ?? 0}
                        onChange={(e) => upsertMonthlyTotal(m, { acquisitionTotal: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        style={{ width: 72, padding: '2px 6px', textAlign: 'right', color: '#16a34a' }}
                      />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', color: '#16a34a', fontWeight: 700 }}>
                  +{totals.acq.toLocaleString()}
                </td>
              </tr>
              <tr>
                <td style={{ color: '#dc2626', fontWeight: 600 }}>－終了 総数</td>
                {months.map((m) => {
                  const mt = getMonthlyTotal(m)
                  return (
                    <td key={`t-${m}`} style={{ padding: 2 }}>
                      <input
                        type="number"
                        min={0}
                        value={mt?.terminationTotal ?? 0}
                        onChange={(e) => upsertMonthlyTotal(m, { terminationTotal: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        style={{ width: 72, padding: '2px 6px', textAlign: 'right', color: '#dc2626' }}
                      />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>
                  -{totals.term.toLocaleString()}
                </td>
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <td><strong>純増減（獲得−終了）</strong></td>
                {preview.map((r) => (
                  <td key={`net-${r.month}`} className="mono" style={{ fontWeight: 600, color: r.net > 0 ? '#16a34a' : r.net < 0 ? '#dc2626' : undefined }}>
                    {r.net > 0 ? `+${r.net}` : r.net}
                  </td>
                ))}
                <td className="mono" style={{ background: '#e2e8f0', fontWeight: 700, color: (totals.acq - totals.term) > 0 ? '#16a34a' : (totals.acq - totals.term) < 0 ? '#dc2626' : undefined }}>
                  {(totals.acq - totals.term) > 0 ? '+' : ''}{(totals.acq - totals.term).toLocaleString()}
                </td>
              </tr>
              <tr>
                <td>累計 純増減</td>
                {cumulativeNets.map((cum, i) => (
                  <td key={`cum-${i}`} className="mono" style={{ color: cum > 0 ? '#16a34a' : cum < 0 ? '#dc2626' : '#64748b' }}>
                    {cum > 0 ? '+' : ''}{cum.toLocaleString()}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9' }}>
                  {cumulativeNets[cumulativeNets.length - 1]?.toLocaleString() ?? 0}
                </td>
              </tr>

              {hasPriorYear && (
                <>
                  <tr><td colSpan={months.length + 2} style={{ background: '#ede9fe', fontWeight: 600, color: '#5b21b6' }}>
                    ■ 前年実績 参照（{plan.priorYear!.fiscalYear}）
                  </td></tr>
                  <tr>
                    <td className="muted">前年 獲得</td>
                    {months.map((m) => {
                      const py = priorLookup.get(priorYm(m))
                      return <td key={`py-a-${m}`} className="mono muted">{py ? py.acq.toLocaleString() : '—'}</td>
                    })}
                    <td className="mono muted" style={{ background: '#f5f3ff' }}>
                      {Array.from(priorLookup.values()).reduce((s, v) => s + v.acq, 0).toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">前年 終了</td>
                    {months.map((m) => {
                      const py = priorLookup.get(priorYm(m))
                      return <td key={`py-t-${m}`} className="mono muted">{py ? py.term.toLocaleString() : '—'}</td>
                    })}
                    <td className="mono muted" style={{ background: '#f5f3ff' }}>
                      {Array.from(priorLookup.values()).reduce((s, v) => s + v.term, 0).toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">前年 純増減</td>
                    {months.map((m) => {
                      const py = priorLookup.get(priorYm(m))
                      const net = py ? py.acq - py.term : null
                      return (
                        <td key={`py-n-${m}`} className="mono" style={{ color: net == null ? '#94a3b8' : (net > 0 ? '#16a34a' : net < 0 ? '#dc2626' : '#64748b') }}>
                          {net == null ? '—' : (net > 0 ? `+${net}` : net)}
                        </td>
                      )
                    })}
                    <td className="mono muted" style={{ background: '#f5f3ff' }}>—</td>
                  </tr>
                </>
              )}
              {!hasPriorYear && (
                <tr>
                  <td colSpan={months.length + 2} className="muted" style={{ fontSize: 12, padding: 10 }}>
                    「前年実績」タブで前年データを入れると、ここに参照行が追加されます。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>按分結果プレビュー（整数・月別比率反映）</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          月によって上書き比率がある月は、項目行の月名に「★」が付きます。合計は必ず総数と一致します。
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>種別 / カテゴリ</th>
                {preview.map((p) => <th key={p.month}>{formatYmShort(p.month)}{p.isOverride ? ' ★' : ''}</th>)}
                <th style={{ background: '#e2e8f0' }}>年間合計</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={months.length + 2} style={{ background: '#ecfdf5', fontWeight: 600, color: '#065f46' }}>＋獲得（比率按分）</td></tr>
              {WorkerCategoryOrder.map((cat) => (
                <tr key={`pa-${cat}`}>
                  <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                  {preview.map((p) => (
                    <td key={`pa-${cat}-${p.month}`} className="mono">{p.acq[cat]}</td>
                  ))}
                  <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700 }}>{categoryTotals.acq[cat].toLocaleString()}</td>
                </tr>
              ))}
              <tr><td colSpan={months.length + 2} style={{ background: '#fef2f2', fontWeight: 600, color: '#991b1b' }}>－終了（比率按分）</td></tr>
              {WorkerCategoryOrder.map((cat) => (
                <tr key={`pt-${cat}`}>
                  <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                  {preview.map((p) => (
                    <td key={`pt-${cat}-${p.month}`} className="mono">{p.term[cat]}</td>
                  ))}
                  <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700 }}>{categoryTotals.term[cat].toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ====================================================
   入替マトリクス（月別 3×3 転出件数）
   ==================================================== */
function TransfersList() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  function setCell(month: string, from: WorkerCategory, to: WorkerCategory, v: number) {
    setPlan((p) => ({ ...p, transfers: upsertTransferCell(p.transfers, month, from, to, v, newId) }))
  }
  function clearAll() {
    if (!confirm('入替マトリクスを全て 0 にリセットしますか？')) return
    setPlan((p) => ({ ...p, transfers: [] }))
  }
  function fillRow(from: WorkerCategory, to: WorkerCategory, v: number) {
    const lbl = `${WorkerCategoryLabels[from]} → ${WorkerCategoryLabels[to]}`
    if (!confirm(`${lbl} を全月 ${v} で上書きしますか？`)) return
    setPlan((p) => {
      let next = p.transfers
      for (const m of months) next = upsertTransferCell(next, m, from, to, v, newId)
      return { ...p, transfers: next }
    })
  }

  // 年間合計（ペア毎）
  const rowTotals = useMemo(() => {
    const o: Record<string, number> = {}
    for (const pair of ALL_TRANSFER_PAIRS) {
      const key = `${pair.from}>${pair.to}`
      o[key] = 0
      for (const m of months) o[key] += getTransferAmount(plan.transfers, m, pair.from, pair.to)
    }
    return o
  }, [plan.transfers, months])

  // 同区分入替 uplift 設定ヘルパー
  function setDefaultUplift(cat: 'partner' | 'vendor', v: number) {
    setPlan((p) => ({ ...p, diagonalUplift: { ...p.diagonalUplift, [cat]: Math.max(0, Math.round(v)) } }))
  }
  function setMonthlyUplift(month: string, cat: 'partner' | 'vendor', v: number) {
    setPlan((p) => {
      const arr = [...p.diagonalUpliftByMonth]
      const idx = arr.findIndex((x) => x.month === month)
      const base: MonthlyDiagonalUpliftOverride = idx >= 0 ? arr[idx] : { month }
      const rounded = v >= 0 ? Math.round(v) : 0
      const next: MonthlyDiagonalUpliftOverride = { ...base, [cat]: rounded }
      // 全項目が未定義または0なら削除
      if ((next.partner === undefined || next.partner === 0) && (next.vendor === undefined || next.vendor === 0)) {
        if (idx >= 0) return { ...p, diagonalUpliftByMonth: arr.filter((_, i) => i !== idx) }
        return p
      }
      if (idx >= 0) arr[idx] = next
      else arr.push(next)
      return { ...p, diagonalUpliftByMonth: arr }
    })
  }
  function clearMonthlyUplift(cat: 'partner' | 'vendor') {
    if (!confirm(`${WorkerCategoryLabels[cat]} の月別上書きをクリアしますか？`)) return
    setPlan((p) => ({
      ...p,
      diagonalUpliftByMonth: p.diagonalUpliftByMonth
        .map((r) => {
          const next = { ...r }
          delete (next as any)[cat]
          return next
        })
        .filter((r) => r.partner !== undefined || r.vendor !== undefined),
    }))
  }

  // 累計同区分入替件数と月次uplift cost
  const upliftSummary = useMemo(() => {
    return months.map((m) => {
      const diagP = cumulativeDiagonalCount(plan.transfers, m, 'partner')
      const diagV = cumulativeDiagonalCount(plan.transfers, m, 'vendor')
      const xp = effectiveDiagonalUpliftAt(plan, m, 'partner')
      const xv = effectiveDiagonalUpliftAt(plan, m, 'vendor')
      const days = workingDaysOf(plan, m)
      return {
        month: m,
        diagPartner: diagonalCount(plan.transfers, m, 'partner'),
        diagVendor: diagonalCount(plan.transfers, m, 'vendor'),
        cumPartner: diagP,
        cumVendor: diagV,
        upliftP: xp,
        upliftV: xv,
        costP: Math.round(diagP * xp * days),
        costV: Math.round(diagV * xv * days),
      }
    })
  }, [months, plan.transfers, plan.diagonalUplift, plan.diagonalUpliftByMonth, plan.workingDaysByMonth, plan.defaultWorkingDays])
  const upliftCostTotalP = upliftSummary.reduce((s, r) => s + r.costP, 0)
  const upliftCostTotalV = upliftSummary.reduce((s, r) => s + r.costV, 0)

  // カテゴリ別 月次 転出/転入
  const monthlyCategoryFlows = useMemo(() => {
    return months.map((m) => {
      const out: Record<WorkerCategory, number> = { partner: 0, vendor: 0, employment: 0 }
      const inn: Record<WorkerCategory, number> = { partner: 0, vendor: 0, employment: 0 }
      for (const c of WorkerCategoryOrder) {
        out[c] = totalOutflow(plan.transfers, m, c)
        inn[c] = totalInflow(plan.transfers, m, c)
      }
      return { month: m, out, inn }
    })
  }, [plan.transfers, months])

  return (
    <>
      <div className="card">
        <div className="row between">
          <h3>月別 入替マトリクス（from → to の件数・9マス）</h3>
          <div className="row">
            <button className="small ghost" onClick={clearAll}>全クリア</button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          対角（<em>同区分入替</em>：運送店→運送店 等）も入力できます。対角はカテゴリ件数には影響しませんが、下の「同区分入替 原価引き上げ」設定により累積的に原価に効きます。
        </div>

        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>from → to</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年間合計</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {ALL_TRANSFER_PAIRS.map(({ from, to }) => {
                const key = `${from}>${to}`
                const isDiagonal = from === to
                return (
                  <tr key={key} style={isDiagonal ? { background: '#fef3c7' } : undefined}>
                    <td>
                      <span className={`badge ${from}`}>{WorkerCategoryLabels[from]}</span>
                      <span className="muted" style={{ margin: '0 4px' }}>→</span>
                      <span className={`badge ${to}`}>{WorkerCategoryLabels[to]}</span>
                      {isDiagonal && <span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>(同区分)</span>}
                    </td>
                    {months.map((m) => (
                      <td key={`${key}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min={0}
                          value={getTransferAmount(plan.transfers, m, from, to)}
                          onChange={(e) => setCell(m, from, to, Math.max(0, Math.round(Number(e.target.value) || 0)))}
                          style={{ width: 64, padding: '2px 6px', textAlign: 'right' }}
                        />
                      </td>
                    ))}
                    <td className="mono" style={{ background: isDiagonal ? '#fde68a' : '#f1f5f9', fontWeight: 700 }}>
                      {rowTotals[key].toLocaleString()}
                    </td>
                    <td>
                      <button className="small ghost" style={{ fontSize: 10, padding: '2px 6px' }}
                        onClick={() => {
                          const v = Number(prompt(`${WorkerCategoryLabels[from]} → ${WorkerCategoryLabels[to]} の毎月件数`, '0') ?? '0')
                          if (!Number.isNaN(v)) fillRow(from, to, Math.max(0, Math.round(v)))
                        }}
                      >一括</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
        <div className="row between">
          <h3 style={{ color: '#92400e' }}>同区分入替 原価引き上げ（uplift）</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            入替した月以降、対象件数 × X円/日 × 計算日数 が累積で原価に加算されます。
          </div>
        </div>
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div>
            <label><span className="badge partner">運送店</span> デフォルト X（円/1件/日）</label>
            <input
              type="number"
              min={0}
              value={plan.diagonalUplift.partner}
              onChange={(e) => setDefaultUplift('partner', Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label><span className="badge vendor">業者</span> デフォルト X（円/1件/日）</label>
            <input
              type="number"
              min={0}
              value={plan.diagonalUplift.vendor}
              onChange={(e) => setDefaultUplift('vendor', Number(e.target.value) || 0)}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 4, alignItems: 'flex-end' }}>
            <button className="small ghost" onClick={() => clearMonthlyUplift('partner')}>運送店 月別クリア</button>
            <button className="small ghost" onClick={() => clearMonthlyUplift('vendor')}>業者 月別クリア</button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          月別 uplift X（空欄はデフォルト値を使用）
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>カテゴリ</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(['partner', 'vendor'] as const).map((cat) => (
                <tr key={`u-${cat}`}>
                  <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span> X</td>
                  {months.map((m) => {
                    const ovr = plan.diagonalUpliftByMonth.find((r) => r.month === m)?.[cat]
                    const isOverride = typeof ovr === 'number' && ovr >= 0
                    const eff = effectiveDiagonalUpliftAt(plan, m, cat)
                    return (
                      <td key={`u-${cat}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min={0}
                          value={isOverride ? ovr! : (eff || 0)}
                          onChange={(e) => setMonthlyUplift(m, cat, Number(e.target.value) || 0)}
                          style={{ width: 72, padding: '2px 6px', textAlign: 'right', color: isOverride ? '#92400e' : '#94a3b8' }}
                          title={isOverride ? '月別上書き' : 'デフォルト値（参考表示）'}
                        />
                      </td>
                    )
                  })}
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 4 }}>
          累積 同区分入替件数と月次 uplift 原価（累計件数 × X × 営業日数）
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>項目</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年計</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="badge partner">運送店</span> 当月入替</td>
                {upliftSummary.map((r) => (
                  <td key={`mp-${r.month}`} className="mono" style={{ color: r.diagPartner > 0 ? '#0f172a' : '#94a3b8' }}>
                    {r.diagPartner || '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9' }}>
                  {upliftSummary.reduce((s, r) => s + r.diagPartner, 0)}
                </td>
              </tr>
              <tr>
                <td><span className="badge partner">運送店</span> 累計入替</td>
                {upliftSummary.map((r) => (
                  <td key={`cp-${r.month}`} className="mono">{r.cumPartner}</td>
                ))}
                <td></td>
              </tr>
              <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
                <td><span className="badge partner">運送店</span> uplift 原価</td>
                {upliftSummary.map((r) => (
                  <td key={`xp-${r.month}`} className="mono" style={{ color: r.costP > 0 ? '#dc2626' : '#94a3b8' }}>
                    {r.costP > 0 ? `¥${yen(r.costP)}` : '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>
                  ¥{yen(upliftCostTotalP)}
                </td>
              </tr>
              <tr>
                <td><span className="badge vendor">業者</span> 当月入替</td>
                {upliftSummary.map((r) => (
                  <td key={`mv-${r.month}`} className="mono" style={{ color: r.diagVendor > 0 ? '#0f172a' : '#94a3b8' }}>
                    {r.diagVendor || '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9' }}>
                  {upliftSummary.reduce((s, r) => s + r.diagVendor, 0)}
                </td>
              </tr>
              <tr>
                <td><span className="badge vendor">業者</span> 累計入替</td>
                {upliftSummary.map((r) => (
                  <td key={`cv-${r.month}`} className="mono">{r.cumVendor}</td>
                ))}
                <td></td>
              </tr>
              <tr>
                <td><span className="badge vendor">業者</span> uplift 原価</td>
                {upliftSummary.map((r) => (
                  <td key={`xv-${r.month}`} className="mono" style={{ color: r.costV > 0 ? '#dc2626' : '#94a3b8' }}>
                    {r.costV > 0 ? `¥${yen(r.costV)}` : '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>
                  ¥{yen(upliftCostTotalV)}
                </td>
              </tr>
              <tr style={{ background: '#fef2f2' }}>
                <td><strong>uplift 原価合計</strong></td>
                {upliftSummary.map((r) => {
                  const sum = r.costP + r.costV
                  return (
                    <td key={`xt-${r.month}`} className="mono" style={{ fontWeight: 600, color: sum > 0 ? '#dc2626' : undefined }}>
                      {sum > 0 ? `¥${yen(sum)}` : '—'}
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#fee2e2', color: '#dc2626', fontWeight: 700 }}>
                  ¥{yen(upliftCostTotalP + upliftCostTotalV)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>カテゴリ別 月次 転出・転入サマリー（参考）</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          転出合計は各カテゴリから出て行く件数、転入合計はそのカテゴリへ入ってくる件数。純移動 = 転入 − 転出。
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>カテゴリ / 種別</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年間合計</th>
              </tr>
            </thead>
            <tbody>
              {WorkerCategoryOrder.map((cat) => {
                const outTotal = monthlyCategoryFlows.reduce((s, r) => s + r.out[cat], 0)
                const inTotal = monthlyCategoryFlows.reduce((s, r) => s + r.inn[cat], 0)
                const netTotal = inTotal - outTotal
                return (
                  <Fragment key={cat}>
                    <tr>
                      <td rowSpan={3}>
                        <span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: '#dc2626', fontSize: 12 }}>転出</td>
                      {monthlyCategoryFlows.map((r) => (
                        <td key={`o-${cat}-${r.month}`} className="mono" style={{ color: r.out[cat] > 0 ? '#dc2626' : '#94a3b8' }}>
                          {r.out[cat] || '—'}
                        </td>
                      ))}
                      <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>
                        {outTotal.toLocaleString()}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: '#16a34a', fontSize: 12 }}>転入</td>
                      {monthlyCategoryFlows.map((r) => (
                        <td key={`i-${cat}-${r.month}`} className="mono" style={{ color: r.inn[cat] > 0 ? '#16a34a' : '#94a3b8' }}>
                          {r.inn[cat] || '—'}
                        </td>
                      ))}
                      <td className="mono" style={{ background: '#f1f5f9', color: '#16a34a', fontWeight: 700 }}>
                        {inTotal.toLocaleString()}
                      </td>
                    </tr>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                      <td style={{ fontSize: 12 }}><strong>純移動</strong></td>
                      {monthlyCategoryFlows.map((r) => {
                        const net = r.inn[cat] - r.out[cat]
                        return (
                          <td key={`n-${cat}-${r.month}`} className="mono" style={{ fontWeight: 600, color: net > 0 ? '#16a34a' : net < 0 ? '#dc2626' : '#94a3b8' }}>
                            {net === 0 ? '—' : net > 0 ? `+${net}` : net}
                          </td>
                        )
                      })}
                      <td className="mono" style={{ background: '#e2e8f0', fontWeight: 700, color: netTotal > 0 ? '#16a34a' : netTotal < 0 ? '#dc2626' : undefined }}>
                        {netTotal > 0 ? '+' : ''}{netTotal.toLocaleString()}
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ====================================================
   条件変更
   ==================================================== */
function ConditionChangesList() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = monthsRange(plan.baseMonth, plan.horizonMonths)

  function addRevenue() {
    setPlan((p) => ({
      ...p,
      conditionChanges: [
        ...p.conditionChanges,
        {
          id: newId(),
          effectiveMonth: p.baseMonth,
          category: 'revenue',
          newRevenuePerCase: p.revenuePerCase,
        },
      ],
    }))
  }
  function addCost() {
    setPlan((p) => ({
      ...p,
      conditionChanges: [
        ...p.conditionChanges,
        {
          id: newId(),
          effectiveMonth: p.baseMonth,
          category: 'partner',
        },
      ],
    }))
  }
  function update(id: string, patch: Partial<ConditionChange>) {
    setPlan((p) => ({
      ...p,
      conditionChanges: p.conditionChanges.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  }
  function updateTarget(id: string, target: WorkerCategory | 'revenue') {
    setPlan((p) => ({
      ...p,
      conditionChanges: p.conditionChanges.map((c) => {
        if (c.id !== id) return c
        const next: ConditionChange = { ...c, category: target }
        // 対象に合わない項目はクリア
        if (target === 'revenue') {
          next.newCostModel = undefined
          next.newCostRate = undefined
          next.newCostAmount = undefined
        } else {
          next.newRevenuePerCase = undefined
        }
        return next
      }),
    }))
  }
  function remove(id: string) {
    if (!confirm('この条件変更を削除しますか？')) return
    setPlan((p) => ({ ...p, conditionChanges: p.conditionChanges.filter((c) => c.id !== id) }))
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>条件変更（{plan.conditionChanges.length}件）</h3>
        <div className="row">
          <button className="small" onClick={addRevenue}>＋ 単価改定（全体）</button>
          <button className="small ghost" onClick={addCost}>＋ 原価改定（カテゴリ別）</button>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        「適用月」以降の単価（全体）または指定カテゴリの原価が書き換わります。単価改定は全カテゴリに波及し、カテゴリ間の入替では売上は変わりません（原価率のみシフト）。
      </div>

      {plan.conditionChanges.length === 0 && <div className="card muted">条件変更はありません。</div>}

      {plan.conditionChanges.map((c) => {
        const isRevenue = c.category === 'revenue'
        return (
          <div key={c.id} className="card">
            <div className="form-grid">
              <div>
                <label>適用月</label>
                <select value={c.effectiveMonth} onChange={(e) => update(c.id, { effectiveMonth: e.target.value })}>
                  {months.map((m) => <option key={m} value={m}>{formatYmShort(m)}</option>)}
                </select>
              </div>
              <div>
                <label>対象</label>
                <select value={c.category} onChange={(e) => updateTarget(c.id, e.target.value as WorkerCategory | 'revenue')}>
                  <option value="revenue">単価改定（全体）</option>
                  {WorkerCategoryOrder.map((k) => (
                    <option key={k} value={k}>原価改定：{WorkerCategoryLabels[k]}</option>
                  ))}
                </select>
              </div>

              {isRevenue && (
                <div style={{ gridColumn: 'span 2' }}>
                  <label>新 1日あたり単価（円）</label>
                  <input
                    type="number"
                    value={c.newRevenuePerCase ?? ''}
                    onChange={(e) => update(c.id, { newRevenuePerCase: e.target.value === '' ? undefined : Number(e.target.value) })}
                    placeholder="未入力は現状維持"
                  />
                </div>
              )}

              {!isRevenue && (
                <>
                  <div>
                    <label>原価モデル</label>
                    <select
                      value={c.newCostModel ?? ''}
                      onChange={(e) => update(c.id, { newCostModel: e.target.value === '' ? undefined : (e.target.value as CostModel) })}
                    >
                      <option value="">（変更しない）</option>
                      <option value="rate">原価率(%)</option>
                      <option value="amount">1日あたり金額</option>
                    </select>
                  </div>
                  <div>
                    <label>新 原価率（%）</label>
                    <input
                      type="number"
                      value={c.newCostRate ?? ''}
                      onChange={(e) => update(c.id, { newCostRate: e.target.value === '' ? undefined : Number(e.target.value) })}
                      placeholder="未入力は現状維持"
                    />
                  </div>
                  <div>
                    <label>新 1日あたり原価（円）</label>
                    <input
                      type="number"
                      value={c.newCostAmount ?? ''}
                      onChange={(e) => update(c.id, { newCostAmount: e.target.value === '' ? undefined : Number(e.target.value) })}
                      placeholder="未入力は現状維持"
                    />
                  </div>
                </>
              )}

              <div style={{ gridColumn: '1 / -1' }}>
                <label>理由</label>
                <input value={c.reason ?? ''} onChange={(e) => update(c.id, { reason: e.target.value })} placeholder="単価改定、原価構造見直し 等" />
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gridColumn: '1 / -1' }}>
                <button className="small danger" onClick={() => remove(c.id)}>削除</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
