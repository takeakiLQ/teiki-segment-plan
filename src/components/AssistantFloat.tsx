/**
 * 🤖 AI アシスタント — 右下フロートウィジェット版
 *
 * - 右下に💬丸ボタン。クリックで展開チャット（380x560px 程度）。
 * - 全ページから利用可能（App.tsx で常駐レンダリング）
 * - サイドナビからの 'assistant' 画面は廃止
 * - ナレッジ / スナップショット / 履歴クリア は展開時ヘッダのメニューから
 */

import { useEffect, useRef, useState } from 'react'
import { usePlanStore } from '../store'
import { useAssistantStore } from '../assistant/assistantStore'
import { runTurn, continueAfterApproval } from '../assistant/chatEngine'
import { anthropicReady, anthropicMode } from '../assistant/anthropicClient'
import type { ChatMessage } from '../assistant/types'
import type { ToolName } from '../assistant/tools'
import type Anthropic from '@anthropic-ai/sdk'
import { BUSINESS_UNITS } from '../data/businessUnits'

function newMsgId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export default function AssistantFloat() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const businessUnit = usePlanStore((s) => s.businessUnit)
  const bu = BUSINESS_UNITS[businessUnit]

  const assistant = useAssistantStore()
  const { state } = assistant

  // BU 切替追従
  useEffect(() => {
    assistant.setBU(businessUnit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessUnit])

  const [open, setOpen] = useState(false)
  const [drawer, setDrawer] = useState<'none' | 'knowledge' | 'snapshots'>('none')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<
    | {
        kind: 'plan_update' | 'save_knowledge'
        payload: any
        toolUseId: string
        toolName: ToolName
        rawMessages: Anthropic.MessageParam[]
      }
    | null
  >(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [state.messages.length, busy])

  async function handleSend() {
    const text = input.trim()
    if (!text || busy) return
    if (!anthropicReady) {
      alert('Claude API が未設定。.env の VITE_CLAUDE_PROXY_URL を確認してください。')
      return
    }
    const userMsg: ChatMessage = {
      id: newMsgId(), role: 'user', content: text, at: new Date().toISOString(),
    }
    assistant.appendMessage(userMsg)
    setInput('')
    setBusy(true)
    try {
      const res = await runTurn({
        history: [...state.messages, userMsg],
        userMessage: text,
        plan, businessUnit,
        knowledge: state.knowledge,
        snapshots: state.snapshots,
      })
      handleTurnResult(res)
    } catch (e: any) {
      assistant.appendMessage({
        id: newMsgId(), role: 'assistant',
        content: `⚠️ エラー: ${e?.message ?? e}`,
        at: new Date().toISOString(),
      })
    } finally {
      setBusy(false)
    }
  }

  function handleTurnResult(res: Awaited<ReturnType<typeof runTurn>>) {
    if (res.kind === 'error') {
      assistant.appendMessage({
        id: newMsgId(), role: 'assistant',
        content: `⚠️ エラー: ${res.error}`,
        at: new Date().toISOString(),
      })
      return
    }
    if (res.kind === 'needs_approval') {
      if (res.interimText) {
        assistant.appendMessage({
          id: newMsgId(), role: 'assistant',
          content: res.interimText,
          at: new Date().toISOString(),
          toolCalls: res.toolCalls,
        })
      }
      setPendingApproval({
        kind: res.pending.kind,
        payload: res.pending.payload,
        toolUseId: res.pending.toolUseId,
        toolName: res.pending.toolName,
        rawMessages: res.rawMessages,
      })
      return
    }
    assistant.appendMessage({
      id: newMsgId(), role: 'assistant',
      content: res.text, at: new Date().toISOString(),
      toolCalls: res.toolCalls,
    })
  }

  async function handleApprove(approved: boolean) {
    if (!pendingApproval) return
    setBusy(true)
    let applicationResult: any = { approved }
    if (approved) {
      if (pendingApproval.kind === 'plan_update') {
        const patch = pendingApproval.payload.patch as any
        assistant.takeSnapshot(plan, `AI修正前 ${new Date().toLocaleString('ja-JP')}`, 'AI 提案適用')
        setPlan((p) => ({ ...p, ...patch }))
        applicationResult = { approved: true, applied: patch, rationale: pendingApproval.payload.rationale }
      } else if (pendingApproval.kind === 'save_knowledge') {
        const { content, tags } = pendingApproval.payload
        assistant.addKnowledge(content, tags)
        applicationResult = { approved: true, saved: { content, tags } }
      }
    }
    const pending = pendingApproval
    setPendingApproval(null)
    try {
      const res = await continueAfterApproval({
        rawMessages: pending.rawMessages,
        toolUseId: pending.toolUseId,
        toolName: pending.toolName,
        approved, applicationResult,
        plan, businessUnit,
        knowledge: state.knowledge,
        snapshots: state.snapshots,
      })
      handleTurnResult(res)
    } catch (e: any) {
      assistant.appendMessage({
        id: newMsgId(), role: 'assistant',
        content: `⚠️ エラー: ${e?.message ?? e}`,
        at: new Date().toISOString(),
      })
    } finally {
      setBusy(false)
    }
  }

  // ======= render =======
  const unreadCount = state.messages.filter((m) => m.role === 'assistant').length  // 参考表示用

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="AI アシスタント"
        title={anthropicReady ? 'AI に質問' : 'API 未設定'}
        style={{
          position: 'fixed',
          right: 20, bottom: 20,
          width: 60, height: 60,
          borderRadius: '50%',
          background: anthropicReady ? '#0284c7' : '#94a3b8',
          color: '#fff',
          fontSize: 28,
          border: 'none',
          boxShadow: '0 8px 24px rgba(2,132,199,0.4)',
          cursor: 'pointer',
          zIndex: 190,
          transition: 'transform 0.15s ease',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      >🤖</button>
    )
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          right: 20, bottom: 20,
          width: 420,
          height: 620,
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: 'calc(100vh - 40px)',
          background: '#fff',
          border: '1px solid #cbd5e1',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(15,23,42,0.25)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 190,
          overflow: 'hidden',
        }}
      >
        {/* ヘッダ */}
        <div
          style={{
            background: '#0284c7', color: '#fff',
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span style={{ fontSize: 18 }}>🤖</span>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            AI アシスタント
            <span style={{ fontWeight: 400, fontSize: 11, marginLeft: 6, opacity: 0.85 }}>/ {bu.shortName}</span>
          </div>
          <button
            onClick={() => setDrawer(drawer === 'knowledge' ? 'none' : 'knowledge')}
            title="ナレッジ"
            style={iconBtnStyle}
          >📚 {state.knowledge.length}</button>
          <button
            onClick={() => setDrawer(drawer === 'snapshots' ? 'none' : 'snapshots')}
            title="plan スナップショット"
            style={iconBtnStyle}
          >📸 {state.snapshots.length}</button>
          <button
            onClick={() => {
              const label = prompt('スナップショットのラベル（省略可）') ?? undefined
              assistant.takeSnapshot(plan, label, '手動保存')
              alert('現在の plan をスナップショットとして保存しました。')
            }}
            title="今の plan を保存"
            style={iconBtnStyle}
          >＋</button>
          <button
            onClick={() => {
              if (!confirm('チャット履歴をクリアしますか？ナレッジとスナップショットは残ります。')) return
              assistant.clearMessages()
            }}
            title="履歴クリア"
            style={iconBtnStyle}
            disabled={state.messages.length === 0}
          >🗑</button>
          <button
            onClick={() => setOpen(false)}
            title="閉じる"
            style={{ ...iconBtnStyle, fontSize: 14 }}
          >✕</button>
        </div>

        {/* サブドロワー */}
        {drawer !== 'none' && (
          <div style={{ borderBottom: '1px solid #e2e8f0', padding: 10, maxHeight: 200, overflowY: 'auto', background: '#f8fafc' }}>
            {drawer === 'knowledge' ? <KnowledgeSection /> : <SnapshotsSection />}
          </div>
        )}

        {!anthropicReady && (
          <div style={{ background: '#fef2f2', border: '1px dashed #dc2626', padding: 8, margin: 8, borderRadius: 6, fontSize: 11, color: '#991b1b' }}>
            ⚠️ Claude API 未設定。<code>.env</code> に <code>VITE_CLAUDE_PROXY_URL</code> または <code>VITE_ANTHROPIC_API_KEY</code> を設定してください。
          </div>
        )}
        {anthropicReady && (
          <div style={{ fontSize: 10, color: '#64748b', padding: '4px 14px', borderBottom: '1px solid #f1f5f9' }}>
            モード: {anthropicMode === 'proxy' ? '🔒 proxy 経由' : '⚠️ 直接モード（キー露出）'}
          </div>
        )}

        {/* メッセージエリア */}
        <div
          ref={scrollRef}
          style={{
            flex: 1, overflowY: 'auto', padding: 10,
            background: '#f8fafc', minHeight: 0,
          }}
        >
          {state.messages.length === 0 && (
            <div className="muted" style={{ fontSize: 11, padding: 8, lineHeight: 1.7 }}>
              💡 質問例:
              <ul style={{ margin: '4px 0 0 16px', paddingLeft: 0 }}>
                <li>「11月の粗利率が10月より上がった要因は？」</li>
                <li>「業者の3月比率を30%にしたい。どこを修正？」</li>
                <li>「予算の粗利ギャップを埋める施策は？」</li>
                <li>「運送店は手数料18%と覚えておいて」</li>
              </ul>
            </div>
          )}
          {state.messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
          {busy && (
            <div className="muted" style={{ padding: 6, fontSize: 11 }}>💭 考え中…</div>
          )}
        </div>

        {/* 入力 */}
        <div style={{ borderTop: '1px solid #e2e8f0', padding: 8, background: '#fff' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={anthropicReady ? 'Claude に質問…（Shift+Enter で改行）' : 'API 未設定'}
              disabled={!anthropicReady || busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              rows={2}
              style={{ flex: 1, resize: 'none', fontFamily: 'inherit', fontSize: 12 }}
            />
            <button
              onClick={handleSend}
              disabled={!anthropicReady || busy || !input.trim()}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >送信</button>
          </div>
        </div>
      </div>

      {pendingApproval && (
        <ApprovalModal
          kind={pendingApproval.kind}
          payload={pendingApproval.payload}
          onDecide={handleApprove}
        />
      )}
    </>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.15)',
  border: '1px solid rgba(255,255,255,0.25)',
  color: '#fff',
  fontSize: 11,
  padding: '3px 6px',
  borderRadius: 4,
  cursor: 'pointer',
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
      <div
        style={{
          maxWidth: '85%',
          background: isUser ? '#dbeafe' : '#fff',
          border: `1px solid ${isUser ? '#93c5fd' : '#e2e8f0'}`,
          borderRadius: 10,
          padding: '6px 10px',
          fontSize: 12,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {msg.content}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="muted" style={{ fontSize: 10, marginTop: 4, paddingTop: 4, borderTop: '1px dashed #cbd5e1' }}>
            🔧 {msg.toolCalls.map((tc, i) => (
              <span key={i} style={{ marginRight: 6 }}>
                <code>{tc.name}</code>{tc.resultSummary && ` → ${tc.resultSummary}`}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function KnowledgeSection() {
  const { state, removeKnowledge, addKnowledge } = useAssistantStore()
  const [v, setV] = useState('')
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#166534' }}>📚 ナレッジ（{state.knowledge.length}）</div>
      <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>事業の前提知識。会話で自動参照されます。</div>
      {state.knowledge.map((k) => (
        <div key={k.id} style={{ background: '#fff', border: '1px solid #d1fae5', borderRadius: 4, padding: 4, marginBottom: 3, fontSize: 11, display: 'flex', gap: 4 }}>
          <div style={{ flex: 1 }}>{k.content}</div>
          <button
            style={{ ...iconBtnStyle, background: '#fff', color: '#64748b', border: '1px solid #cbd5e1', fontSize: 10 }}
            onClick={() => confirm('削除？') && removeKnowledge(k.id)}
          >✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="新しい前提知識..."
          style={{ flex: 1, fontSize: 11, padding: '3px 6px' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && v.trim()) { addKnowledge(v.trim()); setV('') }
          }}
        />
        <button
          disabled={!v.trim()}
          style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={() => { if (v.trim()) { addKnowledge(v.trim()); setV('') } }}
        >追加</button>
      </div>
    </div>
  )
}

function SnapshotsSection() {
  const { state, removeSnapshot } = useAssistantStore()
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#1e40af' }}>📸 plan スナップショット（{state.snapshots.length}）</div>
      <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>AI に「前と何が変わった？」と聞くための参照ポイント。</div>
      {state.snapshots.slice().reverse().map((s) => (
        <div key={s.id} style={{ background: '#fff', border: '1px solid #dbeafe', borderRadius: 4, padding: 4, marginBottom: 3, fontSize: 11, display: 'flex', gap: 4 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{s.label ?? '無題'}</div>
            <div className="muted" style={{ fontSize: 10 }}>{new Date(s.savedAt).toLocaleString('ja-JP')}</div>
            {s.reason && <div className="muted" style={{ fontSize: 10 }}>{s.reason}</div>}
          </div>
          <button
            style={{ ...iconBtnStyle, background: '#fff', color: '#64748b', border: '1px solid #cbd5e1', fontSize: 10 }}
            onClick={() => confirm('削除？') && removeSnapshot(s.id)}
          >✕</button>
        </div>
      ))}
    </div>
  )
}

function ApprovalModal({
  kind, payload, onDecide,
}: {
  kind: 'plan_update' | 'save_knowledge'
  payload: any
  onDecide: (approved: boolean) => void
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, width: '90vw', maxWidth: 640, maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ margin: '0 0 10px' }}>
          {kind === 'plan_update' ? '⚠️ plan の変更を承認しますか？' : '📚 ナレッジを保存しますか？'}
        </h3>
        {kind === 'plan_update' && (
          <>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              <strong>理由:</strong> {payload.rationale ?? '（未指定）'}
            </div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>適用する変更:</div>
            <pre style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, padding: 10, fontSize: 11, overflowX: 'auto', maxHeight: '45vh' }}>
              {JSON.stringify(payload.patch, null, 2)}
            </pre>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>※ 承認すると現在 plan をスナップショット保存してから適用します。</div>
          </>
        )}
        {kind === 'save_knowledge' && (
          <>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              <strong>内容:</strong> {payload.content}
            </div>
            {payload.tags?.length > 0 && (
              <div className="muted" style={{ fontSize: 11 }}>タグ: {payload.tags.join(', ')}</div>
            )}
          </>
        )}
        <div className="row" style={{ gap: 6, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="small ghost" onClick={() => onDecide(false)}>拒否</button>
          <button className="small" onClick={() => onDecide(true)}>承認して適用</button>
        </div>
      </div>
    </div>
  )
}
