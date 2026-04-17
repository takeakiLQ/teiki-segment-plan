import { useMemo } from 'react'
import { newId, usePlanStore } from '../store'
import type { Assignment } from '../types'
import { WorkerCategoryLabels } from '../types'
import { MonthInput } from './ProjectsPanel'

export default function AssignmentsPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)

  const projectOptions = useMemo(
    () => plan.projects.map((p) => ({ value: p.id, label: `${p.name}${p.client ? ` / ${p.client}` : ''}` })),
    [plan.projects],
  )
  const workerOptions = useMemo(
    () => plan.workers.map((w) => ({ value: w.id, label: `${w.name}（${WorkerCategoryLabels[w.category]}）` })),
    [plan.workers],
  )

  function addAssignment() {
    if (plan.projects.length === 0 || plan.workers.length === 0) {
      alert('先に案件と稼働者を登録してください。')
      return
    }
    setPlan((p) => ({
      ...p,
      assignments: [
        ...p.assignments,
        {
          id: newId(),
          projectId: p.projects[0].id,
          workerId: p.workers[0].id,
          startMonth: p.baseMonth,
          endMonth: null,
          overrideCostRate: null,
        },
      ],
    }))
  }

  function update(id: string, patch: Partial<Assignment>) {
    setPlan((p) => ({
      ...p,
      assignments: p.assignments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }))
  }

  function remove(id: string) {
    if (!confirm('このアサインを削除しますか？')) return
    setPlan((p) => ({ ...p, assignments: p.assignments.filter((a) => a.id !== id) }))
  }

  function duplicate(a: Assignment) {
    setPlan((p) => ({
      ...p,
      assignments: [...p.assignments, { ...a, id: newId() }],
    }))
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>アサイン（{plan.assignments.length}件）</h3>
        <div className="row">
          <div className="muted" style={{ fontSize: 12 }}>
            入替は「終了月を入れて旧アサインを終わらせ」「新アサインを追加」で表現します。
          </div>
          <button onClick={addAssignment}>＋ アサインを追加</button>
        </div>
      </div>

      {plan.assignments.length === 0 && (
        <div className="card muted">アサインがありません。</div>
      )}

      {plan.assignments.map((a) => (
        <div key={a.id} className="card">
          <div className="form-grid">
            <div>
              <label>案件</label>
              <select value={a.projectId} onChange={(e) => update(a.id, { projectId: e.target.value })}>
                {projectOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>稼働者</label>
              <select value={a.workerId} onChange={(e) => update(a.id, { workerId: e.target.value })}>
                {workerOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>開始月</label>
              <MonthInput value={a.startMonth} onChange={(v) => update(a.id, { startMonth: v })} />
            </div>
            <div>
              <label>終了月（空欄で継続）</label>
              <MonthInput
                value={a.endMonth ?? ''}
                allowEmpty
                onChange={(v) => update(a.id, { endMonth: v || null })}
              />
            </div>
            <div>
              <label>個別原価率（%・空欄で稼働者単価または区分デフォルト）</label>
              <input
                type="number"
                value={a.overrideCostRate ?? ''}
                onChange={(e) => update(a.id, { overrideCostRate: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="例: 65"
              />
            </div>
            <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              <button className="small ghost" onClick={() => duplicate(a)}>複製</button>
              <button className="small danger" onClick={() => remove(a.id)}>削除</button>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label>メモ</label>
            <input value={a.memo ?? ''} onChange={(e) => update(a.id, { memo: e.target.value })} placeholder="入替・条件変更の理由など" />
          </div>
        </div>
      ))}
    </div>
  )
}
