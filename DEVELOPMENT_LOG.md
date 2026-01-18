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
