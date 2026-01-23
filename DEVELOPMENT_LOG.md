# DEVELOPMENT LOG

## v2.21 - 2026-01-23
### Phase 7c: Bug Fixes & Precision Control
*   **[Fix]** Trail effect now shows for ALL cells when split (not just first cell).
*   **[Fix]** Continuous input now sends mouseDist for consistent speed.
*   **[Feature]** Mouse Distance Speed Control: Closer mouse = slower speed for precision aiming.
    - 0-50px: 20% speed (precision mode)
    - 50-150px: Scales 20-100%
    - 150+px: Full speed

## v2.20 - 2026-01-23
### Phase 7b: Bug Fix & Final VFX
*   **[Fix]** Mouse Stuck Bug - Player no longer stops when mouse stationary (continuous 50ms input).
*   **[Feature]** Trail Effect - Fading trail behind player when moving.

## v2.19 - 2026-01-23
### Phase 7: Visual Effects Phase 2
*   **[Feature]** Bot Score Display - Shows mass on bot circles.
*   **[Feature]** Virus Glow - Pulsating green glow effect.
*   **[Feature]** Camera Shake - Screen shakes on big score gains (+10+).
*   **[Feature]** Death Particles - Explosion effect particle system.

## v2.18 - 2026-01-23
### Phase 6.6: Visual Effects & UX Enhancements
*   **[Feature]** 10% overlap required for eating (not just touching).
*   **[Feature]** Score popup effects (+N floats up with fade).
*   **[Balance]** Gold color for big gains (+10+), green for small.
*   **[UX]** Minimum 40 mass to shoot bullets.

## v2.17 - 2026-01-23
### Phase 6.5: QA Testing & Bug Fixes
*   **[Fix]** Game Over screen version: v2.02 → v2.16.
*   **[QA]** Comprehensive browser testing completed.
*   **[Doc]** Created QA test report with findings.

## v2.16 - 2026-01-23
### Phase 6.4: Natural Score Decay
*   **[Feature]** Tiered natural decay: 0-50 (0), 51-100 (0.2/s), 101-150 (0.3/s), 151-200 (0.5/s), 201-300 (0.8/s), 301+ (1.0/s).
*   **[Balance]** Outside safe zone: 10x decay rate.
*   **[Doc]** Updated `GAME_RULES.md` with decay table.

## v2.15 - 2026-01-23
### Phase 6.3: Triple Virus Split
*   **[Feature]** Virus split now spawns 3 viruses at -15°, 0°, +15° angles.
*   **[Balance]** Each spawned virus has random mass 100-115.

## v2.14 - 2026-01-23
### Phase 6.2: Browser-Verified Bug Fixes
*   **[Fix]** Virus Distribution: Minimum 300px distance between viruses (no more clustering).
*   **[Fix]** Jackpot: Now spawns at game start (guaranteed visible).
*   **[Fix]** Lobby Version: Updated from v2.06 to v2.13.
*   **[Verify]** Browser test confirmed: Jackpot visible, viruses spread, version consistent.

## v2.13 - 2026-01-23
### Phase 6.1: Rule Simplification
*   **[Core]** Removed 1.01x threshold. Now: `mass > opponent = can eat`.
*   **[Doc]** Created `GAME_RULES.md` with all current game rules.

## v2.12 - 2026-01-23
### Phase 6: Comprehensive Bug Fixes
*   **[Critical Fix]** Added `mass` property to viruses (was `undefined`, breaking all collision logic).
*   **[Fix]** Removed all duplicate code lines (14+ instances).
*   **[Balance]** Merge time: 30s → 10s.
*   **[Balance]** Merge overlap: 80% → 50%.
*   **[Fix]** Bot eating reward: Now correctly uses `c2.mass * 0.4`.
*   **[Fix]** Virus feeding: +5 mass per bullet, explode at 135 mass (7-8 shots).
*   **[Verify]** All automated tests passed.

## v2.11 - 2026-01-22
### Phase 5.8: Mass Standardization
*   **[Core]** Refactored all mechanics to use **Mass** (Score) instead of Radius.
*   **[Balance]** Unified Threshold: `Mass > Target * 1.01` (1% difference).
*   **[Balance]** Eating Rewards: Player (60%), Bot (40%).
*   **[Virus]** Evolution: 100 Mass -> 135 Mass (Explode). Projectile: 100-115 Mass.

## v2.10 - 2026-01-22
### Phase 5.7: Mechanics Restoration
*   **[Core]** Implemented **Cell Merging**: Split cells now recombine after 30s.
*   **[Balance]** Tuned Virus: Requires 8 shots (Radius +10/shot) to explode.
*   **[Fix]** Cleaned up initialization logic for better entity distribution.
*   **[verify]** `verify_physics.js` passed: 8 Shot Burst, Merge Logic, Collision Threshold.

## v2.09 - 2026-01-22
### Phase 5.6: Physics Engine Overhaul
*   **[Core]** Refactored Physics Engine: Decoupled `Impulse` (Explosions/Splits) from `Control` (Mouse Movement).
*   **[Fix]** Fixed Split/Eject Inertia: Cells now slide with friction instead of stopping instantly.
*   **[Fix]** Fixed Virus Explosion: Player cells now scatter correctly upon hitting a virus.

## v2.08 - 2026-01-22
### Phase 5.5: Virus & Threshold Tuning
*   **[Virus]** Implemented "Virus Shooter": Feeding virus shoots projectile.
*   **[Balance]** Unified Interaction Threshold to 1.01x (1%).
*   **[Client]** Enforced Instant Size Updates (No LERP delay).

## v2.06 - 2026-01-22
### Phase 5.5: Physics & Stability Patches
*   **[Critical Fix]** Solved "Rush / Freeze" Bug: Identified that `player.radius` was `undefined` on Server, causing `NaN` Zoom on Client, crashing coordinate system.
*   **[Client]** Added `NaN` input blockers and Camera Auto-Reset logic.
*   **[Server]** Implemented `radius` calculation in Game Loop.
*   **[UX]** Verified smooth player movement and correct viral interaction.

## v2.03 - 2026-01-21
### Phase 4.5: Advanced Mechanics
*   **[Server]** Implemented **Safe Zone Damage**: Players outside safe zone lose 10% score and radius per second (simulated).
*   **[Server]** Implemented **Respawn System**: Death -> 5s Wait -> Respawn with 80% Score.
*   **[Server]** Implemented **W Key (Eject Mass)**: Players can shoot mass (Score > 20).
*   **[Client]** Added **Jackpot Arrow Indicator**: Always points to Jackpot.
*   **[Client]** Added **You Died Screen**: Shows respawn countdown.
*   **[Fix]** Fixed Critical Bug: **Timer Running Too Fast** (Game Loop Double Start).

## v2.02 - 2026-01-21
### Phase 4.1: Bug Fixes & Architecture Stabilization
*   **[Client]** Updated UI Version to v2.02 (Stable).
*   **[Client]** Fixed Safe Zone Rendering (Red Border drawing implementation).
*   **[Server]** Fixed Safe Zone Logic (Shrinking Algorithm).
*   **[Server]** Fixed Game Over Loop (Winner Determination + Event Broadcast).
*   **[Server]** Removed Bots from Leaderboard.
*   **[Feature]** Verified Jackpot Ball Spawning.

## v2.01 - 2026-01-21
### Phase 4: Game Flow Implementation
*   **[Client]** Added `Lobby` and `GameOver` screens to `app/page.js`.
*   **[Client]** Added `v2.01` version indicator to UI.
*   **[Server]** Implemented `waiting` state and `player_ready` logic.
*   **[Server]** Implemented `game_over` event broadcasting winner stats.
*   **[Fix]** Fixed "Black Screen" issue by ensuring Lobby UI is correctly rendered.

## v2.00 - 2026-01-21
### Phase 3: Gameplay Restoration (Server-Authoritative)
*   **[Server]** Implemented Physics: Eating Food, Player vs Player Collision.
*   **[Server]** Implemented Safe Zone (Battle Royale shrinking circle).
*   **[Server]** Implemented Leaderboard Logic (Top 10).
*   **[Client]** Fixed Layout: Forced full-screen rendering.
*   **[Client]** Fixed Leaderboard Status: Added Top Right overlay.
*   **[Status]** Core gameplay loop restored.
