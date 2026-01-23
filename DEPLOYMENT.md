# 部署指南 (Deployment Guide)

## 🌐 正式站點

**Frontend (Vercel):** https://battle-agar-io-game.vercel.app

## 架構概覽

| 服務 | 用途 | URL |
|------|------|-----|
| **Vercel** | Frontend 託管 (Next.js) | https://vercel.com |
| **Supabase** | 資料庫 & 後端服務 | https://supabase.com |
| **GitHub** | 版本控制 | https://github.com/bb0311y-jpg/battle-agar-io-game |

## 環境變數

```
NEXT_PUBLIC_SUPABASE_URL=https://gtbzevxiixdzakdrvecb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_WAHCRbdYclN3rP6zdQYxlw_XowVxcUs
NEXT_PUBLIC_SERVER_URL=<Backend Socket.io Server URL>
```

## 部署流程

### 1. GitHub
- 將最新代碼推送到 GitHub repository
- Vercel 會自動偵測並部署

### 2. Vercel (Frontend)
- 連結 GitHub repository
- 設定環境變數
- 自動部署 Next.js 前端

### 3. Backend (Socket.io Server)
> ⚠️ **注意**: Vercel 不支援 WebSocket 持久連線
> 需要額外的服務如 Railway 或 Render 來託管 `server.js`

## 注意事項

1. 生產環境需要設定 `NEXT_PUBLIC_SERVER_URL` 指向後端伺服器
2. Socket.io 伺服器需要 CORS 設定
3. Supabase 用於用戶資料和排行榜存儲
