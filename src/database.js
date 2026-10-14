const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'plex-bot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE NOT NULL,
    discord_username TEXT NOT NULL,
    email TEXT,
    plex_username TEXT UNIQUE,
    plex_token TEXT,
    discord_role_ids TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS role_library_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_role_id TEXT NOT NULL,
    discord_role_name TEXT NOT NULL,
    plex_library_id INTEGER NOT NULL,
    plex_library_name TEXT NOT NULL,
    UNIQUE(discord_role_id, plex_library_id)
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );
`);

module.exports = db;
