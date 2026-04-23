/**
 * Claude (Anthropic) API クライアント。
 *
 * 推奨構成（proxy 経由）:
 *   VITE_CLAUDE_PROXY_URL=https://claude-proxy.xxx.workers.dev
 *   → Worker が Firebase ID token を検証してから Anthropic に転送
 *   → API キーは Worker secret に保管（クライアントには露出しない）
 *
 * 後方互換（直接モード・非推奨）:
 *   VITE_ANTHROPIC_API_KEY=sk-ant-...
 *   → キーがクライアントバンドルに埋め込まれる
 */

import Anthropic from '@anthropic-ai/sdk'
import { auth } from '../firebase'

const PROXY_URL = (import.meta.env.VITE_CLAUDE_PROXY_URL as string | undefined)?.trim()
const DIRECT_KEY = (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined)?.trim()
export const ANTHROPIC_MODEL = (import.meta.env.VITE_ANTHROPIC_MODEL as string) || 'claude-sonnet-4-6'

/** proxy モードか直接モードか */
export const anthropicMode: 'proxy' | 'direct' | 'none' = PROXY_URL
  ? 'proxy'
  : (DIRECT_KEY && DIRECT_KEY.startsWith('sk-ant-') ? 'direct' : 'none')

export const anthropicReady = anthropicMode !== 'none'

let _client: Anthropic | null = null

export function getAnthropic(): Anthropic {
  if (_client) return _client

  if (anthropicMode === 'proxy') {
    // Worker 経由: Firebase ID token を Authorization ヘッダで毎回送信
    _client = new Anthropic({
      baseURL: PROXY_URL,
      apiKey: 'proxy-managed',  // Worker 側で実キーに置換されるのでダミー
      dangerouslyAllowBrowser: true,
      // SDK が使う fetch をラップして Firebase トークンを動的に注入
      fetch: (async (input: any, init?: any) => {
        const headers = new Headers(init?.headers)
        const user = auth?.currentUser
        if (user) {
          const token = await user.getIdToken()
          headers.set('Authorization', `Bearer ${token}`)
        }
        return fetch(input, { ...init, headers })
      }) as any,
    })
    return _client
  }

  if (anthropicMode === 'direct') {
    _client = new Anthropic({
      apiKey: DIRECT_KEY as string,
      dangerouslyAllowBrowser: true,
    })
    return _client
  }

  throw new Error(
    '[Anthropic] Claude API が未設定です。.env に VITE_CLAUDE_PROXY_URL または VITE_ANTHROPIC_API_KEY を設定してください。',
  )
}
