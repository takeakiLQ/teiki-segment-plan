/**
 * Claude とのチャットループ。tool use を含む。
 *
 * 利用側のフロー:
 *   1. `runTurn` を呼ぶと (a) Claude にメッセージを送信 (b) tool_use が返れば自動実行 (c) 結果を返して再度 Claude に投げる…を
 *      `propose_plan_update` などの承認が必要なツール or 最終テキストメッセージまで繰り返す
 *   2. 途中で承認が必要になった場合は `pendingApproval` を含むイベントを返してループを中断
 *   3. ユーザーが UI で承認 or 拒否 → 結果を再度 Claude に投げて続行（`continueAfterApproval`）
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { Plan } from '../types'
import { getAnthropic, ANTHROPIC_MODEL } from './anthropicClient'
import { ASSISTANT_TOOLS, executeTool, type ToolContext, type ToolName } from './tools'
import { buildSystemPrompt } from './context'
import type { AssistantKnowledge, ChatMessage, PlanSnapshot, ToolCallRecord } from './types'
import type { BusinessUnit } from '../data/businessUnits'

export interface RunTurnArgs {
  /** 今までの会話履歴（UI 用の ChatMessage 形式）＋ユーザー新規メッセージ含む */
  history: ChatMessage[]
  /** ユーザーの新規メッセージ本文 */
  userMessage: string
  plan: Plan
  businessUnit: BusinessUnit
  knowledge: AssistantKnowledge[]
  snapshots: PlanSnapshot[]
  /** ツール実行のたびに UI 更新するためのコールバック */
  onToolCall?: (record: ToolCallRecord) => void
}

export type TurnResult =
  | {
      kind: 'message'
      text: string
      toolCalls: ToolCallRecord[]
      /** 次回継続用の内部ステート（Anthropic messages 配列を引き継ぐ） */
      rawMessages: Anthropic.MessageParam[]
    }
  | {
      kind: 'needs_approval'
      pending: { kind: 'plan_update' | 'save_knowledge'; payload: any; toolUseId: string; toolName: ToolName }
      interimText: string
      toolCalls: ToolCallRecord[]
      /** 承認/拒否決定後に continueAfterApproval に渡す */
      rawMessages: Anthropic.MessageParam[]
    }
  | {
      kind: 'error'
      error: string
    }

/** UI の ChatMessage 履歴を Anthropic 形式に変換（tool 呼び出しは省略してテキストのみ） */
function historyToMessages(history: ChatMessage[]): Anthropic.MessageParam[] {
  return history
    .filter((m) => !m.debug)
    .map((m) => ({ role: m.role, content: m.content }))
}

/** 新規ターン実行 */
export async function runTurn(args: RunTurnArgs): Promise<TurnResult> {
  const client = getAnthropic()
  const system = buildSystemPrompt({ plan: args.plan, businessUnit: args.businessUnit, knowledge: args.knowledge })

  const messages: Anthropic.MessageParam[] = [
    ...historyToMessages(args.history),
    { role: 'user', content: args.userMessage },
  ]

  return await runLoop({
    client,
    system,
    messages,
    ctx: { plan: args.plan, knowledge: args.knowledge, snapshots: args.snapshots },
    onToolCall: args.onToolCall,
  })
}

export async function continueAfterApproval(args: {
  /** 承認 or 拒否前のチャット状態 */
  rawMessages: Anthropic.MessageParam[]
  /** 承認待ちだった tool_use の ID */
  toolUseId: string
  toolName: ToolName
  /** 承認されたかどうか。true なら payload を「適用済み」として Claude に通知 */
  approved: boolean
  /** 最終的に適用された内容の JSON（または拒否理由） */
  applicationResult: any
  plan: Plan
  businessUnit: BusinessUnit
  knowledge: AssistantKnowledge[]
  snapshots: PlanSnapshot[]
  onToolCall?: (record: ToolCallRecord) => void
}): Promise<TurnResult> {
  const client = getAnthropic()
  const system = buildSystemPrompt({ plan: args.plan, businessUnit: args.businessUnit, knowledge: args.knowledge })

  // tool_result を return するメッセージを追加
  const toolResultContent = JSON.stringify({
    approved: args.approved,
    result: args.applicationResult,
    note: args.approved
      ? 'ユーザーが承認し、plan に適用されました。'
      : 'ユーザーが拒否しました。次の提案または別の方法を考えてください。',
  })

  const nextMessages: Anthropic.MessageParam[] = [
    ...args.rawMessages,
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: args.toolUseId,
          content: toolResultContent,
        },
      ],
    },
  ]

  return await runLoop({
    client,
    system,
    messages: nextMessages,
    ctx: { plan: args.plan, knowledge: args.knowledge, snapshots: args.snapshots },
    onToolCall: args.onToolCall,
  })
}

/** tool use ループ。max_iter まで繰り返し、テキスト応答 or 承認待ちで return */
async function runLoop(args: {
  client: Anthropic
  system: string
  messages: Anthropic.MessageParam[]
  ctx: ToolContext
  onToolCall?: (record: ToolCallRecord) => void
  maxIter?: number
}): Promise<TurnResult> {
  const { client, system, ctx, onToolCall } = args
  const maxIter = args.maxIter ?? 8
  let messages = [...args.messages]
  const toolCalls: ToolCallRecord[] = []

  for (let iter = 0; iter < maxIter; iter++) {
    let resp: Anthropic.Message
    try {
      resp = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system,
        tools: ASSISTANT_TOOLS as any,
        messages,
      })
    } catch (e: any) {
      return { kind: 'error', error: e?.message ?? String(e) }
    }

    // stop_reason に応じて分岐
    if (resp.stop_reason === 'end_turn' || resp.stop_reason === 'stop_sequence') {
      const text = extractText(resp)
      messages = [...messages, { role: 'assistant', content: resp.content }]
      return { kind: 'message', text, toolCalls, rawMessages: messages }
    }

    if (resp.stop_reason === 'tool_use') {
      // tool_use ブロックを処理
      const toolUseBlocks = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
      const textBlocks = resp.content.filter((c): c is Anthropic.TextBlock => c.type === 'text')
      const interimText = textBlocks.map((b) => b.text).join('\n').trim()

      // assistant メッセージを会話に積む
      messages = [...messages, { role: 'assistant', content: resp.content }]

      // 各 tool_use を実行
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const t of toolUseBlocks) {
        const name = t.name as ToolName
        const input = t.input as any
        let result
        try {
          result = await executeTool(name, input, ctx)
        } catch (e: any) {
          result = {
            resultJSON: JSON.stringify({ error: e?.message ?? String(e) }),
            summary: `エラー: ${e?.message ?? e}`,
          }
        }

        const record: ToolCallRecord = {
          name,
          input,
          resultSummary: result.summary,
          needsConfirmation: !!result.pendingApproval,
          approved: undefined,
        }
        toolCalls.push(record)
        onToolCall?.(record)

        if (result.pendingApproval) {
          // 承認待ち → ループを抜けて UI に返す
          return {
            kind: 'needs_approval',
            interimText,
            toolCalls,
            rawMessages: messages,
            pending: {
              kind: result.pendingApproval.kind,
              payload: result.pendingApproval.payload,
              toolUseId: t.id,
              toolName: name,
            },
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: t.id,
          content: result.resultJSON,
        })
      }

      // tool_result を user メッセージとして追加
      messages = [
        ...messages,
        { role: 'user', content: toolResults },
      ]

      // 次のイテレーションで Claude が続きを考える
      continue
    }

    // 想定外の stop_reason
    const text = extractText(resp)
    messages = [...messages, { role: 'assistant', content: resp.content }]
    return { kind: 'message', text, toolCalls, rawMessages: messages }
  }

  return { kind: 'error', error: 'tool use が max_iter に到達しました' }
}

function extractText(resp: Anthropic.Message): string {
  const blocks = resp.content.filter((c): c is Anthropic.TextBlock => c.type === 'text')
  return blocks.map((b) => b.text).join('\n').trim()
}
