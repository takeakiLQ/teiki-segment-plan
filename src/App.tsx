import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { doSignOut, firebaseReady, subscribeAuth } from './firebase'
import { usePlanStore } from './store'
import { BUSINESS_UNITS, BusinessUnitOrder } from './data/businessUnits'
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const setUid = usePlanStore((s) => s.setUid)
  const dirty = usePlanStore((s) => s.dirty)
  const saveToCloud = usePlanStore((s) => s.saveToCloud)
  const businessUnit = usePlanStore((s) => s.businessUnit)
  const setBusinessUnit = usePlanStore((s) => s.setBusinessUnit)
  const bu = BUSINESS_UNITS[businessUnit]

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

  // ブラウザタブのタイトルを事業本部名に同期
  useEffect(() => {
    document.title = `${bu.fullName} 月次計画`
  }, [bu.fullName])

  // 子コンポーネント（Dashboard のリンクカード等）からの遷移リクエスト
  //  payload: { view: View, subTab?: string, anchor?: string } or just View string
  useEffect(() => {
    function handleNav(e: Event) {
      const raw = (e as CustomEvent).detail
      const payload =
        typeof raw === 'string'
          ? { view: raw as View }
          : (raw as { view: View; subTab?: string; anchor?: string })
      if (!payload?.view) return
      setView(payload.view)
      setMobileNavOpen(false)
      // 描画後にサブタブ切替 & アンカースクロール
      setTimeout(() => {
        if (payload.subTab) {
          window.dispatchEvent(new CustomEvent('nav-subtab', { detail: payload.subTab }))
        }
        if (payload.anchor) {
          const el = document.getElementById(payload.anchor)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 80)
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
    <div className={`app ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
      {/* モバイル用バックドロップ */}
      {mobileNavOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}
      <aside className="sidebar">
        <h1 style={{ color: bu.accent }}>{bu.icon} {bu.shortName}</h1>

        {/* 事業本部スイッチ */}
        <div className="bu-switcher" role="tablist" aria-label="事業本部切替">
          {BusinessUnitOrder.map((id) => {
            const meta = BUSINESS_UNITS[id]
            const active = id === businessUnit
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                className={`bu-tab ${active ? 'active' : ''}`}
                onClick={() => {
                  if (id === businessUnit) return
                  // 未保存があれば警告
                  if (dirty && !confirm('未保存の変更があります。事業本部を切り替えると、現在の編集はローカルに保存されたうえで別本部のデータを読み込みます。続けますか？')) return
                  setBusinessUnit(id)
                }}
                style={active ? { background: meta.accent, borderColor: meta.accent } : undefined}
                title={meta.fullName}
              >
                <span style={{ marginRight: 4 }}>{meta.icon}</span>{meta.shortName}
              </button>
            )
          })}
        </div>

        {NAV.map((n) => (
          <div
            key={n.id}
            className={`nav-item ${view === n.id ? 'active' : ''}`}
            onClick={() => { setView(n.id); setMobileNavOpen(false) }}
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
          <button
            className="hamburger"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label="メニューを開く"
          >
            ☰
          </button>
          <h2>
            {NAV.find((n) => n.id === view)?.label}
            <span className="muted" style={{ fontSize: 12, marginLeft: 8, fontWeight: 400 }}>
              / {bu.fullName}
            </span>
          </h2>
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
