import { useState } from 'react'
import { newId, usePlanStore } from '../store'
import type { CostChange, Worker, WorkerCategory } from '../types'
import { WorkerCategoryLabels } from '../types'
import { yen } from '../utils/calculations'
import { MonthInput } from './ProjectsPanel'

const categoryBadge: Record<WorkerCategory, string> = {
  partner: 'partner',
  vendor: 'vendor',
  dposition: 'dposition',
  fs: 'fs',
}

export default function WorkersPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)

  function addWorker(category: WorkerCategory) {
    setPlan((p) => ({
      ...p,
      workers: [
        ...p.workers,
        {
          id: newId(),
          name: '新規稼働者',
          category,
          monthlyCost: 0,
          costChanges: [],
        },
      ],
    }))
  }

  function update(id: string, patch: Partial<Worker>) {
    setPlan((p) => ({
      ...p,
      workers: p.workers.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }))
  }

  function remove(id: string) {
    if (!confirm('この稼働者を削除しますか？（関連アサインも削除されます）')) return
    setPlan((p) => ({
      ...p,
      workers: p.workers.filter((w) => w.id !== id),
      assignments: p.assignments.filter((a) => a.workerId !== id),
    }))
  }

  function updateDefault(cat: WorkerCategory, rate: number) {
    setPlan((p) => ({ ...p, categoryDefaults: { ...p.categoryDefaults, [cat]: rate } }))
  }

  return (
    <div>
      <div className="card">
        <h3>稼働者区分 デフォルト原価率（%）</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          稼働者の仕入単価が未設定、かつアサインに個別原価率が無い場合、ここの比率 × 案件単価 が原価となります。
        </div>
        <div className="form-grid">
          {(Object.keys(plan.categoryDefaults) as WorkerCategory[]).map((cat) => (
            <div key={cat}>
              <label>
                <span className={`badge ${categoryBadge[cat]}`}>{WorkerCategoryLabels[cat]}</span>
              </label>
              <input
                type="number"
                value={plan.categoryDefaults[cat]}
                onChange={(e) => updateDefault(cat, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="row between" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>稼働者一覧（{plan.workers.length}名）</h3>
        <div className="row">
          {(Object.keys(WorkerCategoryLabels) as WorkerCategory[]).map((cat) => (
            <button key={cat} className="small ghost" onClick={() => addWorker(cat)}>
              ＋ {WorkerCategoryLabels[cat]}
            </button>
          ))}
        </div>
      </div>

      {plan.workers.length === 0 && (
        <div className="card muted">稼働者がいません。右上のボタンから区分を選んで追加してください。</div>
      )}

      {plan.workers.map((w) => (
        <WorkerCard
          key={w.id}
          w={w}
          onChange={(patch) => update(w.id, patch)}
          onRemove={() => remove(w.id)}
          onAddCc={() =>
            update(w.id, {
              costChanges: [
                ...w.costChanges,
                { id: newId(), effectiveMonth: plan.baseMonth, newCost: w.monthlyCost || 500_000 },
              ],
            })
          }
          onUpdateCc={(id, patch) =>
            update(w.id, {
              costChanges: w.costChanges.map((c) => (c.id === id ? { ...c, ...patch } : c)),
            })
          }
          onRemoveCc={(id) =>
            update(w.id, {
              costChanges: w.costChanges.filter((c) => c.id !== id),
            })
          }
        />
      ))}
    </div>
  )
}

function WorkerCard({
  w, onChange, onRemove, onAddCc, onUpdateCc, onRemoveCc,
}: {
  w: Worker
  onChange: (p: Partial<Worker>) => void
  onRemove: () => void
  onAddCc: () => void
  onUpdateCc: (id: string, patch: Partial<CostChange>) => void
  onRemoveCc: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card">
      <div className="form-grid">
        <div>
          <label>氏名</label>
          <input value={w.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div>
          <label>区分</label>
          <select value={w.category} onChange={(e) => onChange({ category: e.target.value as WorkerCategory })}>
            {(Object.keys(WorkerCategoryLabels) as WorkerCategory[]).map((c) => (
              <option key={c} value={c}>{WorkerCategoryLabels[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label>月次 仕入単価（円・0 ならデフォルト率を使用）</label>
          <input type="number" value={w.monthlyCost} onChange={(e) => onChange({ monthlyCost: Number(e.target.value) })} />
        </div>
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <span className={`badge ${categoryBadge[w.category]}`}>{WorkerCategoryLabels[w.category]}</span>
          <button className="small ghost" onClick={() => setOpen(!open)}>
            単価改定 {w.costChanges.length > 0 ? `(${w.costChanges.length})` : ''} {open ? '▲' : '▼'}
          </button>
          <button className="small danger" onClick={onRemove}>削除</button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12, borderTop: '1px dashed #cbd5e1', paddingTop: 12 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="muted" style={{ fontSize: 12 }}>仕入単価の改定履歴</div>
            <button className="small" onClick={onAddCc}>＋ 改定を追加</button>
          </div>
          {w.costChanges.length === 0 && <div className="muted" style={{ fontSize: 12 }}>改定なし（¥{yen(w.monthlyCost)}）</div>}
          {w.costChanges.map((cc) => (
            <div key={cc.id} className="form-grid" style={{ marginTop: 6 }}>
              <div>
                <label>適用月</label>
                <MonthInput value={cc.effectiveMonth} onChange={(v) => onUpdateCc(cc.id, { effectiveMonth: v })} />
              </div>
              <div>
                <label>新仕入単価（円）</label>
                <input type="number" value={cc.newCost} onChange={(e) => onUpdateCc(cc.id, { newCost: Number(e.target.value) })} />
              </div>
              <div>
                <label>理由</label>
                <input value={cc.reason ?? ''} onChange={(e) => onUpdateCc(cc.id, { reason: e.target.value })} placeholder="契約更新 等" />
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="small danger" onClick={() => onRemoveCc(cc.id)}>削除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
