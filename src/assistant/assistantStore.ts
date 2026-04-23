/**
 * AI アシスタントの永続状態（事業本部別）
 * - チャット履歴
 * - ユーザー教示ナレッジ
 * - plan スナップショット
 *
 * 保存:
 * - localStorage: 即時反映、オフライン時の保証
 * - Firestore:  `users/{uid}/plans/{bu}-assistant` に保存（main plan から分離、容量対策）
 *   ただし履歴が長くなった場合は cases と同様にチャンク分割する余地あり（今は単一 doc で始める）
 */

import { create } from 'zustand'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import type { AssistantKnowledge, AssistantStateForBU, ChatMessage, PlanSnapshot } from './types'
import type { BusinessUnit } from '../data/businessUnits'
import { DEFAULT_BUSINESS_UNIT } from '../data/businessUnits'
import { db, firebaseReady } from '../firebase'
import type { Plan } from '../types'

const LS_PREFIX = 'teiki-plan:assistant:'

function lsKey(uid: string | null, bu: BusinessUnit) {
  return `${LS_PREFIX}${bu}:${uid ?? 'local'}`
}

function firestoreAssistantDocId(bu: BusinessUnit): string {
  // main plan の doc id と揃える（teiki は 'main'）
  return bu === 'teiki' ? 'main-assistant' : `${bu}-assistant`
}

function emptyState(): AssistantStateForBU {
  return { messages: [], knowledge: [], snapshots: [] }
}

function loadLocal(uid: string | null, bu: BusinessUnit): AssistantStateForBU {
  try {
    const raw = localStorage.getItem(lsKey(uid, bu))
    if (!raw) return emptyState()
    const obj = JSON.parse(raw)
    return {
      messages: Array.isArray(obj.messages) ? obj.messages : [],
      knowledge: Array.isArray(obj.knowledge) ? obj.knowledge : [],
      snapshots: Array.isArray(obj.snapshots) ? obj.snapshots : [],
    }
  } catch {
    return emptyState()
  }
}

function saveLocal(uid: string | null, bu: BusinessUnit, state: AssistantStateForBU) {
  try {
    localStorage.setItem(lsKey(uid, bu), JSON.stringify(state))
  } catch {
    /* noop（容量 overflow 等） */
  }
}

async function fetchCloud(uid: string, bu: BusinessUnit): Promise<AssistantStateForBU | null> {
  if (!firebaseReady || !db) return null
  try {
    const ref = doc(db, 'users', uid, 'plans', firestoreAssistantDocId(bu))
    const snap = await getDoc(ref)
    if (!snap.exists()) return null
    const obj = snap.data() as any
    return {
      messages: Array.isArray(obj.messages) ? obj.messages : [],
      knowledge: Array.isArray(obj.knowledge) ? obj.knowledge : [],
      snapshots: Array.isArray(obj.snapshots) ? obj.snapshots : [],
    }
  } catch (e) {
    console.warn(`[assistant] (${bu}) Firestore load failed`, e)
    return null
  }
}

async function saveCloud(uid: string, bu: BusinessUnit, state: AssistantStateForBU) {
  if (!firebaseReady || !db) return
  try {
    const ref = doc(db, 'users', uid, 'plans', firestoreAssistantDocId(bu))
    await setDoc(ref, {
      ...state,
      updatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.warn(`[assistant] (${bu}) Firestore save failed`, e)
  }
}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

interface AssistantStore {
  businessUnit: BusinessUnit
  uid: string | null
  state: AssistantStateForBU
  loading: boolean
  dirty: boolean
  /** 事業本部 or uid 切替時にロード */
  setBU: (bu: BusinessUnit) => Promise<void>
  setUid: (uid: string | null) => Promise<void>
  /** messages 追加 */
  appendMessage: (msg: ChatMessage) => void
  /** 全メッセージ置き換え（履歴編集用） */
  setMessages: (msgs: ChatMessage[]) => void
  /** ナレッジ追加 */
  addKnowledge: (content: string, tags?: string[]) => AssistantKnowledge
  removeKnowledge: (id: string) => void
  /** スナップショット追加（現在 plan を渡す） */
  takeSnapshot: (plan: Plan, label?: string, reason?: string) => PlanSnapshot
  removeSnapshot: (id: string) => void
  /** 履歴クリア */
  clearMessages: () => void
  /** クラウド保存（明示ボタン） */
  saveToCloud: () => Promise<void>
  /** クラウドから再取得 */
  reloadFromCloud: () => Promise<void>
}

export const useAssistantStore = create<AssistantStore>((set, get) => ({
  businessUnit: DEFAULT_BUSINESS_UNIT,
  uid: null,
  state: loadLocal(null, DEFAULT_BUSINESS_UNIT),
  loading: false,
  dirty: false,

  setBU: async (bu) => {
    const { uid } = get()
    const local = loadLocal(uid, bu)
    set({ businessUnit: bu, state: local, dirty: false })
    if (uid) {
      const cloud = await fetchCloud(uid, bu)
      if (cloud) {
        set({ state: cloud })
        saveLocal(uid, bu, cloud)
      }
    }
  },

  setUid: async (uid) => {
    const bu = get().businessUnit
    set({ uid })
    const local = loadLocal(uid, bu)
    set({ state: local, dirty: false })
    if (uid) {
      const cloud = await fetchCloud(uid, bu)
      if (cloud) {
        set({ state: cloud })
        saveLocal(uid, bu, cloud)
      }
    }
  },

  appendMessage: (msg) => {
    const { uid, businessUnit, state } = get()
    const next = { ...state, messages: [...state.messages, msg] }
    set({ state: next, dirty: true })
    saveLocal(uid, businessUnit, next)
  },

  setMessages: (msgs) => {
    const { uid, businessUnit, state } = get()
    const next = { ...state, messages: msgs }
    set({ state: next, dirty: true })
    saveLocal(uid, businessUnit, next)
  },

  addKnowledge: (content, tags) => {
    const { uid, businessUnit, state } = get()
    const k: AssistantKnowledge = {
      id: newId(),
      content,
      tags,
      createdAt: new Date().toISOString(),
    }
    const next = { ...state, knowledge: [...state.knowledge, k] }
    set({ state: next, dirty: true })
    saveLocal(uid, businessUnit, next)
    return k
  },

  removeKnowledge: (id) => {
    const { uid, businessUnit, state } = get()
    const next = { ...state, knowledge: state.knowledge.filter((k) => k.id !== id) }
    set({ state: next, dirty: true })
    saveLocal(uid, businessUnit, next)
  },

  takeSnapshot: (plan, label, reason) => {
    const { uid, businessUnit, state } = get()
    // cases は入れない（容量対策）
    const planCopy: Plan = {
      ...plan,
      priorYear: plan.priorYear
        ? { ...plan.priorYear, cases: undefined } as any
        : undefined,
    }
    const snap: PlanSnapshot = {
      id: newId(),
      savedAt: new Date().toISOString(),
      label,
      reason,
      plan: planCopy,
    }
    // 古い snapshot は最大 50 件まで
    const nextSnaps = [...state.snapshots, snap].slice(-50)
    const next = { ...state, snapshots: nextSnaps }
    set({ state: next, dirty: true })
    saveLocal(uid, businessUnit, next)
    return snap
  },

  removeSnapshot: (id) => {
    const { uid, businessUnit, state } = get()
    const next = { ...state, snapshots: state.snapshots.filter((s) => s.id !== id) }
    set({ state: next, dirty: true })
    saveLocal(uid, businessUnit, next)
  },

  clearMessages: () => {
    const { uid, businessUnit, state } = get()
    const next = { ...state, messages: [] }
    set({ state: next, dirty: true })
    saveLocal(uid, businessUnit, next)
  },

  saveToCloud: async () => {
    const { uid, businessUnit, state } = get()
    if (!uid) return
    await saveCloud(uid, businessUnit, state)
    set({ dirty: false })
  },

  reloadFromCloud: async () => {
    const { uid, businessUnit } = get()
    if (!uid) return
    set({ loading: true })
    try {
      const cloud = await fetchCloud(uid, businessUnit)
      if (cloud) {
        set({ state: cloud, dirty: false })
        saveLocal(uid, businessUnit, cloud)
      }
    } finally {
      set({ loading: false })
    }
  },
}))
