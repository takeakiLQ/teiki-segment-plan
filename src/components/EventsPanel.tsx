import { Fragment, useEffect, useMemo, useState } from 'react'
import { newId, usePlanStore } from '../store'
import type {
  ConditionChange,
  CostModel,
  CostRevision,
  MonthlyDiagonalUpliftOverride,
  MonthlyRatioOverride,
  MonthlyTotal,
  PriceIncrease,
  PriceRevision,
  Ratios,
  WorkerCategory,
} from '../types'
import { WorkerCategoryLabels, WorkerCategoryOrder } from '../types'
import {
  ALL_TRANSFER_PAIRS,
  computePriorYearEndCounts,
  costUpliftFactor,
  cumulativeDiagonalCount,
  cumulativeNonDiagonalCount,
  cumulativePriceIncreaseAt,
  diagonalCount,
  distributeIntegers,
  effectiveDiagonalUpliftAt,
  effectiveRatio,
  getTransferAmount,
  monthlyNewPriceIncreaseAt,
  nonDiagonalProfitPerCasePerDay,
  priorYm,
  ratioSum,
  totalInflow,
  totalOutflow,
  upsertTransferCell,
  workingDaysOf,
  yen,
} from '../utils/calculations'
import { addMonths, formatYmShort, monthsRange } from '../utils/month'
import { MeisterCard } from './SettingsPanel'

type Tab = 'flow' | 'ratio' | 'transfer' | 'priceup' | 'meister' | 'costrev' | 'pricerev' | 'condition'

export default function EventsPanel() {
  const [tab, setTab] = useState<Tab>('flow')
  // Dashboard のリンクカードからサブタブ切替指示を受け取る
  useEffect(() => {
    function onSubtab(e: Event) {
      const detail = (e as CustomEvent).detail
      if (typeof detail === 'string' && ['flow','ratio','transfer','priceup','meister','costrev','pricerev','condition'].includes(detail)) {
        setTab(detail as Tab)
      }
    }
    window.addEventListener('nav-subtab', onSubtab)
    return () => window.removeEventListener('nav-subtab', onSubtab)
  }, [])
  return (
    <div>
      <div className="row" style={{ marginBottom: 12, gap: 6, flexWrap: 'wrap' }}>
        <TabButton active={tab === 'flow'} onClick={() => setTab('flow')}>獲得 / 終了</TabButton>
        <TabButton active={tab === 'ratio'} onClick={() => setTab('ratio')}>配車比率（月別）</TabButton>
        <TabButton active={tab === 'transfer'} onClick={() => setTab('transfer')}>入替</TabButton>
        <TabButton active={tab === 'priceup'} onClick={() => setTab('priceup')}>単価アップ</TabButton>
        <TabButton active={tab === 'meister'} onClick={() => setTab('meister')}>マイスター</TabButton>
        <TabButton active={tab === 'costrev'} onClick={() => setTab('costrev')}>原価改定</TabButton>
        <TabButton active={tab === 'pricerev'} onClick={() => setTab('pricerev')}>単価改定</TabButton>
        <TabButton active={tab === 'condition'} onClick={() => setTab('condition')}>条件変更（全体）</TabButton>
      </div>
      {tab === 'flow' && <FlowsPanel />}
      {tab === 'ratio' && <RatioPanel />}
      {tab === 'transfer' && <TransfersList />}
      {tab === 'priceup' && <PriceIncreasesList />}
      {tab === 'meister' && <MeisterCard />}
      {tab === 'costrev' && <CostRevisionsList />}
      {tab === 'pricerev' && <PriceRevisionsList />}
      {tab === 'condition' && <ConditionChangesList />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={active ? '' : 'ghost'}
      onClick={onClick}
      style={{ padding: '6px 12px', fontSize: 13 }}
    >
      {children}
    </button>
  )
}

/* ====================================================
   配車比率（デフォルト + 月別オーバーライド）
   ==================================================== */
function RatioPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  const acqSum = ratioSum(plan.acquisitionRatio)
  const termSum = ratioSum(plan.terminationRatio)

  function updateDefault(kind: 'acquisitionRatio' | 'terminationRatio', cat: WorkerCategory, v: number) {
    setPlan((p) => ({ ...p, [kind]: { ...p[kind], [cat]: Math.max(0, v) } }))
  }

  function normalize(kind: 'acquisitionRatio' | 'terminationRatio') {
    setPlan((p) => {
      const r = p[kind]
      const sum = ratioSum(r)
      if (sum <= 0) return p
      const next: Ratios = {
        partner: Math.round((r.partner / sum) * 100),
        vendor: Math.round((r.vendor / sum) * 100),
        employment: Math.round((r.employment / sum) * 100),
      }
      const diff = 100 - (next.partner + next.vendor + next.employment)
      next.partner += diff
      return { ...p, [kind]: next }
    })
  }

  function copyFromInitial(kind: 'acquisitionRatio' | 'terminationRatio') {
    setPlan((p) => {
      const total = p.initialCounts.partner + p.initialCounts.vendor + p.initialCounts.employment
      if (total <= 0) return p
      const next: Ratios = {
        partner: Math.round((p.initialCounts.partner / total) * 100),
        vendor: Math.round((p.initialCounts.vendor / total) * 100),
        employment: Math.round((p.initialCounts.employment / total) * 100),
      }
      const diff = 100 - (next.partner + next.vendor + next.employment)
      next.partner += diff
      return { ...p, [kind]: next }
    })
  }

  /** 前年末（2026-03）の案件構成比を 獲得/終了 の両方のデフォルト配車比率にまとめて反映 */
  function applyFromPriorYearEnd() {
    if (!plan.priorYear) {
      alert('前年実績が未登録です。')
      return
    }
    const end = computePriorYearEndCounts(plan.priorYear)
    const total = end.partner + end.vendor + end.employment
    if (total <= 0) {
      alert('前年末の件数が取れません。')
      return
    }
    const next: Ratios = {
      partner: Math.round((end.partner / total) * 100),
      vendor: Math.round((end.vendor / total) * 100),
      employment: Math.round((end.employment / total) * 100),
    }
    const diff = 100 - (next.partner + next.vendor + next.employment)
    next.partner += diff
    const msg =
      `前年末（2026-03）の案件構成比を 獲得・終了 の両デフォルト配車比率に反映します:\n\n` +
      `  運送店: ${next.partner}%\n` +
      `  業者:   ${next.vendor}%\n` +
      `  社員:   ${next.employment}%\n\n` +
      `件数: 運送店 ${end.partner.toLocaleString()}件 / 業者 ${end.vendor.toLocaleString()}件 / 社員 ${end.employment.toLocaleString()}件（合計 ${total.toLocaleString()}件）\n\n` +
      `※ 「期初＝前年末の構成」という前提で始めるためのボタンです。月別オーバーライドは別途。`
    if (!confirm(msg)) return
    setPlan((p) => ({
      ...p,
      acquisitionRatio: { ...next },
      terminationRatio: { ...next },
    }))
  }

  const hasPriorYear = !!plan.priorYear

  /* ---- 月別オーバーライド（新 UI 用）：特定月の獲得 or 終了 ratio をセット ---- */
  function setMonthRatio(month: string, kind: 'acquisition' | 'termination', next: Ratios | undefined) {
    setPlan((p) => {
      const idx = p.monthlyRatios.findIndex((r) => r.month === month)
      const base: MonthlyRatioOverride = idx >= 0 ? { ...p.monthlyRatios[idx] } : { month }
      if (kind === 'acquisition') base.acquisition = next
      else base.termination = next
      const arr = [...p.monthlyRatios]
      // 両方 undefined/空 になれば行を削除
      const isEmpty =
        (!base.acquisition || ratioSum(base.acquisition) === 0) &&
        (!base.termination || ratioSum(base.termination) === 0)
      if (idx >= 0) {
        if (isEmpty) arr.splice(idx, 1)
        else arr[idx] = base
      } else if (!isEmpty) {
        arr.push(base)
      }
      return { ...p, monthlyRatios: arr }
    })
  }

  /** 前年同月のカテゴリ別 acq/term から比率を算出して monthlyRatios に反映 */
  function copyPriorYearRatiosFor(kind: 'acquisition' | 'termination') {
    if (!plan.priorYear) {
      alert('前年実績が未登録です。')
      return
    }
    const py = plan.priorYear
    const label = kind === 'acquisition' ? '獲得' : '終了'
    // 前年月マップ
    const priorMap = new Map(py.monthlyData.map((d) => [d.month, d]))

    function toRatio(by: { partner: number; vendor: number; employment: number } | undefined): Ratios | null {
      if (!by) return null
      const total = by.partner + by.vendor + by.employment
      if (total <= 0) return null
      const next: Ratios = {
        partner: Math.round((by.partner / total) * 100),
        vendor: Math.round((by.vendor / total) * 100),
        employment: Math.round((by.employment / total) * 100),
      }
      const diff = 100 - (next.partner + next.vendor + next.employment)
      next.partner += diff
      return next
    }

    const rows: { target: string; ratio: Ratios }[] = []
    for (const m of months) {
      const priorM = priorYm(m)
      const d = priorMap.get(priorM)
      if (!d) continue
      const by = kind === 'acquisition' ? d.acquisitionByCategory : d.terminationByCategory
      const r = toRatio(by)
      if (r) rows.push({ target: m, ratio: r })
    }

    if (rows.length === 0) {
      alert(`前年実績のカテゴリ別${label}件数が見つかりません。`)
      return
    }

    const preview = rows
      .slice(0, 12)
      .map((r) => `  ${r.target}: 運送店 ${r.ratio.partner}% / 業者 ${r.ratio.vendor}% / 社員 ${r.ratio.employment}%`)
      .join('\n')
    if (
      !confirm(
        `前年同月の${label}比率を FY2026 の月別オーバーライドに一括反映します（${rows.length} ヶ月分）:\n\n${preview}\n\n既存の${label}比率上書きは置き換えられます。`,
      )
    )
      return

    setPlan((p) => {
      const arr = [...p.monthlyRatios]
      for (const row of rows) {
        const idx = arr.findIndex((x) => x.month === row.target)
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], [kind]: row.ratio }
        } else {
          arr.push({ month: row.target, [kind]: row.ratio })
        }
      }
      return { ...p, monthlyRatios: arr }
    })
  }

  /** 前年の年間合計 acq/term から単一の平均比率を算出し、FY2026 の全月に同じ値で一括反映する。 */
  function copyPriorYearAnnualAvgRatiosFor(kind: 'acquisition' | 'termination') {
    if (!plan.priorYear) {
      alert('前年実績が未登録です。')
      return
    }
    const py = plan.priorYear
    const label = kind === 'acquisition' ? '獲得' : '終了'

    // 年間合計（カテゴリ別）
    let P = 0, V = 0, E = 0
    for (const d of py.monthlyData) {
      const by = kind === 'acquisition' ? d.acquisitionByCategory : d.terminationByCategory
      if (!by) continue
      P += by.partner || 0
      V += by.vendor || 0
      E += by.employment || 0
    }
    const total = P + V + E
    if (total <= 0) {
      alert(`前年実績のカテゴリ別${label}件数（年間合計）が見つかりません。`)
      return
    }
    const ratio: Ratios = {
      partner: Math.round((P / total) * 100),
      vendor: Math.round((V / total) * 100),
      employment: Math.round((E / total) * 100),
    }
    const diff = 100 - (ratio.partner + ratio.vendor + ratio.employment)
    ratio.partner += diff

    if (
      !confirm(
        `前年(${py.fiscalYear})の${label}カテゴリ別 年間合計から平均比率を算出し、FY2026 の全月に同じ値で上書きします:\n\n` +
        `  運送店 ${ratio.partner}% / 業者 ${ratio.vendor}% / 社員 ${ratio.employment}%\n` +
        `  （年間計: 運送店 ${P.toLocaleString()} / 業者 ${V.toLocaleString()} / 社員 ${E.toLocaleString()} = ${total.toLocaleString()}件）\n\n` +
        `既存の${label}比率上書きは全て置き換えられます。続行しますか？`,
      )
    )
      return

    setPlan((p) => {
      const arr = [...p.monthlyRatios]
      for (const m of months) {
        const idx = arr.findIndex((x) => x.month === m)
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], [kind]: ratio }
        } else {
          arr.push({ month: m, [kind]: ratio })
        }
      }
      return { ...p, monthlyRatios: arr }
    })
  }

  /** 前年同月の 獲得比率 + Δpt を全月の月別オーバーライドに適用（獲得のみ）
   *  partnerDelta, vendorDelta は +/- pt。employment は 100 − partner − vendor の残差。
   */
  function applyPriorYearAcqWithDelta(partnerDelta: number, vendorDelta: number) {
    if (!plan.priorYear) {
      alert('前年実績が未登録です。')
      return
    }
    const py = plan.priorYear
    const priorMap = new Map(py.monthlyData.map((d) => [d.month, d]))
    const rows: { target: string; ratio: Ratios; base: Ratios }[] = []

    for (const m of months) {
      const priorM = priorYm(m)
      const d = priorMap.get(priorM)
      if (!d?.acquisitionByCategory) continue
      const by = d.acquisitionByCategory
      const total = by.partner + by.vendor + by.employment
      if (total <= 0) continue
      const baseP = Math.round((by.partner / total) * 100)
      const baseV = Math.round((by.vendor / total) * 100)
      const baseE = 100 - baseP - baseV
      // Δpt 適用
      let nextP = baseP + partnerDelta
      let nextV = baseV + vendorDelta
      let nextE = 100 - nextP - nextV
      // クランプ（0〜100）
      if (nextP < 0) {
        nextE += nextP
        nextP = 0
      }
      if (nextV < 0) {
        nextE += nextV
        nextV = 0
      }
      if (nextE < 0) {
        // 運送店と業者から按分して吸収
        const shortfall = -nextE
        const total2 = nextP + nextV
        if (total2 > 0) {
          const cutP = Math.round((nextP / total2) * shortfall)
          const cutV = shortfall - cutP
          nextP -= cutP
          nextV -= cutV
        }
        nextE = 0
      }
      // 合計100化の端数調整
      const sum = nextP + nextV + nextE
      if (sum !== 100) nextP += 100 - sum
      rows.push({
        target: m,
        ratio: { partner: Math.max(0, nextP), vendor: Math.max(0, nextV), employment: Math.max(0, nextE) },
        base: { partner: baseP, vendor: baseV, employment: baseE },
      })
    }

    if (rows.length === 0) {
      alert('前年実績のカテゴリ別獲得件数が見つかりません。')
      return
    }

    const preview = rows
      .slice(0, 12)
      .map(
        (r) =>
          `  ${r.target}: R ${r.base.partner}→${r.ratio.partner}% / V ${r.base.vendor}→${r.ratio.vendor}% / E ${r.base.employment}→${r.ratio.employment}%`,
      )
      .join('\n')

    if (
      !confirm(
        `前年同月の獲得比率に Δを乗せて全月の月別オーバーライドに反映します:\n` +
          `  運送店 Δ=${partnerDelta >= 0 ? '+' : ''}${partnerDelta}pt\n` +
          `  業者   Δ=${vendorDelta >= 0 ? '+' : ''}${vendorDelta}pt\n` +
          `  社員   Δ=${-(partnerDelta + vendorDelta) >= 0 ? '+' : ''}${-(partnerDelta + vendorDelta)}pt （残差）\n\n` +
          `${preview}\n\n既存の獲得比率上書きは置き換えられます。`,
      )
    )
      return

    setPlan((p) => {
      const arr = [...p.monthlyRatios]
      for (const row of rows) {
        const idx = arr.findIndex((x) => x.month === row.target)
        if (idx >= 0) arr[idx] = { ...arr[idx], acquisition: row.ratio }
        else arr.push({ month: row.target, acquisition: row.ratio })
      }
      return { ...p, monthlyRatios: arr }
    })
  }

  /** 獲得比率から終了比率を自動導出（社員の絶対件数が獲得=終了になるよう調整）
   *  各月:
   *    social_acq_count = acq_total × acq_ratio.employment / 100
   *    term_ratio.employment = social_acq_count / term_total × 100  (term_total>0 のみ、それ以外は 0)
   *    term_ratio.partner/vendor は acq_ratio の partner/vendor 比率で残りを按分
   */
  function deriveTerminationFromAcquisition() {
    if (!plan.monthlyTotals || plan.monthlyTotals.length === 0) {
      alert('月次合計（獲得/終了件数）が未入力のため導出できません。「獲得/終了」タブで先に件数を入れてください。')
      return
    }

    function normalizeTo100(partner: number, vendor: number, employment: number): Ratios {
      const sum = partner + vendor + employment
      if (sum <= 0) return { partner: 0, vendor: 0, employment: 0 }
      const next: Ratios = {
        partner: Math.round((partner / sum) * 100),
        vendor: Math.round((vendor / sum) * 100),
        employment: Math.round((employment / sum) * 100),
      }
      const diff = 100 - (next.partner + next.vendor + next.employment)
      // 端数は partner に寄せる
      next.partner += diff
      return next
    }

    type Row = {
      target: string
      ratio: Ratios
      acqTotal: number
      termTotal: number
      netPartner: number
      netVendor: number
      netEmployment: number
    }
    const rows: Row[] = []
    for (const m of months) {
      const mt = plan.monthlyTotals.find((x) => x.month === m)
      const acqTotal = mt?.acquisitionTotal ?? 0
      const termTotal = mt?.terminationTotal ?? 0
      if (termTotal <= 0) continue  // term_total=0 の月はスキップ（導出不能）

      const acqR = getMonthRatio(m, 'acquisition').ratio
      const acqEmpCount = (acqTotal * (acqR.employment ?? 0)) / 100
      // 絶対 cap: term_total を超えられない
      const empCount = Math.min(acqEmpCount, termTotal)
      // 終了比率: 社員 = empCount/term_total、残りは partner/vendor を acq 側の比率で配分
      const empPct = termTotal > 0 ? (empCount / termTotal) * 100 : 0
      const acqNonEmp = (acqR.partner ?? 0) + (acqR.vendor ?? 0)
      let partnerPct = 0
      let vendorPct = 0
      if (acqNonEmp > 0) {
        const remain = 100 - empPct
        partnerPct = ((acqR.partner ?? 0) / acqNonEmp) * remain
        vendorPct = ((acqR.vendor ?? 0) / acqNonEmp) * remain
      } else {
        partnerPct = (100 - empPct) / 2
        vendorPct = (100 - empPct) / 2
      }
      const ratio = normalizeTo100(partnerPct, vendorPct, empPct)
      // 純増（運送店・業者は増員、社員は同数=0 を目指す）
      const acqPartner = Math.round((acqTotal * (acqR.partner ?? 0)) / 100)
      const acqVendor = Math.round((acqTotal * (acqR.vendor ?? 0)) / 100)
      const acqEmp = Math.round(acqEmpCount)
      const termPartner = Math.round((termTotal * ratio.partner) / 100)
      const termVendor = Math.round((termTotal * ratio.vendor) / 100)
      const termEmp = Math.round((termTotal * ratio.employment) / 100)
      rows.push({
        target: m,
        ratio,
        acqTotal,
        termTotal,
        netPartner: acqPartner - termPartner,
        netVendor: acqVendor - termVendor,
        netEmployment: acqEmp - termEmp,
      })
    }

    if (rows.length === 0) {
      alert('終了件数が 1件以上の月がないため導出できません。')
      return
    }

    // 年間累計
    const sumNetPartner = rows.reduce((s, r) => s + r.netPartner, 0)
    const sumNetVendor = rows.reduce((s, r) => s + r.netVendor, 0)
    const sumNetEmployment = rows.reduce((s, r) => s + r.netEmployment, 0)

    const preview = rows
      .slice(0, 12)
      .map(
        (r) =>
          `  ${r.target}: 比率 R${r.ratio.partner}/V${r.ratio.vendor}/E${r.ratio.employment}% ` +
          `／ 純増 R${r.netPartner >= 0 ? '+' : ''}${r.netPartner} / V${r.netVendor >= 0 ? '+' : ''}${r.netVendor} / E${r.netEmployment >= 0 ? '+' : ''}${r.netEmployment}`,
      )
      .join('\n')

    const summary =
      `\n年間累計 純増: 運送店 ${sumNetPartner >= 0 ? '+' : ''}${sumNetPartner}件 / ` +
      `業者 ${sumNetVendor >= 0 ? '+' : ''}${sumNetVendor}件 / ` +
      `社員 ${sumNetEmployment >= 0 ? '+' : ''}${sumNetEmployment}件（社員は 0 に近いほど同数原則が保たれている）`

    if (
      !confirm(
        `社員同数原則で終了比率を全月に反映します（運送店・業者は増員、社員はフラット）:\n\n${preview}\n${summary}\n\n既存の終了比率上書きは置き換えられます。`,
      )
    )
      return

    setPlan((p) => {
      const arr = [...p.monthlyRatios]
      for (const row of rows) {
        const idx = arr.findIndex((x) => x.month === row.target)
        if (idx >= 0) arr[idx] = { ...arr[idx], termination: row.ratio }
        else arr.push({ month: row.target, termination: row.ratio })
      }
      return { ...p, monthlyRatios: arr }
    })
  }

  /** 指定月・種別の獲得/終了比率を返す（override があればそれ、無ければ default） */
  function getMonthRatio(month: string, kind: 'acquisition' | 'termination'): { ratio: Ratios; isOverride: boolean } {
    const m = plan.monthlyRatios.find((x) => x.month === month)
    const ov = m?.[kind]
    if (ov && ratioSum(ov) > 0) return { ratio: ov, isOverride: true }
    return { ratio: kind === 'acquisition' ? plan.acquisitionRatio : plan.terminationRatio, isOverride: false }
  }

  /** 前年同月のカテゴリ別比率（参照用） */
  function getPriorMonthRatio(
    month: string,
    kind: 'acquisition' | 'termination',
  ): Ratios | null {
    if (!plan.priorYear) return null
    const priorM = priorYm(month)
    const d = plan.priorYear.monthlyData.find((x) => x.month === priorM)
    if (!d) return null
    const by = kind === 'acquisition' ? d.acquisitionByCategory : d.terminationByCategory
    if (!by) return null
    const total = by.partner + by.vendor + by.employment
    if (total <= 0) return null
    const next: Ratios = {
      partner: Math.round((by.partner / total) * 100),
      vendor: Math.round((by.vendor / total) * 100),
      employment: Math.round((by.employment / total) * 100),
    }
    const diff = 100 - (next.partner + next.vendor + next.employment)
    next.partner += diff
    return next
  }

  /* ---- サブタブ state ---- */
  const [subTab, setSubTab] = useState<'acq' | 'term' | 'ref'>('acq')

  /* ---- ギミック（獲得 Δpt）の state ---- */
  const [deltaP, setDeltaP] = useState(0)
  const [deltaV, setDeltaV] = useState(0)

  const acqMonthData = months.map((m) => ({
    m,
    cur: getMonthRatio(m, 'acquisition'),
    prior: getPriorMonthRatio(m, 'acquisition'),
  }))
  const termMonthData = months.map((m) => ({
    m,
    cur: getMonthRatio(m, 'termination'),
    prior: getPriorMonthRatio(m, 'termination'),
  }))

  function subTabBtn(value: 'acq' | 'term' | 'ref', label: string) {
    return (
      <button
        className={subTab === value ? '' : 'ghost'}
        onClick={() => setSubTab(value)}
        style={{ padding: '4px 10px', fontSize: 12 }}
      >
        {label}
      </button>
    )
  }

  return (
    <>
      {/* 前年末コピー（共通）＆ サブタブセレクタ */}
      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            {subTabBtn('acq', '🟢 獲得')}
            {subTabBtn('term', '🔴 終了')}
            {subTabBtn('ref', '📊 参照（獲得+終了）')}
          </div>
          {hasPriorYear && (
            <button
              className="small"
              onClick={applyFromPriorYearEnd}
              style={{ background: '#7c3aed' }}
              title="前年末(2026-03)の案件構成比を 獲得・終了 の両デフォルトに反映"
            >
              📥 前年末(2026-03)構成比を期初として取り込む
            </button>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          月別オーバーライドが無い月は <strong>デフォルト比率</strong> で按分されます。獲得／終了 を別建てで編集でき、参照タブで両方を並べて確認できます。
        </div>
      </div>

      {/* ============ 獲得 サブタブ ============ */}
      {subTab === 'acq' && (
        <>
          <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac' }}>
            <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, color: '#166534' }}>🟢 獲得 デフォルト配車比率（％）</h3>
              {hasPriorYear && (
                <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  <button
                    className="small"
                    style={{ background: '#16a34a' }}
                    onClick={() => copyPriorYearRatiosFor('acquisition')}
                    title="前年同月の獲得比率を FY2026 の月別オーバーライドに一括反映"
                  >
                    📅 前年同月の比率を全月にコピー
                  </button>
                  <button
                    className="small"
                    style={{ background: '#0369a1' }}
                    onClick={() => copyPriorYearAnnualAvgRatiosFor('acquisition')}
                    title="前年の年間合計から平均獲得比率を算出し、全月に同じ値で一括反映"
                  >
                    📊 前年 年平均比率を全月にコピー
                  </button>
                </div>
              )}
            </div>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>種別</th>
                    {WorkerCategoryOrder.map((c) => (
                      <th key={c}><span className={`badge ${c}`}>{WorkerCategoryLabels[c]}</span></th>
                    ))}
                    <th>合計</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <RatioEditorRow
                    label="獲得（デフォルト）"
                    ratio={plan.acquisitionRatio}
                    sum={acqSum}
                    onChange={(c, v) => updateDefault('acquisitionRatio', c, v)}
                    onNormalize={() => normalize('acquisitionRatio')}
                    onCopyInitial={() => copyFromInitial('acquisitionRatio')}
                  />
                </tbody>
              </table>
            </div>
          </div>

          {/* 前年 + Δpt ギミック（獲得のみ） */}
          {hasPriorYear && (
            <div className="card" style={{ background: '#fef3c7', borderColor: '#fcd34d' }}>
              <h3 style={{ margin: 0, color: '#92400e', fontSize: 14 }}>
                🎛 前年同月 + Δpt ギミック（獲得比率を全月に一括適用）
              </h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
                前年同月の獲得比率をベースに、運送店・業者の pt を増減して全月の月別オーバーライドに書き込みます。
                社員は残差（100 − 運送店 − 業者）で自動計算。
              </div>
              <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                <div className="row" style={{ gap: 6 }}>
                  <label style={{ margin: 0, fontSize: 12 }}>
                    <span className="badge partner">運送店</span> Δ
                  </label>
                  <input
                    type="number"
                    step={0.5}
                    value={deltaP}
                    onChange={(e) => setDeltaP(Math.round((Number(e.target.value) || 0) * 10) / 10)}
                    style={{ width: 72 }}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>pt</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <label style={{ margin: 0, fontSize: 12 }}>
                    <span className="badge vendor">業者</span> Δ
                  </label>
                  <input
                    type="number"
                    step={0.5}
                    value={deltaV}
                    onChange={(e) => setDeltaV(Math.round((Number(e.target.value) || 0) * 10) / 10)}
                    style={{ width: 72 }}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>pt</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  <span className="badge employment">社員</span> Δ ={' '}
                  <strong>{-(deltaP + deltaV) >= 0 ? '+' : ''}{-(deltaP + deltaV)}pt</strong>（残差）
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="small ghost" onClick={() => { setDeltaP(0); setDeltaV(0) }}>0 リセット</button>
                  <button
                    className="small"
                    style={{ background: '#d97706' }}
                    onClick={() => applyPriorYearAcqWithDelta(deltaP, deltaV)}
                  >
                    この Δpt で全月に適用
                  </button>
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>クイック:</span>
                <button className="small ghost" onClick={() => { setDeltaP(2); setDeltaV(-1) }}>運送店+2/業者-1</button>
                <button className="small ghost" onClick={() => { setDeltaP(5); setDeltaV(-2) }}>運送店+5/業者-2</button>
                <button className="small ghost" onClick={() => { setDeltaP(-2); setDeltaV(2) }}>運送店-2/業者+2</button>
                <button className="small ghost" onClick={() => { setDeltaP(0); setDeltaV(0) }}>前年そのまま</button>
              </div>
            </div>
          )}

          {/* 月別 獲得比率 編集テーブル */}
          <MonthlyRatioEditTable
            kind="acquisition"
            label="獲得"
            months={months}
            data={acqMonthData}
            onSet={(m, r) => setMonthRatio(m, 'acquisition', r)}
            defaultRatio={plan.acquisitionRatio}
          />
        </>
      )}

      {/* ============ 終了 サブタブ ============ */}
      {subTab === 'term' && (
        <>
          <div className="card" style={{ background: '#fef2f2', borderColor: '#fca5a5' }}>
            <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, color: '#991b1b' }}>🔴 終了 デフォルト配車比率（％）</h3>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="small"
                  style={{ background: '#0891b2' }}
                  onClick={deriveTerminationFromAcquisition}
                  title="獲得比率+月次件数から、社員の絶対件数が獲得=終了になる終了比率を自動導出"
                >
                  🔀 獲得から導出（社員同数原則）
                </button>
                {hasPriorYear && (
                  <>
                    <button
                      className="small"
                      style={{ background: '#dc2626' }}
                      onClick={() => copyPriorYearRatiosFor('termination')}
                      title="前年同月の終了比率を FY2026 の月別オーバーライドに一括反映"
                    >
                      📅 前年同月の比率を全月にコピー
                    </button>
                    <button
                      className="small"
                      style={{ background: '#b91c1c' }}
                      onClick={() => copyPriorYearAnnualAvgRatiosFor('termination')}
                      title="前年の年間合計から平均終了比率を算出し、全月に同じ値で一括反映"
                    >
                      📊 前年 年平均比率を全月にコピー
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>種別</th>
                    {WorkerCategoryOrder.map((c) => (
                      <th key={c}><span className={`badge ${c}`}>{WorkerCategoryLabels[c]}</span></th>
                    ))}
                    <th>合計</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <RatioEditorRow
                    label="終了（デフォルト）"
                    ratio={plan.terminationRatio}
                    sum={termSum}
                    onChange={(c, v) => updateDefault('terminationRatio', c, v)}
                    onNormalize={() => normalize('terminationRatio')}
                    onCopyInitial={() => copyFromInitial('terminationRatio')}
                  />
                </tbody>
              </table>
            </div>
          </div>

          <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.6 }}>
            💡 <strong>社員同数原則</strong>: 運送店・業者は増員計画を持てるが、<strong>社員は内部人員なので獲得=終了（純増0）</strong>が原則。
            「獲得から導出」ボタンは、獲得側の社員件数 = 終了側の社員件数 になるよう終了比率を自動計算します。
            残り（運送店+業者の終了枠）は獲得側の partner/vendor 比率に合わせて按分。確認ダイアログでは年間累計純増も出るので、<strong>運送店・業者の増員計画</strong>が設計通りになっているかチェックしてください。
          </div>

          {/* 月別 終了比率 編集テーブル */}
          <MonthlyRatioEditTable
            kind="termination"
            label="終了"
            months={months}
            data={termMonthData}
            onSet={(m, r) => setMonthRatio(m, 'termination', r)}
            defaultRatio={plan.terminationRatio}
          />
        </>
      )}

      {/* ============ 参照 サブタブ ============ */}
      {subTab === 'ref' && (
        <RatioReferenceView
          months={months}
          acqData={acqMonthData}
          termData={termMonthData}
        />
      )}

    </>
  )
}

/** 月別比率の12ヶ月編集グリッド（獲得 or 終了 どちらか） */
function MonthlyRatioEditTable({
  kind, label, months, data, onSet, defaultRatio,
}: {
  kind: 'acquisition' | 'termination'
  label: string
  months: string[]
  data: { m: string; cur: { ratio: Ratios; isOverride: boolean }; prior: Ratios | null }[]
  onSet: (month: string, r: Ratios | undefined) => void
  defaultRatio: Ratios
}) {
  function setCell(month: string, cat: WorkerCategory, v: number) {
    const row = data.find((d) => d.m === month)!
    const base = row.cur.isOverride ? row.cur.ratio : { ...defaultRatio }
    const next: Ratios = { ...base, [cat]: Math.max(0, Math.round(v)) }
    onSet(month, next)
  }
  function resetCell(month: string) {
    onSet(month, undefined)
  }

  return (
    <div className="card">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>月別 {label}配車比率（％ / 上書き可）</h3>
        <div className="muted" style={{ fontSize: 11 }}>
          「上書き」バッジ付き = その月はデフォルトとは違う比率で動く。リセットでデフォルトに戻る
        </div>
      </div>
      <div className="scroll-x" style={{ marginTop: 8 }}>
        <table style={{ fontSize: 11 }}>
          <thead>
            <tr>
              <th>月</th>
              <th>状態</th>
              <th><span className="badge partner">運送店</span></th>
              <th><span className="badge vendor">業者</span></th>
              <th><span className="badge employment">社員</span></th>
              <th>合計</th>
              <th>前年同月</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const r = row.cur.ratio
              const s = r.partner + r.vendor + r.employment
              return (
                <tr key={row.m}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatYmShort(row.m)}</td>
                  <td>
                    {row.cur.isOverride ? (
                      <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: 10 }}>上書き</span>
                    ) : (
                      <span className="badge" style={{ background: '#e2e8f0', color: '#475569', fontSize: 10 }}>デフォ</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.partner}
                      onChange={(e) => setCell(row.m, 'partner', Number(e.target.value) || 0)}
                      style={{ width: 56, textAlign: 'right' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.vendor}
                      onChange={(e) => setCell(row.m, 'vendor', Number(e.target.value) || 0)}
                      style={{ width: 56, textAlign: 'right' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.employment}
                      onChange={(e) => setCell(row.m, 'employment', Number(e.target.value) || 0)}
                      style={{ width: 56, textAlign: 'right' }}
                    />
                  </td>
                  <td className="mono" style={{ color: s === 100 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{s}%</td>
                  <td className="mono muted" style={{ fontSize: 10 }}>
                    {row.prior
                      ? `${row.prior.partner}/${row.prior.vendor}/${row.prior.employment}`
                      : '—'}
                  </td>
                  <td>
                    {row.cur.isOverride ? (
                      <button className="small ghost" onClick={() => resetCell(row.m)}>リセット</button>
                    ) : (
                      <span className="muted" style={{ fontSize: 10 }}>—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        前年同月列は <strong>運送店 / 業者 / 社員</strong> の順。合計が 100% にならない月は赤字で警告。
      </div>
    </div>
  )
}

/** 参照ビュー：獲得 と 終了 の月別比率を並べて表示（前年比較付き） */
function RatioReferenceView({
  months, acqData, termData,
}: {
  months: string[]
  acqData: { m: string; cur: { ratio: Ratios; isOverride: boolean }; prior: Ratios | null }[]
  termData: { m: string; cur: { ratio: Ratios; isOverride: boolean }; prior: Ratios | null }[]
}) {
  void months
  function delta(cur: number, prior: number | null): string {
    if (prior == null) return ''
    const d = cur - prior
    if (Math.abs(d) < 0.5) return ''
    return d > 0 ? ` (+${d})` : ` (${d})`
  }
  return (
    <div className="card">
      <h3 style={{ margin: 0 }}>📊 参照：獲得 / 終了 配車比率（月別、前年比較付き）</h3>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        当年の比率と前年同月の比率を並列表示。差分 pt も併記。
      </div>
      <div className="scroll-x" style={{ marginTop: 10 }}>
        <table style={{ fontSize: 11 }}>
          <thead>
            <tr>
              <th rowSpan={2}>月</th>
              <th colSpan={4} style={{ background: '#dcfce7', color: '#166534' }}>🟢 獲得</th>
              <th colSpan={4} style={{ background: '#fee2e2', color: '#991b1b' }}>🔴 終了</th>
            </tr>
            <tr>
              <th style={{ background: '#dcfce7', fontSize: 10 }}>状態</th>
              <th style={{ background: '#dcfce7', fontSize: 10 }}>運送店</th>
              <th style={{ background: '#dcfce7', fontSize: 10 }}>業者</th>
              <th style={{ background: '#dcfce7', fontSize: 10 }}>社員</th>
              <th style={{ background: '#fee2e2', fontSize: 10 }}>状態</th>
              <th style={{ background: '#fee2e2', fontSize: 10 }}>運送店</th>
              <th style={{ background: '#fee2e2', fontSize: 10 }}>業者</th>
              <th style={{ background: '#fee2e2', fontSize: 10 }}>社員</th>
            </tr>
          </thead>
          <tbody>
            {acqData.map((a, i) => {
              const t = termData[i]
              return (
                <tr key={a.m}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatYmShort(a.m)}</td>
                  <td>
                    {a.cur.isOverride ? (
                      <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: 9 }}>上書き</span>
                    ) : (
                      <span className="badge" style={{ background: '#e2e8f0', color: '#475569', fontSize: 9 }}>デフォ</span>
                    )}
                  </td>
                  <td className="mono" style={{ background: '#f0fdf4' }}>
                    {a.cur.ratio.partner}%<span className="muted" style={{ fontSize: 9 }}>{delta(a.cur.ratio.partner, a.prior?.partner ?? null)}</span>
                  </td>
                  <td className="mono" style={{ background: '#f0fdf4' }}>
                    {a.cur.ratio.vendor}%<span className="muted" style={{ fontSize: 9 }}>{delta(a.cur.ratio.vendor, a.prior?.vendor ?? null)}</span>
                  </td>
                  <td className="mono" style={{ background: '#f0fdf4' }}>
                    {a.cur.ratio.employment}%<span className="muted" style={{ fontSize: 9 }}>{delta(a.cur.ratio.employment, a.prior?.employment ?? null)}</span>
                  </td>
                  <td>
                    {t.cur.isOverride ? (
                      <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: 9 }}>上書き</span>
                    ) : (
                      <span className="badge" style={{ background: '#e2e8f0', color: '#475569', fontSize: 9 }}>デフォ</span>
                    )}
                  </td>
                  <td className="mono" style={{ background: '#fef2f2' }}>
                    {t.cur.ratio.partner}%<span className="muted" style={{ fontSize: 9 }}>{delta(t.cur.ratio.partner, t.prior?.partner ?? null)}</span>
                  </td>
                  <td className="mono" style={{ background: '#fef2f2' }}>
                    {t.cur.ratio.vendor}%<span className="muted" style={{ fontSize: 9 }}>{delta(t.cur.ratio.vendor, t.prior?.vendor ?? null)}</span>
                  </td>
                  <td className="mono" style={{ background: '#fef2f2' }}>
                    {t.cur.ratio.employment}%<span className="muted" style={{ fontSize: 9 }}>{delta(t.cur.ratio.employment, t.prior?.employment ?? null)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        括弧内は前年同月との pt 差。編集は各サブタブで。
      </div>
    </div>
  )
}

function RatioEditorRow({
  label, ratio, sum, onChange, onNormalize, onCopyInitial,
}: {
  label: string
  ratio: Ratios
  sum: number
  onChange: (cat: WorkerCategory, v: number) => void
  onNormalize: () => void
  onCopyInitial: () => void
}) {
  const isValid = sum === 100
  return (
    <tr>
      <td><strong>{label}</strong></td>
      {WorkerCategoryOrder.map((c) => (
        <td key={c} style={{ padding: 4 }}>
          <input
            type="number"
            min={0}
            value={ratio[c]}
            onChange={(e) => onChange(c, Math.max(0, Math.round(Number(e.target.value) || 0)))}
            style={{ width: 72, textAlign: 'right' }}
          />
        </td>
      ))}
      <td className="mono" style={{ color: isValid ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
        {sum}%
      </td>
      <td>
        <div className="row" style={{ gap: 4 }}>
          <button className="small ghost" onClick={onCopyInitial}>期首比率</button>
          <button className="small ghost" onClick={onNormalize} disabled={isValid}>100%化</button>
        </div>
      </td>
    </tr>
  )
}

/* ====================================================
   獲得 / 終了（月次総数入力 + プレビュー + 年間合計 + 純増減 + 前年参照）
   ==================================================== */
function FlowsPanel() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  function getMonthlyTotal(m: string): MonthlyTotal | undefined {
    return plan.monthlyTotals.find((x) => x.month === m)
  }

  function upsertMonthlyTotal(m: string, patch: Partial<MonthlyTotal>) {
    setPlan((p) => {
      const idx = p.monthlyTotals.findIndex((x) => x.month === m)
      const base: MonthlyTotal = { month: m, acquisitionTotal: 0, terminationTotal: 0 }
      const next = idx >= 0 ? { ...p.monthlyTotals[idx], ...patch } : { ...base, ...patch }
      const arr = [...p.monthlyTotals]
      if (idx >= 0) arr[idx] = next
      else arr.push(next)
      const cleaned = arr.filter((x) => !(x.acquisitionTotal === 0 && x.terminationTotal === 0))
      return { ...p, monthlyTotals: cleaned }
    })
  }

  function bulkFill(field: 'acquisitionTotal' | 'terminationTotal', val: number) {
    const label = field === 'acquisitionTotal' ? '獲得' : '終了'
    if (!confirm(`全月の${label}総数を ${val} で上書きしますか？`)) return
    setPlan((p) => {
      const map = new Map(p.monthlyTotals.map((x) => [x.month, x]))
      for (const m of months) {
        const cur = map.get(m) ?? { month: m, acquisitionTotal: 0, terminationTotal: 0 }
        map.set(m, { ...cur, [field]: val })
      }
      const arr = [...map.values()].filter((x) => !(x.acquisitionTotal === 0 && x.terminationTotal === 0))
      return { ...p, monthlyTotals: arr }
    })
  }

  function clearAll() {
    if (!confirm('全ての獲得・終了総数を 0 にリセットしますか？')) return
    setPlan((p) => ({ ...p, monthlyTotals: [] }))
  }

  /** 前年の月次データ（総数 + カテゴリ別獲得/終了 比率）を FY2026 の該当月に引き継ぐ。
   *  - acquisitionTotal, terminationTotal → monthlyTotals
   *  - acquisitionByCategory, terminationByCategory → monthlyRatios の acquisition / termination に %化
   *  既存の値は同月のみ上書き、対象外の月はそのまま保持
   */
  function importFromPriorYear() {
    if (!plan.priorYear) {
      alert('前年実績が未登録です。')
      return
    }
    const py = plan.priorYear
    // 前年月 → 当年月 のマップ（+12ヶ月）
    const monthMap = new Map<string, string>()
    for (const d of py.monthlyData) monthMap.set(d.month, addMonths(d.month, 12))
    // ターゲット月（現在の horizon 範囲内）のみ採用
    const monthSet = new Set(months)

    let countTotals = 0
    let countRatios = 0
    const rows: { target: string; acq: number; term: number; hasRatio: boolean }[] = []

    const newMonthlyTotals: MonthlyTotal[] = plan.monthlyTotals.slice()
    const newMonthlyRatios: MonthlyRatioOverride[] = plan.monthlyRatios.slice()

    function toPct(m: Record<WorkerCategory, number>): Ratios {
      const total = m.partner + m.vendor + m.employment
      if (total <= 0) return { partner: 0, vendor: 0, employment: 0 }
      return {
        partner: Math.round((m.partner / total) * 1000) / 10,
        vendor: Math.round((m.vendor / total) * 1000) / 10,
        employment: Math.round((m.employment / total) * 1000) / 10,
      }
    }

    for (const d of py.monthlyData) {
      const target = monthMap.get(d.month)!
      if (!monthSet.has(target)) continue
      const acq = d.acquisition ?? 0
      const term = d.termination ?? 0

      // 合計を upsert
      const ti = newMonthlyTotals.findIndex((x) => x.month === target)
      if (acq > 0 || term > 0) {
        const next: MonthlyTotal = { month: target, acquisitionTotal: acq, terminationTotal: term }
        if (ti >= 0) newMonthlyTotals[ti] = next
        else newMonthlyTotals.push(next)
        countTotals++
      }

      // カテゴリ別配車比率を upsert
      const acqR = d.acquisitionByCategory ? toPct(d.acquisitionByCategory) : undefined
      const termR = d.terminationByCategory ? toPct(d.terminationByCategory) : undefined
      const hasRatio = !!acqR || !!termR
      if (hasRatio) {
        const ri = newMonthlyRatios.findIndex((x) => x.month === target)
        const base: MonthlyRatioOverride = ri >= 0 ? { ...newMonthlyRatios[ri] } : { month: target }
        if (acqR) base.acquisition = acqR
        if (termR) base.termination = termR
        if (ri >= 0) newMonthlyRatios[ri] = base
        else newMonthlyRatios.push(base)
        countRatios++
      }

      rows.push({ target, acq, term, hasRatio })
    }

    if (rows.length === 0) {
      alert('前年実績から対象範囲（FY2026）に該当する月が見つかりませんでした。')
      return
    }

    const preview = rows
      .slice(0, 12)
      .map((r) => `  ${r.target}: 獲得${r.acq} / 終了${r.term}${r.hasRatio ? '・比率' : ''}`)
      .join('\n')
    const msg =
      `前年実績（FY${py.fiscalYear?.replace(/\D/g, '') || '2025'}）から以下を FY2026 に引き継ぎます:\n\n` +
      `${preview}\n\n` +
      `月次合計: ${countTotals} ヶ月分\n` +
      `カテゴリ比率: ${countRatios} ヶ月分\n\n` +
      `既に入力されている同月の値は上書きされます。続行しますか？`
    if (!confirm(msg)) return

    // 0/0 の月は掃除
    const cleanedTotals = newMonthlyTotals.filter((x) => !(x.acquisitionTotal === 0 && x.terminationTotal === 0))

    setPlan((p) => ({
      ...p,
      monthlyTotals: cleanedTotals,
      monthlyRatios: newMonthlyRatios,
    }))
  }

  /** 年間合計（期間全体の合計） */
  const totals = useMemo(() => {
    let acq = 0, term = 0
    for (const m of months) {
      const mt = getMonthlyTotal(m)
      acq += mt?.acquisitionTotal ?? 0
      term += mt?.terminationTotal ?? 0
    }
    return { acq, term }
  }, [months, plan.monthlyTotals])

  /** プレビュー（月×カテゴリ） */
  const preview = useMemo(() => {
    return months.map((m) => {
      const mt = getMonthlyTotal(m)
      const acqR = effectiveRatio(plan, m, 'acquisition')
      const termR = effectiveRatio(plan, m, 'termination')
      const acq = distributeIntegers(mt?.acquisitionTotal ?? 0, acqR)
      const term = distributeIntegers(mt?.terminationTotal ?? 0, termR)
      const acqTotal = mt?.acquisitionTotal ?? 0
      const termTotal = mt?.terminationTotal ?? 0
      const isOverride = plan.monthlyRatios.some((r) => r.month === m && ((r.acquisition && ratioSum(r.acquisition) > 0) || (r.termination && ratioSum(r.termination) > 0)))
      return { month: m, acq, term, acqTotal, termTotal, net: acqTotal - termTotal, isOverride }
    })
  }, [months, plan.monthlyTotals, plan.acquisitionRatio, plan.terminationRatio, plan.monthlyRatios])

  /** 累計純増減 */
  const cumulativeNets = useMemo(() => {
    const arr: number[] = []
    let cum = 0
    for (const row of preview) {
      cum += row.net
      arr.push(cum)
    }
    return arr
  }, [preview])

  /** カテゴリ別 年間合計（獲得／終了） */
  const categoryTotals = useMemo(() => {
    const acq: Record<WorkerCategory, number> = { partner: 0, vendor: 0, employment: 0 }
    const term: Record<WorkerCategory, number> = { partner: 0, vendor: 0, employment: 0 }
    for (const row of preview) {
      for (const c of WorkerCategoryOrder) {
        acq[c] += row.acq[c]
        term[c] += row.term[c]
      }
    }
    return { acq, term }
  }, [preview])

  /** 前年参照 */
  const hasPriorYear = !!plan.priorYear && plan.priorYear.monthlyData.length > 0
  const priorLookup = useMemo(() => {
    const map = new Map<string, { acq: number; term: number }>()
    if (plan.priorYear) {
      for (const d of plan.priorYear.monthlyData) {
        map.set(d.month, { acq: d.acquisition, term: d.termination })
      }
    }
    return map
  }, [plan.priorYear])

  return (
    <>
      <div className="card">
        <div className="row between">
          <h3>月次の獲得・終了 総数</h3>
          <div className="row">
            {hasPriorYear && (
              <button
                className="small"
                onClick={importFromPriorYear}
                style={{ background: '#7c3aed' }}
                title="前年(FY2025)の月次獲得・終了 総数＋カテゴリ比率を FY2026 に引き継ぎます（+12ヶ月シフト）"
              >
                📥 前年の数字を持ってくる
              </button>
            )}
            <button className="small ghost" onClick={() => {
              const v = Number(prompt('毎月の獲得総数', '0') ?? '0')
              if (!Number.isNaN(v)) bulkFill('acquisitionTotal', Math.max(0, Math.round(v)))
            }}>獲得 一括入力</button>
            <button className="small ghost" onClick={() => {
              const v = Number(prompt('毎月の終了総数', '0') ?? '0')
              if (!Number.isNaN(v)) bulkFill('terminationTotal', Math.max(0, Math.round(v)))
            }}>終了 一括入力</button>
            <button className="small ghost" onClick={clearAll}>全クリア</button>
          </div>
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>項目</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年間合計</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ color: '#16a34a', fontWeight: 600 }}>＋獲得 総数</td>
                {months.map((m) => {
                  const mt = getMonthlyTotal(m)
                  return (
                    <td key={`a-${m}`} style={{ padding: 2 }}>
                      <input
                        type="number"
                        min={0}
                        value={mt?.acquisitionTotal ?? 0}
                        onChange={(e) => upsertMonthlyTotal(m, { acquisitionTotal: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        style={{ width: 72, padding: '2px 6px', textAlign: 'right', color: '#16a34a' }}
                      />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', color: '#16a34a', fontWeight: 700 }}>
                  +{totals.acq.toLocaleString()}
                </td>
              </tr>
              <tr>
                <td style={{ color: '#dc2626', fontWeight: 600 }}>－終了 総数</td>
                {months.map((m) => {
                  const mt = getMonthlyTotal(m)
                  return (
                    <td key={`t-${m}`} style={{ padding: 2 }}>
                      <input
                        type="number"
                        min={0}
                        value={mt?.terminationTotal ?? 0}
                        onChange={(e) => upsertMonthlyTotal(m, { terminationTotal: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        style={{ width: 72, padding: '2px 6px', textAlign: 'right', color: '#dc2626' }}
                      />
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>
                  -{totals.term.toLocaleString()}
                </td>
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <td><strong>純増減（獲得−終了）</strong></td>
                {preview.map((r) => (
                  <td key={`net-${r.month}`} className="mono" style={{ fontWeight: 600, color: r.net > 0 ? '#16a34a' : r.net < 0 ? '#dc2626' : undefined }}>
                    {r.net > 0 ? `+${r.net}` : r.net}
                  </td>
                ))}
                <td className="mono" style={{ background: '#e2e8f0', fontWeight: 700, color: (totals.acq - totals.term) > 0 ? '#16a34a' : (totals.acq - totals.term) < 0 ? '#dc2626' : undefined }}>
                  {(totals.acq - totals.term) > 0 ? '+' : ''}{(totals.acq - totals.term).toLocaleString()}
                </td>
              </tr>
              <tr>
                <td>累計 純増減</td>
                {cumulativeNets.map((cum, i) => (
                  <td key={`cum-${i}`} className="mono" style={{ color: cum > 0 ? '#16a34a' : cum < 0 ? '#dc2626' : '#64748b' }}>
                    {cum > 0 ? '+' : ''}{cum.toLocaleString()}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9' }}>
                  {cumulativeNets[cumulativeNets.length - 1]?.toLocaleString() ?? 0}
                </td>
              </tr>

              {hasPriorYear && (
                <>
                  <tr><td colSpan={months.length + 2} style={{ background: '#ede9fe', fontWeight: 600, color: '#5b21b6' }}>
                    ■ 前年実績 参照（{plan.priorYear!.fiscalYear}）
                  </td></tr>
                  <tr>
                    <td className="muted">前年 獲得</td>
                    {months.map((m) => {
                      const py = priorLookup.get(priorYm(m))
                      return <td key={`py-a-${m}`} className="mono muted">{py ? py.acq.toLocaleString() : '—'}</td>
                    })}
                    <td className="mono muted" style={{ background: '#f5f3ff' }}>
                      {Array.from(priorLookup.values()).reduce((s, v) => s + v.acq, 0).toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">前年 終了</td>
                    {months.map((m) => {
                      const py = priorLookup.get(priorYm(m))
                      return <td key={`py-t-${m}`} className="mono muted">{py ? py.term.toLocaleString() : '—'}</td>
                    })}
                    <td className="mono muted" style={{ background: '#f5f3ff' }}>
                      {Array.from(priorLookup.values()).reduce((s, v) => s + v.term, 0).toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">前年 純増減</td>
                    {months.map((m) => {
                      const py = priorLookup.get(priorYm(m))
                      const net = py ? py.acq - py.term : null
                      return (
                        <td key={`py-n-${m}`} className="mono" style={{ color: net == null ? '#94a3b8' : (net > 0 ? '#16a34a' : net < 0 ? '#dc2626' : '#64748b') }}>
                          {net == null ? '—' : (net > 0 ? `+${net}` : net)}
                        </td>
                      )
                    })}
                    <td className="mono muted" style={{ background: '#f5f3ff' }}>—</td>
                  </tr>
                </>
              )}
              {!hasPriorYear && (
                <tr>
                  <td colSpan={months.length + 2} className="muted" style={{ fontSize: 12, padding: 10 }}>
                    「前年実績」タブで前年データを入れると、ここに参照行が追加されます。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>按分結果プレビュー（整数・月別比率反映）</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          月によって上書き比率がある月は、項目行の月名に「★」が付きます。合計は必ず総数と一致します。
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>種別 / カテゴリ</th>
                {preview.map((p) => <th key={p.month}>{formatYmShort(p.month)}{p.isOverride ? ' ★' : ''}</th>)}
                <th style={{ background: '#e2e8f0' }}>年間合計</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={months.length + 2} style={{ background: '#ecfdf5', fontWeight: 600, color: '#065f46' }}>＋獲得（比率按分）</td></tr>
              {WorkerCategoryOrder.map((cat) => (
                <tr key={`pa-${cat}`}>
                  <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                  {preview.map((p) => (
                    <td key={`pa-${cat}-${p.month}`} className="mono">{p.acq[cat]}</td>
                  ))}
                  <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700 }}>{categoryTotals.acq[cat].toLocaleString()}</td>
                </tr>
              ))}
              <tr><td colSpan={months.length + 2} style={{ background: '#fef2f2', fontWeight: 600, color: '#991b1b' }}>－終了（比率按分）</td></tr>
              {WorkerCategoryOrder.map((cat) => (
                <tr key={`pt-${cat}`}>
                  <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span></td>
                  {preview.map((p) => (
                    <td key={`pt-${cat}-${p.month}`} className="mono">{p.term[cat]}</td>
                  ))}
                  <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700 }}>{categoryTotals.term[cat].toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ====================================================
   入替マトリクス（月別 3×3 転出件数）
   ==================================================== */
function TransfersList() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  function setCell(month: string, from: WorkerCategory, to: WorkerCategory, v: number) {
    setPlan((p) => ({ ...p, transfers: upsertTransferCell(p.transfers, month, from, to, v, newId) }))
  }
  function clearAll() {
    if (!confirm('入替マトリクスを全て 0 にリセットしますか？')) return
    setPlan((p) => ({ ...p, transfers: [] }))
  }
  function fillRow(from: WorkerCategory, to: WorkerCategory, v: number) {
    const lbl = `${WorkerCategoryLabels[from]} → ${WorkerCategoryLabels[to]}`
    if (!confirm(`${lbl} を全月 ${v} で上書きしますか？`)) return
    setPlan((p) => {
      let next = p.transfers
      for (const m of months) next = upsertTransferCell(next, m, from, to, v, newId)
      return { ...p, transfers: next }
    })
  }

  /** 前年の入替マトリクスを FY2026 の該当月（+12ヶ月）に引き継ぐ。
   *  対象月の既存セルは上書き（対象外月はそのまま）。
   *  同区分uplift（diagonalUplift / diagonalUpliftByMonth）は変更しない。
   */
  function importTransfersFromPriorYear() {
    if (!plan.priorYear) {
      alert('前年実績が未登録です。')
      return
    }
    const py = plan.priorYear
    const monthSet = new Set(months)
    // 月ごとの転写件数を集計（対象月のみ）
    const targetsByMonth = new Map<string, number>()
    for (const t of py.transfers) {
      const target = addMonths(t.month, 12)
      if (!monthSet.has(target)) continue
      targetsByMonth.set(target, (targetsByMonth.get(target) ?? 0) + 1)
    }
    if (targetsByMonth.size === 0) {
      alert('前年実績の入替データから対象範囲（FY2026）に該当する月が見つかりませんでした。')
      return
    }
    const total = py.transfers.filter((t) => monthSet.has(addMonths(t.month, 12))).length

    const msg =
      `前年(FY2025) の入替マトリクスを FY2026 の同月に転写します（+12ヶ月シフト）:\n\n` +
      `  転写セル数: ${total} 件（${targetsByMonth.size} ヶ月分）\n\n` +
      `対象月の入替件数セルのみ上書きします。同区分uplift（X円/件/日）の設定は変更されません。続行しますか？`
    if (!confirm(msg)) return

    setPlan((p) => {
      // 入替セルを引き継ぎ
      let nextTransfers = p.transfers
      // 対象月の既存セルをまず全てクリア（上書き方針）
      const targetMonths = new Set(targetsByMonth.keys())
      nextTransfers = nextTransfers.filter((t) => !targetMonths.has(t.month))
      for (const t of py.transfers) {
        const target = addMonths(t.month, 12)
        if (!monthSet.has(target)) continue
        if (t.count > 0) {
          nextTransfers = upsertTransferCell(nextTransfers, target, t.from, t.to, t.count, newId)
        }
      }
      // diagonalUplift / diagonalUpliftByMonth はそのまま保持
      return { ...p, transfers: nextTransfers }
    })
  }

  /** 前年の入替マトリクスを「行ごとに年合計 / 12」で均した値で各月を上書き。
   *  同区分uplift（diagonalUplift / diagonalUpliftByMonth）は変更しない。
   */
  function importTransfersFromPriorYearMonthlyAvg() {
    if (!plan.priorYear) {
      alert('前年実績が未登録です。')
      return
    }
    const py = plan.priorYear
    // 9ペアごとに前年の年合計件数を集計
    const rowSum: Record<string, number> = {}
    for (const pair of ALL_TRANSFER_PAIRS) {
      const key = `${pair.from}>${pair.to}`
      rowSum[key] = py.transfers
        .filter((t) => t.from === pair.from && t.to === pair.to)
        .reduce((s, t) => s + (t.count || 0), 0)
    }
    const nonZero = Object.values(rowSum).reduce((s, v) => s + (v > 0 ? 1 : 0), 0)
    if (nonZero === 0) {
      alert('前年実績の入替データが空です。')
      return
    }
    const preview = ALL_TRANSFER_PAIRS
      .filter((p) => rowSum[`${p.from}>${p.to}`] > 0)
      .map((p) => {
        const s = rowSum[`${p.from}>${p.to}`]
        const avg = s / 12
        return `  ${WorkerCategoryLabels[p.from]}→${WorkerCategoryLabels[p.to]}: 年${s} ÷ 12 ≈ ${avg.toFixed(1)}/月`
      })
      .join('\n')

    const msg =
      `前年(FY2025) の入替マトリクスを「行ごとの年合計 ÷ 12」でならした値で FY2026 の各月を上書きします。\n\n${preview}\n\n` +
      `※ 小数点第1位を四捨五入して整数化します。入替件数セルのみ上書き（同区分uplift X円/件/日 の設定は変更しません）。続行しますか？`
    if (!confirm(msg)) return

    setPlan((p) => {
      let nextTransfers = p.transfers
      // 対象範囲の既存セルを全クリア
      const monthSet = new Set(months)
      nextTransfers = nextTransfers.filter((t) => !monthSet.has(t.month))
      for (const pair of ALL_TRANSFER_PAIRS) {
        const s = rowSum[`${pair.from}>${pair.to}`]
        if (s <= 0) continue
        const avg = Math.max(0, Math.round(s / 12))
        if (avg === 0) continue
        for (const m of months) {
          nextTransfers = upsertTransferCell(nextTransfers, m, pair.from, pair.to, avg, newId)
        }
      }
      // diagonalUplift / diagonalUpliftByMonth はそのまま保持
      return { ...p, transfers: nextTransfers }
    })
  }

  const hasPriorYearTransfers = !!plan.priorYear && plan.priorYear.transfers.length > 0

  // 年間合計（ペア毎）
  const rowTotals = useMemo(() => {
    const o: Record<string, number> = {}
    for (const pair of ALL_TRANSFER_PAIRS) {
      const key = `${pair.from}>${pair.to}`
      o[key] = 0
      for (const m of months) o[key] += getTransferAmount(plan.transfers, m, pair.from, pair.to)
    }
    return o
  }, [plan.transfers, months])

  // 同区分入替 uplift 設定ヘルパー
  function setDefaultUplift(cat: 'partner' | 'vendor', v: number) {
    setPlan((p) => ({ ...p, diagonalUplift: { ...p.diagonalUplift, [cat]: Math.max(0, Math.round(v)) } }))
  }
  function setMonthlyUplift(month: string, cat: 'partner' | 'vendor', v: number) {
    setPlan((p) => {
      const arr = [...p.diagonalUpliftByMonth]
      const idx = arr.findIndex((x) => x.month === month)
      const base: MonthlyDiagonalUpliftOverride = idx >= 0 ? arr[idx] : { month }
      const rounded = v >= 0 ? Math.round(v) : 0
      const next: MonthlyDiagonalUpliftOverride = { ...base, [cat]: rounded }
      // 全項目が未定義または0なら削除
      if ((next.partner === undefined || next.partner === 0) && (next.vendor === undefined || next.vendor === 0)) {
        if (idx >= 0) return { ...p, diagonalUpliftByMonth: arr.filter((_, i) => i !== idx) }
        return p
      }
      if (idx >= 0) arr[idx] = next
      else arr.push(next)
      return { ...p, diagonalUpliftByMonth: arr }
    })
  }
  function clearMonthlyUplift(cat: 'partner' | 'vendor') {
    if (!confirm(`${WorkerCategoryLabels[cat]} の月別上書きをクリアしますか？`)) return
    setPlan((p) => ({
      ...p,
      diagonalUpliftByMonth: p.diagonalUpliftByMonth
        .map((r) => {
          const next = { ...r }
          delete (next as any)[cat]
          return next
        })
        .filter((r) => r.partner !== undefined || r.vendor !== undefined),
    }))
  }

  // 累計同区分入替件数と月次uplift cost
  const upliftSummary = useMemo(() => {
    return months.map((m) => {
      const diagPnew = diagonalCount(plan.transfers, m, 'partner')   // 当月の新規件数
      const diagVnew = diagonalCount(plan.transfers, m, 'vendor')
      const diagP = cumulativeDiagonalCount(plan.transfers, m, 'partner')
      const diagV = cumulativeDiagonalCount(plan.transfers, m, 'vendor')
      const xp = effectiveDiagonalUpliftAt(plan, m, 'partner') * costUpliftFactor(plan, 'partner')
      const xv = effectiveDiagonalUpliftAt(plan, m, 'vendor') * costUpliftFactor(plan, 'vendor')
      const days = workingDaysOf(plan, m)
      return {
        month: m,
        diagPartner: diagPnew,
        diagVendor: diagVnew,
        cumPartner: diagP,
        cumVendor: diagV,
        upliftP: xp,
        upliftV: xv,
        // 当月 累積分（今月までに発生した同区分入替件数 × X × 当月日数） — 既存
        costP: Math.round(diagP * xp * days),
        costV: Math.round(diagV * xv * days),
        // 当月「新規発生」ぶん（今月だけの新規件数 × X × 当月日数） — 参考表示
        newCostP: Math.round(diagPnew * xp * days),
        newCostV: Math.round(diagVnew * xv * days),
      }
    })
  }, [months, plan.transfers, plan.diagonalUplift, plan.diagonalUpliftByMonth, plan.workingDaysByMonth, plan.defaultWorkingDays, plan.costUpliftCommissionRate])
  const upliftCostTotalP = upliftSummary.reduce((s, r) => s + r.costP, 0)
  const upliftCostTotalV = upliftSummary.reduce((s, r) => s + r.costV, 0)
  const upliftNewCostTotalP = upliftSummary.reduce((s, r) => s + r.newCostP, 0)
  const upliftNewCostTotalV = upliftSummary.reduce((s, r) => s + r.newCostV, 0)

  // 非対角（from ≠ to）の入替による粗利インパクト（構成比変動）
  //   per-pair の月別粗利影響 = 累計件数(その月まで) × 粗利影響/件/日 × 当月日数
  //   粗利影響/件/日 = cost(from) - cost(to)（正値=低原価へ移動=粗利UP）
  const nonDiagPairs = useMemo(
    () => ALL_TRANSFER_PAIRS.filter((p) => p.from !== p.to),
    [],
  )
  const mixImpact = useMemo(() => {
    return nonDiagPairs.map((pair) => {
      const perCaseDay = nonDiagonalProfitPerCasePerDay(plan, pair.from, pair.to, plan.baseMonth)
      const monthly = months.map((m) => {
        const cum = cumulativeNonDiagonalCount(plan.transfers, m, pair.from, pair.to)
        const days = workingDaysOf(plan, m)
        // 月ごとの粗利影響/件/日 も変わる可能性があるので毎月算出
        const unit = nonDiagonalProfitPerCasePerDay(plan, pair.from, pair.to, m)
        return { month: m, count: cum, profit: Math.round(cum * unit * days) }
      })
      const total = monthly.reduce((s, r) => s + r.profit, 0)
      return { pair, perCaseDay, monthly, total }
    })
  }, [nonDiagPairs, plan, months])
  const mixImpactMonthly = useMemo(() => {
    return months.map((m, idx) => mixImpact.reduce((s, r) => s + r.monthly[idx].profit, 0))
  }, [mixImpact, months])
  const mixImpactYearTotal = mixImpactMonthly.reduce((s, v) => s + v, 0)

  // 入替 合計インパクト（構成比変動 − 同区分 uplift 原価）
  const totalImpactMonthly = useMemo(() => {
    return months.map((m, idx) => {
      const mix = mixImpactMonthly[idx]
      const up = upliftSummary[idx].costP + upliftSummary[idx].costV
      return mix - up
    })
  }, [mixImpactMonthly, upliftSummary, months])
  const totalImpactYear = totalImpactMonthly.reduce((s, v) => s + v, 0)

  const catColor = (c: WorkerCategory) =>
    c === 'partner' ? '#2563eb' : c === 'vendor' ? '#7c3aed' : '#059669'

  // カテゴリ別 月次 転出/転入
  const monthlyCategoryFlows = useMemo(() => {
    return months.map((m) => {
      const out: Record<WorkerCategory, number> = { partner: 0, vendor: 0, employment: 0 }
      const inn: Record<WorkerCategory, number> = { partner: 0, vendor: 0, employment: 0 }
      for (const c of WorkerCategoryOrder) {
        out[c] = totalOutflow(plan.transfers, m, c)
        inn[c] = totalInflow(plan.transfers, m, c)
      }
      return { month: m, out, inn }
    })
  }, [plan.transfers, months])

  return (
    <>
      <div className="card">
        <div className="row between">
          <h3>月別 入替マトリクス（from → to の件数・9マス）</h3>
          <div className="row">
            {hasPriorYearTransfers && (
              <>
                <button
                  className="small"
                  onClick={importTransfersFromPriorYear}
                  style={{ background: '#7c3aed' }}
                  title="前年(FY2025) の同月の数字をそのまま FY2026 の各月にコピーします（+12ヶ月シフト）"
                >
                  📅 前年同月
                </button>
                <button
                  className="small"
                  onClick={importTransfersFromPriorYearMonthlyAvg}
                  style={{ background: '#0369a1' }}
                  title="前年(FY2025) の各行（from→to ペア）の年合計 ÷ 12 を FY2026 の全月に均等に入れます"
                >
                  📊 前年月平均
                </button>
              </>
            )}
            <button className="small ghost" onClick={clearAll}>全クリア</button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          対角（<em>同区分入替</em>：運送店→運送店 等）も入力できます。対角はカテゴリ件数には影響しませんが、下の「同区分入替 原価引き上げ」設定により累積的に原価に効きます。
        </div>

        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>from → to</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年間合計</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {ALL_TRANSFER_PAIRS.map(({ from, to }) => {
                const key = `${from}>${to}`
                const isDiagonal = from === to
                return (
                  <tr key={key} style={isDiagonal ? { background: '#fef3c7' } : undefined}>
                    <td>
                      <span className={`badge ${from}`}>{WorkerCategoryLabels[from]}</span>
                      <span className="muted" style={{ margin: '0 4px' }}>→</span>
                      <span className={`badge ${to}`}>{WorkerCategoryLabels[to]}</span>
                      {isDiagonal && <span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>(同区分)</span>}
                    </td>
                    {months.map((m) => (
                      <td key={`${key}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min={0}
                          value={getTransferAmount(plan.transfers, m, from, to)}
                          onChange={(e) => setCell(m, from, to, Math.max(0, Math.round(Number(e.target.value) || 0)))}
                          style={{ width: 64, padding: '2px 6px', textAlign: 'right' }}
                        />
                      </td>
                    ))}
                    <td className="mono" style={{ background: isDiagonal ? '#fde68a' : '#f1f5f9', fontWeight: 700 }}>
                      {rowTotals[key].toLocaleString()}
                    </td>
                    <td>
                      <button className="small ghost" style={{ fontSize: 10, padding: '2px 6px' }}
                        onClick={() => {
                          const v = Number(prompt(`${WorkerCategoryLabels[from]} → ${WorkerCategoryLabels[to]} の毎月件数`, '0') ?? '0')
                          if (!Number.isNaN(v)) fillRow(from, to, Math.max(0, Math.round(v)))
                        }}
                      >一括</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
        <div className="row between">
          <h3 style={{ color: '#92400e' }}>同区分入替 原価引き上げ（uplift）</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            入替した月以降、対象件数 × X円/日 × 計算日数 が累積で原価に加算されます。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 4 }}>
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <label><span className="badge partner">運送店</span> デフォルト X（円/1件/日）</label>
            <input
              type="number"
              min={0}
              value={plan.diagonalUplift.partner}
              onChange={(e) => setDefaultUplift('partner', Number(e.target.value) || 0)}
            />
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <label><span className="badge vendor">業者</span> デフォルト X（円/1件/日）</label>
            <input
              type="number"
              min={0}
              value={plan.diagonalUplift.vendor}
              onChange={(e) => setDefaultUplift('vendor', Number(e.target.value) || 0)}
            />
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="small ghost" onClick={() => clearMonthlyUplift('partner')}>運送店 月別クリア</button>
            <button className="small ghost" onClick={() => clearMonthlyUplift('vendor')}>業者 月別クリア</button>
          </div>
        </div>
        {(() => {
          const pr = plan.costUpliftCommissionRate?.partner ?? 0
          const vr = plan.costUpliftCommissionRate?.vendor ?? 0
          if (pr <= 0 && vr <= 0) return null
          const effP = Math.round((plan.diagonalUplift.partner || 0) * (100 - pr) / 100)
          const effV = Math.round((plan.diagonalUplift.vendor || 0) * (100 - vr) / 100)
          return (
            <div className="muted" style={{ fontSize: 11, margin: '4px 0 12px', padding: 6, background: '#fff', borderRadius: 4, border: '1px dashed #fcd34d' }}>
              💡 実効原価（手数料控除後）:{' '}
              {pr > 0 && <><strong>運送店</strong>: ¥{effP.toLocaleString()}/件/日（手数料 {pr}%）</>}
              {pr > 0 && vr > 0 && '　／　'}
              {vr > 0 && <><strong>業者</strong>: ¥{effV.toLocaleString()}/件/日（手数料 {vr}%）</>}
              {pr > 0 && vr === 0 && <span style={{ marginLeft: 8 }}>業者: ¥{(plan.diagonalUplift.vendor || 0).toLocaleString()}/件/日（手数料なし）</span>}
            </div>
          )
        })()}
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          月別 uplift X（空欄はデフォルト値を使用）
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>カテゴリ</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(['partner', 'vendor'] as const).map((cat) => (
                <tr key={`u-${cat}`}>
                  <td><span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span> X</td>
                  {months.map((m) => {
                    const ovr = plan.diagonalUpliftByMonth.find((r) => r.month === m)?.[cat]
                    const isOverride = typeof ovr === 'number' && ovr >= 0
                    const eff = effectiveDiagonalUpliftAt(plan, m, cat)
                    return (
                      <td key={`u-${cat}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min={0}
                          value={isOverride ? ovr! : (eff || 0)}
                          onChange={(e) => setMonthlyUplift(m, cat, Number(e.target.value) || 0)}
                          style={{ width: 72, padding: '2px 6px', textAlign: 'right', color: isOverride ? '#92400e' : '#94a3b8' }}
                          title={isOverride ? '月別上書き' : 'デフォルト値（参考表示）'}
                        />
                      </td>
                    )
                  })}
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 4 }}>
          累積 同区分入替件数と月次 uplift 原価（累計件数 × X × 営業日数）
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>項目</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年計</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="badge partner">運送店</span> 当月入替</td>
                {upliftSummary.map((r) => (
                  <td key={`mp-${r.month}`} className="mono" style={{ color: r.diagPartner > 0 ? '#0f172a' : '#94a3b8' }}>
                    {r.diagPartner || '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9' }}>
                  {upliftSummary.reduce((s, r) => s + r.diagPartner, 0)}
                </td>
              </tr>
              <tr>
                <td><span className="badge partner">運送店</span> 累計入替</td>
                {upliftSummary.map((r) => (
                  <td key={`cp-${r.month}`} className="mono">{r.cumPartner}</td>
                ))}
                <td></td>
              </tr>
              <tr>
                <td><span className="badge partner">運送店</span> uplift 原価 <span className="muted" style={{ fontSize: 10 }}>（累計）</span></td>
                {upliftSummary.map((r) => (
                  <td key={`xp-${r.month}`} className="mono" style={{ color: r.costP > 0 ? '#dc2626' : '#94a3b8' }}>
                    {r.costP > 0 ? `¥${yen(r.costP)}` : '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>
                  ¥{yen(upliftCostTotalP)}
                </td>
              </tr>
              <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
                <td className="muted" style={{ fontSize: 11, paddingLeft: 20 }}>
                  ↳ うち当月新規発生分 <span style={{ fontSize: 10 }}>（今月件数 × X × 営業日数）</span>
                </td>
                {upliftSummary.map((r) => (
                  <td key={`np-${r.month}`} className="mono muted" style={{ fontSize: 11, color: r.newCostP > 0 ? '#94a3b8' : '#cbd5e1' }}>
                    {r.newCostP > 0 ? `¥${yen(r.newCostP)}` : '—'}
                  </td>
                ))}
                <td className="mono muted" style={{ background: '#f1f5f9', fontSize: 11 }}>¥{yen(upliftNewCostTotalP)}</td>
              </tr>
              <tr>
                <td><span className="badge vendor">業者</span> 当月入替</td>
                {upliftSummary.map((r) => (
                  <td key={`mv-${r.month}`} className="mono" style={{ color: r.diagVendor > 0 ? '#0f172a' : '#94a3b8' }}>
                    {r.diagVendor || '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9' }}>
                  {upliftSummary.reduce((s, r) => s + r.diagVendor, 0)}
                </td>
              </tr>
              <tr>
                <td><span className="badge vendor">業者</span> 累計入替</td>
                {upliftSummary.map((r) => (
                  <td key={`cv-${r.month}`} className="mono">{r.cumVendor}</td>
                ))}
                <td></td>
              </tr>
              <tr>
                <td><span className="badge vendor">業者</span> uplift 原価 <span className="muted" style={{ fontSize: 10 }}>（累計）</span></td>
                {upliftSummary.map((r) => (
                  <td key={`xv-${r.month}`} className="mono" style={{ color: r.costV > 0 ? '#dc2626' : '#94a3b8' }}>
                    {r.costV > 0 ? `¥${yen(r.costV)}` : '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>
                  ¥{yen(upliftCostTotalV)}
                </td>
              </tr>
              <tr>
                <td className="muted" style={{ fontSize: 11, paddingLeft: 20 }}>
                  ↳ うち当月新規発生分 <span style={{ fontSize: 10 }}>（今月件数 × X × 営業日数）</span>
                </td>
                {upliftSummary.map((r) => (
                  <td key={`nv-${r.month}`} className="mono muted" style={{ fontSize: 11, color: r.newCostV > 0 ? '#94a3b8' : '#cbd5e1' }}>
                    {r.newCostV > 0 ? `¥${yen(r.newCostV)}` : '—'}
                  </td>
                ))}
                <td className="mono muted" style={{ background: '#f1f5f9', fontSize: 11 }}>¥{yen(upliftNewCostTotalV)}</td>
              </tr>
              <tr style={{ background: '#fef2f2' }}>
                <td><strong>uplift 原価合計</strong></td>
                {upliftSummary.map((r) => {
                  const sum = r.costP + r.costV
                  return (
                    <td key={`xt-${r.month}`} className="mono" style={{ fontWeight: 600, color: sum > 0 ? '#dc2626' : undefined }}>
                      {sum > 0 ? `¥${yen(sum)}` : '—'}
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#fee2e2', color: '#dc2626', fontWeight: 700 }}>
                  ¥{yen(upliftCostTotalP + upliftCostTotalV)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* === 構成比変動（非対角入替）による粗利インパクト === */}
      <div className="card" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ color: '#1e40af', margin: 0 }}>🔀 構成比変動による粗利インパクト（非対角入替）</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            累計件数 × (from原価 − to原価) × 営業日数。+は粗利UP（低原価カテゴリへ移動）、−は粗利DOWN。
          </div>
        </div>
        <div className="scroll-x" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>カテゴリ移動</th>
                <th>粗利影響/件/日</th>
                {months.map((m) => <th key={`mix-th-${m}`}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年計</th>
              </tr>
            </thead>
            <tbody>
              {mixImpact.map(({ pair, perCaseDay, monthly, total }) => {
                const hasAny = monthly.some((r) => r.count > 0)
                if (!hasAny) return null
                return (
                  <tr key={`mix-${pair.from}-${pair.to}`}>
                    <td>
                      <span className={`badge ${pair.from}`}>{WorkerCategoryLabels[pair.from]}</span>
                      <span className="muted" style={{ margin: '0 4px' }}>→</span>
                      <span className={`badge ${pair.to}`}>{WorkerCategoryLabels[pair.to]}</span>
                    </td>
                    <td className="mono" style={{ color: perCaseDay >= 0 ? '#16a34a' : '#dc2626' }}>
                      {perCaseDay >= 0 ? '+' : ''}¥{Math.round(perCaseDay).toLocaleString()}
                    </td>
                    {monthly.map((cell) => (
                      <td key={`mix-${pair.from}-${pair.to}-${cell.month}`} className="mono" style={{ color: cell.profit > 0 ? '#16a34a' : cell.profit < 0 ? '#dc2626' : '#94a3b8' }}>
                        {cell.profit === 0 ? '—' : `${cell.profit > 0 ? '+' : '−'}¥${yen(Math.abs(cell.profit))}`}
                      </td>
                    ))}
                    <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700, color: total > 0 ? '#16a34a' : total < 0 ? '#dc2626' : undefined }}>
                      {total === 0 ? '—' : `${total > 0 ? '+' : '−'}¥${yen(Math.abs(total))}`}
                    </td>
                  </tr>
                )
              })}
              <tr style={{ background: '#dbeafe' }}>
                <td colSpan={2}><strong>構成比変動 合計</strong></td>
                {mixImpactMonthly.map((v, i) => (
                  <td key={`mix-sum-${i}`} className="mono" style={{ fontWeight: 700, color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : undefined }}>
                    {v === 0 ? '—' : `${v > 0 ? '+' : '−'}¥${yen(Math.abs(v))}`}
                  </td>
                ))}
                <td className="mono" style={{ background: '#bfdbfe', fontWeight: 800, color: mixImpactYearTotal > 0 ? '#16a34a' : mixImpactYearTotal < 0 ? '#dc2626' : undefined }}>
                  {mixImpactYearTotal === 0 ? '—' : `${mixImpactYearTotal > 0 ? '+' : '−'}¥${yen(Math.abs(mixImpactYearTotal))}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          ※ 原価/件/日 はカテゴリ設定の原価率（×{' '}
          <span className={`badge partner`} style={{ fontSize: 10 }}>運送店</span>
          {' '}= {(plan.categories.partner.costRate || 0).toFixed(1)}% / {' '}
          <span className={`badge vendor`} style={{ fontSize: 10 }}>業者</span>
          {' '}= {(plan.categories.vendor.costRate || 0).toFixed(1)}% / {' '}
          <span className={`badge employment`} style={{ fontSize: 10 }}>社員</span>
          {' '}= {(plan.categories.employment.costRate || 0).toFixed(1)}% ）× 案件単価 ¥{(plan.revenuePerCase || 0).toLocaleString()} から算出
        </div>
      </div>

      {/* === 入替 合計 粗利インパクト（構成比変動 − 同区分 uplift） === */}
      <div className="card" style={{ background: '#faf5ff', borderColor: '#d8b4fe' }}>
        <h3 style={{ color: '#6b21a8', margin: 0 }}>💎 入替 合計 粗利インパクト（年間 {totalImpactYear > 0 ? '+' : ''}¥{(totalImpactYear / 1_000_000).toFixed(1)}M）</h3>
        <div className="muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 10 }}>
          非対角（構成比変動）と同区分（単価uplift）の粗利インパクトを合算。uplift は原価増なので符号は − 寄り。
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>項目</th>
                {months.map((m) => <th key={`ti-th-${m}`}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年計</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>構成比変動 Pt <span className="muted" style={{ fontSize: 10 }}>（非対角）</span></td>
                {mixImpactMonthly.map((v, i) => (
                  <td key={`ti-mix-${i}`} className="mono" style={{ color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : undefined }}>
                    {v === 0 ? '—' : `${v > 0 ? '+' : '−'}¥${yen(Math.abs(v))}`}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700, color: mixImpactYearTotal >= 0 ? '#16a34a' : '#dc2626' }}>
                  {mixImpactYearTotal >= 0 ? '+' : '−'}¥{yen(Math.abs(mixImpactYearTotal))}
                </td>
              </tr>
              <tr>
                <td>同区分 uplift Pt <span className="muted" style={{ fontSize: 10 }}>（対角・累計、原価増=−）</span></td>
                {upliftSummary.map((r, i) => {
                  const neg = -(r.costP + r.costV)
                  return (
                    <td key={`ti-up-${i}`} className="mono" style={{ color: neg < 0 ? '#dc2626' : '#94a3b8' }}>
                      {neg === 0 ? '—' : `${neg > 0 ? '+' : '−'}¥${yen(Math.abs(neg))}`}
                    </td>
                  )
                })}
                <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700, color: '#dc2626' }}>
                  −¥{yen(upliftCostTotalP + upliftCostTotalV)}
                </td>
              </tr>
              <tr style={{ background: '#f3e8ff' }}>
                <td><strong>合計 粗利インパクト</strong></td>
                {totalImpactMonthly.map((v, i) => (
                  <td key={`ti-total-${i}`} className="mono" style={{ fontWeight: 700, color: v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : undefined }}>
                    {v === 0 ? '—' : `${v > 0 ? '+' : '−'}¥${yen(Math.abs(v))}`}
                  </td>
                ))}
                <td className="mono" style={{ background: '#e9d5ff', fontWeight: 800, color: totalImpactYear > 0 ? '#16a34a' : totalImpactYear < 0 ? '#dc2626' : undefined }}>
                  {totalImpactYear === 0 ? '—' : `${totalImpactYear > 0 ? '+' : '−'}¥${yen(Math.abs(totalImpactYear))}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>カテゴリ別 月次 転出・転入サマリー（参考）</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          転出合計は各カテゴリから出て行く件数、転入合計はそのカテゴリへ入ってくる件数。純移動 = 転入 − 転出。
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>カテゴリ / 種別</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年間合計</th>
              </tr>
            </thead>
            <tbody>
              {WorkerCategoryOrder.map((cat) => {
                const outTotal = monthlyCategoryFlows.reduce((s, r) => s + r.out[cat], 0)
                const inTotal = monthlyCategoryFlows.reduce((s, r) => s + r.inn[cat], 0)
                const netTotal = inTotal - outTotal
                return (
                  <Fragment key={cat}>
                    <tr>
                      <td rowSpan={3}>
                        <span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: '#dc2626', fontSize: 12 }}>転出</td>
                      {monthlyCategoryFlows.map((r) => (
                        <td key={`o-${cat}-${r.month}`} className="mono" style={{ color: r.out[cat] > 0 ? '#dc2626' : '#94a3b8' }}>
                          {r.out[cat] || '—'}
                        </td>
                      ))}
                      <td className="mono" style={{ background: '#f1f5f9', color: '#dc2626', fontWeight: 700 }}>
                        {outTotal.toLocaleString()}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: '#16a34a', fontSize: 12 }}>転入</td>
                      {monthlyCategoryFlows.map((r) => (
                        <td key={`i-${cat}-${r.month}`} className="mono" style={{ color: r.inn[cat] > 0 ? '#16a34a' : '#94a3b8' }}>
                          {r.inn[cat] || '—'}
                        </td>
                      ))}
                      <td className="mono" style={{ background: '#f1f5f9', color: '#16a34a', fontWeight: 700 }}>
                        {inTotal.toLocaleString()}
                      </td>
                    </tr>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                      <td style={{ fontSize: 12 }}><strong>純移動</strong></td>
                      {monthlyCategoryFlows.map((r) => {
                        const net = r.inn[cat] - r.out[cat]
                        return (
                          <td key={`n-${cat}-${r.month}`} className="mono" style={{ fontWeight: 600, color: net > 0 ? '#16a34a' : net < 0 ? '#dc2626' : '#94a3b8' }}>
                            {net === 0 ? '—' : net > 0 ? `+${net}` : net}
                          </td>
                        )
                      })}
                      <td className="mono" style={{ background: '#e2e8f0', fontWeight: 700, color: netTotal > 0 ? '#16a34a' : netTotal < 0 ? '#dc2626' : undefined }}>
                        {netTotal > 0 ? '+' : ''}{netTotal.toLocaleString()}
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ====================================================
   単価アップ（累積型・還元率付き）
   ==================================================== */
function PriceIncreasesList() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  /** 月ごとの集計値（複数イベントがある場合は合算） */
  const byMonth = useMemo(() => {
    const map = new Map<string, { amount: number; cost: number; rate: number; count: number }>()
    for (const ev of plan.priceIncreases ?? []) {
      const cur = map.get(ev.month) ?? { amount: 0, cost: 0, rate: 0, count: 0 }
      const cost = Math.round((ev.amount * ev.returnRate) / 100)
      cur.amount += ev.amount
      cur.cost += cost
      cur.count += 1
      map.set(ev.month, cur)
    }
    // weighted average rate
    for (const [, v] of map) {
      v.rate = v.amount > 0 ? (v.cost / v.amount) * 100 : 0
    }
    return map
  }, [plan.priceIncreases])

  /** 月の amount を上書き：その月の既存イベントを全削除して新1件を作成。amount=0なら削除のみ */
  function setMonthAmount(month: string, amount: number, rateHint?: number) {
    const a = Math.max(0, Math.round(amount))
    const existing = byMonth.get(month)
    const rate = rateHint != null
      ? Math.max(0, Math.min(100, rateHint))
      : (existing?.rate ?? 50) // 既存の weighted rate を維持、無ければ既定50%
    setPlan((p) => {
      const other = p.priceIncreases.filter((e) => e.month !== month)
      if (a === 0) return { ...p, priceIncreases: other }
      return {
        ...p,
        priceIncreases: [
          ...other,
          { id: newId(), month, amount: a, returnRate: Math.round(rate * 10) / 10 },
        ],
      }
    })
  }

  /** 月の返還率を上書き：既存1件があれば update、複数なら合算して1件に集約、無ければ 0円で作成しない */
  function setMonthRate(month: string, returnRate: number) {
    const r = Math.max(0, Math.min(100, returnRate))
    const existing = byMonth.get(month)
    if (!existing || existing.amount === 0) return  // amount=0 の時は rate 保存不要
    setPlan((p) => {
      const other = p.priceIncreases.filter((e) => e.month !== month)
      return {
        ...p,
        priceIncreases: [
          ...other,
          { id: newId(), month, amount: existing.amount, returnRate: Math.round(r * 10) / 10 },
        ],
      }
    })
  }

  function clearAll() {
    if (!confirm('全ての単価アップイベントを削除しますか？')) return
    setPlan((p) => ({ ...p, priceIncreases: [] }))
  }

  function bulkFillRate(rate: number) {
    if (byMonth.size === 0) return
    if (!confirm(`登録済み ${byMonth.size} ヶ月の還元率を全て ${rate}% に上書きしますか？`)) return
    setPlan((p) => ({
      ...p,
      priceIncreases: p.priceIncreases.map((e) => ({ ...e, returnRate: rate })),
    }))
  }

  // 月次累計の参照データ
  const summary = useMemo(() => {
    return months.map((m) => {
      const cum = cumulativePriceIncreaseAt(plan, m)
      const now = monthlyNewPriceIncreaseAt(plan, m)
      return {
        month: m,
        newAmount: now.amount,
        newProfit: now.profit,
        newRate: now.weightedReturnRate,
        cumRevenue: cum.revenue,
        cumCost: cum.cost,
        cumProfit: cum.profit,
      }
    })
  }, [months, plan.priceIncreases])

  const totalAmount = summary.reduce((s, r) => s + r.newAmount, 0)
  const totalProfit = summary.reduce((s, r) => s + r.newProfit, 0)
  const totalCost = totalAmount - totalProfit

  return (
    <>
      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>単価アップ（月別 横軸入力）</h3>
            <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
              各月の「売上アップ額」と「還元率」を直接編集。月が決まれば裏で1イベントを自動管理。
              適用月以降の売上・粗利に <strong>累計で加算</strong> されます。
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="small ghost" onClick={() => bulkFillRate(50)}>還元率 一律50%</button>
            <button className="small ghost" onClick={() => bulkFillRate(60)}>還元率 一律60%</button>
            <button className="small ghost" onClick={() => bulkFillRate(70)}>還元率 一律70%</button>
            <button className="small ghost" onClick={clearAll}>全クリア</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
        <h3 style={{ color: '#92400e' }}>月次 累積サマリー（横軸直接入力）</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          <strong style={{ color: '#92400e' }}>「当月 新規アップ」「当月 還元率」セルに直接入力</strong>。月ごとに1イベントとして裏で管理されます。<br />
          下の「累計 売上UP」と「累計 粗利UP」が通常の売上・粗利に加算されます（別計算レイヤー）。
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>項目</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                <th style={{ background: '#e2e8f0' }}>年計 / 最終</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600, color: '#0f172a' }}>当月 新規アップ（円）<span className="muted" style={{ fontSize: 10, fontWeight: 400, marginLeft: 4 }}>← 編集可</span></td>
                {summary.map((r) => (
                  <td key={`na-${r.month}`} style={{ padding: 2 }}>
                    <input
                      type="number"
                      min={0}
                      step={100000}
                      value={r.newAmount}
                      onChange={(e) => setMonthAmount(r.month, Number(e.target.value) || 0)}
                      style={{
                        width: 92,
                        padding: '2px 6px',
                        textAlign: 'right',
                        fontSize: 12,
                        color: r.newAmount > 0 ? '#0f172a' : '#94a3b8',
                        background: r.newAmount > 0 ? '#fff' : '#f8fafc',
                      }}
                    />
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9', fontWeight: 700 }}>
                  ¥{yen(totalAmount)}
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600, color: '#0f172a' }}>当月 還元率（%）<span className="muted" style={{ fontSize: 10, fontWeight: 400, marginLeft: 4 }}>← 編集可</span></td>
                {summary.map((r) => (
                  <td key={`nr-${r.month}`} style={{ padding: 2 }}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={r.newAmount > 0 ? Math.round(r.newRate * 10) / 10 : ''}
                      onChange={(e) => setMonthRate(r.month, Number(e.target.value) || 0)}
                      disabled={r.newAmount === 0}
                      style={{
                        width: 60,
                        padding: '2px 6px',
                        textAlign: 'right',
                        fontSize: 11,
                        color: r.newAmount > 0 ? '#0f172a' : '#cbd5e1',
                        background: r.newAmount > 0 ? '#fff' : '#f8fafc',
                      }}
                      placeholder="—"
                    />
                  </td>
                ))}
                <td className="mono muted" style={{ background: '#f1f5f9', fontSize: 11 }}>
                  {totalAmount > 0 ? `${((totalCost / totalAmount) * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
              <tr>
                <td>当月 新規粗利UP（自動）</td>
                {summary.map((r) => (
                  <td key={`np-${r.month}`} className="mono" style={{ color: r.newProfit > 0 ? '#16a34a' : '#94a3b8' }}>
                    {r.newProfit > 0 ? `¥${yen(r.newProfit)}` : '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#f1f5f9', color: '#16a34a', fontWeight: 700 }}>
                  ¥{yen(totalProfit)}
                </td>
              </tr>
              <tr style={{ background: '#fef3c7', borderTop: '2px solid #fcd34d' }}>
                <td><strong>累計 売上UP</strong></td>
                {summary.map((r) => (
                  <td key={`cr-${r.month}`} className="mono" style={{ fontWeight: 600, color: r.cumRevenue > 0 ? '#0ea5e9' : '#94a3b8' }}>
                    {r.cumRevenue > 0 ? `¥${yen(r.cumRevenue)}` : '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#fde68a', color: '#0ea5e9', fontWeight: 700 }}>
                  ¥{yen(summary[summary.length - 1]?.cumRevenue ?? 0)}
                </td>
              </tr>
              <tr>
                <td>累計 還元額</td>
                {summary.map((r) => (
                  <td key={`cc-${r.month}`} className="mono muted">
                    {r.cumCost > 0 ? `¥${yen(r.cumCost)}` : '—'}
                  </td>
                ))}
                <td className="mono muted" style={{ background: '#fef3c7' }}>
                  ¥{yen(summary[summary.length - 1]?.cumCost ?? 0)}
                </td>
              </tr>
              <tr style={{ background: '#fef3c7' }}>
                <td><strong>累計 粗利UP</strong></td>
                {summary.map((r) => (
                  <td key={`cp-${r.month}`} className="mono" style={{ fontWeight: 700, color: r.cumProfit > 0 ? '#16a34a' : '#94a3b8' }}>
                    {r.cumProfit > 0 ? `¥${yen(r.cumProfit)}` : '—'}
                  </td>
                ))}
                <td className="mono" style={{ background: '#fde68a', color: '#16a34a', fontWeight: 700 }}>
                  ¥{yen(summary[summary.length - 1]?.cumProfit ?? 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ====================================================
   条件変更
   ==================================================== */
function ConditionChangesList() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = monthsRange(plan.baseMonth, plan.horizonMonths)

  function addRevenue() {
    setPlan((p) => ({
      ...p,
      conditionChanges: [
        ...p.conditionChanges,
        {
          id: newId(),
          effectiveMonth: p.baseMonth,
          category: 'revenue',
          newRevenuePerCase: p.revenuePerCase,
        },
      ],
    }))
  }
  function addCost() {
    setPlan((p) => ({
      ...p,
      conditionChanges: [
        ...p.conditionChanges,
        {
          id: newId(),
          effectiveMonth: p.baseMonth,
          category: 'partner',
        },
      ],
    }))
  }
  function update(id: string, patch: Partial<ConditionChange>) {
    setPlan((p) => ({
      ...p,
      conditionChanges: p.conditionChanges.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  }
  function updateTarget(id: string, target: WorkerCategory | 'revenue') {
    setPlan((p) => ({
      ...p,
      conditionChanges: p.conditionChanges.map((c) => {
        if (c.id !== id) return c
        const next: ConditionChange = { ...c, category: target }
        // 対象に合わない項目はクリア
        if (target === 'revenue') {
          next.newCostModel = undefined
          next.newCostRate = undefined
          next.newCostAmount = undefined
        } else {
          next.newRevenuePerCase = undefined
        }
        return next
      }),
    }))
  }
  function remove(id: string) {
    if (!confirm('この条件変更を削除しますか？')) return
    setPlan((p) => ({ ...p, conditionChanges: p.conditionChanges.filter((c) => c.id !== id) }))
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>条件変更（{plan.conditionChanges.length}件）</h3>
        <div className="row">
          <button className="small" onClick={addRevenue}>＋ 単価改定（全体）</button>
          <button className="small ghost" onClick={addCost}>＋ 原価改定（カテゴリ別）</button>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        「適用月」以降の単価（全体）または指定カテゴリの原価が書き換わります。単価改定は全カテゴリに波及し、カテゴリ間の入替では売上は変わりません（原価率のみシフト）。
      </div>

      {plan.conditionChanges.length === 0 && <div className="card muted">条件変更はありません。</div>}

      {plan.conditionChanges.map((c) => {
        const isRevenue = c.category === 'revenue'
        return (
          <div key={c.id} className="card">
            <div className="form-grid">
              <div>
                <label>適用月</label>
                <select value={c.effectiveMonth} onChange={(e) => update(c.id, { effectiveMonth: e.target.value })}>
                  {months.map((m) => <option key={m} value={m}>{formatYmShort(m)}</option>)}
                </select>
              </div>
              <div>
                <label>対象</label>
                <select value={c.category} onChange={(e) => updateTarget(c.id, e.target.value as WorkerCategory | 'revenue')}>
                  <option value="revenue">単価改定（全体）</option>
                  {WorkerCategoryOrder.map((k) => (
                    <option key={k} value={k}>原価改定：{WorkerCategoryLabels[k]}</option>
                  ))}
                </select>
              </div>

              {isRevenue && (
                <div style={{ gridColumn: 'span 2' }}>
                  <label>新 1日あたり単価（円）</label>
                  <input
                    type="number"
                    value={c.newRevenuePerCase ?? ''}
                    onChange={(e) => update(c.id, { newRevenuePerCase: e.target.value === '' ? undefined : Number(e.target.value) })}
                    placeholder="未入力は現状維持"
                  />
                </div>
              )}

              {!isRevenue && (
                <>
                  <div>
                    <label>原価モデル</label>
                    <select
                      value={c.newCostModel ?? ''}
                      onChange={(e) => update(c.id, { newCostModel: e.target.value === '' ? undefined : (e.target.value as CostModel) })}
                    >
                      <option value="">（変更しない）</option>
                      <option value="rate">原価率(%)</option>
                      <option value="amount">1日あたり金額</option>
                    </select>
                  </div>
                  <div>
                    <label>新 原価率（%）</label>
                    <input
                      type="number"
                      value={c.newCostRate ?? ''}
                      onChange={(e) => update(c.id, { newCostRate: e.target.value === '' ? undefined : Number(e.target.value) })}
                      placeholder="未入力は現状維持"
                    />
                  </div>
                  <div>
                    <label>新 1日あたり原価（円）</label>
                    <input
                      type="number"
                      value={c.newCostAmount ?? ''}
                      onChange={(e) => update(c.id, { newCostAmount: e.target.value === '' ? undefined : Number(e.target.value) })}
                      placeholder="未入力は現状維持"
                    />
                  </div>
                </>
              )}

              <div style={{ gridColumn: '1 / -1' }}>
                <label>理由</label>
                <input value={c.reason ?? ''} onChange={(e) => update(c.id, { reason: e.target.value })} placeholder="単価改定、原価構造見直し 等" />
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gridColumn: '1 / -1' }}>
                <button className="small danger" onClick={() => remove(c.id)}>削除</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ====================================================
   原価改定（部分改定・グリッド入力）
   横軸=月(4〜3月)、縦=カテゴリごとに件数+単価を編集、裏で CostRevision 配列を自動管理
   ==================================================== */
function CostRevisionsList() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  /** (category, month) に該当する既存 revision を取得 */
  function getCell(cat: WorkerCategory, month: string): CostRevision | undefined {
    return (plan.costRevisions ?? []).find((c) => c.category === cat && c.effectiveMonth === month)
  }

  /** グリッドセル更新：count OR amount のどちらかが入ってる限り保存、両方0で削除 */
  function setCell(cat: WorkerCategory, month: string, patch: { count?: number; amount?: number }) {
    setPlan((p) => {
      const existing = p.costRevisions.find((c) => c.category === cat && c.effectiveMonth === month)
      const nextCount = patch.count ?? existing?.count ?? 0
      const nextAmount = patch.amount ?? existing?.amountPerCaseDay ?? 0
      const others = p.costRevisions.filter((c) => !(c.category === cat && c.effectiveMonth === month))
      // 両方とも 0 なら削除
      if (nextCount === 0 && nextAmount === 0) {
        return { ...p, costRevisions: others }
      }
      const next: CostRevision = existing
        ? { ...existing, count: nextCount, amountPerCaseDay: nextAmount }
        : { id: newId(), effectiveMonth: month, category: cat, count: nextCount, amountPerCaseDay: nextAmount }
      return { ...p, costRevisions: [...others, next] }
    })
  }

  function clearAll() {
    if (!confirm('全ての原価改定を削除しますか？')) return
    setPlan((p) => ({ ...p, costRevisions: [] }))
  }

  /** 便利ツール：特定カテゴリに「全月 件数X × +Y円」を一括設定 */
  function fillAll(cat: WorkerCategory) {
    const c = Number(prompt(`${WorkerCategoryLabels[cat]} の全月に設定する件数を入力:`, '10'))
    if (!Number.isFinite(c) || c < 0) return
    const a = Number(prompt(`${WorkerCategoryLabels[cat]} の全月に設定する +円/件/日 を入力:`, '500'))
    if (!Number.isFinite(a) || a < 0) return
    if (c === 0 && a === 0) return
    if (!confirm(`${WorkerCategoryLabels[cat]} の全12ヶ月 に 件数=${c}, +円/件/日=${a} を上書きしますか？`)) return
    setPlan((p) => {
      let arr = p.costRevisions.filter((x) => x.category !== cat)
      for (const m of months) {
        arr = [...arr, { id: newId(), category: cat, effectiveMonth: m, count: c, amountPerCaseDay: a }]
      }
      return { ...p, costRevisions: arr }
    })
  }

  /** 便利ツール：カテゴリ間コピー */
  function copyRow(from: WorkerCategory, to: WorkerCategory) {
    if (from === to) return
    if (!confirm(`${WorkerCategoryLabels[from]} の全月設定を ${WorkerCategoryLabels[to]} にコピーしますか？（${WorkerCategoryLabels[to]} の既存値は上書き）`)) return
    setPlan((p) => {
      const fromEntries = p.costRevisions.filter((x) => x.category === from)
      const others = p.costRevisions.filter((x) => x.category !== to)
      const newTo = fromEntries.map((x) => ({
        id: newId(),
        category: to,
        effectiveMonth: x.effectiveMonth,
        count: x.count,
        amountPerCaseDay: x.amountPerCaseDay,
        memo: x.memo,
      }))
      return { ...p, costRevisions: [...others, ...newTo] }
    })
  }

  /** 便利ツール：カテゴリ行クリア */
  function clearRow(cat: WorkerCategory) {
    if (!confirm(`${WorkerCategoryLabels[cat]} の全月設定をクリアしますか？`)) return
    setPlan((p) => ({ ...p, costRevisions: p.costRevisions.filter((x) => x.category !== cat) }))
  }

  // カテゴリ別 手数料率（原価改定の実効額計算に使用）
  const commissionOf = (cat: WorkerCategory) => plan.costUpliftCommissionRate?.[cat] ?? 0
  const factorOf = (cat: WorkerCategory) => (100 - commissionOf(cat)) / 100

  // 月次累積原価影響を各月で集計（手数料控除後の実効額で集計）
  const monthlyImpacts = months.map((m) => {
    let total = 0
    for (const cr of plan.costRevisions ?? []) {
      if (cr.effectiveMonth <= m) total += cr.count * cr.amountPerCaseDay * factorOf(cr.category) * 20  // 20日平均
    }
    return total
  })
  const totalYear = monthlyImpacts.reduce((s, v) => s + v, 0)

  const catColor = (c: WorkerCategory) =>
    c === 'partner' ? '#2563eb' : c === 'vendor' ? '#7c3aed' : '#059669'

  return (
    <div className="card">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>🔴 原価改定（月別 横軸入力）</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
            各月のセルに <strong>件数</strong> と <strong>+円/件/日</strong> を入力。入力月以降、原価が継続的に加算されます（cumulative）。
            例: 業者 6月に 10件 × +500円 → 6月〜3月 の毎月が +10×500×営業日数 の原価増。
          </div>
          {(commissionOf('partner') > 0 || commissionOf('vendor') > 0) && (
            <div className="muted" style={{ fontSize: 11, marginTop: 6, padding: '6px 10px', background: '#fef3c7', border: '1px dashed #fcd34d', borderRadius: 4 }}>
              💡 手数料率が設定されています。入力額 × (100 − 手数料%) が<strong>実効原価増</strong>として計上されます:{' '}
              {commissionOf('partner') > 0 && <><strong>運送店</strong> 手数料 {commissionOf('partner')}% (入力1000 → 実効{Math.round(1000 * factorOf('partner'))}円)</>}
              {commissionOf('partner') > 0 && commissionOf('vendor') > 0 && ' ／ '}
              {commissionOf('vendor') > 0 && <><strong>業者</strong> 手数料 {commissionOf('vendor')}% (入力1000 → 実効{Math.round(1000 * factorOf('vendor'))}円)</>}
            </div>
          )}
        </div>
        <button className="small ghost" onClick={clearAll}>全クリア</button>
      </div>

      {WorkerCategoryOrder.filter((c) => c !== 'employment').map((cat) => (
        <div key={cat} className="card" style={{ background: '#fff', padding: 10, marginTop: 8 }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <h3 style={{ fontSize: 13, margin: 0, color: catColor(cat) }}>
              <span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span>
            </h3>
            <div className="row" style={{ gap: 4 }}>
              <button className="small ghost" onClick={() => fillAll(cat)} title="全12ヶ月に同じ件数/金額を一括設定">🧰 全月一括</button>
              {WorkerCategoryOrder.filter((c) => c !== 'employment' && c !== cat).map((other) => (
                <button
                  key={`cp-${cat}-${other}`}
                  className="small ghost"
                  onClick={() => copyRow(other, cat)}
                  title={`${WorkerCategoryLabels[other]} の設定をコピー`}
                >
                  📋 {WorkerCategoryLabels[other]}から複製
                </button>
              ))}
              <button className="small ghost" onClick={() => clearRow(cat)}>この行クリア</button>
            </div>
          </div>
          <div className="scroll-x">
            <table style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>項目</th>
                  {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>件数</td>
                  {months.map((m) => {
                    const cell = getCell(cat, m)
                    return (
                      <td key={`cnt-${cat}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min={0}
                          value={cell?.count ?? 0}
                          onChange={(e) => setCell(cat, m, { count: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                          style={{ width: 62, padding: '2px 6px', textAlign: 'right' }}
                        />
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>+円/件/日</td>
                  {months.map((m) => {
                    const cell = getCell(cat, m)
                    return (
                      <td key={`amt-${cat}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          value={cell?.amountPerCaseDay ?? 0}
                          onChange={(e) => setCell(cat, m, { amount: Math.round(Number(e.target.value) || 0) })}
                          style={{ width: 70, padding: '2px 6px', textAlign: 'right' }}
                        />
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* 月次原価影響 合計行 */}
      <div className="card" style={{ background: '#fef2f2', borderColor: '#fca5a5', padding: 10, marginTop: 8 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 6px', color: '#991b1b' }}>
          📊 月次 原価影響 合計（20日換算 ・ 累積）／ 年計: <strong>+¥{yen(Math.round(totalYear))}</strong>
        </h3>
        <div className="scroll-x">
          <table style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th>項目</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>原価増（累積・20日）</td>
                {monthlyImpacts.map((v, i) => (
                  <td
                    key={`imp-${i}`}
                    className="mono"
                    style={{ color: v > 0 ? '#dc2626' : '#94a3b8', textAlign: 'right' }}
                  >
                    {v > 0 ? `+¥${yen(Math.round(v))}` : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          セルに件数 or 単価を入れた月から、それ以降の月に累積で加算されていきます（裏で CostRevision イベントとして自動管理）。
        </div>
      </div>
    </div>
  )
}

/* ====================================================
   単価改定（部分改定・グリッド入力）
   横軸=月(4〜3月)、縦=カテゴリごとに件数+単価を編集、裏で PriceRevision 配列を自動管理
   ==================================================== */
function PriceRevisionsList() {
  const plan = usePlanStore((s) => s.plan)
  const setPlan = usePlanStore((s) => s.setPlan)
  const months = useMemo(() => monthsRange(plan.baseMonth, plan.horizonMonths), [plan.baseMonth, plan.horizonMonths])

  function getCell(cat: WorkerCategory, month: string): PriceRevision | undefined {
    return (plan.priceRevisions ?? []).find((c) => c.category === cat && c.effectiveMonth === month)
  }

  /** セル更新：count / amount / pct のいずれかを patch */
  function setCell(cat: WorkerCategory, month: string, patch: { count?: number; amount?: number; pct?: number }) {
    setPlan((p) => {
      const existing = p.priceRevisions.find((c) => c.category === cat && c.effectiveMonth === month)
      const nextCount = patch.count ?? existing?.count ?? 0
      // amount と pct は排他：どちらかを patch で指定したらもう一方は undefined に
      let nextAmount: number | undefined = existing?.amountPerCaseDay
      let nextPct: number | undefined = existing?.pctOfBase
      if (patch.amount != null) {
        nextAmount = patch.amount > 0 ? patch.amount : undefined
        if (patch.amount > 0) nextPct = undefined
      }
      if (patch.pct != null) {
        nextPct = patch.pct > 0 ? patch.pct : undefined
        if (patch.pct > 0) nextAmount = undefined
      }
      const hasValue = (nextAmount ?? 0) > 0 || (nextPct ?? 0) > 0
      const others = p.priceRevisions.filter((c) => !(c.category === cat && c.effectiveMonth === month))
      if (nextCount === 0 && !hasValue) {
        return { ...p, priceRevisions: others }
      }
      const next: PriceRevision = {
        id: existing?.id ?? newId(),
        effectiveMonth: month,
        category: cat,
        count: nextCount,
        amountPerCaseDay: nextAmount,
        pctOfBase: nextPct,
      }
      return { ...p, priceRevisions: [...others, next] }
    })
  }

  function clearAll() {
    if (!confirm('全ての単価改定を削除しますか？')) return
    setPlan((p) => ({ ...p, priceRevisions: [] }))
  }

  function fillAll(cat: WorkerCategory) {
    const mode = prompt(`${WorkerCategoryLabels[cat]} の全月に一括設定。入力モードを指定（amount or pct）:`, 'amount')
    if (mode !== 'amount' && mode !== 'pct') return
    const c = Number(prompt(`件数を入力:`, '10'))
    if (!Number.isFinite(c) || c < 0) return
    const v = Number(prompt(mode === 'amount' ? `+円/件/日 を入力:` : `+% (単価比) を入力:`, mode === 'amount' ? '500' : '5'))
    if (!Number.isFinite(v) || v < 0) return
    if (c === 0 && v === 0) return
    if (!confirm(`${WorkerCategoryLabels[cat]} の全12ヶ月 に 件数=${c}, ${mode === 'amount' ? '+円/件/日' : '+%'}=${v} を上書きしますか？`)) return
    setPlan((p) => {
      let arr = p.priceRevisions.filter((x) => x.category !== cat)
      for (const m of months) {
        const entry: PriceRevision = {
          id: newId(),
          category: cat,
          effectiveMonth: m,
          count: c,
          ...(mode === 'amount' ? { amountPerCaseDay: v } : { pctOfBase: v }),
        }
        arr = [...arr, entry]
      }
      return { ...p, priceRevisions: arr }
    })
  }

  function copyRow(from: WorkerCategory, to: WorkerCategory) {
    if (from === to) return
    if (!confirm(`${WorkerCategoryLabels[from]} の全月設定を ${WorkerCategoryLabels[to]} にコピーしますか？`)) return
    setPlan((p) => {
      const fromEntries = p.priceRevisions.filter((x) => x.category === from)
      const others = p.priceRevisions.filter((x) => x.category !== to)
      const newTo = fromEntries.map((x) => ({
        id: newId(),
        category: to,
        effectiveMonth: x.effectiveMonth,
        count: x.count,
        amountPerCaseDay: x.amountPerCaseDay,
        pctOfBase: x.pctOfBase,
        memo: x.memo,
      }))
      return { ...p, priceRevisions: [...others, ...newTo] }
    })
  }

  function clearRow(cat: WorkerCategory) {
    if (!confirm(`${WorkerCategoryLabels[cat]} の全月設定をクリアしますか？`)) return
    setPlan((p) => ({ ...p, priceRevisions: p.priceRevisions.filter((x) => x.category !== cat) }))
  }

  // 月次累積売上影響
  const monthlyImpacts = months.map((m) => {
    let total = 0
    for (const pr of plan.priceRevisions ?? []) {
      if (pr.effectiveMonth <= m) {
        const perDay = pr.amountPerCaseDay ?? ((plan.revenuePerCase ?? 0) * (pr.pctOfBase ?? 0) / 100)
        total += pr.count * perDay * 20
      }
    }
    return total
  })
  const totalYear = monthlyImpacts.reduce((s, v) => s + v, 0)

  const catColor = (c: WorkerCategory) =>
    c === 'partner' ? '#2563eb' : c === 'vendor' ? '#7c3aed' : '#059669'

  return (
    <div className="card">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>🟢 単価改定（月別 横軸入力）</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
            各月のセルに <strong>件数</strong> と <strong>+円/件/日</strong>（売上アップ）を入力。入力月以降、売上が継続的に加算されます。
            原価は追随しない＝純マージン改善。
          </div>
        </div>
        <button className="small ghost" onClick={clearAll}>全クリア</button>
      </div>

      {WorkerCategoryOrder.filter((c) => c !== 'employment').map((cat) => (
        <div key={cat} className="card" style={{ background: '#fff', padding: 10, marginTop: 8 }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <h3 style={{ fontSize: 13, margin: 0, color: catColor(cat) }}>
              <span className={`badge ${cat}`}>{WorkerCategoryLabels[cat]}</span>
            </h3>
            <div className="row" style={{ gap: 4 }}>
              <button className="small ghost" onClick={() => fillAll(cat)} title="全12ヶ月に一括設定（amount or pct 選択）">🧰 全月一括</button>
              {WorkerCategoryOrder.filter((c) => c !== 'employment' && c !== cat).map((other) => (
                <button
                  key={`pcp-${cat}-${other}`}
                  className="small ghost"
                  onClick={() => copyRow(other, cat)}
                >
                  📋 {WorkerCategoryLabels[other]}から複製
                </button>
              ))}
              <button className="small ghost" onClick={() => clearRow(cat)}>この行クリア</button>
            </div>
          </div>
          <div className="scroll-x">
            <table style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>項目</th>
                  {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>件数</td>
                  {months.map((m) => {
                    const cell = getCell(cat, m)
                    return (
                      <td key={`pcnt-${cat}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          min={0}
                          value={cell?.count ?? 0}
                          onChange={(e) => setCell(cat, m, { count: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                          style={{ width: 62, padding: '2px 6px', textAlign: 'right' }}
                        />
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>
                    +円/件/日
                    <span className="muted" style={{ fontSize: 9, marginLeft: 4 }}>(amount)</span>
                  </td>
                  {months.map((m) => {
                    const cell = getCell(cat, m)
                    const pctActive = (cell?.pctOfBase ?? 0) > 0
                    return (
                      <td key={`pamt-${cat}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          value={cell?.amountPerCaseDay ?? 0}
                          onChange={(e) => setCell(cat, m, { amount: Math.round(Number(e.target.value) || 0) })}
                          disabled={pctActive}
                          title={pctActive ? '% が入力されているため無効。pct を 0 にすると編集可' : ''}
                          style={{
                            width: 70,
                            padding: '2px 6px',
                            textAlign: 'right',
                            background: pctActive ? '#f1f5f9' : '#fff',
                            color: pctActive ? '#cbd5e1' : undefined,
                          }}
                        />
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>
                    +% (単価比)
                    <span className="muted" style={{ fontSize: 9, marginLeft: 4 }}>(pct)</span>
                  </td>
                  {months.map((m) => {
                    const cell = getCell(cat, m)
                    const amountActive = (cell?.amountPerCaseDay ?? 0) > 0
                    return (
                      <td key={`ppct-${cat}-${m}`} style={{ padding: 2 }}>
                        <input
                          type="number"
                          step={0.1}
                          value={cell?.pctOfBase ?? 0}
                          onChange={(e) => setCell(cat, m, { pct: Number(e.target.value) || 0 })}
                          disabled={amountActive}
                          title={amountActive ? '金額が入力されているため無効' : `= +¥${Math.round((plan.revenuePerCase ?? 0) * (cell?.pctOfBase ?? 0) / 100)}/件/日`}
                          style={{
                            width: 60,
                            padding: '2px 6px',
                            textAlign: 'right',
                            background: amountActive ? '#f1f5f9' : '#fff',
                            color: amountActive ? '#cbd5e1' : undefined,
                          }}
                        />
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
            amount と pct は排他：片方を入れるともう片方はグレーアウト。どちらも 0 にすると行は無効化。
          </div>
        </div>
      ))}

      <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac', padding: 10, marginTop: 8 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 6px', color: '#166534' }}>
          📊 月次 売上影響 合計（20日換算 ・ 累積）／ 年計: <strong>+¥{yen(Math.round(totalYear))}</strong>
        </h3>
        <div className="scroll-x">
          <table style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th>項目</th>
                {months.map((m) => <th key={m}>{formatYmShort(m)}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>売上増（累積・20日）</td>
                {monthlyImpacts.map((v, i) => (
                  <td
                    key={`pimp-${i}`}
                    className="mono"
                    style={{ color: v > 0 ? '#16a34a' : '#94a3b8', textAlign: 'right' }}
                  >
                    {v > 0 ? `+¥${yen(Math.round(v))}` : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          セルに件数と +円 を入れた月から、それ以降の月に累積で売上が加算されます。
          原価は追随しないため、粗利も同額増＝純マージン改善。
        </div>
      </div>
    </div>
  )
}
