import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 用の base path
// https://<USER>.github.io/<REPO>/ で公開する場合 base: '/<REPO>/'
// ユーザー/Organization Pages（<USER>.github.io）の場合は '/'
// 環境変数 VITE_BASE で上書き可
const base = process.env.VITE_BASE ?? '/teiki-segment-plan/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
