import { useState } from 'react'
import { newId, usePlanStore } from '../store'
import type { PriceChange, Project } from '../types'
import { yen } from '../utils/calculations'

export default function ProjectsPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)

  function addProject() {
    setPlan((p) => ({
      ...p,
      projects: [
        ...p.projects,
        {
          id: newId(),
          name: '新規案件',
          client: '',
          startMonth: p.baseMonth,
          endMonth: null,
          unitPrice: 500_000,
          priceChanges: [],
        },
      ],
    }))
  }

  function update(id: string, patch: Partial<Project>) {
    setPlan((p) => ({
      ...p,
      projects: p.projects.map((pr) => (pr.id === id ? { ...pr, ...patch } : pr)),
    }))
  }

  function remove(id: string) {
    if (!confirm('この案件を削除しますか？（関連アサインも削除されます）')) return
    setPlan((p) => ({
      ...p,
      projects: p.projects.filter((pr) => pr.id !== id),
      assignments: p.assignments.filter((a) => a.projectId !== id),
    }))
  }

  function addPriceChange(id: string) {
    setPlan((p) => ({
      ...p,
      projects: p.projects.map((pr) =>
        pr.id === id
          ? {
              ...pr,
              priceChanges: [
                ...pr.priceChanges,
                { id: newId(), effectiveMonth: pr.startMonth, newPrice: pr.unitPrice + 50_000 },
              ],
            }
          : pr,
      ),
    }))
  }

  function updatePc(projectId: string, pcId: string, patch: Partial<PriceChange>) {
    setPlan((p) => ({
      ...p,
      projects: p.projects.map((pr) =>
        pr.id === projectId
          ? { ...pr, priceChanges: pr.priceChanges.map((pc) => (pc.id === pcId ? { ...pc, ...patch } : pc)) }
          : pr,
      ),
    }))
  }

  function removePc(projectId: string, pcId: string) {
    setPlan((p) => ({
      ...p,
      projects: p.projects.map((pr) =>
        pr.id === projectId
          ? { ...pr, priceChanges: pr.priceChanges.filter((pc) => pc.id !== pcId) }
          : pr,
      ),
    }))
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>案件一覧（{plan.projects.length}件）</h3>
        <button onClick={addProject}>＋ 新しい案件を追加</button>
      </div>

      {plan.projects.length === 0 && (
        <div className="card muted">案件がありません。「新しい案件を追加」から登録してください。</div>
      )}

      {plan.projects.map((pr) => (
        <ProjectCard key={pr.id} pr={pr} onChange={(patch) => update(pr.id, patch)} onRemove={() => remove(pr.id)}
          onAddPc={() => addPriceChange(pr.id)}
          onUpdatePc={(pcId, patch) => updatePc(pr.id, pcId, patch)}
          onRemovePc={(pcId) => removePc(pr.id, pcId)} />
      ))}
    </div>
  )
}

function ProjectCard({
  pr, onChange, onRemove, onAddPc, onUpdatePc, onRemovePc,
}: {
  pr: Project
  onChange: (p: Partial<Project>) => void
  onRemove: () => void
  onAddPc: () => void
  onUpdatePc: (id: string, patch: Partial<PriceChange>) => void
  onRemovePc: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card">
      <div className="form-grid">
        <div>
          <label>案件名</label>
          <input value={pr.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div>
          <label>クライアント</label>
          <input value={pr.client ?? ''} onChange={(e) => onChange({ client: e.target.value })} />
        </div>
        <div>
          <label>開始月</label>
          <MonthInput value={pr.startMonth} onChange={(v) => onChange({ startMonth: v })} />
        </div>
        <div>
          <label>終了月（空欄で継続）</label>
          <MonthInput value={pr.endMonth ?? ''} onChange={(v) => onChange({ endMonth: v || null })} allowEmpty />
        </div>
        <div>
          <label>基本単価（月額・円）</label>
          <input type="number" value={pr.unitPrice} onChange={(e) => onChange({ unitPrice: Number(e.target.value) })} />
        </div>
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="small ghost" onClick={() => setOpen(!open)}>
            単価改定 {pr.priceChanges.length > 0 ? `(${pr.priceChanges.length})` : ''} {open ? '▲' : '▼'}
          </button>
          <button className="small danger" onClick={onRemove}>削除</button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12, borderTop: '1px dashed #334155', paddingTop: 12 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="muted" style={{ fontSize: 12 }}>単価改定（effective 月以降に newPrice を適用）</div>
            <button className="small" onClick={onAddPc}>＋ 改定を追加</button>
          </div>
          {pr.priceChanges.length === 0 && <div className="muted" style={{ fontSize: 12 }}>改定なし（基本単価 ¥{yen(pr.unitPrice)} で継続）</div>}
          {pr.priceChanges.map((pc) => (
            <div key={pc.id} className="form-grid" style={{ marginTop: 6 }}>
              <div>
                <label>適用月</label>
                <MonthInput value={pc.effectiveMonth} onChange={(v) => onUpdatePc(pc.id, { effectiveMonth: v })} />
              </div>
              <div>
                <label>新単価（円）</label>
                <input type="number" value={pc.newPrice} onChange={(e) => onUpdatePc(pc.id, { newPrice: Number(e.target.value) })} />
              </div>
              <div>
                <label>理由</label>
                <input value={pc.reason ?? ''} onChange={(e) => onUpdatePc(pc.id, { reason: e.target.value })} placeholder="条件変更、改定交渉 など" />
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="small danger" onClick={() => onRemovePc(pc.id)}>削除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MonthInput({
  value, onChange, allowEmpty = false,
}: {
  value: string
  onChange: (v: string) => void
  allowEmpty?: boolean
}) {
  return (
    <input
      type="month"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={!allowEmpty}
    />
  )
}
