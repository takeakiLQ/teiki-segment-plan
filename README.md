# 定期セグメント 月次売上・粗利 計画ツール

SES／受託／運用のような "定期セグメント" ビジネス向けに、
**案件ごとの単価・稼働者の原価・条件変更**を組み合わせて
12ヶ月（最大36ヶ月）の月次売上・粗利を計画するWebアプリ。

- フロント: **React + Vite + TypeScript**
- 認証: **Firebase Authentication**（メール / Google）
- 保存: **Firestore**（ユーザーごと）＋ブラウザ `localStorage`
- グラフ: **Recharts**
- デプロイ: **GitHub Pages**（GitHub Actions で自動ビルド）

---

## 1. 主な機能

| ページ | 内容 |
|---|---|
| ダッシュボード | KPI、月次 売上・原価・粗利・粗利率、区分別原価の月次推移 |
| 月次テーブル | 月次明細（売上/原価/区分別/粗利/粗利率/案件数/新規・終了） + CSV エクスポート |
| 案件 | 案件の追加・編集、**単価改定履歴** |
| 稼働者 | パートナー / 協力会社 / D職 / FS の4区分、**仕入単価改定履歴**、区分デフォルト原価率 |
| アサイン | 案件 × 稼働者 の期間管理。**入替・条件変更**を開始/終了月と個別原価率で表現 |
| 設定 | 計画名・基準月・期間、JSON 入出力、サンプル/空リセット |

### 原価計算の優先順位
1. アサインに `個別原価率(%)` が設定されていれば：**案件単価 × 原価率**
2. 稼働者に `月次仕入単価` が設定されていれば：**その金額**
3. それ以外：**案件単価 × 区分デフォルト原価率(%)**

これにより「個別交渉した稼働者」「単価ベースで見ている協力会社」「区分平均で見たいバッファ枠」などが1モデルで扱えます。

---

## 2. セットアップ（ローカル開発）

前提: Node.js 20 以上 / npm。

```bash
cd D:\Claude\定期セグメント_月次推移
npm install
cp .env.example .env   # Firebase を使う場合のみ編集
npm run dev
```

ブラウザで http://localhost:5173 が開きます。  
Firebase を設定していなくても「ログインせずに使う」でローカル保存のまま試せます。

---

## 3. Firebase のセットアップ（任意：ログインとクラウド保存を使う場合）

1. https://console.firebase.google.com/ で**新規プロジェクト作成**
2. 左メニュー **Build → Authentication → Get started**
   - Sign-in method で **Email/Password** と **Google** を有効化
3. 左メニュー **Build → Firestore Database → Create database**（Nativeモード）
4. **プロジェクトの設定（⚙）→ マイアプリ → ウェブアプリ `</>` を追加**
5. 表示される `firebaseConfig` の値を `.env` に貼り付け
   ```env
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
6. **Firestore のセキュリティルール**（`firestore.rules` を参照）
   - Firebase コンソール → Firestore Database → ルール にコピペして公開
   - 各ユーザーは `users/{自分のuid}/...` だけ読み書き可能になります
7. GitHub Pages など別ドメインで使う場合：
   Authentication → Settings → **承認済みドメイン** に
   `<GitHubユーザー名>.github.io` を追加

---

## 4. GitHub Pages 公開手順

### 4-1. リポジトリ作成
GitHub で新規リポジトリ（例: `teiki-segment-plan`）を作成し、ローカルから push：

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/teiki-segment-plan.git
git push -u origin main
```

### 4-2. Pages を有効化
GitHub リポジトリの **Settings → Pages** を開き、
**Source = GitHub Actions** を選択。

### 4-3. Firebase の値を GitHub Secrets に登録（Firebase を使う場合のみ）
Settings → Secrets and variables → **Actions** → **New repository secret** で
`.env` と同じ 6 つのキーを登録：

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

### 4-4. 自動デプロイ
`main` にプッシュすると `.github/workflows/deploy.yml` が自動実行され、
**`https://<ユーザー名>.github.io/<リポジトリ名>/`** に公開されます。

> **base path は自動的にリポジトリ名に合わせる**設定になっています。
> 別の path で公開したい場合は `.env` の `VITE_BASE` を変更してください。

---

## 5. 使い方クイックガイド

1. **設定** で基準月と期間（通常12ヶ月）を指定
2. **案件** で定期収益の源泉となる案件を登録（単価・開始月・終了月）
3. **稼働者** で4区分ごとに人を登録（月次仕入単価 / または 区分デフォルト率を利用）
4. **アサイン** で案件 × 稼働者を紐付け
5. **ダッシュボード / 月次テーブル** で推移を確認し、CSV エクスポート可能

### 条件変更・入替のモデリング

| やりたいこと | モデル |
|---|---|
| 4月から案件の単価を 120万 → 140万 | 案件の「単価改定」に `適用月=2026-04, 新単価=1,400,000` を追加 |
| 6月から稼働者を A さんから B さんに入替 | A のアサインに `終了月=2026-05` を入れ、B を `開始月=2026-06` で追加 |
| 契約更新で仕入単価が上がる | 稼働者の「仕入単価改定」に適用月と新金額を登録 |
| 特定のアサインだけ原価率を固定 | アサインの「個別原価率」に % を入力 |

---

## 6. ディレクトリ構成

```
定期セグメント_月次推移/
├── .github/workflows/deploy.yml   # GitHub Actions（Pages 自動デプロイ）
├── firestore.rules                 # Firestore のセキュリティルール
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig*.json
├── .env.example
└── src/
    ├── main.tsx / App.tsx / styles.css
    ├── firebase.ts                 # Firebase 初期化 + Auth ラッパ
    ├── store.ts                    # zustand ストア（+ Firestore 永続化）
    ├── types.ts                    # ドメイン型
    ├── utils/
    │   ├── month.ts                # yyyy-mm 演算
    │   └── calculations.ts         # 月次集計ロジック
    └── components/
        ├── Login.tsx
        ├── Dashboard.tsx
        ├── MonthlyTable.tsx
        ├── ProjectsPanel.tsx
        ├── WorkersPanel.tsx
        ├── AssignmentsPanel.tsx
        └── SettingsPanel.tsx
```

---

## 7. ライセンス

社内ツールとして自由にご利用ください。
