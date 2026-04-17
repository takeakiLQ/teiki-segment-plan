import { useRef } from 'react'
import { createEmptyPlan, usePlanStore } from '../store'
import type { Plan } from '../types'
import { MonthInput } from './ProjectsPanel'

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
            <MonthInput value={plan.baseMonth} onChange={(v) => setPlan((p) => ({ ...p, baseMonth: v }))} />
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
        <h3>注意事項</h3>
        <ul className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
          <li>データは端末のローカル（localStorage）に即時保存されます。</li>
          <li>Firebase 設定済み＆ログイン中の場合、右上の「クラウドに保存」でユーザーごとの計画として保存されます。</li>
          <li>ログイン時は起動時にクラウドの最新データが自動で読み込まれます。</li>
          <li>稼働者の入替は「旧アサインに終了月を入れ、新アサインを開始月で追加」で表現します。</li>
        </ul>
      </div>
    </div>
  )
}
