import { create } from 'zustand'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import type { Plan, PriorYearPlan } from './types'
import { db, firebaseReady } from './firebase'
import { addMonths, thisYm } from './utils/month'
import {
  type BusinessUnit,
  DEFAULT_BUSINESS_UNIT,
  isBusinessUnit,
} from './data/businessUnits'

/**
 * localStorage / Firestore キーの決め方（事業本部別）
 * - 定期便(teiki) は既存パスをそのまま使う（後方互換）:
 *     localStorage: teiki-plan:portfolio:{uid}
 *     Firestore   : users/{uid}/plans/main
 * - 新しい事業本部(urban 等) は別キー:
 *     localStorage: teiki-plan:portfolio:bu:{unit}:{uid}
 *     Firestore   : users/{uid}/plans/{unit}
 */
const LS_KEY_PREFIX_TEIKI = 'teiki-plan:portfolio:'
const LS_KEY_PREFIX_BU = 'teiki-plan:portfolio:bu:'
const LS_SELECTED_BU_KEY = 'teiki-plan:selectedBU'

function firestoreDocId(bu: BusinessUnit): string {
  return bu === 'teiki' ? 'main' : bu
}

function loadSelectedBU(): BusinessUnit {
  try {
    const v = localStorage.getItem(LS_SELECTED_BU_KEY)
    if (isBusinessUnit(v)) return v
  } catch {
    /* noop */
  }
  return DEFAULT_BUSINESS_UNIT
}
function saveSelectedBU(bu: BusinessUnit) {
  try {
    localStorage.setItem(LS_SELECTED_BU_KEY, bu)
  } catch {
    /* noop */
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function createEmptyPlan(name = 'メイン計画'): Plan {
  return {
    id: 'main',
    name,
    baseMonth: thisYm(),
    horizonMonths: 12,
    initialCounts: { partner: 0, vendor: 0, employment: 0 },
    // A案：単価は全カテゴリ共通。カテゴリ側は原価のみ。
    revenuePerCase: 2_500,
    categories: {
      partner:    { costModel: 'rate',   costRate: 60, costAmount: 0 },
      vendor:     { costModel: 'amount', costRate: 0,  costAmount: 1_500 },
      employment: { costModel: 'rate',   costRate: 0,  costAmount: 0 },
    },
    acquisitionRatio: { partner: 50, vendor: 35, employment: 15 },
    terminationRatio: { partner: 50, vendor: 35, employment: 15 },
    monthlyRatios: [],
    monthlyTotals: [],
    transfers: [],
    conditionChanges: [],
    costRevisions: [],
    priceRevisions: [],
    workingDaysByMonth: {},
    defaultWorkingDays: 20,
    diagonalUplift: { partner: 0, vendor: 0 },
    diagonalUpliftByMonth: [],
    meisterRevenueByMonth: {},
    meisterAllocation: { partner: 100, vendor: 0, employment: 0 },
    priceIncreases: [],
    cohortPricing: {
      priorAcquisitionUnitPrice: 0,
      acquisitionUnitPriceUpAbs: 0,
      acquisitionUnitPriceUpPct: 0,
      acquisitionProfitUplift: { partner: 0, vendor: 0, employment: 0 },
    },
    budget: {
      revenue: 0,
      grossProfit: 0,
      revenueByMonth: {},
      grossProfitByMonth: {},
    },
    updatedAt: new Date().toISOString(),
  }
}

/** 前年実績の空テンプレート（基準月の1年前から12ヶ月） */
export function createEmptyPriorYear(currentBaseMonth: string): PriorYearPlan {
  return {
    fiscalYear: 'FY前年',
    baseMonth: addMonths(currentBaseMonth, -12),
    horizonMonths: 12,
    initialCounts: { partner: 0, vendor: 0, employment: 0 },
    acquisitionRatio: { partner: 50, vendor: 35, employment: 15 },
    terminationRatio: { partner: 50, vendor: 35, employment: 15 },
    monthlyData: [],
    transfers: [],
    workingDaysByMonth: {},
    defaultWorkingDays: 20,
    diagonalUplift: { partner: 0, vendor: 0 },
    diagonalUpliftByMonth: [],
  }
}

/** サンプル：5000案件想定 */
function samplePlan(): Plan {
  const p = createEmptyPlan('サンプル計画（5000案件）')
  p.initialCounts = {
    partner: 2500,
    vendor: 1700,
    employment: 800,
  }
  // A案：単価は全カテゴリ共通。原価のみカテゴリごとに差をつける。
  p.revenuePerCase = 3_000
  p.categories = {
    partner:    { costModel: 'rate',   costRate: 65, costAmount: 0 },
    vendor:     { costModel: 'amount', costRate: 0,  costAmount: 1_750 },
    employment: { costModel: 'rate',   costRate: 0,  costAmount: 0 },
  }
  // 初期構成比に合わせて、獲得・終了の比率をセット
  p.acquisitionRatio = { partner: 50, vendor: 34, employment: 16 }
  p.terminationRatio = { partner: 50, vendor: 34, employment: 16 }
  return p
}

interface PlanStore {
  businessUnit: BusinessUnit
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
  setBusinessUnit: (bu: BusinessUnit) => Promise<void>
}

function lsKey(uid: string | null, bu: BusinessUnit) {
  // teiki は後方互換のため旧プレフィックスを使う
  if (bu === 'teiki') return `${LS_KEY_PREFIX_TEIKI}${uid ?? 'local'}`
  return `${LS_KEY_PREFIX_BU}${bu}:${uid ?? 'local'}`
}

/** 新しいスキーマの Plan かどうかチェック。 */
function isValidPlan(obj: any): obj is Plan {
  if (!obj || typeof obj !== 'object') return false
  if (!obj.initialCounts || typeof obj.initialCounts !== 'object') return false
  if (!obj.categories || typeof obj.categories !== 'object') return false
  if (!obj.acquisitionRatio || typeof obj.acquisitionRatio !== 'object') return false
  if (!obj.terminationRatio || typeof obj.terminationRatio !== 'object') return false
  if (!Array.isArray(obj.monthlyTotals)) return false
  if (!Array.isArray(obj.transfers)) return false
  if (!Array.isArray(obj.conditionChanges)) return false
  const cats = ['partner', 'vendor', 'employment']
  for (const c of cats) {
    if (typeof obj.initialCounts[c] !== 'number') return false
    if (!obj.categories[c]) return false
    if (typeof obj.acquisitionRatio[c] !== 'number') return false
    if (typeof obj.terminationRatio[c] !== 'number') return false
  }
  return true
}

/** 古い Plan を新フィールド付きに寄せる */
function migratePlan(plan: any): Plan {
  if (!Array.isArray(plan.monthlyRatios)) plan.monthlyRatios = []
  if (!plan.workingDaysByMonth || typeof plan.workingDaysByMonth !== 'object') plan.workingDaysByMonth = {}
  if (typeof plan.defaultWorkingDays !== 'number' || plan.defaultWorkingDays <= 0) plan.defaultWorkingDays = 20
  if (!plan.budget || typeof plan.budget !== 'object') {
    plan.budget = { revenue: 0, grossProfit: 0, revenueByMonth: {}, grossProfitByMonth: {} }
  } else {
    if (typeof plan.budget.revenue !== 'number') plan.budget.revenue = 0
    if (typeof plan.budget.grossProfit !== 'number') plan.budget.grossProfit = 0
    if (!plan.budget.revenueByMonth || typeof plan.budget.revenueByMonth !== 'object') plan.budget.revenueByMonth = {}
    if (!plan.budget.grossProfitByMonth || typeof plan.budget.grossProfitByMonth !== 'object') plan.budget.grossProfitByMonth = {}
  }

  // A案: revenuePerCase を Plan レベルに引き上げ
  if (typeof plan.revenuePerCase !== 'number' || plan.revenuePerCase <= 0) {
    const derived = plan.categories?.partner?.revenuePerCase
      ?? plan.categories?.vendor?.revenuePerCase
      ?? plan.categories?.employment?.revenuePerCase
      ?? 0
    plan.revenuePerCase = derived > 0 ? derived : 3000
  }
  // カテゴリ側の revenuePerCase は無害だが、旧データを掃除
  if (plan.categories && typeof plan.categories === 'object') {
    for (const cat of ['partner', 'vendor', 'employment']) {
      if (plan.categories[cat]) delete plan.categories[cat].revenuePerCase
    }
  }
  // ConditionChange: newRevenuePerCase が入っていれば category='revenue' に付け替え
  if (Array.isArray(plan.conditionChanges)) {
    for (const c of plan.conditionChanges) {
      if (c && typeof c.newRevenuePerCase === 'number' && c.newRevenuePerCase > 0 && c.category !== 'revenue') {
        c.category = 'revenue'
      }
    }
  }

  // 同区分入替 uplift 設定のデフォルト
  if (!plan.diagonalUplift || typeof plan.diagonalUplift !== 'object') {
    plan.diagonalUplift = { partner: 0, vendor: 0 }
  } else {
    if (typeof plan.diagonalUplift.partner !== 'number' || plan.diagonalUplift.partner < 0) plan.diagonalUplift.partner = 0
    if (typeof plan.diagonalUplift.vendor !== 'number' || plan.diagonalUplift.vendor < 0) plan.diagonalUplift.vendor = 0
  }
  if (!Array.isArray(plan.diagonalUpliftByMonth)) plan.diagonalUpliftByMonth = []
  if (!plan.meisterRevenueByMonth || typeof plan.meisterRevenueByMonth !== 'object') {
    plan.meisterRevenueByMonth = {}
  }
  if (!plan.meisterAllocation || typeof plan.meisterAllocation !== 'object') {
    plan.meisterAllocation = { partner: 100, vendor: 0, employment: 0 }
  } else {
    if (typeof plan.meisterAllocation.partner !== 'number') plan.meisterAllocation.partner = 100
    if (typeof plan.meisterAllocation.vendor !== 'number') plan.meisterAllocation.vendor = 0
    if (typeof plan.meisterAllocation.employment !== 'number') plan.meisterAllocation.employment = 0
  }
  if (!Array.isArray(plan.priceIncreases)) plan.priceIncreases = []
  if (!Array.isArray(plan.costRevisions)) plan.costRevisions = []
  if (!Array.isArray(plan.priceRevisions)) plan.priceRevisions = []
  if (!plan.cohortPricing || typeof plan.cohortPricing !== 'object') {
    plan.cohortPricing = {
      priorAcquisitionUnitPrice: 0,
      acquisitionUnitPriceUpAbs: 0,
      acquisitionUnitPriceUpPct: 0,
      acquisitionProfitUplift: { partner: 0, vendor: 0, employment: 0 },
    }
  } else {
    const cp = plan.cohortPricing
    if (typeof cp.priorAcquisitionUnitPrice !== 'number') cp.priorAcquisitionUnitPrice = 0
    if (typeof cp.acquisitionUnitPriceUpAbs !== 'number') cp.acquisitionUnitPriceUpAbs = 0
    if (typeof cp.acquisitionUnitPriceUpPct !== 'number') cp.acquisitionUnitPriceUpPct = 0
    if (!cp.acquisitionProfitUplift || typeof cp.acquisitionProfitUplift !== 'object') {
      cp.acquisitionProfitUplift = { partner: 0, vendor: 0, employment: 0 }
    } else {
      const u = cp.acquisitionProfitUplift
      if (typeof u.partner !== 'number') u.partner = 0
      if (typeof u.vendor !== 'number') u.vendor = 0
      if (typeof u.employment !== 'number') u.employment = 0
    }
  }

  if (plan.priorYear) {
    if (!plan.priorYear.workingDaysByMonth || typeof plan.priorYear.workingDaysByMonth !== 'object') plan.priorYear.workingDaysByMonth = {}
    if (typeof plan.priorYear.defaultWorkingDays !== 'number' || plan.priorYear.defaultWorkingDays <= 0) plan.priorYear.defaultWorkingDays = 20
    if (!plan.priorYear.diagonalUplift || typeof plan.priorYear.diagonalUplift !== 'object') {
      plan.priorYear.diagonalUplift = { partner: 0, vendor: 0 }
    } else {
      if (typeof plan.priorYear.diagonalUplift.partner !== 'number' || plan.priorYear.diagonalUplift.partner < 0) plan.priorYear.diagonalUplift.partner = 0
      if (typeof plan.priorYear.diagonalUplift.vendor !== 'number' || plan.priorYear.diagonalUplift.vendor < 0) plan.priorYear.diagonalUplift.vendor = 0
    }
    if (!Array.isArray(plan.priorYear.diagonalUpliftByMonth)) plan.priorYear.diagonalUpliftByMonth = []
  }
  return plan as Plan
}

function loadLocal(uid: string | null, bu: BusinessUnit): Plan | null {
  try {
    const raw = localStorage.getItem(lsKey(uid, bu))
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!isValidPlan(obj)) {
      console.warn(`[teiki-plan] (${bu}) 旧スキーマを検出したのでサンプルを使用します`)
      return null
    }
    return migratePlan(obj)
  } catch (e) {
    console.warn(`[teiki-plan] (${bu}) localStorage 読込エラー:`, e)
    return null
  }
}
function saveLocal(uid: string | null, plan: Plan, bu: BusinessUnit) {
  try {
    localStorage.setItem(lsKey(uid, bu), JSON.stringify(plan))
  } catch {
    /* noop */
  }
}

async function fetchCloudPlan(uid: string, bu: BusinessUnit): Promise<Plan | null> {
  if (!firebaseReady || !db) return null
  try {
    const ref = doc(db, 'users', uid, 'plans', firestoreDocId(bu))
    const snap = await getDoc(ref)
    if (!snap.exists()) return null
    const data = snap.data()
    if (!isValidPlan(data)) {
      console.warn(`[teiki-plan] (${bu}) Firestore に旧スキーマが残っています。`)
      return null
    }
    return migratePlan(data)
  } catch (e) {
    console.warn(`[teiki-plan] (${bu}) Firestore load failed`, e)
    return null
  }
}

const INITIAL_BU: BusinessUnit = loadSelectedBU()

export const usePlanStore = create<PlanStore>((set, get) => ({
  businessUnit: INITIAL_BU,
  plan: loadLocal(null, INITIAL_BU) ?? samplePlan(),
  uid: null,
  loading: false,
  dirty: false,

  setUid: async (uid) => {
    const bu = get().businessUnit
    set({ uid, loading: true })
    const local = loadLocal(uid, bu)
    if (local) set({ plan: local })
    if (uid) {
      const cloud = await fetchCloudPlan(uid, bu)
      if (cloud) {
        set({ plan: cloud })
        saveLocal(uid, cloud, bu)
      }
    }
    set({ loading: false, dirty: false })
  },

  setPlan: (updater) => {
    const next = updater(get().plan)
    next.updatedAt = new Date().toISOString()
    set({ plan: next, dirty: true })
    saveLocal(get().uid, next, get().businessUnit)
  },

  replacePlan: (next) => {
    next.updatedAt = new Date().toISOString()
    set({ plan: next, dirty: true })
    saveLocal(get().uid, next, get().businessUnit)
  },

  saveToCloud: async () => {
    const { uid, plan, businessUnit } = get()
    if (!uid || !firebaseReady || !db) {
      set({ dirty: false })
      return
    }
    const ref = doc(db, 'users', uid, 'plans', firestoreDocId(businessUnit))
    await setDoc(ref, plan)
    set({ dirty: false })
  },

  loadFromCloud: async () => {
    const { uid, businessUnit } = get()
    if (!uid) return
    const cloud = await fetchCloudPlan(uid, businessUnit)
    if (cloud) {
      set({ plan: cloud })
      saveLocal(uid, cloud, businessUnit)
    }
  },

  resetToSample: () => {
    const p = samplePlan()
    set({ plan: p, dirty: true })
    saveLocal(get().uid, p, get().businessUnit)
  },

  setBusinessUnit: async (bu) => {
    const { uid, plan, businessUnit: cur } = get()
    if (bu === cur) return
    // 現在の plan を現事業本部のスロットに保存しておく（未保存分も失わない）
    saveLocal(uid, plan, cur)
    saveSelectedBU(bu)

    // 次の事業本部の plan をローカルから先にロード（即時反映）
    const local = loadLocal(uid, bu)
    set({
      businessUnit: bu,
      plan: local ?? samplePlan(),
      dirty: false,
      loading: !!uid,
    })

    // クラウドからも上書き取得
    if (uid) {
      const cloud = await fetchCloudPlan(uid, bu)
      if (cloud) {
        set({ plan: cloud })
        saveLocal(uid, cloud, bu)
      }
      set({ loading: false })
    }
  },
}))

export { uid as newId }
