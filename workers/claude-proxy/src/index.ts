/**
 * Claude (Anthropic) proxy on Cloudflare Workers.
 *
 * 役割:
 *   1. クライアント（GitHub Pages 上のアプリ）からのリクエストを受ける
 *   2. Firebase ID token を検証し、ログイン済みユーザーだけ通す
 *   3. Anthropic API (https://api.anthropic.com) にそのまま転送
 *   4. 応答をクライアントへ返す
 *
 * セキュリティ:
 *   - ANTHROPIC_API_KEY は Worker secret に入れる（クライアントに露出しない）
 *   - FIREBASE_PROJECT_ID も secret（verify 対象 aud/iss 検証用）
 *   - ALLOWED_ORIGINS: CORS で許可する Origin のカンマ区切りリスト
 *
 * URL 構造（Anthropic のパスを透過）:
 *   Worker: https://claude-proxy.xxx.workers.dev/v1/messages
 *   → Anthropic: https://api.anthropic.com/v1/messages
 *   同じパスがそのまま透過される
 */

import { jwtVerify, createRemoteJWKSet } from 'jose'

export interface Env {
  ANTHROPIC_API_KEY: string
  FIREBASE_PROJECT_ID: string
  ALLOWED_ORIGINS: string
}

const ANTHROPIC_BASE = 'https://api.anthropic.com'

// Firebase ID token の公開鍵（キャッシュつき）
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

async function verifyFirebaseToken(token: string, projectId: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
    algorithms: ['RS256'],
  })
  // 有効期限は jwtVerify が自動チェック
  return payload
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const allowOrigin = allowed.length === 0 || allowed.includes('*')
    ? (origin || '*')
    : (allowed.includes(origin) ? origin : allowed[0])
  // echo back: ブラウザが要求したヘッダーを丸々許可として返す（最も取りこぼしが少ない）
  const requested = request.headers.get('Access-Control-Request-Headers')
  const allowHeaders = requested && requested.length > 0
    ? requested
    : 'Authorization, Content-Type, x-api-key, anthropic-version, anthropic-beta, anthropic-dangerous-direct-browser-access'
  console.log(`[proxy] CORS request-headers: ${requested ?? '(none)'}`)
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'request-id, anthropic-ratelimit-requests-remaining, anthropic-ratelimit-tokens-remaining, x-request-id, retry-after',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin, Access-Control-Request-Headers',
  }
}

function jsonError(status: number, code: string, message: string, cors: Record<string, string>) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  })
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env)
    console.log(`[proxy] ${request.method} ${new URL(request.url).pathname} origin=${request.headers.get('Origin') ?? '-'}`)

    // CORS preflight
    //   204 ではなく 200 + 空ボディで応答（一部ブラウザ/プロキシが 204 を嫌うケース対策）
    if (request.method === 'OPTIONS') {
      return new Response('', {
        status: 200,
        headers: { ...cors, 'content-length': '0' },
      })
    }

    // ルートヘルスチェック
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'claude-proxy' }), {
        headers: { 'content-type': 'application/json', ...cors },
      })
    }

    // API エンドポイント（/v1/... 以外は拒否）
    if (!url.pathname.startsWith('/v1/')) {
      return jsonError(404, 'not_found', 'Path must start with /v1/', cors)
    }

    if (request.method !== 'POST') {
      return jsonError(405, 'method_not_allowed', 'POST のみ許可', cors)
    }

    // Firebase ID token 検証
    const authHeader = request.headers.get('Authorization')
    const match = authHeader?.match(/^Bearer (.+)$/)
    const token = match?.[1]
    if (!token) {
      console.warn('[proxy] missing auth header. all headers:', [...request.headers.keys()].join(','))
      return jsonError(401, 'missing_auth', 'Authorization: Bearer <firebase-id-token> が必要', cors)
    }
    try {
      const payload = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID)
      console.log('[proxy] auth ok, uid=', payload.sub)
    } catch (e: any) {
      console.warn('[proxy] auth fail:', e?.message ?? e, 'projectId=', env.FIREBASE_PROJECT_ID)
      return jsonError(401, 'invalid_token', `Firebase ID token 検証失敗: ${e?.message ?? e}`, cors)
    }

    // Anthropic に転送
    const targetUrl = ANTHROPIC_BASE + url.pathname + url.search
    const forwardHeaders = new Headers()
    // SDK が付けている anthropic-version や content-type を引き継ぐ
    for (const [k, v] of request.headers) {
      const lower = k.toLowerCase()
      if (lower === 'authorization') continue          // Firebase token は Anthropic には渡さない
      if (lower === 'x-api-key') continue              // クライアント側のダミーキーは破棄
      if (lower === 'host') continue
      if (lower === 'origin') continue
      if (lower === 'referer') continue
      if (lower === 'content-length') continue
      if (lower === 'cookie') continue
      forwardHeaders.set(k, v)
    }
    forwardHeaders.set('x-api-key', env.ANTHROPIC_API_KEY)
    if (!forwardHeaders.has('anthropic-version')) {
      forwardHeaders.set('anthropic-version', '2023-06-01')
    }

    let anthropicResp: Response
    try {
      anthropicResp = await fetch(targetUrl, {
        method: 'POST',
        headers: forwardHeaders,
        body: request.body,
      })
    } catch (e: any) {
      return jsonError(502, 'upstream_error', `Anthropic への接続失敗: ${e?.message ?? e}`, cors)
    }

    // Anthropic の応答に CORS を追加して返す
    const respHeaders = new Headers(anthropicResp.headers)
    for (const [k, v] of Object.entries(cors)) respHeaders.set(k, v)

    return new Response(anthropicResp.body, {
      status: anthropicResp.status,
      statusText: anthropicResp.statusText,
      headers: respHeaders,
    })
  },
}
