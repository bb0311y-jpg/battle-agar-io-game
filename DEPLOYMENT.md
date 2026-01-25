# 部署指南 (Deployment Guide)

## 🌐 正式站點

**Frontend (Vercel):** https://battle-agar-io-game.vercel.app
**Backend (Render):** https://battle-agar-io-game.onrender.com

## 架構概覽

| 服務 | 用途 | URL |
|------|------|-----|
| **Vercel** | Frontend 託管 (Next.js) | https://vercel.com |
| **Render** | Backend 伺服器 (Socket.io) | https://render.com |
| **Supabase** | 資料庫 & 後端服務 | https://supabase.com |
| **GitHub** | 版本控制 | https://github.com/bb0311y-jpg/battle-agar-io-game |

## 環境變數

```
NEXT_PUBLIC_SUPABASE_URL=https://gtbzevxiixdzakdrvecb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_WAHCRbdYclN3rP6zdQYxlw_XowVxcUs
NEXT_PUBLIC_SERVER_URL=https://battle-agar-io-game.onrender.com
```

## 部署流程

### 1. GitHub
- 將最新代碼推送到 GitHub repository
- Vercel & Render 會自動偵測並部署

### 2. Vercel (Frontend)
- 連結 GitHub repository
- 設定環境變數
- 自動部署 Next.js 前端

### 3. Render (Backend Socket.io Server)
- 連結 GitHub repository
- Start Command: `node server.js`
- 使用 `process.env.PORT` 環境變數

## 注意事項

1. ✅ `NEXT_PUBLIC_SERVER_URL` 已設定指向 Render 後端伺服器
2. ✅ Socket.io 伺服器已設定 CORS
3. ✅ Supabase 用於用戶資料和排行榜存儲
4. ⚠️ Render 免費方案會在閒置 15 分鐘後休眠，首次連線可能需 30 秒喚醒
