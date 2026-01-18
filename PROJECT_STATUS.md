# 專案進度與溝通 (Project Status & Communication)

## 📅 最後更新時間 (Last Updated)
2026-01-18 (Session 4 - Setup)

## ℹ️ 專案概要 (Project Overview)
*   **專案名稱**: Battle Agar.io Game
*   **核心概念**: 結合「大逃殺 (.io)」與「博奕元素」的競技遊戲。玩家透過支付入場費進行對戰，最終存活者贏得獎金。
*   **參考範本**: *Agar.io* (吞噬機制) + *Battle Royale* (縮圈/殊死戰) + *High Stakes* (下注/獎勵)。
*   **目標受眾**: 喜歡短時間、高強度競技與追求勝負報酬的玩家。
*   **遊戲特色**:
    1.  **快速對決**: 限時 1-3 分鐘。
    2.  **勝者全拿**: 積分/體積最大或最後存活者獲勝。
    3.  **即時回饋**: 簡單操作，高強度的視覺反饋。

## 🔗 線上資源與連結 (Links & Resources)
*   **正式站點 (Production)**: `https://battle-agar-io-game.vercel.app` (預設，請確認 Vercel Dashboard)
*   **測試環境 (Development)**: `http://localhost:3000` (Local)
*   **後端服務 (Supabase)**: [Supabase Dashboard](https://supabase.com/dashboard)
    *   負責功能: 身分驗證 (Auth), 即時資料庫 (Realtime DB), 交易紀錄。
*   **部署平台 (Vercel)**: [Vercel Dashboard](https://vercel.com/dashboard)

## 🔐 帳號與權限 (Accounts & Access)
*   **遊戲登入**:
    *   目前使用 **Anonymous Auth (匿名登入)**，無需帳號密碼，進入網頁即可遊玩。
    *   每個瀏覽器 Session 會產生唯一的 User ID。
*   **管理員/開發者帳號**:
    *   **Supabase**: (需填寫/請詢問專案擁有人)
    *   **Vercel**: (需填寫/請詢問專案擁有人)

## 📊 專案當前狀態 (Current Status)
- **目前階段 (Phase)**: Phase 5 - 資料庫與下注系統 (Database & Betting System)
- **最近完成 (Recently Completed)**:
    - 專案檔案復原 (Project Recovery).
    - 加入 Supabase Auth 匿名登入 (Added Supabase Anonymous Auth).
    - 建立資料庫架構檔案 `supabase_schema.sql` (Created DB Schema).
    - 完成核心玩法：分裂(Split)、射擊(Eject Mass)、毒圈(Poison Circle)、AI Bot。
- **待辦事項 (Pending/Todo)**:
    - **確認資料庫設定**: 使用者需在 Supabase Dashboard 執行 SQL。
    - **UI 開發**: 在 Lobby 加入下注介面，顯示餘額。
    - **邏輯開發**: 實作扣款與獎勵邏輯 (Transaction System)。

## ⏭️ 下一步計畫 (Next Steps)
1.  確認 `supabase_schema.sql` 已執行並建立 Tables (profiles, matches)。
2.  修改前端 `app/page.js` 或建立新 Component 以顯示使用者餘額 (Balance)。
3.  實作「加入遊戲前下注」的功能 (Betting UI)。

---

## 🤖 下一次循環啟動語 (Startup Phrase for Next Cycle)
請複製以下區塊文字，在下一次對話提供給我，以便我快速進入狀況：

> **[SYSTEM_RESUME]**
> **Current Phase**: Phase 5 (Database & Betting System)
> **Last Action**: Set up Supabase schema and auth. Ready to implement Betting UI/Logic.
> **Context**:
> - `supabase_schema.sql` defines `profiles` (balance) and `matches`.
> - Check if user has run the SQL migration.
> - Need to implement:
>   1. Betting UI in Lobby.
>   2. Transaction logic (Deduct balance on start, Add on win).
> **Objective**: Continue implementation of the Betting System.
> **Note**: Verify Supabase connection first.
