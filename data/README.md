# data/ — 業務データ（非公開）

このフォルダには**会計実績・予算・計画** 等の機密データを置きます。
`.gitignore` で除外されているため、**git add / commit されません**（このREADMEのみ例外）。

## 典型的なファイル

| ファイル名 | 用途 | 読込み先の画面 |
|---|---|---|
| `fy2025.json` | FY2025 売上・粗利実績 | 📆 前年実績 → JSONインポート |
| `fy2025-workingdays.json` | FY2025 月別営業日数 | 📆 前年実績 → JSONインポート |
| `fy2026-workingdays.json` | FY2026 月別営業日数 | ⚙️ 計画設定 → 月ごとの計算日数 → JSON読み込み |
| `plan-export.json` | 全計画のバックアップ | ⚙️ 計画設定 → JSONインポート |

## 運用ルール

- このフォルダの JSON は**絶対に公開リポジトリに push しない**
- 共有が必要な場合は、**社内ストレージ**（SharePoint / Box / Google Drive 等）経由でやり取り
- サンプル・スキーマ例は `docs/` や README 内に**ダミー値**で記載する

## フォルダを間違えてコミットしそうになったら

```bash
# ステージングから外す（ローカルファイルは残る）
git rm --cached -r data/

# 念のため .gitignore が効いているか確認
git check-ignore -v data/fy2025.json
```
