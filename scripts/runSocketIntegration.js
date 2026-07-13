const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

const root = require('path').join(__dirname, '..');
const dbConfig = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, socketPath: process.env.DB_SOCKET_PATH || undefined };
const run = (cmd, args, env) => new Promise((resolve, reject) => { const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', d => { out += d; process.stdout.write(d); }); p.stderr.on('data', d => { out += d; process.stderr.write(d); }); p.on('error', reject); p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}\n${out}`))); });
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const waitForHttp = (port) => new Promise((resolve, reject) => { const started = Date.now(); const poll = () => { const req = http.get(`http://127.0.0.1:${port}/login`, res => { res.resume(); if (res.statusCode && res.statusCode < 500) return resolve(); setTimeout(poll, 100); }); req.on('error', () => Date.now() - started > 30000 ? reject(new Error('server startup timeout')) : setTimeout(poll, 100)); }; poll(); });

(async () => {
  const db = `schoolsync_socket_${Date.now()}`;
  const port = await freePort();
  let app;
  const env = { DB_NAME: db, NODE_ENV: 'test', PORT: String(port), SESSION_SECRET: 'socket-test-session', JWT_SECRET: 'socket-test-jwt', SEED_DEMO_PASSWORD: 'SocketDemo#2026', SUPER_ADMIN_PASSWORD: 'SocketAdmin#2026' };
  try {
    let c = await mysql.createConnection({ ...dbConfig, multipleStatements: true });
    await c.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.end();
    c = await mysql.createConnection({ ...dbConfig, database: db, multipleStatements: true });
    await c.query(fs.readFileSync(`${root}/database.sql`, 'utf8')); await c.end();
    await run(process.execPath, ['seed.js'], env);
    await run(process.execPath, ['src/config/runMigration.js'], env);
    c = await mysql.createConnection({ ...dbConfig, database: db });
    await c.query("UPDATE transport_trips SET status='running', trip_date=CURDATE() WHERE id=1");
    await c.query('UPDATE transport_trip_students SET student_id=1 WHERE id=1');
    await c.end();
    app = spawn(process.execPath, ['app.js'], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
    await waitForHttp(port);
    await run(process.execPath, ['scripts/socket-final-test.js'], { ...env, SOCKET_TEST_URL: `http://127.0.0.1:${port}` });
  } finally {
    if (app && !app.killed) { app.kill('SIGTERM'); await new Promise(resolve => app.once('exit', resolve)); }
    const c = await mysql.createConnection(dbConfig).catch(() => null);
    if (c) { try { await c.query(`DROP DATABASE IF EXISTS \`${db}\``); } finally { await c.end(); } }
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
