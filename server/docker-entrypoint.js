const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function ensureDbInitialized() {
  const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '../database.sqlite');

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const exists = fs.existsSync(dbPath);
  const size = exists ? fs.statSync(dbPath).size : 0;
  if (exists && size > 0) return;

  const initSqlPath = path.join(__dirname, '../docker/init.sql');
  const sql = fs.readFileSync(initSqlPath, 'utf8');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec(sql);
  await db.close();
}

ensureDbInitialized()
  .then(() => {
    require('./index.js');
  })
  .catch((err) => {
    process.stderr.write(String(err?.stack || err) + '\n');
    process.exit(1);
  });
