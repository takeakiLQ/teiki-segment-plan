import { useState } from 'react'
import { emailSignIn, emailSignUp, googleSignIn, firebaseReady } from '../firebase'

export default function Login({ onSkip }: { onSkip: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      if (mode === 'signin') await emailSignIn(email, pw)
      else await emailSignUp(email, pw)
    } catch (e: any) {
      setErr(e?.message ?? '失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function google() {
    setErr(null)
    setLoading(true)
    try {
      await googleSignIn()
    } catch (e: any) {
      setErr(e?.message ?? 'Google ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <h1>📈 定期セグメント 月次計画</h1>
        <p>ログインすると計画をクラウド保存できます。</p>

        {!firebaseReady && (
          <div style={{ background: '#1f2937', border: '1px solid #334155', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
            Firebase 未設定です。<br />
            <code>.env</code> を設定するとログイン機能が有効になります。<br />
            未設定でもローカル保存でお試しいただけます。
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label>メールアドレス</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!firebaseReady} />
          </div>
          <div className="field">
            <label>パスワード</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required disabled={!firebaseReady} />
          </div>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={loading || !firebaseReady}>
            {mode === 'signin' ? 'ログイン' : '新規登録'}
          </button>
        </form>
        <div style={{ marginTop: 8 }}>
          <button className="ghost" style={{ width: '100%' }} onClick={google} disabled={loading || !firebaseReady}>
            Google でログイン
          </button>
        </div>

        <div className="row between" style={{ marginTop: 14 }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              setMode(mode === 'signin' ? 'signup' : 'signin')
            }}
          >
            {mode === 'signin' ? 'アカウント作成はこちら' : '既にアカウントをお持ちの方'}
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); onSkip() }} className="muted">
            ログインせずに使う
          </a>
        </div>
      </div>
    </div>
  )
}
