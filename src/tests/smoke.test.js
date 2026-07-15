const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

test("required project files exist", () => {
    for (const file of ["app.js", "package.json", ".env.example", "database.sql"]) {
        assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
    }
});

test("package scripts point to existing files", () => {
    const pkg = require(path.join(root, "package.json"));
    assert.match(pkg.scripts.start, /app\.js/);
    assert.match(pkg.scripts.migrate, /src\/config\/runMigration\.js/);
    assert.equal(fs.existsSync(path.join(root, "src/config/runMigration.js")), true);
});
