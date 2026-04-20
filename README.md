# 定期セグメント 月次売上・粗利 計画ツール

数千件規模の定期案件を **個別ではなく カテゴリ別構成比で** 動かしながら、
月次の売上・粗利・粗利率を 12ヶ月（最大36ヶ月）で見通すための Web アプリ。

- フロント: **React + Vite + TypeScript**
- 認証: **Firebase Authentication**（メール / Google）
- 保存: **Firestore**（ユーザーごと）＋ブラウザ `localStorage`
- グラフ: **Recharts**
- デプロイ: **GitHub Pages**（GitHub Actions で自動ビルド）

---

## 1. モデルの考え方（ポートフォリオ型）

案件を1件ずつ管理するのではなく、次の2つで推移をつくります。

### 1-1. カテゴリ（3区分）の **基本パラメータ**
- **運送店 / 業者 / 社員** の3区分について
  - 期首件数（例：運送店 2,500件、業者 1,700件、社員 800件）
  - 1案件あたり月次売上（円）
  - 原価モデル：**原価率(%)** または **1案件あたり金額(円)** のどちらかを選択
    - 例：運送店 = 65%、業者 = 35,000円/案件、社員 = 0% 等

### 1-2. 月次イベント
- **獲得 / 終了**：月 × カテゴリ の2次元グリッドで +N件 / −N件 を入力
- **入替（カテゴリ間移動）**：例「4月に 運送店 50件 → 社員 に切替」
- **条件変更**：「YYYY-MM 以降 運送店の単価を +5,000、原価率を 65→63% に」

### 1-3. 月次計算
```
当月件数 = 前月件数 + 獲得 − 終了 + (流入) − (流出)
売上(カテゴリ) = 件数 × 1案件売上
原価(カテゴリ) = 原価モデルに従う（率 or 額）
粗利 / 粗利率 = 合計売上 − 合計原価
```

過去月の数字は条件変更で書き換わりません（適用月以降のみ反映）。

---

## 2. 画面構成

| ページ | 内容 |
|---|---|
| ダッシュボード | KPI、月次 売上/原価/粗利/粗利率、案件数のカテゴリ別積み上げ |
| 月次テーブル | 月次明細（件数/売上/原価 をカテゴリ別・合計）+ CSV エクスポート |
| カテゴリ設定 | 期首件数と、カテゴリごとの単価・原価モデル・率/金額 |
| 月次イベント | 獲得/終了（グリッド入力）・入替・条件変更 |
| 計画設定 | 計画名・基準月・期間、JSON 入出力、サンプル/空リセット |

---

## 3. セットアップ（ローカル開発）

前提: Node.js 20 以上 / npm。

```bash
cd D:\Claude\定期セグメント_月次推移
npm install
cp .env.example .env   # Firebase を使う場合のみ編集
npm run dev
```

ブラウザで http://localhost:5173 が開きます。
Firebase 未設定でも「ログインせずに使う」でローカル保存のまま試せます。

---

## 4. Firebase のセットアップ（任意：ログインとクラウド保存を使う場合）

1. https://console.firebase.google.com/ で**新規プロジェクト作成**
2. 左メニュー **Build → Authentication → Get started**
   - Sign-in method で **Email/Password** と **Google** を有効化
3. 左メニュー **Build → Firestore Database → Create database**（Native モード）
4. **プロジェクトの設定（⚙）→ マイアプリ → ウェブアプリ `</>` を追加**
5. 表示される `firebaseConfig` の値を `.env` に貼り付け
6. **Firestore のセキュリティルール**（`firestore.rules` を参照）
   - Firebase コンソール → Firestore Database → ルール にコピペして公開
   - 各ユーザーは `users/{自分のuid}/...` だけ読み書き可能
7. GitHub Pages など別ドメインで使う場合：
   Authentication → Settings → **承認済みドメイン** に
   `<GitHubユーザー名>.github.io` を追加

---

## 5. GitHub Pages 公開手順

### 5-1. リポジトリ作成 & 初回プッシュ
```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/teiki-segment-plan.git
git push -u origin main
```

### 5-2. Pages を有効化
GitHub リポジトリの **Settings → Pages** を開き、**Source = GitHub Actions** を選択。

### 5-3. Firebase の値を GitHub Secrets に登録（Firebase を使う場合）
Settings → Secrets and variables → **Actions** → **New repository secret** で `.env` と同じ 6 つのキーを登録：
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

### 5-4. 自動デプロイ
`main` にプッシュすると `.github/workflows/deploy.yml` が自動実行され、
**`https://<ユーザー名>.github.io/<リポジトリ名>/`** に公開されます。

---

## 6. 使い方クイックガイド

1. **計画設定**：基準月と期間（通常12ヶ月）、計画名を決める
2. **カテゴリ設定**：4区分の期首件数と、単価・原価モデルを入れる
   - 例：運送店 2,200件 / 60,000円・原価率65%
   - 例：業者 1,500件 / 55,000円・1案件35,000円
   - 例：社員 800件 / 70,000円・原価率 0%
3. **月次イベント**
   - 獲得/終了タブ：グリッドに直接 +N / -N を入力。右端の「一括」で同値を全月コピーも可能
   - 入替：対象月・移動元・移動先・件数を指定
   - 条件変更：適用月以降に単価や原価を書き換え
4. **ダッシュボード / 月次テーブル**：推移を確認。CSVエクスポート可能

### 条件変更・入替のモデリング例

| やりたいこと | モデル |
|---|---|
| 運送店単価を 4月から +5,000 | 条件変更：適用月 2026-04、対象 運送店、新 1案件売上 65,000 |
| 業者を順次社員化（6月に 200件） | 入替：対象月 2026-06、from 業者、to 社員、件数 200 |
| 毎月 獲得 30件 / 終了 20件 | 獲得/終了タブで一括入力 |
| 一時的に特定月だけ大量終了 | その月のセルにだけ大きい数値を入力 |

---

## 7. ディレクトリ構成

```
定期セグメント_月次推移/
├── .github/workflows/deploy.yml
├── firestore.rules
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig*.json
├── .env.example
└── src/
    ├── main.tsx / App.tsx / styles.css
    ├── firebase.ts
    ├── store.ts
    ├── types.ts
    ├── utils/
    │   ├── month.ts
    │   └── calculations.ts
    └── components/
        ├── Login.tsx
        ├── Dashboard.tsx
        ├── MonthlyTable.tsx
        ├── CategoriesPanel.tsx
        ├── EventsPanel.tsx
        └── SettingsPanel.tsx
```

---

## 8. ライセンス

社内ツールとして自由にご利用ください。
