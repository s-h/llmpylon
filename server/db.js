const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');

async function setupDb() {
    const dbFile = process.env.DB_PATH
        ? path.resolve(process.env.DB_PATH)
        : path.join(__dirname, '../database.sqlite');
    const db = await open({
        filename: dbFile,
        driver: sqlite3.Database
    });

    // Create providers table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL, -- 'openai' or 'anthropic'
            baseUrl TEXT NOT NULL,
            apiKey TEXT,
            defaultModelId INTEGER,
            active INTEGER DEFAULT 0 -- 0 or 1
        )
    `);

    // Create client_keys table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS client_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            key TEXT NOT NULL UNIQUE,
            enabled INTEGER DEFAULT 1, -- 0 or 1
            providerId INTEGER,
            managedModelId INTEGER,
            FOREIGN KEY (providerId) REFERENCES providers(id),
            FOREIGN KEY (managedModelId) REFERENCES managed_models(id)
        )
    `);

    // Create conversation_logs table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            providerId INTEGER,
            clientKeyId INTEGER,
            model TEXT NOT NULL,
            actualModel TEXT,
            requestBody TEXT,
            responseBody TEXT,
            status TEXT DEFAULT 'waiting', -- 'waiting', 'completed', 'error'
            clientUrl TEXT,
            targetUrl TEXT,
            requestAt DATETIME,
            responseAt DATETIME,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (providerId) REFERENCES providers(id),
            FOREIGN KEY (clientKeyId) REFERENCES client_keys(id)
        )
    `);

    // Create managed_models table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS managed_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            active INTEGER DEFAULT 0 -- 0 or 1
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS provider_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            providerId INTEGER NOT NULL,
            modelId INTEGER NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(providerId, modelId),
            FOREIGN KEY (providerId) REFERENCES providers(id),
            FOREIGN KEY (modelId) REFERENCES managed_models(id)
        )
    `);

    await db.exec('CREATE INDEX IF NOT EXISTS idx_provider_models_providerId ON provider_models(providerId)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_provider_models_modelId ON provider_models(modelId)');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS stats_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            appId INTEGER,
            providerId INTEGER,
            requestedModel TEXT,
            actualModel TEXT,
            status TEXT,
            requestAt DATETIME,
            responseAt DATETIME,
            latencyMs INTEGER,
            tokensIn INTEGER,
            tokensOut INTEGER,
            tokensTotal INTEGER,
            errorMessage TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (appId) REFERENCES client_keys(id),
            FOREIGN KEY (providerId) REFERENCES providers(id)
        )
    `);

    await db.exec('CREATE INDEX IF NOT EXISTS idx_stats_events_requestAt ON stats_events(requestAt)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_stats_events_appId ON stats_events(appId)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_stats_events_providerId ON stats_events(providerId)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_stats_events_actualModel ON stats_events(actualModel)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_stats_events_status ON stats_events(status)');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS model_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT NOT NULL,
            targetModel TEXT NOT NULL,
            priority INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.exec('CREATE INDEX IF NOT EXISTS idx_model_rules_enabled_priority ON model_rules(enabled, priority, id)');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            passwordSalt TEXT NOT NULL,
            passwordHash TEXT NOT NULL,
            mustChangePassword INTEGER DEFAULT 1,
            enabled INTEGER DEFAULT 1,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            tokenHash TEXT NOT NULL UNIQUE,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            expiresAt DATETIME NOT NULL,
            revokedAt DATETIME,
            FOREIGN KEY (userId) REFERENCES admin_users(id)
        )
    `);

    await db.exec('CREATE INDEX IF NOT EXISTS idx_admin_sessions_tokenHash ON admin_sessions(tokenHash)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_admin_sessions_userId ON admin_sessions(userId)');

    // Migration: Add apiKey to providers if missing
    const providerCols = await db.all('PRAGMA table_info(providers)');
    if (!providerCols.some(c => c.name === 'apiKey')) {
        await db.exec('ALTER TABLE providers ADD COLUMN apiKey TEXT');
    }
    if (!providerCols.some(c => c.name === 'defaultModelId')) {
        await db.exec('ALTER TABLE providers ADD COLUMN defaultModelId INTEGER');
    }
    if (!providerCols.some(c => c.name === 'protocolConvert')) {
        await db.exec('ALTER TABLE providers ADD COLUMN protocolConvert INTEGER DEFAULT 0');
    }
    if (!providerCols.some(c => c.name === 'deletedAt')) {
        await db.exec('ALTER TABLE providers ADD COLUMN deletedAt DATETIME');
    }
    if (!providerCols.some(c => c.name === 'createdAt')) {
        await db.exec('ALTER TABLE providers ADD COLUMN createdAt DATETIME');
    }
    if (!providerCols.some(c => c.name === 'position')) {
        await db.exec('ALTER TABLE providers ADD COLUMN position INTEGER');
    }
    // Backfill provider position for existing rows
    const unpositionedProviders = await db.all('SELECT id FROM providers WHERE position IS NULL ORDER BY id ASC');
    for (let i = 0; i < unpositionedProviders.length; i++) {
        await db.run('UPDATE providers SET position = ? WHERE id = ?', [i, unpositionedProviders[i].id]);
    }

    // Migration: managed_models columns
    const mmCols = await db.all('PRAGMA table_info(managed_models)');
    if (!mmCols.some(c => c.name === 'createdAt')) {
        await db.exec('ALTER TABLE managed_models ADD COLUMN createdAt DATETIME');
    }
    if (!mmCols.some(c => c.name === 'position')) {
        await db.exec('ALTER TABLE managed_models ADD COLUMN position INTEGER');
    }
    const unpositionedModels = await db.all('SELECT id FROM managed_models WHERE position IS NULL ORDER BY id ASC');
    for (let i = 0; i < unpositionedModels.length; i++) {
        await db.run('UPDATE managed_models SET position = ? WHERE id = ?', [i, unpositionedModels[i].id]);
    }

    // Migration for client_keys
    const keyCols = await db.all('PRAGMA table_info(client_keys)');
    const keyColNames = keyCols.map(c => c.name);
    if (!keyColNames.includes('providerId')) {
        await db.exec('ALTER TABLE client_keys ADD COLUMN providerId INTEGER');
    }
    if (!keyColNames.includes('managedModelId')) {
        await db.exec('ALTER TABLE client_keys ADD COLUMN managedModelId INTEGER');
    }

    // Migration for conversation_logs
    const logCols = await db.all('PRAGMA table_info(conversation_logs)');
    const logColNames = logCols.map(c => c.name);

    if (!logColNames.includes('clientKeyId')) {
        await db.exec('ALTER TABLE conversation_logs ADD COLUMN clientKeyId INTEGER');
    }
    if (!logColNames.includes('requestAt')) {
        await db.exec('ALTER TABLE conversation_logs ADD COLUMN requestAt DATETIME');
    }
    if (!logColNames.includes('responseAt')) {
        await db.exec('ALTER TABLE conversation_logs ADD COLUMN responseAt DATETIME');
    }
    if (!logColNames.includes('clientUrl')) {
        await db.exec('ALTER TABLE conversation_logs ADD COLUMN clientUrl TEXT');
    }
    if (!logColNames.includes('targetUrl')) {
        await db.exec('ALTER TABLE conversation_logs ADD COLUMN targetUrl TEXT');
    }
    if (!logColNames.includes('actualModel')) {
        await db.exec('ALTER TABLE conversation_logs ADD COLUMN actualModel TEXT');
    }

    const logCols2 = await db.all('PRAGMA table_info(conversation_logs)');
    const lcn = logCols2.map((c) => c.name);
    const addLogCol = async (name, ddl) => {
        if (!lcn.includes(name)) {
            await db.exec(`ALTER TABLE conversation_logs ADD COLUMN ${name} ${ddl}`);
            lcn.push(name);
        }
    };
    await addLogCol('clientUserAgent', 'TEXT');
    await addLogCol('proxyUserAgent', 'TEXT');
    await addLogCol('clientIp', 'TEXT');
    await addLogCol('httpMethod', 'TEXT');
    await addLogCol('requestPath', 'TEXT');
    await addLogCol('isStream', 'INTEGER DEFAULT 0');
    await addLogCol('streamBroken', 'INTEGER DEFAULT 0');
    await addLogCol('requestBytes', 'INTEGER');
    await addLogCol('responseBytes', 'INTEGER');
    await addLogCol('latencyMs', 'INTEGER');
    await addLogCol('upstreamStatus', 'INTEGER');
    await addLogCol('clientStatus', 'INTEGER');
    await addLogCol('tokensIn', 'INTEGER');
    await addLogCol('tokensOut', 'INTEGER');
    await addLogCol('tokensTotal', 'INTEGER');
    await addLogCol('clientRequestHeaders', 'TEXT');
    await addLogCol('proxyRequestHeaders', 'TEXT');
    await addLogCol('proxyRequestBody', 'TEXT');
    await addLogCol('proxyResponseBody', 'TEXT');

    // Streaming enhancements
    await addLogCol('ttfbMs', 'INTEGER');
    await addLogCol('chunkCount', 'INTEGER');
    await addLogCol('streamDurationMs', 'INTEGER');
    await addLogCol('disconnectReason', 'TEXT');
    await addLogCol('clientApp', 'TEXT');

    // Migration for stats_events
    const statsEvtCols = await db.all('PRAGMA table_info(stats_events)');
    const statsEvtColNames = statsEvtCols.map(c => c.name);
    const addStatsCol = async (name, ddl) => {
        if (!statsEvtColNames.includes(name)) {
            await db.exec(`ALTER TABLE stats_events ADD COLUMN ${name} ${ddl}`);
        }
    };
    await addStatsCol('isStream', 'INTEGER DEFAULT 0');
    await addStatsCol('ttfbMs', 'INTEGER');
    await addStatsCol('streamDurationMs', 'INTEGER');
    await addStatsCol('chunkCount', 'INTEGER');
    await addStatsCol('responseBytes', 'INTEGER');
    await addStatsCol('streamBroken', 'INTEGER DEFAULT 0');
    await addStatsCol('clientProtocol', 'TEXT');
    await addStatsCol('retryCount', 'INTEGER DEFAULT 0');
    await addStatsCol('upstreamStatus', 'INTEGER');
    await addStatsCol('clientStatus', 'INTEGER');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_stats_events_isStream ON stats_events(isStream)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_stats_events_clientProtocol ON stats_events(clientProtocol)');

    await db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        )
    `);
    await db.run(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('log_retention_days', '0')"
    );
    await db.run(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('stats_retention_days', '0')"
    );
    await db.run(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('upstream_timeout_seconds', '360')"
    );
    await db.run(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('upstream_headers_blocklist', '[\"host\",\"content-length\",\"connection\",\"accept-encoding\"]')"
    );
    await db.run(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('stream_chunk_timeout_seconds', '120')"
    );
    await db.run(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('stream_retry_enabled', '1')"
    );
    await db.run(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('stream_max_retries', '2')"
    );

    const adminUserCols = await db.all('PRAGMA table_info(admin_users)');
    const adminUserColNames = adminUserCols.map(c => c.name);
    if (!adminUserColNames.includes('mustChangePassword')) {
        await db.exec('ALTER TABLE admin_users ADD COLUMN mustChangePassword INTEGER DEFAULT 1');
    }
    if (!adminUserColNames.includes('enabled')) {
        await db.exec('ALTER TABLE admin_users ADD COLUMN enabled INTEGER DEFAULT 1');
    }

    const existingAdminCount = await db.get('SELECT COUNT(*) as cnt FROM admin_users');
    if (!existingAdminCount || !existingAdminCount.cnt) {
        const password = 'llmpylon';
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        await db.run(
            'INSERT INTO admin_users (username, passwordSalt, passwordHash, mustChangePassword, enabled) VALUES (?, ?, ?, ?, ?)',
            ['llmpylon', salt, hash, 1, 1]
        );
    }

    const activeProvider = await db.get('SELECT id FROM providers WHERE active = 1');
    if (activeProvider) {
        const linksCount = await db.get('SELECT COUNT(*) as cnt FROM provider_models WHERE providerId = ?', [activeProvider.id]);
        if (!linksCount?.cnt) {
            await db.exec(
                `
                INSERT OR IGNORE INTO provider_models (providerId, modelId)
                SELECT ?, m.id FROM managed_models m
                `,
                [activeProvider.id]
            );
        }
        const providerHasDefault = await db.get('SELECT defaultModelId FROM providers WHERE id = ?', [activeProvider.id]);
        if (!providerHasDefault?.defaultModelId) {
            const legacyDefault = await db.get('SELECT id FROM managed_models WHERE active = 1');
            if (legacyDefault) {
                await db.run('UPDATE providers SET defaultModelId = ? WHERE id = ?', [legacyDefault.id, activeProvider.id]);
            }
        }
    }

    return db;
}

module.exports = setupDb;
