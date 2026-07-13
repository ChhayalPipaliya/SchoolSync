const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationRunner = require("../config/runMigration");
const seed = require("../../seed");

test("migration splitter preserves quoted semicolons and ordered migration files", () => {
    const statements = migrationRunner.splitStatements("INSERT INTO x(v) VALUES ('a;b'); UPDATE x SET v='c';");
    assert.equal(statements.length, 2);
    const files = migrationRunner.getMigrationFiles().map((file) => path.basename(file));
    assert.deepEqual(files, [...files].sort());
    assert.ok(files.includes("001_transport_active_trip_guards.sql"));
    assert.ok(files.includes("002_normalize_teacher_references.sql"));
});

test("production seed reset is refused and destructive reset requires both flags", () => {
    const credentials = { demoPassword: "strong-demo", superAdminPassword: "strong-admin" };
    assert.throws(
        () => seed.validateSeedConfiguration({ ...credentials, hasResetFlag: true, hasResetConfirmation: false }),
        /requires both --reset and --yes/
    );
    assert.throws(
        () => seed.validateSeedConfiguration({ ...credentials, hasResetFlag: true, hasResetConfirmation: true, nodeEnv: "production" }),
        /Refusing to reset demo data/
    );
    assert.doesNotThrow(() => seed.validateSeedConfiguration({ ...credentials, hasResetFlag: false, hasResetConfirmation: false, nodeEnv: "production" }));
});

test("seed and migration modules are import-safe and do not run automatically", () => {
    const seedSource = fs.readFileSync(path.resolve(__dirname, "../../seed.js"), "utf8");
    const migrationSource = fs.readFileSync(path.resolve(__dirname, "../config/runMigration.js"), "utf8");
    assert.match(seedSource, /require\.main === module/);
    assert.match(migrationSource, /require\.main === module/);
    assert.match(seedSource, /finally[\s\S]*FOREIGN_KEY_CHECKS = 1/);
});
