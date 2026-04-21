/**
 * 事業本部（Business Unit）のメタ情報とスイッチ機構。
 *
 * - ドメインモデル（types.ts の Plan / PriorYearPlan 等）は両事業本部で共通
 * - 事業本部ごとにプラン・実績データを独立して保持
 * - ローカルストレージ／Firestore のパスも事業本部別に分離
 */

export type BusinessUnit = 'teiki' | 'urban'

/** UI に並べる順序。既定は先頭。 */
export const BusinessUnitOrder: BusinessUnit[] = ['teiki', 'urban']

/** 事業本部ごとの表示メタ情報 */
export interface BusinessUnitMeta {
  id: BusinessUnit
  /** サイドバー等で使う短縮名 */
  shortName: string
  /** タイトル等で使うフル名 */
  fullName: string
  /** サイドバー先頭の絵文字 */
  icon: string
  /** ブランドカラー（サイドバー H1 と タブのアクティブ色） */
  accent: string
  /** data/ 以下の参照フォルダ（ユーザーが JSON を置く場所） */
  dataDir: string
}

export const BUSINESS_UNITS: Record<BusinessUnit, BusinessUnitMeta> = {
  teiki: {
    id: 'teiki',
    shortName: '定期便',
    fullName: '定期便事業本部',
    icon: '📈',
    accent: '#0284c7',
    dataDir: 'data/teiki',
  },
  urban: {
    id: 'urban',
    shortName: '都市物流',
    fullName: '都市物流事業本部',
    icon: '🏙',
    accent: '#059669',
    dataDir: 'data/urban',
  },
}

/** 既定の事業本部 */
export const DEFAULT_BUSINESS_UNIT: BusinessUnit = 'teiki'

export function isBusinessUnit(v: unknown): v is BusinessUnit {
  return v === 'teiki' || v === 'urban'
}
