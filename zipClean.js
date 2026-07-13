const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const rootDir = __dirname;
const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const outputName = `SchoolSync-clean-${timestamp}.zip`;
const outputPath = path.join(rootDir, outputName);

const excluded = [
    ".git/**",
    ".git",
    ".env",
    ".env.*",
    "!.env.example",
    "node_modules/**",
    "storage/**",
    "src/public/uploads/**",
    "uploads/**",
    "logs/**",
    "coverage/**",
    "dist/**",
    "build/**",
    ".cache/**",
    "__MACOSX/**",
    ".DS_Store",
    "**/.DS_Store",
    "*.log",
    "*.zip",
    "backup*.sql",
    "*_backup.sql",
    "schoolsync_backup*.sql"
];

function ensureZipAvailable() {
    try {
        execFileSync("zip", ["-v"], { stdio: "ignore" });
    } catch (err) {
        console.error("The `zip` command is required to create a clean archive.");
        process.exit(1);
    }
}

function createArchive() {
    if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
    }

    const args = ["-r", outputName, "."];
    for (const pattern of excluded) {
        args.push("-x", pattern);
    }

    execFileSync("zip", args, {
        cwd: rootDir,
        stdio: "inherit"
    });
    console.log(`Created ${outputName}`);
}

ensureZipAvailable();
createArchive();
