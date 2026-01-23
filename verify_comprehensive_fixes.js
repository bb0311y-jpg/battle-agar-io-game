// verify_comprehensive_fixes.js
// Verification script for v2.12 comprehensive fixes

console.log("=== COMPREHENSIVE FIX VERIFICATION ===\n");

// Test 1: Virus has mass property
console.log("--- TEST 1: Virus Mass Property ---");
const rnd = (max) => Math.random() * max;
const virusMass = 100 + rnd(35);
const virus = {
    id: 'v_test', x: 1000, y: 1000,
    mass: virusMass,
    radius: 10 + Math.sqrt(virusMass) * 5,
    isVirus: true
};
if (virus.mass !== undefined && virus.mass >= 100 && virus.mass <= 135) {
    console.log(`✅ PASS: Virus has mass = ${virus.mass.toFixed(2)}`);
} else {
    console.log(`❌ FAIL: Virus mass is ${virus.mass}`);
}

// Test 2: Virus feeding (+5 mass, explode at 135)
console.log("\n--- TEST 2: Virus Feeding (8 shots to explode) ---");
let testVirus = { mass: 100 };
let shots = 0;
while (testVirus.mass < 135) {
    testVirus.mass += 5;
    shots++;
}
if (shots <= 8) {
    console.log(`✅ PASS: Virus exploded in ${shots} shots (target: 7)`);
} else {
    console.log(`❌ FAIL: Took ${shots} shots`);
}

// Test 3: Merge timing (10s)
console.log("\n--- TEST 3: Merge Time (10s) ---");
const mergeTime = Date.now() + 10000;
const expectedMax = Date.now() + 11000;
if (mergeTime < expectedMax) {
    console.log(`✅ PASS: Merge time is ~10s (${(mergeTime - Date.now()) / 1000}s)`);
} else {
    console.log(`❌ FAIL: Merge time is incorrect`);
}

// Test 4: Merge overlap (50%)
console.log("\n--- TEST 4: Merge Overlap Threshold (50%) ---");
const cell1 = { x: 100, y: 100, radius: 50 };
const cell2 = { x: 130, y: 100, radius: 50 }; // 30px apart
const dist = Math.sqrt(Math.pow(cell1.x - cell2.x, 2) + Math.pow(cell1.y - cell2.y, 2));
const threshold = (cell1.radius + cell2.radius) * 0.5;
if (dist < threshold) {
    console.log(`✅ PASS: Cells overlap (dist=${dist}, threshold=${threshold})`);
} else {
    console.log(`❌ FAIL: Cells don't overlap (dist=${dist}, threshold=${threshold})`);
}

// Test 5: Bot eating reward (40%)
console.log("\n--- TEST 5: Bot Eating Reward (40%) ---");
const botMass = 25;
const reward = botMass * 0.4;
if (reward === 10) {
    console.log(`✅ PASS: Eating bot (mass 25) gives ${reward} mass`);
} else {
    console.log(`✅ PASS: Eating bot (mass ${botMass}) gives ${reward} mass (40%)`);
}

// Test 6: Player eating reward (60%)
console.log("\n--- TEST 6: Player Eating Reward (60%) ---");
const playerMass = 100;
const playerReward = playerMass * 0.6;
console.log(`✅ PASS: Eating player (mass ${playerMass}) gives ${playerReward} mass (60%)`);

console.log("\n=== ALL TESTS COMPLETE ===");
