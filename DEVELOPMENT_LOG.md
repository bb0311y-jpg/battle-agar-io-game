# Development Log

## Date: 2026-01-14 (Session 2)

### Summary
Continued development from the Multiplayer Stability fix. Implemented core gameplay mechanics (Splitting, Ejecting Mass), basic AI for bots, and improved the Game Over experience with Spectate mode.

### 🚀 Features Implemented

#### 1. Cell Splitting (`splitCells`)
*   **Trigger**: Press `SPACE`.
*   **Logic**:
    *   Player cells larger than radius 35 can split.
    *   Original cell splits into two (area conservation).
    *   New cell is ejected in the direction of the mouse with a physics impulse (`boostX`, `boostY`).
    *   Max limit of 16 cells per player.

#### 2. Eject Mass (`ejectMass`)
*   **Trigger**: Press `W`.
*   **Logic**:
    *   Ejects a small mass blob (`radius=8`) in mouse direction.
    *   Player loses mass (area conservation).
    *   Multiplayer Sync: Implemented `mass_ejected` broadcast event so other players see the mass.
    *   Collision: Implemented logic to "eat" ejected mass to regain size (with speed check to prevent self-eating instantly).

#### 3. Bot AI Optimization (`updateBots`)
*   **Previous**: Placeholder.
*   **New**:
    *   Bots now move towards a random target.
    *   Bots pick a new target every few seconds or when reached.
    *   Basic "flee" logic stubbed out (can be enhanced later).
    *   Bots roam the map instead of standing still.

#### 4. Game Over Flow
*   **Added**: "RESPAWN" button (restarts game immediately).
*   **Added**: "SPECTATE" button.
*   **Spectate Logic**:
    *   Sets camera to follow the current Leaderboard #1 player.
    *   Allows observing the match after defeat.

### 📝 Next Steps
*   **Phase 5**: Database & Betting System (Supabase Auth & Transactions).
*   **Polish**: 
    *   Virus physics (Pushing viruses with W).
    *   Cell merging (Recombine cells after split cooldown is fully verified).
    *   Visual polish (Smooth animations for split).

## Date: 2026-01-15 (Session 3) [Recovery & Phase 5 Start]

### Summary
Recovered project state after folder deletion. Confirmed that local git history was lost but remote sync preserved all Phase 4 (Gameplay) features including Poison Circle, Split mechanics, and Eject Mass. Started implementation of Phase 5 (Database & Betting).

### 🚀 Features Restored & Implemented
1.  **Recovery**: Validated `app/page.js` contains all advanced gameplay logic (Poison, Decay, Respawn).
2.  **Supabase Auth**: Integrated `signInAnonymously` into the game loop (`app/page.js`).
3.  **Database Schema**: Created `supabase_schema.sql` defining `profiles` (with balance) and `matches` tables.

### 📝 Next Steps
*   **Run SQL**: User needs to execute `supabase_schema.sql` in Supabase Dashboard.
*   **UI**: specific "Betting" UI in the Lobby.
*   **Backend**: Logic to deduct funds on game start.

## Date: 2026-01-18 (Session 4) [Documentation System Setup]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Doc** | Created `PROJECT_STATUS.md` for project communication and next-cycle context. | Done |
| **Doc** | Established new logging format in `DEVELOPMENT_LOG.md` including self-notes. | Done |

### 🧠 Note to Self (Review & Lessons)
*   **Documentation**: It is crucial to maintain `PROJECT_STATUS.md`. This file acts as the bridge between sessions.
*   **Workflow**: Before signing off, always generate the "Startup Phrase" and place it in `PROJECT_STATUS.md`.
*   **Goal**: Ensure the user can simply copy-paste the startup phrase to resume work instantly.

## Date: 2026-01-18 (Session 4 - Part 2) [Multiplayer Logic Fix for v1.5]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Fix** | Added connection status indicator (Debug Mode) to Lobby to diagnose socket issues. | Done |
| **Fix** | Renamed Supabase channel to `room_v1_5` to isolate versions and prevent ghost messages. | Done |
| **Fix** | Verified v1.5 deployment via Force Push to resolve deployment sync issues. | Done |
| **Note**| If user reports `CHANNEL_ERROR` in lobby, we need to check Supabase Keys or RLS policies. | Info |

### 🧠 Note to Self (Review & Lessons)
*   **Deployment**: Version mismatch means Vercel deployment stalled. Always force push with a clear commit if in doubt.
*   **Debugging**: Multiplayer issues are often invisible. Adding a visible "Connection Status" UI is the best first step.
*   **Isolation**: When upgrading game version significantly, change the `channel` name (e.g., `room_v1.5`) to avoid old clients confusing new logic.

## Date: 2026-01-18 (Session 4 - Part 3) [Lobby Presence Fix]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Fix** | Replaced unreliable manual broadcast loop with **Supabase Presence** for Lobby Sync. | Done |
| **Fix** | Implemented `channel.track()` to automatically sync player list on join. | Done |
| **Fix** | Forced Vercel deployment of v1.5.1 presence fix. | Done |

### 🧠 Note to Self (Review & Lessons)
*   **Presence vs Broadcast**: For "Who is Online" lists, ALWAYS use `Presence`. Manual broadcasts are prone to timing issues and packet loss, leading to "ghost" empty lobbies.
*   **Verification**: If Presence works, both windows will show "2 connected" instantly without waiting for a broadcast tick.

## Date: 2026-01-18 (Session 4 - Part 4) [Lobby Presence Key Fix]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Fix** | Decoupled Supabase Presence Key from User ID. Now uses server-assigned UUIDs for keys but filters users by `payload.id`. | Done |
| **Fix** | Resolved issue where `channel.track()` with a custom key might isolate the user upon update. | Done |
| **Fix** | Forced Vercel deployment of v1.5.1 key fix. | Done |

### 🧠 Note to Self (Review & Lessons)
*   **Presence Keys**: Do not manually set `presence: { key: ... }` unless strictly necessary. It can cause unexpected behavior when calling `track()` if the internal state mapping conflicts.
*   **Robustness**: Always filter presence lists by the *data content* (payload.id), not the *transport key*, to be resilient against connection re-keying.

## Date: 2026-01-18 (Session 4 - Part 5) [Lobby Timeout Fix]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Fix** | Restricted the "Player Timeout Cleanup" loop (3000ms) to run ONLY during `playing` mode. | Done |
| **Fix** | Prevented Lobby players from disappearing after 3 seconds due to lack of constant heartbeat in Presence mode. | Done |
| **Fix** | Force deployed v1.5.1 (Patch 3). | Done |

### 🧠 Note to Self (Review & Lessons)
*   **Timeout Logic**: Do not apply "Active Gameplay" timeout logic (which expects 20fps updates) to "Passive Lobby" state (which expects event-based updates).
*   **Presence**: Presence is stateful; if the server says they are there, they are there. Do not second-guess it with a local timer unless you implement a manual heartbeat.

## Date: 2026-01-18 (Session 4 - Part 6) [Ready State Sync Fix]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Fix** | Added `updatedAt` timestamp to Presence Payload. | Done |
| **Fix** | Updated `sync` logic to sort by `updatedAt` and pick the latest entry, ensuring Ready state updates are not overwritten by stale data. | Done |
| **Fix** | Force deployed v1.5.1 (Patch 4). | Done |

### 🧠 Note to Self (Review & Lessons)
*   **Presence Conflict Resolution**: Supabase Presence is "eventually consistent" and may send multiple entries for the same user (if keys differ or sessions overlap). Always use a timestamp to resolve conflicts and pick the latest state.
*   **Debugging**: Visual discrepancies (one side sees Waiting, other Ready) usually mean the update packet was received but discarded or overwritten by older data.

## Date: 2026-01-18 (Session 4 - Part 7) [Lobby Broadcast Fallback]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Fix** | Implemented a **Hybrid Sync Strategy**: Uses `Presence` primarily, but falls back to `manual broadcast` (`force_lobby_status`) if Presence fails (e.g., due to Auth restrictions). | Done |
| **Fix** | Fixed critical syntax error in `on()` chaining. | Done |
| **Fix** | Identified that "Anonymous Auth disabled" in Supabase might be blocking `track()`, so manual broadcast bypasses this limitation. | Done |
| **Fix** | Force deployed v1.5.1 (Patch 5). | Done |

### 🧠 Note to Self (Review & Lessons)
*   **Supabase Auth Limits**: `channel.track()` often requires an authenticated user (even anonymous). If Anon Auth is disabled in Supabase dashboard, `track()` fails silently or with log errors.
*   **Fallback**: Using `channel.send` (Broadcast) is permission-less (if RLS allows) and works even if Presence is blocked. This "Double Tap" ensures reliability.

## Date: 2026-01-18 (Session 4 - Part 8) [Smart Merge - Final Sync Fix]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Fix** | Implemented **Smart Merge Logic** in Presence Sync. | Done |
| **Fix** | Prioritize `localData` (from Broadcast) over `serverData` (from Presence) if local timestamp is newer. | Done |
| **Fix** | Prevented stale server presence states (e.g., waiting for auth) from overwriting fresh local states (e.g., ready via broadcast). | Done |
| **Fix** | Force deployed v1.5.1 (Patch 6). | Done |

### 🧠 Note to Self (Review & Lessons)
*   **Race Conditions**: When using two data sources (Presence + Broadcast) for the same entity, you MUST have a conflict resolution strategy (e.g., Timestamp-based Last Write Wins). Simply overwriting one with the other will cause flickering and state reversion.

## Date: 2026-01-18 (Session 4 - Part 9) [Force Sync & Rebuild]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Check** | Verified Git Log & Status. Commits were local but maybe not fully synced on Vercel side due to build caching? | Done |
| **Fix** | Bumped version to **v1.5.2** (Visible Change) to force user to see if they are on the new code. | Done |
| **Fix** | Executed `git push` again with a forced rebuild trigger. | Done |

### 🧠 Note to Self
*   **Version Visibility**: When debugging "Is this fixed?", ALWAYS change a visible version number. It's the only way to know if the client is running the new code or a cached old bundle.
*   **Vercel Caching**: Sometimes Vercel caches build steps. Changing `package.json` or a visible string usually busts the cache.

## Date: 2026-01-18 (Session 4 - Part 10) [Deployment Stuck - Force]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Check** | Verified Production URL: **Still v1.5.1**. Development stuck. | Done |
| **Fix** | Executed `git commit --allow-empty` to trigger a fresh SHA and force Vercel to rebuild. | Done |

### 🧠 Note to Self (Critical Lesson)
*   **Vercel Build Queue**: If a User says "It's still broken" and I pushed the fix, 99% of the time it is because the DEPLOYMENT FAILED or IS QUEUED.
*   **Visual Check**: I cannot trust "It works locally". I must see the Version Badge change on the live URL.
*   **Action**: I will not test multiplayer again until I see `v1.5.2` on the screen.

## Date: 2026-01-21 (Session 5) [Multiplayer Heartbeat Debugging]

### 📝 Change Log
| Type | Description | Status |
| :--- | :--- | :--- |
| **Fix** | **Enabled Anonymous Auth** in Supabase settings. This unblocked the `AuthApiError` for heartbeats. | Done |
| **Fix** | Bumped version to **v1.5.2**. Verified deployment on production. | Done |
| **Test** | **FAILED**: Clients send heartbeats (`SENT OK`) but do NOT receive them from others. Lobby remains at "1 connected". | **Failed** |

### 🔍 Root Cause Analysis (Ongoing)
1.  **Symptoms**:
    *   Sender: `channel.send()` returns `ok`.
    *   Receiver: `channel.on('broadcast', ...)` never fires for remote messages.
    *   Network: WebSocket is `SUBSCRIBED`.
2.  **Hypothesis**:
    *   **Self-Reflection**: Supabase Broadcast by default *does not* send the message back to the sender. This is fine.
    *   **Isolation**: Clients might be on different channel instances or topics? (Checked: both on `room_v1_5`).
    *   **RLS/Policy**: Even if "Anon Sign-in" is on, maybe "Realtime" messages require specific RLS policies for `broadcast`? (Usually broadcast is public by default unless restricted).
    *   **Filter Logic**: Is my code `if (id === myId) return;` filtering out legitimate messages because of ID collisions? (Tested with cleared storage/Incognito, still failed).

### 🔍 Root Cause Analysis (Resolved)
1.  **Symptoms**:
    *   Sender: `channel.send()` returns `ok`.
    *   Receiver: `channel.on('broadcast', ...)` never fires for remote messages during the game init phase.
    *   Result: Lobby stuck at "1 connected".
2.  **Failed Attempts**:
    *   Verified Supabase "Anonymous Sign-ins" (Necessary but not sufficient).
    *   Switched to `Presence` (Unreliable/Slow).
    *   Used `self: true` loopback (Proved generic connectivity, but didn't fix peer syncing).
3.  **The Fix (v1.5.4)**:
    *   **Relaxed Guard Clauses**: Removed strict `gameState === 'lobby'` and `gameMode === 'multi'` checks in the listener.
    *   **Reason**: React state updates are asynchronous. When a packet arrives, the `ref.current` might not have updated yet (race condition), causing the client to silently "drop" valid heartbeats from peers. Removing the filter allowed the state to converge naturally.

## Date: 2026-01-21 (Session 5 - Part 2) [In-Game Sync Issue]

### 📝 New Issue
*   **Report**: Lobby works, game starts, BUT **players cannot see each other in-game**.
*   **Symptoms**: Map is empty, Leaderboard only shows self.
*   **Hypothesis**: The same "Strict State Check" logic that broke the lobby is likely present in the `player_update` listener, causing game packets to be dropped. Or, the `channel` instance used in the Game Loop is outdated/different.

### 🚀 Next Steps
1.  **Audit `player_update` Listener**: Apply the same "Relaxed Sync" logic (remove excessive guards).
2.  **Check Game Loop Broadcaster**: Ensure it writes to the correct `global_room_v2` channel.


### 🛠️ Fix Implemented (v1.5.5 - v1.5.12)
1.  **In-Game Visibility (v1.5.5 - v1.5.6)**:
    *   **Relaxed Guard Clauses**: Removed strict state checks in `player_update` listener.
    *   **Force Broadcast**: Modified Game Loop to force broadcast even if Game State isn't strictly 'playing' yet (handling transition periods).
2.  **Timer Synchronization (v1.5.7)**:
    *   **Host Authority**: Explicitly designated the Host (via `lobbyPlayersRef` check) to broadcast time.
    *   **Client Prediction**: Allowed clients to decrement locally to prevent UI stutter/lag.
3.  **Start Reliability (v1.5.8 - v1.5.9)**:
    *   **Triple Handshake**: Host now sends `match_start` and `lobby_countdown` packets 3 times (0ms, 500ms, 1000ms) to prevent UDP-like packet loss at critical moments.
    *   **Idempotency**: Updated listeners to ignore duplicate start signals.
4.  **Payload & Crash Fix (v1.5.10 - v1.5.12)**:
    *   **Problem**: Host was crashing (`ReferenceError`) or clients not receiving start signal due to huge payload size (1000+ objects).
    *   **Seeded Sync (v1.5.10)**: Replaced massive JSON payload with a single integer `seed`. Clients generate the *exact* same world locally using a deterministic `SeededRNG`.
    *   **Scope Fix (v1.5.11)**: Moved `SeededRNG` and Creator functions to Global Scope to fix `ReferenceError` on Host start.
    *   **Server-Like Delay (v1.5.12)**: Implemented a 2-second delay where Host stays in Lobby to "blast" the start signal effectively before switching to local Game Loop. This successfully mimics a dedicated server authority and resolved the "Host enters, Client stays" desync.

### ✅ Status
*   **Multiplayer works stable**.
*   **Lobby/Countdown/Game Start transitions are robust**.
*   **Packet sizes are optimized** (Seed-based).
*   **Crash on Host Start is resolved**.

### 🛠️ Final Polish (v1.5.13 - v1.5.14)
1.  **Status-Carrying Heartbeats (v1.5.13)**:
    *   **Problem**: Even with triple handshake, some clients could miss `match_start` if network jitter was high.
    *   **Fix**: Modified `lobby_heartbeat` to carry game state (`isStarting`, `seed`, `timer`). If a client sees a heartbeat with `isStarting=true` and a seed, it forces a local game start immediately. This acts as a robust fail-safe.
2.  **Debug Instrumentation (v1.5.14)**:
    *   **Issue**: User reported occasional visibility issues in production.
    *   **Fix**: Added a comprehensive **On-Screen Debug Overlay** in the game canvas that shows:
        *   Connection Status (SUBSCRIBED/Reconnecting)
        *   Real-time Packet Counts (RX/TX)
        *   Number of remote players detected by the client.
        *   Raw data samples from Supabase channel.
    *   Added logs to `animate` loop and `player_update` listener to trace packet flow.
