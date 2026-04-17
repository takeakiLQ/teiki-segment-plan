// 月文字列ユーティリティ（yyyy-mm）

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export function toYm(year: number, month1: number): string {
  // month1 は 1..12
  return `${year}-${pad2(month1)}`
}

export function parseYm(ym: string): { year: number; month1: number } {
  const [y, m] = ym.split('-').map(Number)
  return { year: y, month1: m }
}

/** ym に months を足した yyyy-mm を返す */
export function addMonths(ym: string, months: number): string {
  const { year, month1 } = parseYm(ym)
  const total = year * 12 + (month1 - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return toYm(ny, nm)
}

/** base から horizon 個分の yyyy-mm 配列 */
export function monthsRange(baseMonth: string, horizon: number): string[] {
  const arr: string[] = []
  for (let i = 0; i < horizon; i++) arr.push(addMonths(baseMonth, i))
  return arr
}

/** a <= b */
export function ymLte(a: string, b: string): boolean {
  return a.localeCompare(b) <= 0
}
/** a < b */
export function ymLt(a: string, b: string): boolean {
  return a.localeCompare(b) < 0
}

/** 今月 yyyy-mm */
export function thisYm(): string {
  const d = new Date()
  return toYm(d.getFullYear(), d.getMonth() + 1)
}

export function formatYmJa(ym: string): string {
  const { year, month1 } = parseYm(ym)
  return `${year}年${month1}月`
}

export function formatYmShort(ym: string): string {
  const { year, month1 } = parseYm(ym)
  return `${String(year).slice(2)}/${pad2(month1)}`
}
