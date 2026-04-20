import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info)
  }

  reset = () => {
    this.setState({ error: null })
  }

  clearLocalAndReload = () => {
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('teiki-plan:')) keysToRemove.push(key)
      }
      for (const k of keysToRemove) localStorage.removeItem(k)
      location.reload()
    } catch (e) {
      console.error(e)
      alert('クリアに失敗しました。ブラウザの開発者ツールで localStorage を手動削除してください。')
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#0f172a' }}>
          <h2 style={{ color: '#dc2626', marginTop: 0 }}>エラーが発生しました</h2>
          <pre
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              padding: 12,
              borderRadius: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              maxHeight: 240,
              overflow: 'auto',
            }}
          >
            {String(this.state.error?.stack ?? this.state.error)}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={this.clearLocalAndReload}
              style={{ background: '#0369a1', color: '#fff', border: 0, padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}
            >
              ローカルデータをクリアしてリロード
            </button>
            <button
              onClick={this.reset}
              style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}
            >
              閉じる
            </button>
          </div>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 16 }}>
            旧バージョンのデータが残っている場合は「ローカルデータをクリアしてリロード」を押してください。
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
