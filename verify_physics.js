
// verify_physics.js
const WORLD_WIDTH = 4500;
const WORLD_HEIGHT = 4500;
const rnd = (max) => Math.random() * max;

class GameRoom {
    constructor() {
        this.players = new Map();
        this.food = [];
        this.viruses = [];
        // Init Virus
        this.viruses.push({
            id: 'v_test', x: 2000, y: 2000,
            radius: 100, isVirus: true
        });

        // Init Player
        this.addPlayer('test_socket', 'Tester');
    }

    addPlayer(id, name) {
        this.players.set(id, {
            id, name,
            x: 0, y: 0,
            cells: [{
                id: `${id}_0`, x: 2000, y: 2000,
                mass: 350, // Radius > 100
                radius: 10 + Math.sqrt(350) * 5, // ~10 + 18.7*5 = 103.5
                vx: 0, vy: 0, mergeTime: 0
            }],
            dead: false
        });
    }

    checkCollision(c1, c2) {
        const dx = c1.x - c2.x;
        const dy = c1.y - c2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist < c1.radius + c2.radius;
    }

    // --- MOCKING SERVER LOGIC ---

    testVirusShotCount() {
        console.log("--- TEST 1: Virus Shot Count ---");
        const v = this.viruses[0];
        v.radius = 100; // Reset
        let bullets = 0;

        // Simulate feeding
        while (v.radius < 180) {
            // Logic from server.js (to be applied)
            // v.radius += 10; (Goal: 8 shots)
            v.radius += 10;
            bullets++;
            console.log(`Shot ${bullets}: Virus Radius = ${v.radius}`);
        }

        if (bullets <= 8) {
            console.log(`✅ PASS: Virus exploded in ${bullets} shots (<= 8).`);
        } else {
            console.log(`❌ FAIL: Virus took ${bullets} shots.`);
        }
    }

    testPlayerVirusCollision() {
        console.log("\n--- TEST 2: Player vs Virus Collision ---");
        const p = this.players.get('test_socket');
        const cell = p.cells[0]; // Mass 350, Radius ~103
        const v = { x: 2000, y: 2000, radius: 100 }; // Overlapping perfectly

        console.log(`Player Radius: ${cell.radius.toFixed(2)} vs Virus Radius: ${v.radius}`);

        // Logic from server.js
        const threshold = 1.01; // 1%
        const isLarger = cell.radius > v.radius * threshold;
        const isColliding = this.checkCollision(cell, v);

        if (isLarger && isColliding) {
            console.log("✅ PASS: Player meets eating criteria (>101% size + colliding).");
        } else {
            console.log(`❌ FAIL: Larger? ${isLarger} Colliding? ${isColliding}`);
        }
    }

    testMerge() {
        console.log("\n--- TEST 3: Cell Merging ---");
        const p = this.players.get('test_socket');
        // Setup 2 cells
        p.cells = [
            { id: 'c1', x: 2000, y: 2000, mass: 100, radius: 60, mergeTime: 0 },
            { id: 'c2', x: 2010, y: 2000, mass: 100, radius: 60, mergeTime: 0 } // Very close
        ];

        const cell = p.cells[0];
        const other = p.cells[1];

        // Logic from server.js
        const dist = Math.sqrt(Math.pow(cell.x - other.x, 2) + Math.pow(cell.y - other.y, 2));
        const combinedRadius = cell.radius + other.radius; // 120
        const mergeThreshold = combinedRadius * 0.8; // 96

        console.log(`Dist: ${dist}, Threshold: ${mergeThreshold}`);

        if (dist < mergeThreshold) {
            console.log("✅ PASS: Cells are close enough to merge.");
            // Apply merge
            cell.mass += other.mass;
            other.mass = 0;
            console.log(`Merged Mass: ${cell.mass} (Expected 200)`);
        } else {
            console.log("❌ FAIL: Cells did not merge.");
        }
    }
}

// Run Tests
const game = new GameRoom();
game.testVirusShotCount();
game.testPlayerVirusCollision();
game.testMerge();
