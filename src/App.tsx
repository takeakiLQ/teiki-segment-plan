import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { doSignOut, firebaseReady, subscribeAuth } from './firebase'
import { usePlanStore } from './store'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import MonthlyTable from './components/MonthlyTable'
import ProjectsPanel from './components/ProjectsPanel'
import WorkersPanel from './components/WorkersPanel'
import AssignmentsPanel from './components/AssignmentsPanel'
import SettingsPanel from './components/SettingsPanel'

type View = 'dashboard' | 'monthly' | 'projects' | 'workers' | 'assignments' | 'settings'

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'ダッシュボード', icon: '📊' },
  { id: 'monthly', label: '月次テーブル', icon: '📅' },
  { id: 'projects', label: '案件', icon: '📁' },
  { id: 'workers', label: '稼働者', icon: '👥' },
  { id: 'assignments', label: 'アサイン', icon: '🔗' },
  { id: 'settings', label: '設定', icon: '⚙️' },
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
        {view === 'projects' && <ProjectsPanel />}
        {view === 'workers' && <WorkersPanel />}
        {view === 'assignments' && <AssignmentsPanel />}
        {view === 'settings' && <SettingsPanel />}
      </main>
    </div>
  )
}
