PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  baseUrl TEXT NOT NULL,
  apiKey TEXT,
  defaultModelId INTEGER,
  active INTEGER DEFAULT 0,
  protocolConvert INTEGER DEFAULT 0,
  deletedAt DATETIME,
  createdAt DATETIME,
  position INTEGER
);

CREATE TABLE IF NOT EXISTS managed_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER DEFAULT 0,
  createdAt DATETIME,
  position INTEGER
);

CREATE TABLE IF NOT EXISTS provider_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  providerId INTEGER NOT NULL,
  modelId INTEGER NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(providerId, modelId),
  FOREIGN KEY (providerId) REFERENCES providers(id),
  FOREIGN KEY (modelId) REFERENCES managed_models(id)
);

CREATE INDEX IF NOT EXISTS idx_provider_models_providerId ON provider_models(providerId);
CREATE INDEX IF NOT EXISTS idx_provider_providerId ON provider_models(modelId);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  passwordSalt TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  mustChangePassword INTEGER DEFAULT 1,
  enabled INTEGER DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  expiresAt DATETIME NOT NULL,
  revokedAt DATETIME,
  FOREIGN KEY (userId) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_tokenHash ON admin_sessions(tokenHash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_userId ON admin_sessions(userId);

-- 默认管理员账号将由 server/db.js 自动创建: llmpylon / llmpylon
-- 不在此处预插入用户，以确保密码哈希使用正确的 crypto.scryptSync 计算

COMMIT;
