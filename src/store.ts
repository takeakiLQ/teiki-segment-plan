import { create } from 'zustand'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import type { Plan } from './types'
import { db, firebaseReady } from './firebase'
import { thisYm } from './utils/month'

const LS_KEY_PREFIX = 'teiki-plan:'

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function createEmptyPlan(name = 'メイン計画'): Plan {
  return {
    id: 'main',
    name,
    baseMonth: thisYm(),
    horizonMonths: 12,
    categoryDefaults: {
      partner: 60,
      vendor: 70,
      dposition: 50,
      fs: 55,
    },
    projects: [],
    workers: [],
    assignments: [],
    updatedAt: new Date().toISOString(),
  }
}

function samplePlan(): Plan {
  const base = thisYm()
  const p: Plan = createEmptyPlan('サンプル計画')
  const proj1 = { id: uid(), name: 'A社 運用支援', client: 'A社', startMonth: base, endMonth: null, unitPrice: 1_200_000, priceChanges: [] }
  const proj2 = { id: uid(), name: 'B社 基盤保守', client: 'B社', startMonth: base, endMonth: null, unitPrice: 800_000, priceChanges: [] }
  p.projects = [proj1, proj2]
  const w1 = { id: uid(), name: '山田', category: 'partner' as const, monthlyCost: 700_000, costChanges: [] }
  const w2 = { id: uid(), name: '佐藤', category: 'vendor' as const, monthlyCost: 600_000, costChanges: [] }
  const w3 = { id: uid(), name: '田中', category: 'dposition' as const, monthlyCost: 400_000, costChanges: [] }
  p.workers = [w1, w2, w3]
  p.assignments = [
    { id: uid(), projectId: proj1.id, workerId: w1.id, startMonth: base, endMonth: null },
    { id: uid(), projectId: proj1.id, workerId: w3.id, startMonth: base, endMonth: null },
    { id: uid(), projectId: proj2.id, workerId: w2.id, startMonth: base, endMonth: null },
  ]
  return p
}

interface PlanStore {
  plan: Plan
  uid: string | null
  loading: boolean
  dirty: boolean
  setUid: (uid: string | null) => Promise<void>
  setPlan: (updater: (draft: Plan) => Plan) => void
  replacePlan: (next: Plan) => void
  saveToCloud: () => Promise<void>
  loadFromCloud: () => Promise<void>
  resetToSample: () => void
}

function lsKey(uid: string | null) {
  return `${LS_KEY_PREFIX}${uid ?? 'local'}`
}
function loadLocal(uid: string | null): Plan | null {
  try {
    const raw = localStorage.getItem(lsKey(uid))
    if (!raw) return null
    return JSON.parse(raw) as Plan
  } catch {
    return null
  }
}
function saveLocal(uid: string | null, plan: Plan) {
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify(plan))
  } catch {
    /* noop */
  }
}

export const usePlanStore = create<PlanStore>((set, get) => ({
  plan: loadLocal(null) ?? samplePlan(),
  uid: null,
  loading: false,
  dirty: false,

  setUid: async (uid) => {
    set({ uid, loading: true })
    // ローカルに該当 uid のデータがあればまず読む
    const local = loadLocal(uid)
    if (local) set({ plan: local })
    // クラウドから上書き試行
    if (uid && firebaseReady && db) {
      try {
        const ref = doc(db, 'users', uid, 'plans', 'main')
        const snap = await getDoc(ref)
        if (snap.exists()) {
          const plan = snap.data() as Plan
          set({ plan })
          saveLocal(uid, plan)
        }
      } catch (e) {
        console.warn('Firestore load failed', e)
      }
    }
    set({ loading: false, dirty: false })
  },

  setPlan: (updater) => {
    const next = updater(get().plan)
    next.updatedAt = new Date().toISOString()
    set({ plan: next, dirty: true })
    saveLocal(get().uid, next)
  },

  replacePlan: (next) => {
    next.updatedAt = new Date().toISOString()
    set({ plan: next, dirty: true })
    saveLocal(get().uid, next)
  },

  saveToCloud: async () => {
    const { uid, plan } = get()
    if (!uid || !firebaseReady || !db) {
      set({ dirty: false })
      return
    }
    const ref = doc(db, 'users', uid, 'plans', 'main')
    await setDoc(ref, plan)
    set({ dirty: false })
  },

  loadFromCloud: async () => {
    const { uid } = get()
    if (!uid || !firebaseReady || !db) return
    const ref = doc(db, 'users', uid, 'plans', 'main')
    const snap = await getDoc(ref)
    if (snap.exists()) {
      const plan = snap.data() as Plan
      set({ plan })
      saveLocal(uid, plan)
    }
  },

  resetToSample: () => {
    const p = samplePlan()
    set({ plan: p, dirty: true })
    saveLocal(get().uid, p)
  },
}))

export { uid as newId }
