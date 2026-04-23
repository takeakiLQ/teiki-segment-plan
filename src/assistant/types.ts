/**
 * AI アシスタント（Claude チャットボット）共通型定義
 */

import type { Plan } from '../types'

/** ユーザーが教えたナレッジ1件 */
export interface AssistantKnowledge {
  id: string
  content: string
  /** 作成日時 ISO8601 */
  createdAt: string
  /** 関連タグ（optional） */
  tags?: string[]
}

/** plan のスナップショット（時系列ログ） */
export interface PlanSnapshot {
  id: string
  /** 保存日時 */
  savedAt: string
  /** ラベル（ユーザーが任意で付ける名前、未指定なら日時） */
  label?: string
  /** 変更の要因メモ（optional） */
  reason?: string
  /** plan 全体のスナップショット。cases は含めない（容量節約） */
  plan: Plan
}

/** チャットメッセージ1件 */
export interface ChatMessage {
  id: string
  /** user / assistant */
  role: 'user' | 'assistant'
  /** 表示用の本文（Markdown 可） */
  content: string
  /** 作成日時 */
  at: string
  /** Claude が呼んだツール一覧（assistant メッセージ時） */
  toolCalls?: ToolCallRecord[]
  /** 表示をデバッグ用に小さく */
  debug?: boolean
}

/** ツール呼び出しの記録 */
export interface ToolCallRecord {
  name: string
  input: unknown
  /** 実行結果の JSON 文字列（表示用に省略可） */
  resultSummary?: string
  /** ユーザー承認が必要だったか */
  needsConfirmation?: boolean
  /** 承認されたか */
  approved?: boolean
}

/** 事業本部ごとに持つアシスタント状態 */
export interface AssistantStateForBU {
  messages: ChatMessage[]
  knowledge: AssistantKnowledge[]
  snapshots: PlanSnapshot[]
}
