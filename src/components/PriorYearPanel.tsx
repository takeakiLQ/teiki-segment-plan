import { Fragment, useMemo, useRef } from 'react'
import { createEmptyPriorYear, newId, usePlanStore } from '../store'
import type { PriorYearMonthly, PriorYearPlan, WorkerCategory } from '../types'
import { WorkerCategoryLabels, WorkerCategoryOrder } from '../types'
import {
  ALL_TRANSFER_PAIRS,
  getTransferAmount,
  totalInflow,
  totalOutflow,
  upsertTransferCell,
} from '../utils/calculations'
import { formatYmShort, monthsRange } from '../utils/month'
import { parsePriorYearJson, samplePriorYearJson, serializePriorYearJson } from '../utils/priorYearJson'

/**
 * 年間ブレンド単価を算出（参考値）
 * = 年間売上 / (平均件数 × 総営業日数)
 * 件数は「各月初 件数」を平均。データ不足時は 0 を返す。
 */
function computeBlendedUnitPrice(py: PriorYearPlan, months: string[]): number {
  if (months.length === 0) return 0
  let totRev = 0
  let totWd = 0
  for (const m of months) {
    const d = py.monthlyData.find((x) => x.month === m)
    totRev += d?.revenue ?? 0
    const wd = py.workingDaysByMonth?.[m] ?? py.defaultWorkingDays ?? 0
    totWd += wd
  }
  if (totRev <= 0 || totWd <= 0) return 0

  // 月初件数を各月加算 → 平均
  let running = (py.initialCounts.partner || 0) + (py.initialCounts.vendor || 0) + (py.initialCounts.employment || 0)
  let sumStart = 0
  for (const m of months) {
    sumStart += running
    const d = py.monthlyData.find((x) => x.month === m)
    running += (d?.acquisition ?? 0) - (d?.termination ?? 0)
  }
  const avgCases = sumStart / months.length
  if (avgCases <= 0) return 0
  return Math.round(totRev / (avgCases * totWd))
}

export default function PriorYearPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const py = plan.priorYear

  function enable() {
    setPlan((p) => ({ ...p, priorYear: createEmptyPriorYear(p.baseMonth) }))
  }
  function disable() {
    if (!confirm('前年実績データを削除しますか？（この画面で入力した情報は失われます）')) return
    setPlan((p) => ({ ...p, priorYear: undefined }))
  }

  if (!py) {
    return (
      <div className="card">
        <h3>前年実績データ</h3>
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          前年の獲得・終了・入替を入力しておくと、<strong>月次イベント画面</strong>で参照行として表示されます。
          この入力は計算には影響しません（参照専用）。
        </div>
        <button onClick={enable}>＋ 前年実績を作成する</button>
      </div>
    )
  }

  return <PriorYearEditor py={py} onDisable={disable} />
}

function PriorYearEditor({ py, onDisable }: { py: PriorYearPlan; onDisable: () => void }) {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(py.baseMonth, py.horizonMonths), [py.baseMonth, py.horizonMonths])
  const fileRef = useRef<HTMLInputElement>(null)

  // --- JSON 入出力 ---
  function exportJson() {
    const obj = serializePriorYearJson(py)
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${py.fiscalYear || 'prior-year'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  function downloadSample() {
    const obj = samplePriorYearJson(plan.baseMonth)
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prior-year-sample.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  function openFilePicker() {
    fileRef.current?.click()
  }
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const obj = JSON.parse(text)
      const next = parsePriorYearJson(obj, plan.baseMonth, plan.priorYear)
      if (!confirm(`「${file.name}」を取り込みます（既存データにマージします）。よろしいですか？`)) {
        if (fileRef.current) fileRef.current.value = ''
        return
      }
      setPlan((p) => ({ ...p, priorYear: next }))
      alert(`前年実績を読み込みました（マージ）。\n月次データ: ${next.monthlyData.length} 件\n入替: ${next.transfers.length} 件\n計算日数 設定月数: ${Object.keys(next.workingDaysByMonth).length} 月`)
    } catch (err: any) {
      alert('読み込みに失敗しました: ' + (err?.message ?? err))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function updatePY(patch: Partial<PriorYearPlan>) {
    setPlan((p) => (p.priorYear ? { ...p, priorYear: { ...p.priorYear, ...patch } } : p))
  }
  function updateMonth(m: string, patch: Partial<PriorYearMonthly>) {
    setPlan((p) => {
      if (!p.priorYear) return p
      const arr = [...p.priorYear.monthlyData]
      const idx = arr.findIndex((x) => x.month === m)
      const base: PriorYearMonthly = { month: m, acquisition: 0, termination: 0 }
      const next = idx >= 0 ? { ...arr[idx], ...patch } : { ...base, ...patch }
      if (idx >= 0) arr[idx] = next
      else arr.push(next)
      const cleaned = arr.filter((x) => !(
        x.acquisition === 0 && x.termination === 0 &&
        (x.revenue ?? 0) === 0 && (x.grossProfit ?? 0) === 0 &&
        (x.meisterRevenue ?? 0) === 0 &&
        !x.memo
      ))
      return { ...p, priorYear: { ...p.priorYear, monthlyData: cleaned } }
    })
  }
  function getMonth(m: string): PriorYearMonthly | undefined {
    return py.monthlyData.find((x) => x.month === m)
  }

  function updateInitial(cat: WorkerCategory, v: number) {
    setPlan((p) => p.priorYear
      ? { ...p, priorYear: { ...p.priorYear, initialCounts: { ...p.priorYear.initialCounts, [cat]: Math.max(0, Math.round(v)) } } }
      : p)
  }

  function setTransferCell(month: string, from: WorkerCategory, to: WorkerCategory, v: number) {
    setPlan((p) => p.priorYear
      ? { ...p, priorYear: { ...p.priorYear, transfers: upsertTransferCell(p.priorYear.transfers, month, from, to, v, newId) } }
      : p)
  }
  function clearTransfers() {
    if (!confirm('前年の入替マトリクスを全てクリアしますか？')) return
    setPlan((p) => p.priorYear ? { ...p, priorYear: { ...p.priorYear, transfers: [] } } : p)
  }
  function fillTransferRow(from: WorkerCategory, to: WorkerCategory, v: number) {
    const lbl = `${WorkerCategoryLabels[from]} → ${WorkerCategoryLabels[to]}`
    if (!confirm(`${lbl} を前年全月 ${v} で上書きしますか？`)) return
    setPlan((p) => {
      if (!p.priorYear) return p
      let next = p.priorYear.transfers
      for (const m of months) next = upsertTransferCell(next, m, from, to, v, newId)
      return { ...p, priorYear: { ...p.priorYear, transfers: next } }
    })
  }

  // 年間合計
  const totals = useMemo(() => {
    let acq = 0, term = 0, rev = 0, gp = 0, meister = 0
    for (const d of py.monthlyData) {
      acq += d.acquisition
      term += d.termination
      rev += d.revenue ?? 0
      gp += d.grossProfit ?? 0
      meister += d.meisterRevenue ?? 0
    }
    const margin = rev > 0 ? gp / rev : 0
    return { acq, term, rev, gp, margin, net: acq - term, meister }
  }, [py.monthlyData])
  const meisterTotal = totals.meister

  return (
    <>
      <div className="card">
        <div className="row between">
          <h3>前年実績 基本設定</h3>
          <button className="small danger" onClick={onDisable}>前年データを削除</button>
        </div>
        <div className="form-grid">
          <div>
            <label>会計年度ラベル</label>
            <input value={py.fiscalYear} onChange={(e) => updatePY({ fiscalYear: e.target.value })} placeholder="FY2025" />
          </div>
          <div>
            <label>開始月</label>
            <input type="month" value={py.baseMonth} onChange={(e) => updatePY({ baseMonth: e.target.value })} />
          </div>
          <div>
            <label>期間（月）</label>
            <input
              type="number"
              min={1}
              max={36}
              value={py.horizonMonths}
              onChange={(e) => updatePY({ horizonMonths: Math.max(1, Math.min(36, Number(e.target.value) || 12)) })}
            />
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          参照用データです。この画面の数値は計算に影響しません。月次イベント画面の「前年実績 参照」行に表示されます（当年の月から -12ヶ月 の月を対応させます）。
        </div>
      </div>

      <div className="card" style={{ background: '#f0f9ff', borderColor: '#bae6fd' }}>
        <div className="row between">
          <h3 style={{ color: '#0369a1' }}>JSON 一括入出力</h3>
          <div className="row">
            <button className="small ghost" onClick={downloadSample}>サンプル JSON</button>
            <button className="small ghost" onClick={exportJson}>エクスポート</button>
            <button className="small" onClick={openFilePicker}>インポート</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handleImport} />
          </div>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#475569' }}>📄 スキーマを表示</summary>
          <pre style={{
            background: '#fff',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            padding: 10,
            marginTop: 6,
            fontSize: 11,
            lineHeight: 1.55,
            overflowX: 'auto',
          }}>
{`{
  "fiscalYear": "FY2025",
  "baseMonth": "2025-04",           // 開始月 yyyy-mm
  "horizonMonths": 12,
  "defaultWorkingDays": 20,
  "workingDays": {                  // 月別 計算日数（省略可、小数可）
    "2025-04": 21,
    "2025-05": 20.5
  },
  "initialCounts": {                // 期首件数（参考）
    "partner": 2200, "vendor": 1500, "employment": 800
  },
  "acquisitionRatio": { "partner": 50, "vendor": 35, "employment": 15 },
  "terminationRatio": { "partner": 50, "vendor": 35, "employment": 15 },

  "months": {                       // 月次データ（dict形式・推奨）
    "2025-04": {
      "revenue": 1315411885,
      "grossProfit": 300000000,
      "acquisition": 150,
      "termination": 130,
      "memo": "期初"
    },
    "2025-05": { "revenue": 1257008755 }
  },

  // 入替：list または matrix どちらでもOK
  "transfers": [
    { "month": "2025-04", "from": "partner", "to": "vendor", "count": 10 }
  ],
  "transferMatrix": {
    "2025-04": {
      "partner":    { "vendor": 10, "employment": 5 },
      "vendor":     { "partner": 3, "employment": 8 },
      "employment": { "partner": 1, "vendor": 2 }
    }
  }
}`}
          </pre>
        </details>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          インポートは既存データに <strong>マージ</strong> します（JSON に無い項目は保持）。売上だけ、営業日数だけ、など部分的な JSON でも安全に取り込めます。
          カテゴリは <code>partner</code>/<code>vendor</code>/<code>employment</code> の3種です。
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h3>前年 月ごとの計算日数（小数点第2位まで）</h3>
          <div className="row">
            <button className="small ghost" onClick={() => {
              const v = Number(prompt('前年全月に揃える日数（小数可）', String(py.defaultWorkingDays)) ?? '0')
              if (!Number.isNaN(v) && v > 0) {
                const r = Math.round(v * 100) / 100
                if (!confirm(`前年全月の計算日数を ${r} 日で上書きしますか？`)) return
                setPlan((p) => {
                  if (!p.priorYear) return p
                  const next: Record<string, number> = {}
                  for (const m of months) next[m] = r
                  return { ...p, priorYear: { ...p.priorYear, workingDaysByMonth: next } }
                })
              }
            }}>全月一括</button>
          </div>
        </div>
        <div className="form-grid" style={{ marginBottom: 10 }}>
          <div>
            <label>デフォルト計算日数（小数可）</label>
            <input
              type="number"
              min={0.01}
              max={31}
              step={0.01}
              value={Math.round((py.defaultWorkingDays ?? 20) * 100) / 100}
              onChange={(e) => {
                const v = Number(e.target.value) || 20
                updatePY({ defaultWorkingDays: Math.max(0.01, Math.round(v * 100) / 100) })
              }}
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
                  const v = py.workingDaysByMonth?.[m]
                  const isOverride = typeof v === 'number' && v > 0
                  const display = Math.round(((isOverride ? v : py.defaultWorkingDays) ?? 20) * 100) / 100
                  return (
                    <td key={`pywd-${m}`} style={{ padding: 2 }}>
                      <input
                        type="number"
                        min={0}
                        max={31}
                        step={0.01}
                        value={display}
                        onChange={(e) => {
                          const nv = Number(e.target.value) || 0
                          setPlan((p) => {
                            if (!p.priorYear) return p
                            const next = { ...p.priorYear.workingDaysByMonth }
                            if (nv > 0) next[m] = Math.round(nv * 100) / 100
                            else delete next[m]
                            return { ...p, priorYear: { ...p.priorYear, workingDaysByMonth: next } }
                          })
                        }}
                        style={{ width: 76, padding: '2px 6px', textAlign: 'right', color: isOverride ? '#0f172a' : '#94a3b8' }}
                      />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700 }}>
                  {Math.round(months.reduce((s, m) => s + (py.workingDaysByMonth?.[m] ?? py.defaultWorkingDays), 0) * 100) / 100}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>前年の期首件数（参考）</h3>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                {WorkerCategoryOrder.map((c) => <th key={c}><span className={`badge ${c}`}>{WorkerCategoryLabels[c]}</span></th>)}
                <th>合計</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {WorkerCategoryOrder.map((c) => (
                  <td key={c}>
                    <input type="number" min={0} value={py.initialCounts[c]} onChange={(e) => updateInitial(c, Number(e.target.value) || 0)} style={{ maxWidth: 140, textAlign: 'right' }} />
                  </td>
                ))}
                <td className="mono">
                  {(py.initialCounts.partner + py.initialCounts.vendor + py.initialCounts.employment).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>前年 月次実績（獲得 / 終了）</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          獲得・終了は当年の参照行として自動表示されます。
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
                <td style={{ color: '#16a34a', fontWeight: 600 }}>＋獲得</td>
                {months.map((m) => {
                  const d = getMonth(m)
                  return (
                    <td key={`py-a-${m}`} style={{ padding: 2 }}>
                      <input type="number" min={0} value={d?.acquisition ?? 0}
                        onChange={(e) => updateMonth(m, { acquisition: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        style={{ width: 72, padding: '2px 6px', textAlign: 'right', color: '#16a34a' }} />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', color: '#16a34a', fontWeight: 700 }}>+{totals.acq.toLocaleString()}</td>
              </tr>
              <tr>
                <td style={{ color: '#dc2626', fontWeight: 600 }}>－終了</td>
                {months.map((m) => {
                  const d = getMonth(m)
                  return (
                    <td key={`py-t-${m}`} style={{ padding: 2 }}>
                      <input type="number" min={0} value={d?.termination ?? 0}
                        onChange={(e) => updateMonth(m, { termination: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        style={{ width: 72, padding: '2px 6px', textAlign: 'right', color: '#dc2626' }} />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>-{totals.term.toLocaleString()}</td>
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <td><strong>純増減（獲得−終了）</strong></td>
                {months.map((m) => {
                  const d = getMonth(m)
                  const net = (d?.acquisition ?? 0) - (d?.termination ?? 0)
                  return (
                    <td key={`py-n-${m}`} className="mono" style={{ color: net > 0 ? '#16a34a' : net < 0 ? '#dc2626' : undefined, fontWeight: 600 }}>
                      {net > 0 ? `+${net}` : net}
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#e2e8f0', fontWeight: 700, color: totals.net > 0 ? '#16a34a' : totals.net < 0 ? '#dc2626' : undefined }}>
                  {totals.net > 0 ? '+' : ''}{totals.net.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h3>前年 獲得・終了 カテゴリ別内訳</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            月ごとに 運送店 / 業者 / 社員 の獲得・終了件数を記録します。合計は自動で同期。
          </div>
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>項目 / 区分</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年間合計</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={months.length + 2} style={{ background: '#ecfdf5', fontWeight: 600, color: '#065f46' }}>＋獲得 カテゴリ別</td></tr>
              {WorkerCategoryOrder.map((cat) => {
                const values = months.map((m) => getMonth(m)?.acquisitionByCategory?.[cat] ?? 0)
                const total = values.reduce((s, v) => s + v, 0)
                return (
                  <tr key={`ac-${cat}`}>
                    <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                    {months.map((m, i) => (
                      <td key={`ac-${cat}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min={0}
                          value={values[i]}
                          onChange={(e) => {
                            const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                            const cur = getMonth(m)
                            const nextBy = {
                              partner: cur?.acquisitionByCategory?.partner ?? 0,
                              vendor: cur?.acquisitionByCategory?.vendor ?? 0,
                              employment: cur?.acquisitionByCategory?.employment ?? 0,
                              [cat]: v,
                            }
                            const newTotal = nextBy.partner + nextBy.vendor + nextBy.employment
                            updateMonth(m, { acquisitionByCategory: nextBy, acquisition: newTotal })
                          }}
                          style={{ width: 64, padding: '2px 6px', textAlign: 'right', color: '#16a34a' }}
                        />
                      </td>
                    ))}
                    <td className="mono" style={{ background: '#f1f5f9', color: '#16a34a', fontWeight: 700 }}>
                      {total.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
              <tr><td colSpan={months.length + 2} style={{ background: '#fef2f2', fontWeight: 600, color: '#991b1b' }}>－終了 カテゴリ別</td></tr>
              {WorkerCategoryOrder.map((cat) => {
                const values = months.map((m) => getMonth(m)?.terminationByCategory?.[cat] ?? 0)
                const total = values.reduce((s, v) => s + v, 0)
                return (
                  <tr key={`tc-${cat}`}>
                    <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                    {months.map((m, i) => (
                      <td key={`tc-${cat}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min={0}
                          value={values[i]}
                          onChange={(e) => {
                            const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                            const cur = getMonth(m)
                            const nextBy = {
                              partner: cur?.terminationByCategory?.partner ?? 0,
                              vendor: cur?.terminationByCategory?.vendor ?? 0,
                              employment: cur?.terminationByCategory?.employment ?? 0,
                              [cat]: v,
                            }
                            const newTotal = nextBy.partner + nextBy.vendor + nextBy.employment
                            updateMonth(m, { terminationByCategory: nextBy, termination: newTotal })
                          }}
                          style={{ width: 64, padding: '2px 6px', textAlign: 'right', color: '#dc2626' }}
                        />
                      </td>
                    ))}
                    <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>
                      {total.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
              <tr><td colSpan={months.length + 2} style={{ background: '#f8fafc', fontWeight: 600 }}>純増減（カテゴリ別）</td></tr>
              {WorkerCategoryOrder.map((cat) => {
                const nets = months.map((m) => {
                  const d = getMonth(m)
                  return (d?.acquisitionByCategory?.[cat] ?? 0) - (d?.terminationByCategory?.[cat] ?? 0)
                })
                const total = nets.reduce((s, v) => s + v, 0)
                return (
                  <tr key={`nc-${cat}`} style={{ background: '#f8fafc' }}>
                    <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                    {nets.map((net, i) => (
                      <td key={`nc-${cat}-${i}`} className="mono" style={{ fontWeight: 600, color: net > 0 ? '#16a34a' : net < 0 ? '#dc2626' : undefined }}>
                        {net > 0 ? `+${net}` : net}
                      </td>
                    ))}
                    <td className="mono" style={{ background: '#e2e8f0', fontWeight: 700, color: total > 0 ? '#16a34a' : total < 0 ? '#dc2626' : undefined }}>
                      {total > 0 ? `+${total}` : total}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>前年 売上・粗利・粗利率（参考）</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          会計システムや前年実績資料から、月次の売上・粗利（円）を入力してください。粗利率は自動計算されます。
          ここで入力した値は計算には影響しません（月次テーブルで参考行として表示されます）。
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
                <td style={{ color: '#0ea5e9', fontWeight: 600 }}>売上（円）</td>
                {months.map((m) => {
                  const d = getMonth(m)
                  return (
                    <td key={`py-rev-${m}`} style={{ padding: 2 }}>
                      <input type="number" min={0} value={d?.revenue ?? 0}
                        onChange={(e) => updateMonth(m, { revenue: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        style={{ width: 96, padding: '2px 6px', textAlign: 'right', color: '#0ea5e9' }} />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', color: '#0ea5e9', fontWeight: 700 }}>
                  {totals.rev.toLocaleString()}
                </td>
              </tr>
              <tr>
                <td style={{ color: '#16a34a', fontWeight: 600 }}>粗利（円）</td>
                {months.map((m) => {
                  const d = getMonth(m)
                  return (
                    <td key={`py-gp-${m}`} style={{ padding: 2 }}>
                      <input type="number" value={d?.grossProfit ?? 0}
                        onChange={(e) => updateMonth(m, { grossProfit: Math.round(Number(e.target.value) || 0) })}
                        style={{ width: 96, padding: '2px 6px', textAlign: 'right', color: '#16a34a' }} />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', color: '#16a34a', fontWeight: 700 }}>
                  {totals.gp.toLocaleString()}
                </td>
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <td><strong>粗利率（自動）</strong></td>
                {months.map((m) => {
                  const d = getMonth(m)
                  const rev = d?.revenue ?? 0
                  const gp = d?.grossProfit ?? 0
                  const margin = rev > 0 ? gp / rev : 0
                  return (
                    <td key={`py-gm-${m}`} className="mono" style={{ fontWeight: 600 }}>
                      {rev > 0 ? `${(margin * 100).toFixed(1)}%` : '—'}
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#e2e8f0', fontWeight: 700 }}>
                  {totals.rev > 0 ? `${(totals.margin * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
              <tr>
                <td style={{ color: '#7c3aed', fontWeight: 600 }}>
                  マイスター売上
                  <div className="muted" style={{ fontSize: 10, fontWeight: 400 }}>（営業社員代走・情報表示のみ）</div>
                </td>
                {months.map((m) => {
                  const d = getMonth(m)
                  return (
                    <td key={`py-mr-${m}`} style={{ padding: 2 }}>
                      <input type="number" min={0} value={d?.meisterRevenue ?? 0}
                        onChange={(e) => updateMonth(m, { meisterRevenue: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        style={{ width: 108, padding: '2px 6px', textAlign: 'right', color: '#7c3aed' }} />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', color: '#7c3aed', fontWeight: 700 }}>
                  {meisterTotal.toLocaleString()}
                </td>
              </tr>
              <tr>
                <td className="muted" style={{ fontSize: 11 }}>マイスター比率（対売上）</td>
                {months.map((m) => {
                  const d = getMonth(m)
                  const rev = d?.revenue ?? 0
                  const mr = d?.meisterRevenue ?? 0
                  const ratio = rev > 0 ? mr / rev : 0
                  return (
                    <td key={`py-mrr-${m}`} className="mono muted" style={{ fontSize: 11 }}>
                      {rev > 0 && mr > 0 ? `${(ratio * 100).toFixed(2)}%` : '—'}
                    </td>
                  )
                })}
                <td className="mono muted" style={{ background: '#f1f5f9', fontSize: 11 }}>
                  {totals.rev > 0 && meisterTotal > 0 ? `${((meisterTotal / totals.rev) * 100).toFixed(2)}%` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ background: '#fef3c7', borderColor: '#fde68a' }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ color: '#92400e' }}>前年 年間サマリー（獲得/終了 単価・粗利率・参考値）</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            ダッシュボード「終了単価」カードや、カテゴリ設定の「前年実績サマリー」で参照されます。計算には影響しません。
          </div>
        </div>

        <div className="scroll-x" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th>獲得案件</th>
                <th>終了案件</th>
                <th className="muted" style={{ fontWeight: 400 }}>一括操作</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>平均単価（円/日）</strong></td>
                <td style={{ padding: 2 }}>
                  <input
                    type="number"
                    min={0}
                    value={py.annualSummary?.acquisitionUnitPrice ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                      setPlan((p) => p.priorYear
                        ? { ...p, priorYear: { ...p.priorYear, annualSummary: { ...(p.priorYear.annualSummary ?? {}), acquisitionUnitPrice: v } } }
                        : p)
                    }}
                    style={{ maxWidth: 120, textAlign: 'right' }}
                  />
                </td>
                <td style={{ padding: 2 }}>
                  <input
                    type="number"
                    min={0}
                    value={py.annualSummary?.terminationUnitPrice ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                      setPlan((p) => p.priorYear
                        ? { ...p, priorYear: { ...p.priorYear, annualSummary: { ...(p.priorYear.annualSummary ?? {}), terminationUnitPrice: v } } }
                        : p)
                    }}
                    style={{ maxWidth: 120, textAlign: 'right' }}
                  />
                </td>
                <td>
                  <button
                    className="small ghost"
                    style={{ fontSize: 11 }}
                    onClick={() => {
                      const blended = computeBlendedUnitPrice(py, months)
                      if (blended <= 0) {
                        alert('月次売上または計算日数が未入力のためブレンド単価を算出できません。')
                        return
                      }
                      if (!confirm(`獲得・終了の両方に年間ブレンド単価（¥${blended.toLocaleString()}/日）を入れますか？`)) return
                      setPlan((p) => p.priorYear
                        ? { ...p, priorYear: { ...p.priorYear, annualSummary: {
                            ...(p.priorYear.annualSummary ?? {}),
                            acquisitionUnitPrice: blended,
                            terminationUnitPrice: blended,
                          } } }
                        : p)
                    }}
                  >
                    年間ブレンドで埋める
                  </button>
                </td>
              </tr>
              <tr>
                <td><strong>粗利率（%）</strong></td>
                <td style={{ padding: 2 }}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={py.annualSummary?.acquisitionMarginPct ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) * 100) / 100 || 0))
                      setPlan((p) => p.priorYear
                        ? { ...p, priorYear: { ...p.priorYear, annualSummary: { ...(p.priorYear.annualSummary ?? {}), acquisitionMarginPct: v } } }
                        : p)
                    }}
                    style={{ maxWidth: 100, textAlign: 'right' }}
                  />
                </td>
                <td style={{ padding: 2 }}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={py.annualSummary?.terminationMarginPct ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) * 100) / 100 || 0))
                      setPlan((p) => p.priorYear
                        ? { ...p, priorYear: { ...p.priorYear, annualSummary: { ...(p.priorYear.annualSummary ?? {}), terminationMarginPct: v } } }
                        : p)
                    }}
                    style={{ maxWidth: 100, textAlign: 'right' }}
                  />
                </td>
                <td>
                  <button
                    className="small ghost"
                    style={{ fontSize: 11 }}
                    onClick={() => {
                      if (totals.rev <= 0) {
                        alert('月次売上・粗利が未入力のため年間粗利率を算出できません。')
                        return
                      }
                      const pct = Math.round((totals.margin * 100) * 100) / 100
                      if (!confirm(`獲得・終了の両方に年間粗利率（${pct.toFixed(2)}%）を入れますか？`)) return
                      setPlan((p) => p.priorYear
                        ? { ...p, priorYear: { ...p.priorYear, annualSummary: {
                            ...(p.priorYear.annualSummary ?? {}),
                            acquisitionMarginPct: pct,
                            terminationMarginPct: pct,
                          } } }
                        : p)
                    }}
                  >
                    年間粗利率で埋める
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          ※ 実データで獲得・終了を分離できない場合は「年間ブレンド」「年間粗利率」で両方に同じ値を入れておき、把握でき次第 個別に上書きしてください。
          獲得単価はカテゴリ設定 → 🎯 FY2026 コホート単価カードの「前年（FY前年）獲得案件 平均単価」の既定値としても使われます。
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h3>前年 月別 入替マトリクス（from → to）</h3>
          <button className="small ghost" onClick={clearTransfers}>全クリア</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          前年の各月の移動件数（9マス）。対角「同区分入替（運送店→運送店 等）」も入力可能で、下の同区分 uplift と連動して原価影響を可視化できます。
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
                const isDiagonal = from === to
                const total = months.reduce((s, m) => s + getTransferAmount(py.transfers, m, from, to), 0)
                return (
                  <tr key={`py-${from}-${to}`} style={isDiagonal ? { background: '#fef3c7' } : undefined}>
                    <td>
                      <span className={`badge ${from}`}>{WorkerCategoryLabels[from]}</span>
                      <span className="muted" style={{ margin: '0 4px' }}>→</span>
                      <span className={`badge ${to}`}>{WorkerCategoryLabels[to]}</span>
                      {isDiagonal && <span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>(同区分)</span>}
                    </td>
                    {months.map((m) => (
                      <td key={`py-${from}-${to}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min={0}
                          value={getTransferAmount(py.transfers, m, from, to)}
                          onChange={(e) => setTransferCell(m, from, to, Math.max(0, Math.round(Number(e.target.value) || 0)))}
                          style={{ width: 64, padding: '2px 6px', textAlign: 'right' }}
                        />
                      </td>
                    ))}
                    <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700 }}>{total.toLocaleString()}</td>
                    <td>
                      <button className="small ghost" style={{ fontSize: 10, padding: '2px 6px' }}
                        onClick={() => {
                          const v = Number(prompt(`${WorkerCategoryLabels[from]} → ${WorkerCategoryLabels[to]} の前年 毎月件数`, '0') ?? '0')
                          if (!Number.isNaN(v)) fillTransferRow(from, to, Math.max(0, Math.round(v)))
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
          <h3 style={{ color: '#92400e' }}>前年 同区分入替 原価引き上げ（参考値）</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            前年実績の uplift 実績値。計算には影響しません（参照用）。
          </div>
        </div>
        <div className="form-grid" style={{ marginBottom: 10 }}>
          <div>
            <label><span className="badge partner">運送店</span> デフォルト X（円/1件/日）</label>
            <input
              type="number"
              min={0}
              value={py.diagonalUplift?.partner ?? 0}
              onChange={(e) => {
                const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                setPlan((p) => p.priorYear
                  ? { ...p, priorYear: { ...p.priorYear, diagonalUplift: { ...p.priorYear.diagonalUplift, partner: v } } }
                  : p)
              }}
            />
          </div>
          <div>
            <label><span className="badge vendor">業者</span> デフォルト X（円/1件/日）</label>
            <input
              type="number"
              min={0}
              value={py.diagonalUplift?.vendor ?? 0}
              onChange={(e) => {
                const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                setPlan((p) => p.priorYear
                  ? { ...p, priorYear: { ...p.priorYear, diagonalUplift: { ...p.priorYear.diagonalUplift, vendor: v } } }
                  : p)
              }}
            />
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          月別上書きが必要な場合は、JSON インポートで <code>diagonalUpliftByMonth</code> を与えてください。
        </div>
      </div>

      <div className="card">
        <h3>前年 カテゴリ別 月次 転出・転入サマリー</h3>
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
                const outs = months.map((m) => totalOutflow(py.transfers, m, cat))
                const ins = months.map((m) => totalInflow(py.transfers, m, cat))
                const outTotal = outs.reduce((s, v) => s + v, 0)
                const inTotal = ins.reduce((s, v) => s + v, 0)
                const netTotal = inTotal - outTotal
                return (
                  <Fragment key={`py-sum-${cat}`}>
                    <tr>
                      <td rowSpan={3}><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                    </tr>
                    <tr>
                      <td style={{ color: '#dc2626', fontSize: 12 }}>転出</td>
                      {outs.map((v, i) => (
                        <td key={`py-o-${cat}-${i}`} className="mono" style={{ color: v > 0 ? '#dc2626' : '#94a3b8' }}>{v || '—'}</td>
                      ))}
                      <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>{outTotal.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#16a34a', fontSize: 12 }}>転入</td>
                      {ins.map((v, i) => (
                        <td key={`py-i-${cat}-${i}`} className="mono" style={{ color: v > 0 ? '#16a34a' : '#94a3b8' }}>{v || '—'}</td>
                      ))}
                      <td className="mono" style={{ background: '#f1f5f9', color: '#16a34a', fontWeight: 700 }}>{inTotal.toLocaleString()}</td>
                    </tr>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                      <td style={{ fontSize: 12 }}><strong>純移動</strong></td>
                      {ins.map((ii, i) => {
                        const net = ii - outs[i]
                        return (
                          <td key={`py-n-${cat}-${i}`} className="mono" style={{ fontWeight: 600, color: net > 0 ? '#16a34a' : net < 0 ? '#dc2626' : '#94a3b8' }}>
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
