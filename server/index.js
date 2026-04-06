const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const setupDb = require('./db');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Axios instance with keep-alive and longer timeout
const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: 300000, // 5 minutes
});
const io = new Server(server, {
    cors: {
        origin: "*",
    }
});

app.use(cors());
app.use(bodyParser.json({ limit: '1000mb' }));
app.use(bodyParser.urlencoded({ limit: '1000mb', extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

let db;

function extractUsage(payload) {
    const pickFromUsage = (usage) => {
        if (!usage || typeof usage !== 'object') return null;
        if (typeof usage.prompt_tokens === 'number' || typeof usage.completion_tokens === 'number' || typeof usage.total_tokens === 'number') {
            const tokensIn = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
            const tokensOut = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
            const tokensTotal = typeof usage.total_tokens === 'number' ? usage.total_tokens : (tokensIn + tokensOut);
            return { tokensIn, tokensOut, tokensTotal };
        }
        if (typeof usage.input_tokens === 'number' || typeof usage.output_tokens === 'number') {
            const tokensIn = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
            const tokensOut = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
            const tokensTotal = tokensIn + tokensOut;
            return { tokensIn, tokensOut, tokensTotal };
        }
        return null;
    };

    if (!payload) return { tokensIn: 0, tokensOut: 0, tokensTotal: 0 };

    if (typeof payload === 'object') {
        const usage = pickFromUsage(payload.usage);
        return usage || { tokensIn: 0, tokensOut: 0, tokensTotal: 0 };
    }

    if (typeof payload !== 'string') return { tokensIn: 0, tokensOut: 0, tokensTotal: 0 };

    try {
        const json = JSON.parse(payload);
        if (json && typeof json === 'object') {
            const usage = pickFromUsage(json.usage);
            return usage || { tokensIn: 0, tokensOut: 0, tokensTotal: 0 };
        }
    } catch (e) {
    }

    let lastUsage = null;
    const lines = payload.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.replace(/^data:\s*/, '').trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
            const obj = JSON.parse(dataStr);
            const usage = pickFromUsage(obj?.usage);
            if (usage) lastUsage = usage;
        } catch (e) {
        }
    }

    return lastUsage || { tokensIn: 0, tokensOut: 0, tokensTotal: 0 };
}

function normalizeStatsRange(range) {
    const now = new Date();
    if (!range || range === '30d') return { range: '30d', from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };
    if (range === '7d') return { range: '7d', from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
    if (range === '90d') return { range: '90d', from: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), to: now };
    if (range === 'all') return { range: 'all', from: null, to: now };
    return { range: '30d', from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };
}

function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr);
}

function applyModelRules(requestedModel, rules) {
    if (!requestedModel) return { matched: false, actualModel: requestedModel, rule: null };
    for (const rule of rules) {
        try {
            const re = wildcardToRegExp(rule.pattern);
            if (re.test(requestedModel)) {
                return { matched: true, actualModel: rule.targetModel, rule };
            }
        } catch (e) {
        }
    }
    return { matched: false, actualModel: requestedModel, rule: null };
}

function sha256Hex(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function hashPassword(password, saltHex) {
    return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

function verifyPassword(password, saltHex, expectedHashHex) {
    const actual = Buffer.from(hashPassword(password, saltHex), 'hex');
    const expected = Buffer.from(expectedHashHex, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
}

async function requireAdminAuth(req, res, next) {
    if (!db) return res.status(503).json({ error: 'DB not ready' });
    const auth = req.headers['authorization'] || '';
    const parts = auth.split(' ');
    const token = parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const tokenHash = sha256Hex(token);
    const nowIso = new Date().toISOString();
    const session = await db.get(
        `
        SELECT s.id as sessionId, u.id as userId, u.username, u.mustChangePassword, u.enabled
        FROM admin_sessions s
        JOIN admin_users u ON s.userId = u.id
        WHERE s.tokenHash = ? AND s.revokedAt IS NULL AND s.expiresAt > ?
        `,
        [tokenHash, nowIso]
    );
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    if (!session.enabled) return res.status(403).json({ error: 'User disabled' });

    req.adminUser = {
        id: session.userId,
        username: session.username,
        mustChangePassword: session.mustChangePassword ? 1 : 0
    };
    req.adminSessionId = session.sessionId;
    return next();
}

io.use(async (socket, next) => {
    if (!db) return next(new Error('DB not ready'));
    const token = socket.handshake?.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    const tokenHash = sha256Hex(token);
    const nowIso = new Date().toISOString();
    const session = await db.get(
        `
        SELECT u.id as userId, u.username, u.mustChangePassword, u.enabled
        FROM admin_sessions s
        JOIN admin_users u ON s.userId = u.id
        WHERE s.tokenHash = ? AND s.revokedAt IS NULL AND s.expiresAt > ?
        `,
        [tokenHash, nowIso]
    );
    if (!session) return next(new Error('Unauthorized'));
    if (!session.enabled) return next(new Error('User disabled'));
    if (session.mustChangePassword) return next(new Error('Must change password'));
    socket.adminUser = { id: session.userId, username: session.username, mustChangePassword: session.mustChangePassword ? 1 : 0 };
    return next();
});

io.on('connection', (socket) => {
    socket.join('admins');
    console.log('admin connected');
    socket.on('disconnect', () => {
        console.log('admin disconnected');
    });
});

app.use('/api', async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (req.path === '/auth/login') return next();
    return requireAdminAuth(req, res, () => {
        if (req.adminUser?.mustChangePassword) {
            if (req.path !== '/auth/change-password' && req.path !== '/auth/logout' && req.path !== '/auth/me') {
                return res.status(403).json({ error: 'Must change password' });
            }
        }
        return next();
    });
});

app.get('/healthz', (req, res) => {
    res.json({ ok: true, proxy: true, time: new Date().toISOString() });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
    const user = await db.get('SELECT * FROM admin_users WHERE username = ?', [username]);
    if (!user) return res.status(403).json({ error: 'Invalid credentials' });
    if (!user.enabled) return res.status(403).json({ error: 'User disabled' });
    if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) return res.status(403).json({ error: 'Invalid credentials' });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.run('INSERT INTO admin_sessions (userId, tokenHash, expiresAt) VALUES (?, ?, ?)', [user.id, tokenHash, expiresAt]);
    res.json({
        token,
        user: { id: user.id, username: user.username },
        mustChangePassword: user.mustChangePassword ? true : false
    });
});

app.get('/api/auth/me', async (req, res) => {
    res.json({ user: req.adminUser, mustChangePassword: !!req.adminUser.mustChangePassword });
});

app.post('/api/auth/logout', async (req, res) => {
    const nowIso = new Date().toISOString();
    await db.run('UPDATE admin_sessions SET revokedAt = ? WHERE id = ?', [nowIso, req.adminSessionId]);
    res.sendStatus(200);
});

app.post('/api/auth/change-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ error: 'Missing newPassword' });
    const user = await db.get('SELECT * FROM admin_users WHERE id = ?', [req.adminUser.id]);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!verifyPassword(currentPassword || '', user.passwordSalt, user.passwordHash)) return res.status(403).json({ error: 'Invalid credentials' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(newPassword, salt);
    await db.run('UPDATE admin_users SET passwordSalt = ?, passwordHash = ?, mustChangePassword = 0 WHERE id = ?', [salt, hash, user.id]);
    res.sendStatus(200);
});

app.get('/api/users', async (req, res) => {
    const users = await db.all('SELECT id, username, mustChangePassword, enabled, createdAt FROM admin_users ORDER BY id ASC');
    res.json(users);
});

app.post('/api/users', async (req, res) => {
    const { username, password, enabled } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    await db.run(
        'INSERT INTO admin_users (username, passwordSalt, passwordHash, mustChangePassword, enabled) VALUES (?, ?, ?, ?, ?)',
        [username, salt, hash, 1, enabled === undefined ? 1 : (enabled ? 1 : 0)]
    );
    res.sendStatus(201);
});

app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username, enabled } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Missing username' });
    await db.run('UPDATE admin_users SET username = ?, enabled = ? WHERE id = ?', [username, enabled ? 1 : 0, id]);
    res.sendStatus(200);
});

app.post('/api/users/:id/reset-password', async (req, res) => {
    const { id } = req.params;
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Missing password' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    await db.run('UPDATE admin_users SET passwordSalt = ?, passwordHash = ?, mustChangePassword = 1 WHERE id = ?', [salt, hash, id]);
    await db.run('UPDATE admin_sessions SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL', [new Date().toISOString(), id]);
    res.sendStatus(200);
});

app.delete('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    if (Number(id) === Number(req.adminUser.id)) return res.status(400).json({ error: 'Cannot delete current user' });
    await db.run('UPDATE admin_sessions SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL', [new Date().toISOString(), id]);
    await db.run('DELETE FROM admin_users WHERE id = ?', [id]);
    res.sendStatus(200);
});

// Providers API
app.get('/api/providers', async (req, res) => {
    const providers = await db.all('SELECT * FROM providers ORDER BY id ASC');
    const models = await db.all(
        `
        SELECT pm.providerId, m.id as modelId, m.name as modelName
        FROM provider_models pm
        JOIN managed_models m ON pm.modelId = m.id
        ORDER BY m.name ASC
        `
    );
    const modelsByProvider = new Map();
    for (const row of models) {
        if (!modelsByProvider.has(row.providerId)) modelsByProvider.set(row.providerId, []);
        modelsByProvider.get(row.providerId).push({ id: row.modelId, name: row.modelName });
    }
    const enriched = providers.map((p) => ({
        ...p,
        models: modelsByProvider.get(p.id) || []
    }));
    res.json(enriched);
});

app.post('/api/providers', async (req, res) => {
    const { name, type, baseUrl, apiKey } = req.body;
    const result = await db.run('INSERT INTO providers (name, type, baseUrl, apiKey) VALUES (?, ?, ?, ?)', [name, type, baseUrl, apiKey]);
    res.status(201).json({ id: result.lastID });
});

app.put('/api/providers/:id', async (req, res) => {
    const { id } = req.params;
    const { name, type, baseUrl, apiKey } = req.body;
    await db.run(
        'UPDATE providers SET name = ?, type = ?, baseUrl = ?, apiKey = ? WHERE id = ?',
        [name, type, baseUrl, apiKey, id]
    );
    res.sendStatus(200);
});

app.put('/api/providers/:id/activate', async (req, res) => {
    const { id } = req.params;
    await db.run('UPDATE providers SET active = 0');
    await db.run('UPDATE providers SET active = 1 WHERE id = ?', [id]);
    res.sendStatus(200);
});

app.get('/api/providers/:id/models', async (req, res) => {
    const { id } = req.params;
    const provider = await db.get('SELECT * FROM providers WHERE id = ?', [id]);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    const models = await db.all(
        `
        SELECT m.id, m.name
        FROM provider_models pm
        JOIN managed_models m ON pm.modelId = m.id
        WHERE pm.providerId = ?
        ORDER BY m.name ASC
        `,
        [id]
    );
    res.json({ providerId: Number(id), defaultModelId: provider.defaultModelId || null, models });
});

app.post('/api/providers/:id/models', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing model name' });
    const provider = await db.get('SELECT * FROM providers WHERE id = ?', [id]);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    let model = await db.get('SELECT * FROM managed_models WHERE name = ?', [name]);
    if (!model) {
        const r = await db.run('INSERT INTO managed_models (name) VALUES (?)', [name]);
        model = { id: r.lastID, name };
    }
    await db.run('INSERT OR IGNORE INTO provider_models (providerId, modelId) VALUES (?, ?)', [id, model.id]);
    res.status(201).json({ modelId: model.id });
});

app.put('/api/providers/:id/models/:modelId/activate', async (req, res) => {
    const { id, modelId } = req.params;
    const provider = await db.get('SELECT * FROM providers WHERE id = ?', [id]);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    const link = await db.get('SELECT * FROM provider_models WHERE providerId = ? AND modelId = ?', [id, modelId]);
    if (!link) {
        await db.run('INSERT OR IGNORE INTO provider_models (providerId, modelId) VALUES (?, ?)', [id, modelId]);
    }
    await db.run('UPDATE providers SET defaultModelId = ? WHERE id = ?', [modelId, id]);
    res.sendStatus(200);
});

app.delete('/api/providers/:id/models/:modelId', async (req, res) => {
    const { id, modelId } = req.params;
    const provider = await db.get('SELECT id, name, defaultModelId FROM providers WHERE id = ?', [id]);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    const apps = await db.all('SELECT id, name FROM client_keys WHERE providerId = ? AND managedModelId = ?', [id, modelId]);
    const usingAsDefault = provider.defaultModelId && Number(provider.defaultModelId) === Number(modelId);
    if (usingAsDefault || apps.length) {
        const modelRow = await db.get('SELECT name FROM managed_models WHERE id = ?', [modelId]);
        return res.status(409).json({
            error: 'Model is in use',
            message: [
                `无法删除模型：${modelRow?.name || modelId}`,
                usingAsDefault ? `- 厂商管理：${provider.name}（默认模型）` : null,
                apps.length ? `- 应用管理：${apps.map(a => a.name).join('、')}` : null
            ].filter(Boolean).join('\n'),
            inUse: {
                providerDefault: usingAsDefault ? { id: provider.id, name: provider.name } : null,
                apps
            }
        });
    }

    await db.run('DELETE FROM provider_models WHERE providerId = ? AND modelId = ?', [id, modelId]);
    res.sendStatus(200);
});

app.delete('/api/providers/:id', async (req, res) => {
    const { id } = req.params;
    await db.run('UPDATE client_keys SET providerId = NULL WHERE providerId = ?', [id]);
    await db.run('DELETE FROM provider_models WHERE providerId = ?', [id]);
    await db.run('DELETE FROM providers WHERE id = ?', [id]);
    res.sendStatus(200);
});

// 导出厂商配置
app.get('/api/providers/export', async (req, res) => {
    const providers = await db.all('SELECT * FROM providers ORDER BY id ASC');
    const models = await db.all(`
        SELECT pm.providerId, m.id as modelId, m.name as modelName
        FROM provider_models pm
        JOIN managed_models m ON pm.modelId = m.id
        ORDER BY pm.providerId ASC, m.name ASC
    `);

    const modelsByProvider = new Map();
    for (const row of models) {
        if (!modelsByProvider.has(row.providerId)) modelsByProvider.set(row.providerId, []);
        modelsByProvider.get(row.providerId).push({ id: row.modelId, name: row.modelName });
    }

    const exportData = providers.map((p) => ({
        name: p.name,
        type: p.type,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey || '',
        defaultModel: modelsByProvider.get(p.id)?.find(m => m.id === p.defaultModelId)?.name || null,
        models: modelsByProvider.get(p.id)?.map(m => m.name) || [],
        active: p.active === 1
    }));

    res.json({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        providers: exportData
    });
});

// 导入厂商配置
app.post('/api/providers/import', async (req, res) => {
    const { data, mergeStrategy } = req.body;
    if (!data || !data.providers) {
        return res.status(400).json({ error: 'Invalid data format' });
    }

    const results = [];
    const existingProviders = await db.all('SELECT id, name FROM providers');
    const existingNames = new Map(existingProviders.map(p => [p.name, p.id]));

    for (const p of data.providers) {
        const existingId = existingNames.get(p.name);

        if (existingId && mergeStrategy[p.name] === 'skip') {
            results.push({ name: p.name, action: 'skipped', reason: '已存在，用户选择跳过' });
            continue;
        }

        if (existingId && mergeStrategy[p.name] === 'overwrite') {
            // 更新现有厂商
            await db.run(
                'UPDATE providers SET type = ?, baseUrl = ?, apiKey = ?, active = ? WHERE id = ?',
                [p.type, p.baseUrl, p.apiKey || null, p.active ? 1 : 0, existingId]
            );
            // 删除旧模型关联
            await db.run('DELETE FROM provider_models WHERE providerId = ?', [existingId]);

            // 重新关联模型
            for (const modelName of p.models || []) {
                let model = await db.get('SELECT * FROM managed_models WHERE name = ?', [modelName]);
                if (!model) {
                    const r = await db.run('INSERT INTO managed_models (name) VALUES (?)', [modelName]);
                    model = { id: r.lastID };
                }
                await db.run('INSERT OR IGNORE INTO provider_models (providerId, modelId) VALUES (?, ?)', [existingId, model.id]);
            }

            // 设置默认模型
            if (p.defaultModel) {
                const defaultModel = await db.get('SELECT id FROM managed_models WHERE name = ?', [p.defaultModel]);
                if (defaultModel) {
                    await db.run('UPDATE providers SET defaultModelId = ? WHERE id = ?', [defaultModel.id, existingId]);
                }
            }

            results.push({ name: p.name, action: 'overwritten', id: existingId });
            continue;
        }

        // 创建新厂商
        const result = await db.run(
            'INSERT INTO providers (name, type, baseUrl, apiKey, active) VALUES (?, ?, ?, ?, ?)',
            [p.name, p.type, p.baseUrl, p.apiKey || null, p.active ? 1 : 0]
        );
        const providerId = result.lastID;

        // 关联模型
        for (const modelName of p.models || []) {
            let model = await db.get('SELECT * FROM managed_models WHERE name = ?', [modelName]);
            if (!model) {
                const r = await db.run('INSERT INTO managed_models (name) VALUES (?)', [modelName]);
                model = { id: r.lastID };
            }
            await db.run('INSERT OR IGNORE INTO provider_models (providerId, modelId) VALUES (?, ?)', [providerId, model.id]);
        }

        // 设置默认模型
        if (p.defaultModel) {
            const defaultModel = await db.get('SELECT id FROM managed_models WHERE name = ?', [p.defaultModel]);
            if (defaultModel) {
                await db.run('UPDATE providers SET defaultModelId = ? WHERE id = ?', [defaultModel.id, providerId]);
            }
        }

        results.push({ name: p.name, action: 'created', id: providerId });
    }

    res.json({ results });
});

// 导出全局配置（不包含管理员用户/密码）
app.get('/api/config/export', async (req, res) => {
    const includeSecrets = String(req.query.includeSecrets || '') === '1';
    const providers = await db.all(
        'SELECT id, name, type, baseUrl, apiKey, defaultModelId, active FROM providers ORDER BY id ASC'
    );
    const managedModels = await db.all(
        'SELECT id, name, active FROM managed_models ORDER BY id ASC'
    );
    const providerModels = await db.all(
        'SELECT providerId, modelId FROM provider_models ORDER BY providerId ASC, modelId ASC'
    );
    const apps = await db.all(
        'SELECT id, name, key, enabled, providerId, managedModelId FROM client_keys ORDER BY id ASC'
    );
    const modelRules = await db.all(
        'SELECT id, pattern, targetModel, priority, enabled FROM model_rules ORDER BY priority DESC, id ASC'
    );
    const safeProviders = includeSecrets
        ? providers
        : providers.map((p) => ({ ...p, apiKey: '' }));
    const safeApps = includeSecrets
        ? apps
        : apps.map((a) => ({ ...a, key: '' }));

    res.json({
        version: '1.0',
        includeSecrets,
        exportedAt: new Date().toISOString(),
        config: {
            providers: safeProviders,
            managedModels,
            providerModels,
            apps: safeApps,
            modelRules
        }
    });
});

// 导入全局配置（覆盖当前配置，不包含管理员用户/密码）
app.post('/api/config/import', async (req, res) => {
    const payload = req.body?.data?.config || req.body?.config;
    if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Invalid data format' });
    }

    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const managedModels = Array.isArray(payload.managedModels) ? payload.managedModels : [];
    const providerModels = Array.isArray(payload.providerModels) ? payload.providerModels : [];
    const apps = Array.isArray(payload.apps) ? payload.apps : [];
    const modelRules = Array.isArray(payload.modelRules) ? payload.modelRules : [];

    try {
        await db.exec('BEGIN TRANSACTION');

        // 清理旧配置（保留 admin_users/admin_sessions/conversation_logs/stats_events）
        await db.run('UPDATE providers SET defaultModelId = NULL');
        await db.run('DELETE FROM provider_models');
        await db.run('DELETE FROM client_keys');
        await db.run('DELETE FROM model_rules');
        await db.run('DELETE FROM providers');
        await db.run('DELETE FROM managed_models');

        for (const m of managedModels) {
            await db.run(
                'INSERT INTO managed_models (id, name, active) VALUES (?, ?, ?)',
                [m.id, m.name, m.active ? 1 : 0]
            );
        }

        for (const p of providers) {
            await db.run(
                'INSERT INTO providers (id, name, type, baseUrl, apiKey, defaultModelId, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [p.id, p.name, p.type, p.baseUrl, p.apiKey || null, p.defaultModelId || null, p.active ? 1 : 0]
            );
        }

        for (const pm of providerModels) {
            await db.run(
                'INSERT OR IGNORE INTO provider_models (providerId, modelId) VALUES (?, ?)',
                [pm.providerId, pm.modelId]
            );
        }

        for (const a of apps) {
            await db.run(
                'INSERT INTO client_keys (id, name, key, enabled, providerId, managedModelId) VALUES (?, ?, ?, ?, ?, ?)',
                [a.id, a.name, a.key, a.enabled ? 1 : 0, a.providerId || null, a.managedModelId || null]
            );
        }

        for (const r of modelRules) {
            await db.run(
                'INSERT INTO model_rules (id, pattern, targetModel, priority, enabled) VALUES (?, ?, ?, ?, ?)',
                [r.id, r.pattern, r.targetModel, Number.isFinite(Number(r.priority)) ? Number(r.priority) : 0, r.enabled ? 1 : 0]
            );
        }

        // 保证最多一个 active provider
        const activeProviders = await db.all('SELECT id FROM providers WHERE active = 1 ORDER BY id ASC');
        if (activeProviders.length > 1) {
            const keepId = activeProviders[0].id;
            await db.run('UPDATE providers SET active = 0 WHERE id <> ?', [keepId]);
        }

        await db.exec('COMMIT');
        res.json({
            ok: true,
            counts: {
                providers: providers.length,
                managedModels: managedModels.length,
                providerModels: providerModels.length,
                apps: apps.length,
                modelRules: modelRules.length
            }
        });
    } catch (err) {
        await db.exec('ROLLBACK');
        res.status(500).json({ error: err.message || 'Import failed' });
    }
});

// Client Keys API (Now Apps API)
app.get('/api/keys', async (req, res) => {
    const keys = await db.all('SELECT * FROM client_keys');
    res.json(keys);
});

app.post('/api/keys', async (req, res) => {
    const { name, providerId, managedModelId } = req.body;
    const key = 'sk-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await db.run('INSERT INTO client_keys (name, key, providerId, managedModelId) VALUES (?, ?, ?, ?)', [name, key, providerId || null, managedModelId || null]);
    res.sendStatus(201);
});

app.put('/api/keys/:id', async (req, res) => {
    const { id } = req.params;
    const { name, providerId, managedModelId } = req.body;
    await db.run(
        'UPDATE client_keys SET name = ?, providerId = ?, managedModelId = ? WHERE id = ?',
        [name, providerId || null, managedModelId || null, id]
    );
    res.sendStatus(200);
});

app.put('/api/keys/:id/toggle', async (req, res) => {
    const { id } = req.params;
    await db.run('UPDATE client_keys SET enabled = 1 - enabled WHERE id = ?', [id]);
    res.sendStatus(200);
});

app.delete('/api/keys/:id', async (req, res) => {
    const { id } = req.params;
    await db.run('DELETE FROM client_keys WHERE id = ?', [id]);
    res.sendStatus(200);
});

// Logs API
app.get('/api/logs', async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 50)));
    const offset = (page - 1) * pageSize;

    const where = [];
    const params = [];
    if (req.query.clientKeyId) {
        where.push('l.clientKeyId = ?');
        params.push(Number(req.query.clientKeyId));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = await db.get(`SELECT COUNT(*) as cnt FROM conversation_logs l ${whereSql}`, params);
    const total = totalRow?.cnt || 0;
    const totalPages = total ? Math.ceil(total / pageSize) : 1;

    const items = await db.all(
        `
        SELECT l.*, p.name as providerName, ck.name as clientKeyName
        FROM conversation_logs l
        LEFT JOIN providers p ON l.providerId = p.id
        LEFT JOIN client_keys ck ON l.clientKeyId = ck.id
        ${whereSql}
        ORDER BY l.createdAt DESC
        LIMIT ? OFFSET ?
        `,
        [...params, pageSize, offset]
    );

    res.json({ items, page, pageSize, total, totalPages });
});

app.delete('/api/logs', async (req, res) => {
    console.log('[API] Request to clear all logs');
    try {
        const result = await db.run('DELETE FROM conversation_logs');
        console.log('[API] Logs cleared successfully. Rows affected:', result.changes);
        res.status(200).json({ message: 'Logs cleared', changes: result.changes });
    } catch (err) {
        console.error('[API] Error clearing logs:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/models/catalog', async (req, res) => {
    const models = await db.all(
        `
        SELECT DISTINCT m.id, m.name
        FROM managed_models m
        JOIN provider_models pm ON pm.modelId = m.id
        ORDER BY m.name ASC
        `
    );
    const providerLinks = await db.all(
        `
        SELECT pm.modelId, p.id as providerId, p.name as providerName, p.active as providerActive
        FROM provider_models pm
        JOIN providers p ON pm.providerId = p.id
        ORDER BY p.id ASC
        `
    );
    const byModel = new Map();
    for (const m of models) {
        byModel.set(m.id, { ...m, providers: [] });
    }
    for (const link of providerLinks) {
        const entry = byModel.get(link.modelId);
        if (entry) {
            entry.providers.push({ id: link.providerId, name: link.providerName, active: link.providerActive ? 1 : 0 });
        }
    }
    res.json(Array.from(byModel.values()));
});

app.get('/api/models', async (req, res) => {
    const provider = await db.get('SELECT * FROM providers WHERE active = 1');
    if (!provider) return res.json({ providerId: null, defaultModelId: null, models: [] });
    const models = await db.all(
        `
        SELECT m.id, m.name
        FROM provider_models pm
        JOIN managed_models m ON pm.modelId = m.id
        WHERE pm.providerId = ?
        ORDER BY m.name ASC
        `,
        [provider.id]
    );
    res.json({ providerId: provider.id, defaultModelId: provider.defaultModelId || null, models });
});

app.post('/api/models', async (req, res) => {
    const provider = await db.get('SELECT * FROM providers WHERE active = 1');
    if (!provider) return res.status(400).json({ error: 'No active provider' });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing model name' });

    let model = await db.get('SELECT * FROM managed_models WHERE name = ?', [name]);
    if (!model) {
        const r = await db.run('INSERT INTO managed_models (name) VALUES (?)', [name]);
        model = { id: r.lastID, name };
    }
    await db.run('INSERT OR IGNORE INTO provider_models (providerId, modelId) VALUES (?, ?)', [provider.id, model.id]);
    res.status(201).json({ modelId: model.id });
});

app.put('/api/models/:id/activate', async (req, res) => {
    const provider = await db.get('SELECT * FROM providers WHERE active = 1');
    if (!provider) return res.status(400).json({ error: 'No active provider' });
    const { id } = req.params;
    const link = await db.get('SELECT * FROM provider_models WHERE providerId = ? AND modelId = ?', [provider.id, id]);
    if (!link) {
        await db.run('INSERT OR IGNORE INTO provider_models (providerId, modelId) VALUES (?, ?)', [provider.id, id]);
    }
    await db.run('UPDATE providers SET defaultModelId = ? WHERE id = ?', [id, provider.id]);
    res.sendStatus(200);
});

app.delete('/api/models/:id', async (req, res) => {
    const provider = await db.get('SELECT * FROM providers WHERE active = 1');
    if (!provider) return res.status(400).json({ error: 'No active provider' });
    const { id } = req.params;
    const apps = await db.all('SELECT id, name FROM client_keys WHERE providerId = ? AND managedModelId = ?', [provider.id, id]);
    const usingAsDefault = provider.defaultModelId && Number(provider.defaultModelId) === Number(id);
    if (usingAsDefault || apps.length) {
        const modelRow = await db.get('SELECT name FROM managed_models WHERE id = ?', [id]);
        return res.status(409).json({
            error: 'Model is in use',
            message: [
                `无法删除模型：${modelRow?.name || id}`,
                usingAsDefault ? `- 厂商管理：${provider.name}（默认模型）` : null,
                apps.length ? `- 应用管理：${apps.map(a => a.name).join('、')}` : null
            ].filter(Boolean).join('\n'),
            inUse: {
                providerDefault: usingAsDefault ? { id: provider.id, name: provider.name } : null,
                apps
            }
        });
    }

    await db.run('DELETE FROM provider_models WHERE providerId = ? AND modelId = ?', [provider.id, id]);
    res.sendStatus(200);
});

app.get('/api/model-rules', async (req, res) => {
    const rules = await db.all('SELECT * FROM model_rules ORDER BY priority DESC, id ASC');
    res.json(rules);
});

app.post('/api/model-rules', async (req, res) => {
    const { pattern, targetModel, priority } = req.body;
    await db.run(
        'INSERT INTO model_rules (pattern, targetModel, priority) VALUES (?, ?, ?)',
        [pattern, targetModel, Number.isFinite(Number(priority)) ? Number(priority) : 0]
    );
    res.sendStatus(201);
});

app.put('/api/model-rules/:id', async (req, res) => {
    const { id } = req.params;
    const { pattern, targetModel, priority, enabled } = req.body;
    await db.run(
        'UPDATE model_rules SET pattern = ?, targetModel = ?, priority = ?, enabled = ? WHERE id = ?',
        [
            pattern,
            targetModel,
            Number.isFinite(Number(priority)) ? Number(priority) : 0,
            enabled === undefined ? 1 : (enabled ? 1 : 0),
            id
        ]
    );
    res.sendStatus(200);
});

app.put('/api/model-rules/:id/toggle', async (req, res) => {
    const { id } = req.params;
    await db.run('UPDATE model_rules SET enabled = 1 - enabled WHERE id = ?', [id]);
    res.sendStatus(200);
});

app.delete('/api/model-rules/:id', async (req, res) => {
    const { id } = req.params;
    await db.run('DELETE FROM model_rules WHERE id = ?', [id]);
    res.sendStatus(200);
});

app.get('/api/stats', async (req, res) => {
    const { range, appId, providerId, model, status } = req.query;
    const { range: normalizedRange, from, to } = normalizeStatsRange(range);

    const buildWhere = ({ includeProvider }) => {
        const where = [];
        const params = [];
        if (from) {
            where.push('e.requestAt >= ?');
            params.push(from.toISOString());
        }
        if (to) {
            where.push('e.requestAt <= ?');
            params.push(to.toISOString());
        }
        if (appId) {
            where.push('e.appId = ?');
            params.push(Number(appId));
        }
        if (includeProvider && providerId) {
            where.push('e.providerId = ?');
            params.push(Number(providerId));
        }
        if (model) {
            where.push('e.actualModel = ?');
            params.push(model);
        }
        if (status) {
            where.push('e.status = ?');
            params.push(status);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return { where, params, whereSql };
    };

    const { whereSql, params } = buildWhere({ includeProvider: true });
    const { whereSql: heatmapWhereSql, params: heatmapParams } = buildWhere({ includeProvider: false });

    const summaryRow = await db.get(
        `
        SELECT
          COUNT(*) as requestCount,
          SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) as errorCount,
          SUM(COALESCE(e.tokensTotal, 0)) as tokensTotal,
          AVG(CASE WHEN e.latencyMs IS NOT NULL THEN e.latencyMs ELSE NULL END) as avgLatencyMs,
          COUNT(DISTINCT date(e.requestAt, 'localtime')) as activeDays
        FROM stats_events e
        ${whereSql}
        `,
        params
    );

    const timeseriesRows = await db.all(
        `
        SELECT
          date(e.requestAt, 'localtime') as day,
          COUNT(*) as requests,
          SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) as errors,
          SUM(COALESCE(e.tokensTotal, 0)) as tokensTotal,
          AVG(CASE WHEN e.latencyMs IS NOT NULL THEN e.latencyMs ELSE NULL END) as avgLatencyMs
        FROM stats_events e
        ${whereSql}
        GROUP BY day
        ORDER BY day
        `,
        params
    );

    const heatmapRows = await db.all(
        `
        SELECT
          date(e.requestAt, 'localtime') as day,
          COUNT(*) as value
        FROM stats_events e
        ${heatmapWhereSql}
        GROUP BY day
        ORDER BY day
        `,
        heatmapParams
    );

    const yearTo = new Date();
    const yearFrom = new Date(yearTo.getTime() - 365 * 24 * 60 * 60 * 1000);
    const formatLocalDay = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    const heatmapYearWhere = [];
    const heatmapYearParams = [];
    if (appId) {
        heatmapYearWhere.push('e.appId = ?');
        heatmapYearParams.push(Number(appId));
    }
    if (model) {
        heatmapYearWhere.push('e.actualModel = ?');
        heatmapYearParams.push(model);
    }
    if (status) {
        heatmapYearWhere.push('e.status = ?');
        heatmapYearParams.push(status);
    }
    heatmapYearWhere.push('e.requestAt >= ?');
    heatmapYearParams.push(yearFrom.toISOString());
    heatmapYearWhere.push('e.requestAt <= ?');
    heatmapYearParams.push(yearTo.toISOString());
    const yearWhereSql = heatmapYearWhere.length ? `WHERE ${heatmapYearWhere.join(' AND ')}` : '';

    const heatmapYearRows = await db.all(
        `
        SELECT
          date(e.requestAt, 'localtime') as day,
          COUNT(*) as value
        FROM stats_events e
        ${yearWhereSql}
        GROUP BY day
        ORDER BY day
        `,
        heatmapYearParams
    );

    const byModelRows = await db.all(
        `
        SELECT
          COALESCE(e.actualModel, e.requestedModel, 'unknown') as name,
          SUM(COALESCE(e.tokensTotal, 0)) as tokens,
          COUNT(*) as requests
        FROM stats_events e
        ${whereSql}
        GROUP BY name
        ORDER BY tokens DESC
        LIMIT 20
        `,
        params
    );

    const byProviderRows = await db.all(
        `
        SELECT
          COALESCE(p.name, 'unknown') as name,
          SUM(COALESCE(e.tokensTotal, 0)) as tokens,
          COUNT(*) as requests
        FROM stats_events e
        LEFT JOIN providers p ON e.providerId = p.id
        ${whereSql}
        GROUP BY name
        ORDER BY tokens DESC
        LIMIT 20
        `,
        params
    );

    const byAppRows = await db.all(
        `
        SELECT
          COALESCE(ck.name, 'unknown') as name,
          SUM(COALESCE(e.tokensTotal, 0)) as tokens,
          COUNT(*) as requests
        FROM stats_events e
        LEFT JOIN client_keys ck ON e.appId = ck.id
        ${whereSql}
        GROUP BY name
        ORDER BY tokens DESC
        LIMIT 20
        `,
        params
    );

    const byStatusRows = await db.all(
        `
        SELECT
          COALESCE(e.status, 'unknown') as name,
          COUNT(*) as requests
        FROM stats_events e
        ${whereSql}
        GROUP BY name
        ORDER BY requests DESC
        `,
        params
    );

    const topSlowRows = await db.all(
        `
        SELECT
          e.id,
          e.requestAt,
          e.latencyMs,
          e.status,
          e.requestedModel,
          e.actualModel,
          COALESCE(p.name, 'unknown') as providerName,
          COALESCE(ck.name, 'unknown') as appName
        FROM stats_events e
        LEFT JOIN providers p ON e.providerId = p.id
        LEFT JOIN client_keys ck ON e.appId = ck.id
        ${whereSql} ${whereSql ? 'AND' : 'WHERE'} e.latencyMs IS NOT NULL
        ORDER BY e.latencyMs DESC
        LIMIT 10
        `,
        params
    );

    const topErrorRows = await db.all(
        `
        SELECT
          e.id,
          e.requestAt,
          e.status,
          e.errorMessage,
          e.requestedModel,
          e.actualModel,
          COALESCE(p.name, 'unknown') as providerName,
          COALESCE(ck.name, 'unknown') as appName
        FROM stats_events e
        LEFT JOIN providers p ON e.providerId = p.id
        LEFT JOIN client_keys ck ON e.appId = ck.id
        ${whereSql} ${whereSql ? 'AND' : 'WHERE'} e.status = 'error'
        ORDER BY e.requestAt DESC
        LIMIT 10
        `,
        params
    );

    res.json({
        range: normalizedRange,
        summary: {
            requestCount: summaryRow?.requestCount || 0,
            errorCount: summaryRow?.errorCount || 0,
            tokensTotal: summaryRow?.tokensTotal || 0,
            avgLatencyMs: summaryRow?.avgLatencyMs ?? null,
            activeDays: summaryRow?.activeDays || 0
        },
        heatmap: heatmapRows.map(r => [r.day, r.value]),
        heatmapYear: heatmapYearRows.map(r => [r.day, r.value]),
        heatmapYearRange: [formatLocalDay(yearFrom), formatLocalDay(yearTo)],
        timeseries: {
            days: timeseriesRows.map(r => r.day),
            requests: timeseriesRows.map(r => r.requests),
            errors: timeseriesRows.map(r => r.errors),
            tokensTotal: timeseriesRows.map(r => r.tokensTotal),
            avgLatencyMs: timeseriesRows.map(r => r.avgLatencyMs)
        },
        distributions: {
            byModel: byModelRows,
            byProvider: byProviderRows,
            byApp: byAppRows,
            byStatus: byStatusRows
        },
        top: {
            slow: topSlowRows,
            errors: topErrorRows
        }
    });
});

// Proxy Endpoint (Flexible routing starting with /proxy)
app.post(['/proxy', /^\/proxy\/.*/], async (req, res) => {
    // Detect client's expected format
    const isClientAnthropic = req.url.includes('/messages');
    const isClientOpenAI = req.url.includes('/chat/completions') || req.url.includes('/completions');

    // Authenticate client key
    const authHeader = req.headers['authorization']?.split(' ')[1] || req.headers['x-api-key'];
    if (!authHeader) {
        return res.status(401).json({ error: 'Missing API Key' });
    }

    const clientKeyData = await db.get('SELECT * FROM client_keys WHERE key = ?', [authHeader]);
    if (!clientKeyData) {
        return res.status(403).json({ error: 'Invalid API Key' });
    }
    if (!clientKeyData.enabled) {
        return res.status(403).json({ error: 'API Key is disabled' });
    }

    const { model, messages, stream } = req.body;

    // 1. Get Provider (App-specific or Global Default)
    let provider;
    if (clientKeyData.providerId) {
        provider = await db.get('SELECT * FROM providers WHERE id = ?', [clientKeyData.providerId]);
        if (provider) console.log(`[Proxy] Using App-specific provider: ${provider.name}`);
    }

    if (!provider) {
        provider = await db.get('SELECT * FROM providers WHERE active = 1');
        if (provider) console.log(`[Proxy] Using Global Default provider: ${provider.name}`);
    }

    if (!provider) {
        return res.status(500).json({ error: 'No active provider configured' });
    }
    if (!provider.apiKey) {
        return res.status(500).json({ error: `Provider '${provider.name}' has no API Key configured.` });
    }

    let actualModel = model;
    if (model !== 'llmproxy') {
        const rules = await db.all('SELECT id, pattern, targetModel, priority FROM model_rules WHERE enabled = 1 ORDER BY priority DESC, id ASC');
        const ruleResult = applyModelRules(model, rules);
        if (ruleResult.matched) {
            actualModel = ruleResult.actualModel;
            console.log(`[Proxy] Model Rule matched: '${ruleResult.rule.pattern}' -> '${ruleResult.rule.targetModel}' (requested='${model}')`);
        }
    } else {
        let managedModelName = null;

        if (clientKeyData.managedModelId) {
            const mm = await db.get('SELECT name FROM managed_models WHERE id = ?', [clientKeyData.managedModelId]);
            if (mm) {
                managedModelName = mm.name;
                console.log(`[Proxy] Model 'llmproxy' replaced with App-specific model: ${managedModelName}`);
            }
        }

        if (!managedModelName) {
            if (provider.defaultModelId) {
                const mm = await db.get('SELECT name FROM managed_models WHERE id = ?', [provider.defaultModelId]);
                if (mm) {
                    managedModelName = mm.name;
                    console.log(`[Proxy] Model 'llmproxy' replaced with Provider Default model: ${managedModelName}`);
                }
            }
            if (!managedModelName) {
                const mm = await db.get('SELECT name FROM managed_models WHERE active = 1');
                if (mm) {
                    managedModelName = mm.name;
                    console.log(`[Proxy] Model 'llmproxy' replaced with Legacy Global Default model: ${managedModelName}`);
                }
            }
        }

        if (managedModelName) {
            actualModel = managedModelName;
        } else {
            console.warn(`[Proxy] Model 'llmproxy' requested but no managed model is configured. Using 'llmproxy' as-is.`);
        }
    }

    console.log(`[Proxy] Final Route: Provider=${provider.name} (${provider.type}), Model=${actualModel}`);
    const mask = (key) => key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : 'null';
    console.log(`[Proxy] Client Key: ${mask(authHeader)}`);
    console.log(`[Proxy] Provider Key: ${mask(provider.apiKey)}`);

    // Extract path suffix after /proxy
    let pathSuffix = req.url.substring('/proxy'.length) || '/';

    // Create log entry
    const requestAt = new Date().toISOString();
    const clientUrl = req.url;
    const logResult = await db.run(
        'INSERT INTO conversation_logs (providerId, clientKeyId, model, actualModel, requestBody, status, requestAt, clientUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [provider.id, clientKeyData.id, model || 'unknown', actualModel, JSON.stringify(req.body), 'waiting', requestAt, clientUrl]
    );
    const logId = logResult.lastID;

    // Notify frontend: waiting for response
    io.to('admins').emit('log_update', { id: logId, status: 'waiting', providerName: provider.name, clientKeyId: clientKeyData.id, clientKeyName: clientKeyData.name, requestAt, clientUrl, actualModel });

    let targetUrl = '';
    if (stream) {
        try {
            let targetBody = { ...req.body, model: actualModel };
            let upstreamHeaders = {};

            if (provider.type === 'openai') {
                if (isClientAnthropic && !isClientOpenAI) {
                    const msg = 'Streaming protocol conversion (Anthropic -> OpenAI) is not supported';
                    const responseAt = new Date().toISOString();
                    await db.run(
                        'UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ? WHERE id = ?',
                        [msg, 'error', responseAt, targetUrl, logId]
                    );
                    io.to('admins').emit('log_update', { id: logId, status: 'error', responseBody: msg, responseAt, targetUrl });
                    return res.status(400).json({ error: msg });
                }
                targetUrl = provider.baseUrl.replace(/\/+$/, '');
                if (pathSuffix === '/' || pathSuffix === '/chat/completions' || pathSuffix === '/completions') {
                    if (!targetUrl.match(/\/v\d+$/) && !targetUrl.match(/\/v\d+\/.*$/)) {
                        if (!targetUrl.endsWith('/v1')) targetUrl += '/v1';
                    }
                    targetUrl += '/chat/completions';
                } else {
                    targetUrl += pathSuffix;
                }
                upstreamHeaders = {
                    'Authorization': `Bearer ${provider.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                };
            } else if (provider.type === 'anthropic') {
                if (isClientOpenAI || !isClientAnthropic) {
                    const msg = 'Streaming protocol conversion (OpenAI -> Anthropic) is not supported';
                    const responseAt = new Date().toISOString();
                    await db.run(
                        'UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ? WHERE id = ?',
                        [msg, 'error', responseAt, targetUrl, logId]
                    );
                    io.to('admins').emit('log_update', { id: logId, status: 'error', responseBody: msg, responseAt, targetUrl });
                    return res.status(400).json({ error: msg });
                }
                targetUrl = provider.baseUrl.replace(/\/+$/, '');
                if (pathSuffix === '/' || pathSuffix === '/messages') {
                    if (!targetUrl.match(/\/v\d+$/) && !targetUrl.match(/\/v\d+\/.*$/)) {
                        if (!targetUrl.endsWith('/v1')) targetUrl += '/v1';
                    }
                    targetUrl += '/messages';
                } else {
                    targetUrl += pathSuffix;
                }
                upstreamHeaders = {
                    'x-api-key': provider.apiKey,
                    'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
                    'content-type': 'application/json',
                    'accept': 'text/event-stream'
                };
                if (req.headers['anthropic-beta']) {
                    upstreamHeaders['anthropic-beta'] = req.headers['anthropic-beta'];
                }
            } else {
                return res.status(400).json({ error: `Unsupported provider type: ${provider.type}` });
            }

            if (req.headers['user-agent']) {
                upstreamHeaders['User-Agent'] = req.headers['user-agent'];
            }

            const upstream = await axiosInstance.post(targetUrl, targetBody, {
                headers: upstreamHeaders,
                responseType: 'stream',
                validateStatus: () => true
            });

            res.status(upstream.status);
            const passHeaders = [
                'content-type',
                'cache-control',
                'connection',
                'transfer-encoding',
                'x-request-id',
                'anthropic-request-id'
            ];
            for (const h of passHeaders) {
                if (upstream.headers[h]) {
                    res.setHeader(h, upstream.headers[h]);
                }
            }

            let responseData = '';
            let pendingChunkForLog = '';
            let lastEmitTs = 0;
            const emitPendingChunk = () => {
                if (!pendingChunkForLog) return;
                io.to('admins').emit('log_update', {
                    id: logId,
                    status: 'waiting',
                    targetUrl,
                    appendResponseChunk: true,
                    streamChunk: pendingChunkForLog
                });
                pendingChunkForLog = '';
                lastEmitTs = Date.now();
            };

            await new Promise((resolve, reject) => {
                const src = upstream.data;
                let ended = false;

                src.on('data', (chunk) => {
                    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
                    responseData += text;
                    pendingChunkForLog += text;
                    res.write(chunk);
                    if (Date.now() - lastEmitTs > 180) emitPendingChunk();
                });

                src.on('end', () => {
                    ended = true;
                    emitPendingChunk();
                    resolve();
                });

                src.on('error', (err) => {
                    if (ended) return;
                    reject(err);
                });

                res.on('close', () => {
                    if (!res.writableEnded) {
                        src.destroy(new Error('Client disconnected'));
                    }
                });
            });

            if (!res.writableEnded) {
                res.end();
            }

            const responseAt = new Date().toISOString();
            const status = upstream.status >= 200 && upstream.status < 300 ? 'completed' : 'error';
            await db.run(
                'UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ? WHERE id = ?',
                [responseData, status, responseAt, targetUrl, logId]
            );

            const latencyMs = new Date(responseAt) - new Date(requestAt);
            const usage = extractUsage(responseData);
            await db.run(
                `INSERT INTO stats_events (appId, providerId, requestedModel, actualModel, status, requestAt, responseAt, latencyMs, tokensIn, tokensOut, tokensTotal, errorMessage)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    clientKeyData.id,
                    provider.id,
                    model || 'unknown',
                    actualModel || null,
                    status,
                    requestAt,
                    responseAt,
                    Number.isFinite(latencyMs) ? latencyMs : null,
                    usage.tokensIn,
                    usage.tokensOut,
                    usage.tokensTotal,
                    status === 'error' ? `Upstream status ${upstream.status}` : null
                ]
            );

            io.to('admins').emit('log_update', { id: logId, status, responseBody: responseData, responseAt, targetUrl });
            return;
        } catch (error) {
            const responseAt = new Date().toISOString();
            const errorBody = error?.message || 'Streaming proxy failed';
            await db.run(
                'UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ? WHERE id = ?',
                [errorBody, 'error', responseAt, targetUrl || error.config?.url, logId]
            );
            const latencyMs = new Date(responseAt) - new Date(requestAt);
            await db.run(
                `INSERT INTO stats_events (appId, providerId, requestedModel, actualModel, status, requestAt, responseAt, latencyMs, tokensIn, tokensOut, tokensTotal, errorMessage)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    clientKeyData.id,
                    provider.id,
                    model || 'unknown',
                    actualModel || null,
                    'error',
                    requestAt,
                    responseAt,
                    Number.isFinite(latencyMs) ? latencyMs : null,
                    0,
                    0,
                    0,
                    error?.message || 'Streaming proxy failed'
                ]
            );
            io.to('admins').emit('log_update', { id: logId, status: 'error', responseBody: errorBody, responseAt, targetUrl: targetUrl || error.config?.url });
            if (!res.headersSent) {
                return res.status(error.response?.status || 500).json(error.response?.data || { error: errorBody });
            }
            if (!res.writableEnded) res.end();
            return;
        }
    }

    try {
        let response;
        if (provider.type === 'openai') {
            // Target is OpenAI
            let targetBody = { ...req.body, model: actualModel };

            // Request conversion logic
            if (isClientAnthropic && !isClientOpenAI) {
                targetBody = {
                    model: actualModel,
                    messages: messages.map(m => ({
                        role: m.role,
                        content: typeof m.content === 'string' ? m.content : m.content[0]?.text || ''
                    })),
                    max_tokens: req.body.max_tokens || 4096,
                };
                const systemMsg = messages.find(m => m.role === 'system');
                if (systemMsg) {
                    targetBody.messages = targetBody.messages.filter(m => m.role !== 'system');
                    targetBody.messages.unshift({ role: 'system', content: systemMsg.content });
                }
            }

            // Construct final URL
            targetUrl = provider.baseUrl.replace(/\/+$/, '');
            if (pathSuffix === '/' || pathSuffix === '/chat/completions' || pathSuffix === '/completions') {
                if (!targetUrl.match(/\/v\d+$/) && !targetUrl.match(/\/v\d+\/.*$/)) {
                    if (!targetUrl.endsWith('/v1')) targetUrl += '/v1';
                }
                targetUrl += '/chat/completions';
            } else {
                targetUrl += pathSuffix;
            }

            console.log(`[Proxy] Forwarding to OpenAI: ${targetUrl}`);
            const openaiHeaders = {
                'Authorization': `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            if (req.headers['user-agent']) {
                openaiHeaders['User-Agent'] = req.headers['user-agent'];
            }

            response = await axiosInstance.post(targetUrl, targetBody, {
                headers: openaiHeaders
            });

            // Response conversion logic
            if (isClientAnthropic && !isClientOpenAI) {
                const data = response.data;
                response.data = {
                    id: data.id,
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'text', text: data.choices[0].message.content }],
                    model: data.model,
                    stop_reason: data.choices[0].finish_reason === 'stop' ? 'end_turn' : data.choices[0].finish_reason,
                    usage: {
                        input_tokens: data.usage.prompt_tokens,
                        output_tokens: data.usage.completion_tokens
                    }
                };
            }
        } else if (provider.type === 'anthropic') {
            // Target is Anthropic
            let targetBody = { ...req.body, model: actualModel };

            // Request conversion logic
            if (isClientOpenAI || !isClientAnthropic) {
                targetBody = {
                    model: actualModel,
                    messages: messages.filter(m => m.role !== 'system').map(m => ({
                        role: m.role === 'assistant' ? 'assistant' : 'user',
                        content: m.content
                    })),
                    max_tokens: req.body.max_tokens || 4096,
                    system: messages.find(m => m.role === 'system')?.content,
                };
            }

            // Construct final URL
            targetUrl = provider.baseUrl.replace(/\/+$/, '');
            if (pathSuffix === '/' || pathSuffix === '/messages') {
                if (!targetUrl.match(/\/v\d+$/) && !targetUrl.match(/\/v\d+\/.*$/)) {
                    if (!targetUrl.endsWith('/v1')) targetUrl += '/v1';
                }
                targetUrl += '/messages';
            } else {
                targetUrl += pathSuffix;
            }

            console.log(`[Proxy] Forwarding to Anthropic: ${targetUrl}`);
            const anthropicHeaders = {
                'x-api-key': provider.apiKey,
                'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
                'content-type': 'application/json',
                'accept': 'application/json'
            };
            if (req.headers['anthropic-beta']) {
                anthropicHeaders['anthropic-beta'] = req.headers['anthropic-beta'];
            }
            if (req.headers['user-agent']) {
                anthropicHeaders['User-Agent'] = req.headers['user-agent'];
            }

            response = await axiosInstance.post(targetUrl, targetBody, {
                headers: anthropicHeaders
            });

            // Response conversion logic
            if (isClientOpenAI || !isClientAnthropic) {
                const data = response.data;
                response.data = {
                    id: data.id,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: data.model,
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: data.content[0].text
                        },
                        finish_reason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason
                    }],
                    usage: {
                        prompt_tokens: data.usage.input_tokens,
                        completion_tokens: data.usage.output_tokens,
                        total_tokens: data.usage.input_tokens + data.usage.output_tokens
                    }
                };
            }
        }

        // Update log
        const responseAt = new Date().toISOString();
        const responseData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        await db.run(
            'UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ? WHERE id = ?',
            [responseData, 'completed', responseAt, targetUrl, logId]
        );

        const latencyMs = new Date(responseAt) - new Date(requestAt);
        const usage = extractUsage(response.data);
        await db.run(
            `INSERT INTO stats_events (appId, providerId, requestedModel, actualModel, status, requestAt, responseAt, latencyMs, tokensIn, tokensOut, tokensTotal, errorMessage)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clientKeyData.id,
                provider.id,
                model || 'unknown',
                actualModel || null,
                'completed',
                requestAt,
                responseAt,
                Number.isFinite(latencyMs) ? latencyMs : null,
                usage.tokensIn,
                usage.tokensOut,
                usage.tokensTotal,
                null
            ]
        );

        // Notify frontend: completed
        io.to('admins').emit('log_update', { id: logId, status: 'completed', responseBody: responseData, responseAt, targetUrl });

        res.json(response.data);

    } catch (error) {
        const responseAt = new Date().toISOString();
        console.error('Proxy Error Detail:', {
            url: error.config?.url,
            method: error.config?.method,
            headers: error.config?.headers,
            data: error.config?.data,
            response: error.response?.data,
            status: error.response?.status,
            message: error.message
        });
        const errorData = error.response?.data || { error: error.message };
        const errorBody = typeof errorData === 'string' ? errorData : JSON.stringify(errorData);
        await db.run(
            'UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ? WHERE id = ?',
            [errorBody, 'error', responseAt, targetUrl || error.config?.url, logId]
        );

        const latencyMs = new Date(responseAt) - new Date(requestAt);
        const usage = extractUsage(error.response?.data);
        await db.run(
            `INSERT INTO stats_events (appId, providerId, requestedModel, actualModel, status, requestAt, responseAt, latencyMs, tokensIn, tokensOut, tokensTotal, errorMessage)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clientKeyData.id,
                provider.id,
                model || 'unknown',
                actualModel || null,
                'error',
                requestAt,
                responseAt,
                Number.isFinite(latencyMs) ? latencyMs : null,
                usage.tokensIn,
                usage.tokensOut,
                usage.tokensTotal,
                error.message || null
            ]
        );

        io.to('admins').emit('log_update', { id: logId, status: 'error', responseBody: errorBody, responseAt, targetUrl: targetUrl || error.config?.url });
        res.status(error.response?.status || 500).json(errorData);
    }
});

// Error for incorrect paths
app.post(['/v1', /^\/v1\/.*/], (req, res) => {
    res.status(404).json({
        error: "Incorrect API Path",
        message: `Please use the new proxy path: http://${req.hostname}:3000/proxy instead of /v1. Check the dashboard for configuration help.`
    });
});

const clientDistDir = path.join(__dirname, '../client/dist');
const clientIndexFile = path.join(clientDistDir, 'index.html');
if (fs.existsSync(clientIndexFile)) {
    app.use(express.static(clientDistDir));
    app.get(/^\/(?!api\/|proxy\/|socket\.io\/|healthz$).*/, (req, res) => {
        res.sendFile(clientIndexFile);
    });
}

async function start() {
    db = await setupDb();
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

start();
