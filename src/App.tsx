import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { doSignOut, firebaseReady, subscribeAuth } from './firebase'
import { usePlanStore } from './store'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import MonthlyTable from './components/MonthlyTable'
import CategoriesPanel from './components/CategoriesPanel'
import EventsPanel from './components/EventsPanel'
import PriorYearPanel from './components/PriorYearPanel'
import SettingsPanel from './components/SettingsPanel'

type View = 'dashboard' | 'monthly' | 'categories' | 'events' | 'priorYear' | 'settings'

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'ダッシュボード', icon: '📊' },
  { id: 'monthly', label: '月次テーブル', icon: '📅' },
  { id: 'categories', label: 'カテゴリ設定', icon: '🧮' },
  { id: 'events', label: '月次イベント', icon: '🔀' },
  { id: 'priorYear', label: '前年実績', icon: '📆' },
  { id: 'settings', label: '計画設定', icon: '⚙️' },
]

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [guestMode, setGuestMode] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [saving, setSaving] = useState(false)

  const setUid = usePlanStore((s) => s.setUid)
  const dirty = usePlanStore((s) => s.dirty)
  const saveToCloud = usePlanStore((s) => s.saveToCloud)

  useEffect(() => {
    const unsub = subscribeAuth((u) => {
      setUser(u)
      setAuthReady(true)
      if (u) {
        setGuestMode(false)
        setUid(u.uid)
      } else {
        setUid(null)
      }
    })
    return () => unsub()
  }, [setUid])

  // 子コンポーネント（Dashboard のリンクカード等）からの遷移リクエスト
  useEffect(() => {
    function handleNav(e: Event) {
      const detail = (e as CustomEvent).detail as View
      if (detail) setView(detail)
    }
    window.addEventListener('navigate-to-view', handleNav)
    return () => window.removeEventListener('navigate-to-view', handleNav)
  }, [])

  if (!authReady && firebaseReady) {
    return <div className="login-wrap"><div className="muted">読み込み中…</div></div>
  }

  if (!user && !guestMode) {
    return <Login onSkip={() => setGuestMode(true)} />
  }

  async function onSave() {
    if (!user) { alert('ログインすると計画をクラウドに保存できます。'); return }
    setSaving(true)
    try {
      await saveToCloud()
    } catch (e: any) {
      alert('保存に失敗しました: ' + (e?.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>📈 定期セグメント</h1>
        {NAV.map((n) => (
          <div
            key={n.id}
            className={`nav-item ${view === n.id ? 'active' : ''}`}
            onClick={() => setView(n.id)}
          >
            <span style={{ marginRight: 8 }}>{n.icon}</span>{n.label}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="muted" style={{ fontSize: 11, padding: 8 }}>
          {user ? `ログイン: ${user.email ?? user.uid.slice(0, 8)}` : 'ゲストモード（ローカル保存のみ）'}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h2>{NAV.find((n) => n.id === view)?.label}</h2>
          <div className="user">
            {dirty && <span style={{ color: '#d97706' }}>● 未保存の変更</span>}
            {user ? (
              <>
                <button className="small" onClick={onSave} disabled={saving}>
                  {saving ? '保存中…' : 'クラウドに保存'}
                </button>
                <button className="small ghost" onClick={() => doSignOut()}>ログアウト</button>
              </>
            ) : (
              <button className="small ghost" onClick={() => setGuestMode(false)}>
                ログイン
              </button>
            )}
          </div>
        </div>

        {view === 'dashboard' && <Dashboard />}
        {view === 'monthly' && <MonthlyTable />}
        {view === 'categories' && <CategoriesPanel />}
        {view === 'events' && <EventsPanel />}
        {view === 'priorYear' && <PriorYearPanel />}
        {view === 'settings' && <SettingsPanel />}
      </main>
    </div>
  )
}
