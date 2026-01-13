# 遊戲開發實作計畫 (Game Implementation Plan)

## 專案資訊
*   **專案名稱**: battle-agar-io-game
*   **技術棧**: Next.js (App Router), Supabase (Auth, DB, Realtime), HTML5 Canvas
*   **目標**: 多人連線對戰網頁遊戲，包含博奕要素。

## Phase 1: 基礎建設與遊戲迴圈 (Infrastructure & Game Loop)
- [x] 初始化 Next.js 專案
- [x] 安裝 Supabase Client
- [x] 建立 Git 版控
- [x] **Task 1.1**: 設置基礎頁面與 Canvas 畫布
    - 建立 `/game` 路由
    - 實作全螢幕 Canvas
    - 實作基本的遊戲迴圈 (Game Loop): `requestAnimationFrame`
    - 實作玩家控制 (滑鼠跟隨)
- [ ] **Task 1.2**: 玩家物件 (Player Entity)
    - 定義玩家屬性 (x, y, radius, color, score)
    - 繪製玩家圓球

## Phase 2: 多人連線同步 (Multiplayer Synchronization)
- [x] **Task 2.1**: Supabase Realtime Setup
    - 設定 Supabase Client 連線
    - 建立 `room` (channel) 訂閱機制
- [x] **Task 2.2**: 狀態同步 (State Sync)
    - 廣播玩家位置 (Broadcast coordinates)
    - 接收其他玩家位置並渲染
    - 處理玩家斷線移除
- [ ] **Task 2.3**: 延遲補償 (Client-side Prediction) - *視情況加入*
    - 簡單的內插 (Interpolation) 使移動平滑

## Phase 3: 遊戲邏輯與勝負 (Game Logic & Rules)
- [x] **Task 3.1**: 碰撞檢測 (Collision Detection)
    - 判定玩家與食物的碰撞 (得分/變大)
    - 判定玩家與玩家的碰撞 (大吃小/擊殺)
- [x] **Task 3.2**: 勝負判定 (Win Condition)
    - 加入倒數計時器 (120秒)
    - 時間結束時判定最高分者勝
    - 顯示結算畫面

## Phase 4: 進階機制 (Advanced Mechanics)
- [x] **Task 4.1**: 分裂與物理 (Split & Physics)
    - 空白鍵分裂
    - 分裂後的推進力 (Impulse)
    - 細胞合併冷卻 (Merge Cooldown)
- [x] **Task 4.2**: AI 機器人 (Bots)
    - 簡單的隨機移動機器人
    - 可被玩家吞噬
## Phase 4: 資料庫與博奕系統 (Database & Betting)
- [ ] **Task 4.1**: Supabase Auth
    - 實作匿名登入或簡易 Email 登入
- [ ] **Task 4.2**: 資金系統
    - 建立 `profiles` table (id, username, balance)
    - 建立 `matches` table (match_id, winner_id, prize_pool)
    - 遊戲開始前扣除入場費
    - 遊戲結算後發放獎金 (透過 Edge Function 或 Client 端簡易實作)

## Phase 5: UI/UX 優化
- [x] **Task 5.1**: 主選單 (Main Menu)
    - 輸入暱稱
    - 選擇房間/開始遊戲
- [x] **Task 5.2**: HUD 介面
    - 顯示時間、分數、排名
- [x] **Task 5.3**: 美術與特效
    - 背景網格
    - 粒子特效 (死亡/吃球) - *部份實作 (病毒與重繪)*

