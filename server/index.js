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

/** Proxy “magic” model: match is case-insensitive (e.g. llmpylon, LLMPYLON). */
const MAGIC_PROXY_MODEL_LOWER = 'llmpylon';

function isMagicProxyModel(model) {
    return typeof model === 'string' && model.toLowerCase() === MAGIC_PROXY_MODEL_LOWER;
}

function loadPackageInfo() {
    try {
        const pkgPath = path.join(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return {
            name: typeof pkg.name === 'string' ? pkg.name : 'llmpylon',
            version: typeof pkg.version === 'string' ? pkg.version : '0.0.0'
        };
    } catch {
        return { name: 'llmpylon', version: '0.0.0' };
    }
}

const appPackageInfo = loadPackageInfo();

// Axios instance: per-request `timeout` comes from app_settings (see proxy handler)
const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: 0 // disabled at instance level; each upstream call sets timeout explicitly
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

function tokNum(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function pickFromUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const pt = tokNum(usage.prompt_tokens);
    const ct = tokNum(usage.completion_tokens);
    const tt = tokNum(usage.total_tokens);
    if (pt !== null || ct !== null || tt !== null) {
        const tokensIn = pt ?? 0;
        const tokensOut = ct ?? 0;
        const tokensTotal = tt !== null ? tt : tokensIn + tokensOut;
        return { tokensIn, tokensOut, tokensTotal };
    }
    const it = tokNum(usage.input_tokens);
    const ot = tokNum(usage.output_tokens);
    if (it !== null || ot !== null) {
        const tokensIn = it ?? 0;
        const tokensOut = ot ?? 0;
        return { tokensIn, tokensOut, tokensTotal: tokensIn + tokensOut };
    }
    return null;
}

function usageFromStreamChunk(obj) {
    if (!obj || typeof obj !== 'object') return null;
    let u = pickFromUsage(obj.usage);
    if (!u && obj.message && typeof obj.message === 'object') {
        u = pickFromUsage(obj.message.usage);
    }
    if (!u && obj.delta && typeof obj.delta === 'object') {
        u = pickFromUsage(obj.delta.usage);
    }
    return u;
}

function mergeUsageMax(a, b) {
    if (!b) return a;
    if (!a) return { ...b };
    return {
        tokensIn: Math.max(a.tokensIn, b.tokensIn),
        tokensOut: Math.max(a.tokensOut, b.tokensOut),
        tokensTotal: Math.max(a.tokensTotal, b.tokensTotal)
    };
}

function finalizeUsage(u) {
    if (!u) return { tokensIn: 0, tokensOut: 0, tokensTotal: 0 };
    let { tokensIn, tokensOut, tokensTotal } = u;
    const sum = tokensIn + tokensOut;
    if (tokensTotal < sum) tokensTotal = sum;
    return { tokensIn, tokensOut, tokensTotal };
}

function extractUsage(payload) {
    if (!payload) return { tokensIn: 0, tokensOut: 0, tokensTotal: 0 };

    if (typeof payload === 'object') {
        const u = usageFromStreamChunk(payload) || pickFromUsage(payload.usage);
        return finalizeUsage(u);
    }

    if (typeof payload !== 'string') return { tokensIn: 0, tokensOut: 0, tokensTotal: 0 };

    try {
        const json = JSON.parse(payload);
        if (json && typeof json === 'object') {
            const u = usageFromStreamChunk(json) || pickFromUsage(json.usage);
            return finalizeUsage(u);
        }
    } catch (e) {
    }

    let agg = null;
    const lines = payload.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.replace(/^data:\s*/, '').trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
            const obj = JSON.parse(dataStr);
            const u = usageFromStreamChunk(obj);
            if (u) agg = mergeUsageMax(agg, u);
        } catch (e) {
        }
    }

    return finalizeUsage(agg);
}

function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
        return xff.split(',')[0].trim();
    }
    if (Array.isArray(xff) && xff.length) {
        return String(xff[0]).split(',')[0].trim();
    }
    const xr = req.headers['x-real-ip'];
    if (typeof xr === 'string' && xr.trim()) return xr.trim();
    return req.socket?.remoteAddress || req.ip || '';
}

function pickOutgoingUserAgent(headers) {
    if (!headers || typeof headers !== 'object') return null;
    const v = headers['User-Agent'] ?? headers['user-agent'];
    return v != null && String(v).trim() ? String(v) : null;
}

/** Avoid logging raw API keys in stderr when upstream requests fail */
function redactSensitiveHeaders(headers) {
    if (!headers || typeof headers !== 'object') return headers;
    try {
        const plain = typeof headers.toJSON === 'function' ? headers.toJSON() : { ...headers };
        const out = { ...plain };
        for (const k of Object.keys(out)) {
            const kl = String(k).toLowerCase();
            if (kl === 'authorization' || kl === 'x-api-key' || kl === 'cookie' || kl === 'proxy-authorization') {
                out[k] = '[redacted]';
            }
        }
        return out;
    } catch {
        return '[headers: unserializable]';
    }
}

function truncateForErrorLog(data, maxLen = 4000) {
    if (data == null) return data;
    try {
        const s = typeof data === 'string' ? data : JSON.stringify(data);
        if (s.length <= maxLen) return data;
        return `${s.slice(0, maxLen)}…[truncated]`;
    } catch {
        return '[unserializable]';
    }
}

const APP_SETTINGS_KEYS = {
    LOG_RETENTION_DAYS: 'log_retention_days',
    STATS_RETENTION_DAYS: 'stats_retention_days',
    UPSTREAM_TIMEOUT_SECONDS: 'upstream_timeout_seconds',
    UPSTREAM_HEADERS_BLOCKLIST: 'upstream_headers_blocklist'
};

const UPSTREAM_TIMEOUT_MIN_SEC = 5;
const UPSTREAM_TIMEOUT_MAX_SEC = 86400;
const UPSTREAM_TIMEOUT_DEFAULT_SEC = 360;
const UPSTREAM_HEADERS_BLOCKLIST_DEFAULT = ['host', 'content-length', 'connection', 'accept-encoding'];

async function getUpstreamTimeoutSeconds() {
    const raw = await getAppSettingInt(APP_SETTINGS_KEYS.UPSTREAM_TIMEOUT_SECONDS, UPSTREAM_TIMEOUT_DEFAULT_SEC);
    if (!Number.isFinite(raw) || raw < UPSTREAM_TIMEOUT_MIN_SEC) return UPSTREAM_TIMEOUT_DEFAULT_SEC;
    return Math.min(UPSTREAM_TIMEOUT_MAX_SEC, raw);
}

async function getAppSettingInt(key, defaultVal) {
    const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (row == null || row.value === undefined || row.value === '') return defaultVal;
    const n = parseInt(String(row.value), 10);
    return Number.isFinite(n) && n >= 0 ? n : defaultVal;
}

async function setAppSetting(key, val) {
    await db.run(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, String(val)]
    );
}

async function getUpstreamHeadersBlocklist() {
    const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [APP_SETTINGS_KEYS.UPSTREAM_HEADERS_BLOCKLIST]);
    if (row == null || row.value === undefined || row.value === '') return UPSTREAM_HEADERS_BLOCKLIST_DEFAULT;
    try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) return parsed;
    } catch (e) {
        console.error('[getUpstreamHeadersBlocklist] parse error:', e);
    }
    return UPSTREAM_HEADERS_BLOCKLIST_DEFAULT;
}

/**
 * Filter client headers based on blocklist, then apply auth override
 * @param {object} clientHeaders - Original request headers
 * @param {string} providerApiKey - Provider API key to use for auth
 * @param {boolean} isStream - Whether this is a streaming request
 * @param {boolean} isAnthropic - Whether the target is Anthropic API
 * @returns {object} Filtered headers for upstream
 */
async function buildUpstreamHeaders(clientHeaders, providerApiKey, isStream, isAnthropic) {
    const blocklist = await getUpstreamHeadersBlocklist();
    const blocklistLower = blocklist.map(h => h.toLowerCase());

    const upstreamHeaders = {};

    for (const [key, value] of Object.entries(clientHeaders)) {
        // Skip blocked headers
        if (blocklistLower.includes(key.toLowerCase())) {
            continue;
        }
        upstreamHeaders[key] = value;
    }

    // Override auth headers with provider's key
    if (isAnthropic) {
        const hasBearer = clientHeaders['authorization']?.toLowerCase().startsWith('bearer');
        const hasXApiKey = !!clientHeaders['x-api-key'];

        if (hasBearer) {
            upstreamHeaders['Authorization'] = `Bearer ${providerApiKey}`;
        }
        if (hasXApiKey) {
            upstreamHeaders['x-api-key'] = providerApiKey;
        }
    } else {
        // OpenAI uses Bearer token
        if (clientHeaders['authorization']) {
            upstreamHeaders['Authorization'] = `Bearer ${providerApiKey}`;
        }
    }

    // Override accept header based on stream mode
    if (isStream) {
        upstreamHeaders['Accept'] = isAnthropic ? 'text/event-stream' : 'text/event-stream';
    } else {
        upstreamHeaders['Accept'] = 'application/json';
    }

    return upstreamHeaders;
}

async function runRetentionPurge() {
    if (!db) return;
    const logDays = await getAppSettingInt(APP_SETTINGS_KEYS.LOG_RETENTION_DAYS, 0);
    const statsDays = await getAppSettingInt(APP_SETTINGS_KEYS.STATS_RETENTION_DAYS, 0);
    const now = Date.now();
    if (logDays > 0) {
        const cutoff = new Date(now - logDays * 86400000).toISOString();
        const r = await db.run(
            'DELETE FROM conversation_logs WHERE COALESCE(requestAt, createdAt) IS NOT NULL AND COALESCE(requestAt, createdAt) < ?',
            [cutoff]
        );
        if (r.changes > 0) console.log(`[Retention] Removed ${r.changes} conversation_logs (older than ${logDays}d)`);
    }
    if (statsDays > 0) {
        const cutoff = new Date(now - statsDays * 86400000).toISOString();
        const r = await db.run(
            'DELETE FROM stats_events WHERE COALESCE(requestAt, createdAt) IS NOT NULL AND COALESCE(requestAt, createdAt) < ?',
            [cutoff]
        );
        if (r.changes > 0) console.log(`[Retention] Removed ${r.changes} stats_events (older than ${statsDays}d)`);
    }
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

function isClientProtocolOpenAI(reqUrl) {
    return reqUrl.includes('/chat/completions') || reqUrl.includes('/completions');
}

function isClientProtocolAnthropic(reqUrl) {
    return reqUrl.includes('/messages');
}

function buildTargetUrl(baseUrl, pathSuffix, providerType, needsConvert) {
    let url = baseUrl.replace(/\/+$/, '');
    url = url.replace(/\/v\d+\/(chat\/completions|messages).*$/, '');
    url = url.replace(/\/v\d+$/, '');
    url = url.replace(/\/+$/, '');
    if (needsConvert) {
        if (providerType === 'openai') {
            if (!url.match(/\/v\d+$/) && !url.match(/\/v\d+\/.*$/)) {
                if (!url.endsWith('/v1')) url += '/v1';
            }
            url += '/chat/completions';
        } else if (providerType === 'anthropic') {
            if (!url.match(/\/v\d+$/) && !url.match(/\/v\d+\/.*$/)) {
                if (!url.endsWith('/v1')) url += '/v1';
            }
            url += '/messages';
        }
        return url;
    }
    const isOpenAI = pathSuffix === '/' || pathSuffix === '/chat/completions' || pathSuffix === '/completions';
    const isAnthropic = pathSuffix === '/' || pathSuffix === '/messages';
    if (providerType === 'openai' && isOpenAI) {
        if (!url.match(/\/v\d+$/) && !url.match(/\/v\d+\/.*$/)) {
            if (!url.endsWith('/v1')) url += '/v1';
        }
        url += '/chat/completions';
    } else if (providerType === 'anthropic' && isAnthropic) {
        if (!url.match(/\/v\d+$/) && !url.match(/\/v\d+\/.*$/)) {
            if (!url.endsWith('/v1')) url += '/v1';
        }
        url += '/messages';
    } else {
        url += pathSuffix;
    }
    return url;
}

function isProtocolNative(providerType, isOpenAI, isAnthropic) {
    if (providerType === 'openai') return isOpenAI;
    if (providerType === 'anthropic') return isAnthropic;
    return false;
}

function getProtocolError(isOpenAI, isAnthropic) {
    if (isOpenAI) return '协议错误：OpenAI 协议的客户端不能直接访问此厂商';
    if (isAnthropic) return '协议错误：Anthropic 协议的客户端不能直接访问此厂商';
    return '协议错误：不支持的协议';
}

function convertOpenAIStreamToAnthropic(chunkText, state) {
    const lines = chunkText.split('\n');
    let result = '';
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
                result += 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
            } else {
                try {
                    const parsed = JSON.parse(data);
                    const choices = parsed.choices || [];
                    for (const choice of choices) {
                        const delta = choice.delta || {};
                        const finishReason = choice.finish_reason;
                        if (!state.hasStarted && delta.role === 'assistant') {
                            state.hasStarted = true;
                            result += 'event: message_start\ndata: ' + JSON.stringify({
                                type: 'message_start',
                                message: { id: parsed.id || 'msg_unknown', type: 'message', role: 'assistant', content: [], model: parsed.model || '' }
                            }) + '\n\n';
                            result += 'event: content_block_start\ndata: ' + JSON.stringify({
                                type: 'content_block_start', index: 0,
                                content_block: { type: 'text', text: '' }
                            }) + '\n\n';
                        }
                        if (delta.content) {
                            result += 'event: content_block_delta\ndata: ' + JSON.stringify({
                                type: 'content_block_delta', index: 0,
                                delta: { type: 'text_delta', text: delta.content }
                            }) + '\n\n';
                        }
                        if (finishReason) {
                            const anthropicStopReason = finishReason === 'stop' ? 'end_turn' : finishReason;
                            result += 'event: content_block_stop\ndata: ' + JSON.stringify({
                                type: 'content_block_stop', index: 0
                            }) + '\n\n';
                            result += 'event: message_delta\ndata: ' + JSON.stringify({
                                type: 'message_delta',
                                delta: { stop_reason: anthropicStopReason, stop_sequence: null }
                            }) + '\n\n';
                        }
                    }
                } catch (e) {
                    result += line + '\n';
                }
            }
        }
    }
    return result;
}

function convertAnthropicStreamToOpenAI(chunkText, state) {
    const lines = chunkText.split('\n');
    let result = '';
    let currentEvent = '';
    for (const line of lines) {
        if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (currentEvent === 'message_start' && data) {
                try {
                    const parsed = JSON.parse(data);
                    const message = parsed.message || {};
                    if (!state.hasStarted) {
                        state.hasStarted = true;
                        result += 'data: ' + JSON.stringify({
                            id: message.id || 'msg_unknown',
                            object: 'chat.completion.chunk',
                            choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
                        }) + '\n\n';
                    }
                } catch (e) {
                    result += line + '\n';
                }
            } else if (currentEvent === 'content_block_delta' && data) {
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.delta || {};
                    if (delta.type === 'text_delta' && delta.text) {
                        result += 'data: ' + JSON.stringify({
                            choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }]
                        }) + '\n\n';
                    }
                } catch (e) {
                    result += line + '\n';
                }
            } else if (currentEvent === 'message_delta' && data) {
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.delta || {};
                    const stopReason = delta.stop_reason === 'end_turn' ? 'stop' : (delta.stop_reason || null);
                    result += 'data: ' + JSON.stringify({
                        choices: [{ index: 0, delta: {}, finish_reason: stopReason }]
                    }) + '\n\n';
                } catch (e) {
                    result += line + '\n';
                }
            } else if (currentEvent === 'message_stop') {
                result += 'data: [DONE]\n\n';
            }
            currentEvent = '';
        }
    }
    return result;
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
    res.json({
        ok: true,
        proxy: true,
        time: new Date().toISOString(),
        name: appPackageInfo.name,
        version: appPackageInfo.version
    });
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
    const providers = await db.all('SELECT * FROM providers WHERE deletedAt IS NULL ORDER BY id ASC');
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
    const { name, type, baseUrl, apiKey, protocolConvert } = req.body;
    const result = await db.run(
        'INSERT INTO providers (name, type, baseUrl, apiKey, protocolConvert) VALUES (?, ?, ?, ?, ?)',
        [name, type, baseUrl, apiKey, protocolConvert ? 1 : 0]
    );
    res.status(201).json({ id: result.lastID });
});

app.put('/api/providers/:id', async (req, res) => {
    const { id } = req.params;
    const { name, type, baseUrl, apiKey, protocolConvert } = req.body;
    await db.run(
        'UPDATE providers SET name = ?, type = ?, baseUrl = ?, apiKey = ?, protocolConvert = ? WHERE id = ?',
        [name, type, baseUrl, apiKey, protocolConvert ? 1 : 0, id]
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
    await db.run('UPDATE providers SET active = 0, deletedAt = ? WHERE id = ?', [new Date().toISOString(), id]);
    res.sendStatus(200);
});

app.get('/api/providers/deleted', async (req, res) => {
    const providers = await db.all('SELECT * FROM providers WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC');
    const models = await db.all(
        `SELECT pm.providerId, m.id as modelId, m.name as modelName
         FROM provider_models pm JOIN managed_models m ON pm.modelId = m.id
         ORDER BY m.name ASC`
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

app.post('/api/providers/:id/restore', async (req, res) => {
    const { id } = req.params;
    await db.run('UPDATE providers SET deletedAt = NULL WHERE id = ?', [id]);
    res.sendStatus(200);
});

app.delete('/api/providers/:id/permanent', async (req, res) => {
    const { id } = req.params;
    await db.run('DELETE FROM provider_models WHERE providerId = ?', [id]);
    await db.run('DELETE FROM providers WHERE id = ?', [id]);
    res.sendStatus(200);
});

// 导出厂商配置
app.get('/api/providers/export', async (req, res) => {
    const providers = await db.all('SELECT * FROM providers WHERE deletedAt IS NULL ORDER BY id ASC');
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
        active: p.active === 1,
        protocolConvert: p.protocolConvert === 1
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
                'UPDATE providers SET type = ?, baseUrl = ?, apiKey = ?, active = ?, protocolConvert = ? WHERE id = ?',
                [p.type, p.baseUrl, p.apiKey || null, p.active ? 1 : 0, p.protocolConvert ? 1 : 0, existingId]
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
            'INSERT INTO providers (name, type, baseUrl, apiKey, active, protocolConvert) VALUES (?, ?, ?, ?, ?, ?)',
            [p.name, p.type, p.baseUrl, p.apiKey || null, p.active ? 1 : 0, p.protocolConvert ? 1 : 0]
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
        'SELECT id, name, type, baseUrl, apiKey, defaultModelId, active FROM providers WHERE deletedAt IS NULL ORDER BY id ASC'
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
        SELECT
            l.id, l.providerId, l.clientKeyId, l.model, l.actualModel, l.status,
            l.clientUrl, l.targetUrl, l.requestAt, l.responseAt, l.createdAt,
            l.clientUserAgent, l.proxyUserAgent, l.clientIp, l.httpMethod, l.requestPath,
            l.isStream, l.streamBroken, l.requestBytes, l.responseBytes, l.latencyMs,
            l.upstreamStatus, l.clientStatus, l.tokensIn, l.tokensOut, l.tokensTotal,
            p.name as providerName, ck.name as clientKeyName
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

app.get('/api/logs/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const row = await db.get(
        `
        SELECT l.*, p.name as providerName, ck.name as clientKeyName
        FROM conversation_logs l
        LEFT JOIN providers p ON l.providerId = p.id
        LEFT JOIN client_keys ck ON l.clientKeyId = ck.id
        WHERE l.id = ?
        `,
        [id]
    );
    if (!row) return res.status(404).json({ error: 'Log not found' });
    res.json(row);
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

app.get('/api/settings', async (req, res) => {
    const logRetentionDays = await getAppSettingInt(APP_SETTINGS_KEYS.LOG_RETENTION_DAYS, 0);
    const statsRetentionDays = await getAppSettingInt(APP_SETTINGS_KEYS.STATS_RETENTION_DAYS, 0);
    const upstreamTimeoutSeconds = await getUpstreamTimeoutSeconds();
    const upstreamHeadersBlocklist = await getUpstreamHeadersBlocklist();
    res.json({ logRetentionDays, statsRetentionDays, upstreamTimeoutSeconds, upstreamHeadersBlocklist });
});

app.put('/api/settings', async (req, res) => {
    const body = req.body || {};
    let logRetentionDays = Math.max(0, parseInt(body.logRetentionDays, 10));
    let statsRetentionDays = Math.max(0, parseInt(body.statsRetentionDays, 10));
    if (!Number.isFinite(logRetentionDays)) logRetentionDays = 0;
    if (!Number.isFinite(statsRetentionDays)) statsRetentionDays = 0;
    let upstreamTimeoutSeconds = parseInt(body.upstreamTimeoutSeconds, 10);
    if (!Number.isFinite(upstreamTimeoutSeconds)) upstreamTimeoutSeconds = UPSTREAM_TIMEOUT_DEFAULT_SEC;
    upstreamTimeoutSeconds = Math.min(UPSTREAM_TIMEOUT_MAX_SEC, Math.max(UPSTREAM_TIMEOUT_MIN_SEC, upstreamTimeoutSeconds));

    // Handle upstream headers blocklist
    let upstreamHeadersBlocklist = UPSTREAM_HEADERS_BLOCKLIST_DEFAULT;
    if (body.upstreamHeadersBlocklist && Array.isArray(body.upstreamHeadersBlocklist)) {
        upstreamHeadersBlocklist = body.upstreamHeadersBlocklist.filter(h => typeof h === 'string' && h.trim());
    }

    await setAppSetting(APP_SETTINGS_KEYS.LOG_RETENTION_DAYS, logRetentionDays);
    await setAppSetting(APP_SETTINGS_KEYS.STATS_RETENTION_DAYS, statsRetentionDays);
    await setAppSetting(APP_SETTINGS_KEYS.UPSTREAM_TIMEOUT_SECONDS, upstreamTimeoutSeconds);
    await setAppSetting(APP_SETTINGS_KEYS.UPSTREAM_HEADERS_BLOCKLIST, JSON.stringify(upstreamHeadersBlocklist));
    await runRetentionPurge();
    res.json({ logRetentionDays, statsRetentionDays, upstreamTimeoutSeconds, upstreamHeadersBlocklist });
});

app.post('/api/stats/clear', async (req, res) => {
    const r = await db.run('DELETE FROM stats_events');
    res.json({ ok: true, changes: r.changes });
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
    let providerId = req.query.providerId ? Number(req.query.providerId) : null;
    let provider;
    if (providerId) {
        provider = await db.get('SELECT * FROM providers WHERE id = ?', [providerId]);
    } else {
        provider = await db.get('SELECT * FROM providers WHERE active = 1');
        providerId = provider?.id || null;
    }
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
    const { name, providerId: reqProviderId } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing model name' });
    let provider;
    if (reqProviderId) {
        provider = await db.get('SELECT * FROM providers WHERE id = ?', [reqProviderId]);
    } else {
        provider = await db.get('SELECT * FROM providers WHERE active = 1');
    }
    if (!provider) return res.status(400).json({ error: 'No active provider' });

    let model = await db.get('SELECT * FROM managed_models WHERE name = ?', [name]);
    if (!model) {
        const r = await db.run('INSERT INTO managed_models (name) VALUES (?)', [name]);
        model = { id: r.lastID, name };
    }
    await db.run('INSERT OR IGNORE INTO provider_models (providerId, modelId) VALUES (?, ?)', [provider.id, model.id]);
    res.status(201).json({ modelId: model.id });
});

app.put('/api/models/:id/activate', async (req, res) => {
    let providerId = req.query.providerId ? Number(req.query.providerId) : null;
    let provider;
    if (providerId) {
        provider = await db.get('SELECT * FROM providers WHERE id = ?', [providerId]);
    } else {
        provider = await db.get('SELECT * FROM providers WHERE active = 1');
        providerId = provider?.id || null;
    }
    if (!provider) return res.status(400).json({ error: 'No provider specified or active' });
    const { id } = req.params;
    const link = await db.get('SELECT * FROM provider_models WHERE providerId = ? AND modelId = ?', [provider.id, id]);
    if (!link) {
        await db.run('INSERT OR IGNORE INTO provider_models (providerId, modelId) VALUES (?, ?)', [provider.id, id]);
    }
    await db.run('UPDATE providers SET defaultModelId = ? WHERE id = ?', [id, provider.id]);
    res.sendStatus(200);
});

app.delete('/api/models/:id', async (req, res) => {
    let providerId = req.query.providerId ? Number(req.query.providerId) : null;
    let provider;
    if (providerId) {
        provider = await db.get('SELECT * FROM providers WHERE id = ?', [providerId]);
    } else {
        provider = await db.get('SELECT * FROM providers WHERE active = 1');
        providerId = provider?.id || null;
    }
    if (!provider) return res.status(400).json({ error: 'No provider specified or active' });
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

app.put('/api/models/:id', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing model name' });
    const model = await db.get('SELECT * FROM managed_models WHERE id = ?', [id]);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    const existing = await db.get('SELECT * FROM managed_models WHERE name = ? AND id != ?', [name, id]);
    if (existing) return res.status(409).json({ error: `Model name '${name}' already exists` });
    await db.run('UPDATE managed_models SET name = ? WHERE id = ?', [name, id]);
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
    const isClientOpenAI = isClientProtocolOpenAI(req.url);
    const isClientAnthropic = isClientProtocolAnthropic(req.url);

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

    const upstreamTimeoutMs = (await getUpstreamTimeoutSeconds()) * 1000;

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
    if (!isMagicProxyModel(model)) {
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
                console.log(`[Proxy] Model '${MAGIC_PROXY_MODEL_LOWER}' replaced with App-specific model: ${managedModelName}`);
            }
        }

        if (!managedModelName) {
            if (provider.defaultModelId) {
                const mm = await db.get('SELECT name FROM managed_models WHERE id = ?', [provider.defaultModelId]);
                if (mm) {
                    managedModelName = mm.name;
                    console.log(`[Proxy] Model '${MAGIC_PROXY_MODEL_LOWER}' replaced with Provider Default model: ${managedModelName}`);
                }
            }
            if (!managedModelName) {
                const mm = await db.get('SELECT name FROM managed_models WHERE active = 1');
                if (mm) {
                    managedModelName = mm.name;
                    console.log(`[Proxy] Model '${MAGIC_PROXY_MODEL_LOWER}' replaced with Legacy Global Default model: ${managedModelName}`);
                }
            }
        }

        if (managedModelName) {
            actualModel = managedModelName;
        } else {
            console.warn(`[Proxy] Model '${MAGIC_PROXY_MODEL_LOWER}' requested but no managed model is configured. Using client model string as-is.`);
        }
    }

    console.log(`[Proxy] Final Route: Provider=${provider.name} (${provider.type}), Model=${actualModel}`);
    const mask = (key) => key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : 'null';
    console.log(`[Proxy] Client Key: ${mask(authHeader)}`);
    console.log(`[Proxy] Provider Key: ${mask(provider.apiKey)}`);

    // Extract path suffix after /proxy (no query string — easier endpoint aggregation)
    let pathSuffix = req.url.substring('/proxy'.length) || '/';
    const qIdx = pathSuffix.indexOf('?');
    if (qIdx >= 0) pathSuffix = pathSuffix.slice(0, qIdx);
    pathSuffix = pathSuffix || '/';
    if (!pathSuffix.startsWith('/')) pathSuffix = `/${pathSuffix}`;

    // Create log entry
    const requestAt = new Date().toISOString();
    const clientUrl = req.url;
    const clientUserAgent = req.headers['user-agent'] ? String(req.headers['user-agent']) : null;
    const clientIp = getClientIp(req);
    const httpMethod = req.method;
    const requestPath = pathSuffix;
    const isStreamFlag = stream ? 1 : 0;
    const requestBodySerialized = JSON.stringify(req.body);
    const requestBytes = Buffer.byteLength(requestBodySerialized, 'utf8');

    // Record client request headers (mask sensitive values)
    const clientHeadersForLog = { ...req.headers };
    if (clientHeadersForLog['authorization']) {
        const auth = clientHeadersForLog['authorization'];
        clientHeadersForLog['authorization'] = auth.length > 10 ? `${auth.substring(0, 10)}...` : auth;
    }
    if (clientHeadersForLog['x-api-key']) {
        clientHeadersForLog['x-api-key'] = '***masked***';
    }
    const clientRequestHeaders = JSON.stringify(clientHeadersForLog);

    const logResult = await db.run(
        `INSERT INTO conversation_logs (
            providerId, clientKeyId, model, actualModel, requestBody, status, requestAt, clientUrl,
            clientUserAgent, clientIp, httpMethod, requestPath, isStream, requestBytes, clientRequestHeaders
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            provider.id,
            clientKeyData.id,
            model || 'unknown',
            actualModel,
            requestBodySerialized,
            'waiting',
            requestAt,
            clientUrl,
            clientUserAgent,
            clientIp,
            httpMethod,
            requestPath,
            isStreamFlag,
            requestBytes,
            clientRequestHeaders
        ]
        );
    const logId = logResult.lastID;

    // Notify frontend: waiting for response
    io.to('admins').emit('log_update', {
        id: logId,
        status: 'waiting',
        providerName: provider.name,
        clientKeyId: clientKeyData.id,
        clientKeyName: clientKeyData.name,
        requestAt,
        clientUrl,
        actualModel,
        clientUserAgent,
        clientIp,
        httpMethod,
        requestPath,
        isStream: isStreamFlag,
        requestBytes
    });

    // Protocol validation (after log creation so errors are recorded)
    const hasValidProtocol = isClientOpenAI || isClientAnthropic;
    const protocolConvertOn = provider.protocolConvert === 1;
    const isNative = isProtocolNative(provider.type, isClientOpenAI, isClientAnthropic);
    const needsResponseConversion = hasValidProtocol && protocolConvertOn && !isNative;
    if (hasValidProtocol && ((protocolConvertOn && isNative) || (!protocolConvertOn && !isNative))) {
        const errorMsg = getProtocolError(isClientOpenAI, isClientAnthropic);
        const fullMsg = errorMsg + '。请在厂商配置中检查协议转换开关设置。';
        console.log(`[Proxy] Protocol error: ${errorMsg} (provider=${provider.name}, type=${provider.type}, convertOn=${protocolConvertOn})`);
        const responseAt = new Date().toISOString();
        const latencyMs = new Date(responseAt) - new Date(requestAt);
        await db.run(
            `UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, latencyMs = ?, upstreamStatus = ?, clientStatus = ?, responseBytes = ?, streamBroken = 1, tokensIn = 0, tokensOut = 0, tokensTotal = 0 WHERE id = ?`,
            [fullMsg, 'error', responseAt, Number.isFinite(latencyMs) ? Math.round(latencyMs) : null, null, 400, Buffer.byteLength(fullMsg, 'utf8'), logId]
        );
        io.to('admins').emit('log_update', {
            id: logId,
            status: 'error',
            responseBody: fullMsg,
            responseAt,
            latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
            clientStatus: 400,
            responseBytes: Buffer.byteLength(fullMsg, 'utf8'),
            streamBroken: 1,
            tokensIn: 0,
            tokensOut: 0,
            tokensTotal: 0
        });
        await db.run(
            `INSERT INTO stats_events (appId, providerId, requestedModel, actualModel, status, requestAt, responseAt, latencyMs, tokensIn, tokensOut, tokensTotal, errorMessage)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
            [clientKeyData.id, provider.id, model || 'unknown', actualModel || null, 'error', requestAt, responseAt, null, fullMsg]
        );
        return res.status(400).json({ error: fullMsg });
    }

    let targetUrl = '';
    if (stream) {
        let streamBytesTotal = 0;
        let proxyUserAgent = null;
        try {
            let targetBody = { ...req.body, model: actualModel };
            let upstreamHeaders = {};

            if (provider.type === 'openai') {
                if (needsResponseConversion) {
                    const messages = req.body.messages || [];
                    targetBody = {
                        model: actualModel,
                        messages: messages.map(m => ({
                            role: m.role,
                            content: typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '')
                        })),
                        max_tokens: req.body.max_tokens || 4096,
                        stream: true
                    };
                    const systemMsg = messages.find(m => m.role === 'system');
                    if (systemMsg) {
                        targetBody.messages = targetBody.messages.filter(m => m.role !== 'system');
                        targetBody.messages.unshift({ role: 'system', content: systemMsg.content });
                    }
                }
                targetUrl = buildTargetUrl(provider.baseUrl, pathSuffix, provider.type, needsResponseConversion);
                upstreamHeaders = await buildUpstreamHeaders(req.headers, provider.apiKey, true, false);
            } else if (provider.type === 'anthropic') {
                if (needsResponseConversion) {
                    const messages = req.body.messages || [];
                    targetBody = {
                        model: actualModel,
                        messages: messages.filter(m => m.role !== 'system').map(m => ({
                            role: m.role === 'assistant' ? 'assistant' : 'user',
                            content: m.content
                        })),
                        max_tokens: req.body.max_tokens || 4096,
                        system: messages.find(m => m.role === 'system')?.content,
                        stream: true
                    };
                }
                targetUrl = buildTargetUrl(provider.baseUrl, pathSuffix, provider.type, needsResponseConversion);
                upstreamHeaders = await buildUpstreamHeaders(req.headers, provider.apiKey, true, true);
            } else {
                const msg = `不支持的厂商类型: ${provider.type}`;
                const responseAt = new Date().toISOString();
                const latencyMs = new Date(responseAt) - new Date(requestAt);
                const rb = Buffer.byteLength(msg, 'utf8');
                await db.run(
                    `UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ?, proxyUserAgent = ?, latencyMs = ?, upstreamStatus = ?, clientStatus = ?, responseBytes = ?, streamBroken = ?, tokensIn = ?, tokensOut = ?, tokensTotal = ? WHERE id = ?`,
                    [msg, 'error', responseAt, targetUrl, null, Number.isFinite(latencyMs) ? Math.round(latencyMs) : null, null, 400, rb, 0, 0, 0, 0, logId]
                );
                io.to('admins').emit('log_update', {
                    id: logId,
                    status: 'error',
                    responseBody: msg,
                    responseAt,
                    targetUrl,
                    latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                    clientStatus: 400,
                    responseBytes: rb,
                    streamBroken: 0,
                    tokensIn: 0,
                    tokensOut: 0,
                    tokensTotal: 0
                });
                return res.status(400).json({ error: msg });
            }

            if (req.headers['user-agent']) {
                upstreamHeaders['User-Agent'] = req.headers['user-agent'];
            }

            proxyUserAgent = pickOutgoingUserAgent(upstreamHeaders);

            const proxyHeadersForLog = { ...upstreamHeaders };
            if (proxyHeadersForLog['authorization']) {
                const auth = proxyHeadersForLog['authorization'];
                proxyHeadersForLog['authorization'] = auth.length > 10 ? `${auth.substring(0, 10)}...` : auth;
            }
            if (proxyHeadersForLog['x-api-key']) {
                proxyHeadersForLog['x-api-key'] = '***masked***';
            }
            const proxyRequestHeaders = JSON.stringify(proxyHeadersForLog);
            await db.run('UPDATE conversation_logs SET proxyRequestHeaders = ? WHERE id = ?', [proxyRequestHeaders, logId]);

            const upstream = await axiosInstance.post(targetUrl, targetBody, {
                headers: upstreamHeaders,
                responseType: 'stream',
                validateStatus: () => true,
                timeout: upstreamTimeoutMs
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
            const sseConvertState = {};
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
                    let text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
                    if (needsResponseConversion) {
                        if (provider.type === 'openai') {
                            text = convertOpenAIStreamToAnthropic(text, sseConvertState);
                        } else if (provider.type === 'anthropic') {
                            text = convertAnthropicStreamToOpenAI(text, sseConvertState);
                        }
                    }
                    streamBytesTotal += Buffer.byteLength(text, 'utf8');
                    responseData += text;
                    pendingChunkForLog += text;
                    res.write(text);
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
            const latencyMs = new Date(responseAt) - new Date(requestAt);
            const usage = extractUsage(responseData);
            const clientStatus = upstream.status;
            await db.run(
                `UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ?, proxyUserAgent = ?, latencyMs = ?, upstreamStatus = ?, clientStatus = ?, responseBytes = ?, streamBroken = ?, tokensIn = ?, tokensOut = ?, tokensTotal = ? WHERE id = ?`,
                [
                    responseData,
                    status,
                    responseAt,
                    targetUrl,
                    proxyUserAgent,
                    Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                    upstream.status,
                    clientStatus,
                    streamBytesTotal,
                    0,
                    usage.tokensIn,
                    usage.tokensOut,
                    usage.tokensTotal,
                    logId
                ]
            );

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
                    Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                    usage.tokensIn,
                    usage.tokensOut,
                    usage.tokensTotal,
                    status === 'error' ? `Upstream status ${upstream.status}` : null
                ]
            );

            io.to('admins').emit('log_update', {
                id: logId,
                status,
                responseBody: responseData,
                responseAt,
                targetUrl,
                proxyUserAgent,
                latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                upstreamStatus: upstream.status,
                clientStatus,
                responseBytes: streamBytesTotal,
                streamBroken: 0,
                tokensIn: usage.tokensIn,
                tokensOut: usage.tokensOut,
                tokensTotal: usage.tokensTotal
            });
            return;
        } catch (error) {
            const responseAt = new Date().toISOString();
            const errorBody = error?.message || 'Streaming proxy failed';
            const latencyMs = new Date(responseAt) - new Date(requestAt);
            const cfgUa = pickOutgoingUserAgent(error.config?.headers);
            const upstreamStatus = error.response?.status ?? null;
            const clientStatus = res.headersSent ? (res.statusCode || error.response?.status || 500) : (error.response?.status || 500);
            const usage = extractUsage(error.response?.data);
            await db.run(
                `UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ?, proxyUserAgent = ?, latencyMs = ?, upstreamStatus = ?, clientStatus = ?, responseBytes = ?, streamBroken = ?, tokensIn = ?, tokensOut = ?, tokensTotal = ? WHERE id = ?`,
                [
                    errorBody,
                    'error',
                    responseAt,
                    targetUrl || error.config?.url,
                    cfgUa,
                    Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                    upstreamStatus,
                    clientStatus,
                    streamBytesTotal,
                    1,
                    usage.tokensIn,
                    usage.tokensOut,
                    usage.tokensTotal,
                    logId
                ]
            );
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
                    Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                    usage.tokensIn,
                    usage.tokensOut,
                    usage.tokensTotal,
                    error?.message || 'Streaming proxy failed'
                ]
            );
            io.to('admins').emit('log_update', {
                id: logId,
                status: 'error',
                responseBody: errorBody,
                responseAt,
                targetUrl: targetUrl || error.config?.url,
                proxyUserAgent: cfgUa,
                latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                upstreamStatus,
                clientStatus,
                responseBytes: streamBytesTotal,
                streamBroken: 1,
                tokensIn: usage.tokensIn,
                tokensOut: usage.tokensOut,
                tokensTotal: usage.tokensTotal
            });
            if (!res.headersSent) {
                return res.status(error.response?.status || 500).json(error.response?.data || { error: errorBody });
            }
            if (!res.writableEnded) res.end();
            return;
        }
    }

    try {
        let response;
        let proxyUserAgent = null;
        if (provider.type === 'openai') {
            // Target is OpenAI
            let targetBody = { ...req.body, model: actualModel };

            // Request conversion logic
            if (needsResponseConversion) {
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
            targetUrl = buildTargetUrl(provider.baseUrl, pathSuffix, provider.type, needsResponseConversion);

            console.log(`[Proxy] Forwarding to OpenAI: ${targetUrl}`);
            // Use filtered headers from client, override auth
            const openaiHeaders = await buildUpstreamHeaders(req.headers, provider.apiKey, false, false);

            proxyUserAgent = pickOutgoingUserAgent(openaiHeaders);

            response = await axiosInstance.post(targetUrl, targetBody, {
                headers: openaiHeaders,
                timeout: upstreamTimeoutMs
            });

            // Response conversion logic
            if (needsResponseConversion) {
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
            if (needsResponseConversion) {
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
            targetUrl = buildTargetUrl(provider.baseUrl, pathSuffix, provider.type, needsResponseConversion);

            console.log(`[Proxy] Forwarding to Anthropic: ${targetUrl}`);
            // Use filtered headers from client, override auth
            const anthropicHeaders = await buildUpstreamHeaders(req.headers, provider.apiKey, false, true);

            proxyUserAgent = pickOutgoingUserAgent(anthropicHeaders);

            // Record proxy request headers (mask sensitive values)
            const proxyHeadersForLog = { ...anthropicHeaders };
            if (proxyHeadersForLog['authorization']) {
                const auth = proxyHeadersForLog['authorization'];
                proxyHeadersForLog['authorization'] = auth.length > 10 ? `${auth.substring(0, 10)}...` : auth;
            }
            if (proxyHeadersForLog['x-api-key']) {
                proxyHeadersForLog['x-api-key'] = '***masked***';
            }
            const proxyRequestHeaders = JSON.stringify(proxyHeadersForLog);
            await db.run('UPDATE conversation_logs SET proxyRequestHeaders = ? WHERE id = ?', [proxyRequestHeaders, logId]);

            response = await axiosInstance.post(targetUrl, targetBody, {
                headers: anthropicHeaders,
                timeout: upstreamTimeoutMs
            });

            // Response conversion logic
            if (needsResponseConversion) {
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
        const latencyMs = new Date(responseAt) - new Date(requestAt);
        const usage = extractUsage(response.data);
        const responseBytes = Buffer.byteLength(responseData, 'utf8');
        const upstreamStatus = response.status;
        const clientStatus = response.status;
        await db.run(
            `UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ?, proxyUserAgent = ?, latencyMs = ?, upstreamStatus = ?, clientStatus = ?, responseBytes = ?, streamBroken = 0, tokensIn = ?, tokensOut = ?, tokensTotal = ? WHERE id = ?`,
            [
                responseData,
                'completed',
                responseAt,
                targetUrl,
                proxyUserAgent,
                Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                upstreamStatus,
                clientStatus,
                responseBytes,
                usage.tokensIn,
                usage.tokensOut,
                usage.tokensTotal,
                logId
            ]
        );

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
        io.to('admins').emit('log_update', {
            id: logId,
            status: 'completed',
            responseBody: responseData,
            responseAt,
            targetUrl,
            proxyUserAgent,
            latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
            upstreamStatus,
            clientStatus,
            responseBytes,
            streamBroken: 0,
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            tokensTotal: usage.tokensTotal
        });

        res.json(response.data);

    } catch (error) {
        const responseAt = new Date().toISOString();
        console.error('Proxy Error Detail:', {
            url: error.config?.url,
            method: error.config?.method,
            headers: redactSensitiveHeaders(error.config?.headers),
            data: truncateForErrorLog(error.config?.data),
            response: truncateForErrorLog(error.response?.data),
            status: error.response?.status,
            message: error.message
        });
        const errorData = error.response?.data || { error: error.message };
        const errorBody = typeof errorData === 'string' ? errorData : JSON.stringify(errorData);
        const latencyMs = new Date(responseAt) - new Date(requestAt);
        const usage = extractUsage(error.response?.data);
        const responseBytes = Buffer.byteLength(errorBody, 'utf8');
        const cfgUa = pickOutgoingUserAgent(error.config?.headers);
        const upstreamStatus = error.response?.status ?? null;
        const clientStatus = error.response?.status || 500;
        await db.run(
            `UPDATE conversation_logs SET responseBody = ?, status = ?, responseAt = ?, targetUrl = ?, proxyUserAgent = ?, latencyMs = ?, upstreamStatus = ?, clientStatus = ?, responseBytes = ?, streamBroken = 0, tokensIn = ?, tokensOut = ?, tokensTotal = ? WHERE id = ?`,
            [
                errorBody,
                'error',
                responseAt,
                targetUrl || error.config?.url,
                cfgUa,
                Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
                upstreamStatus,
                clientStatus,
                responseBytes,
                usage.tokensIn,
                usage.tokensOut,
                usage.tokensTotal,
                logId
            ]
        );

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

        io.to('admins').emit('log_update', {
            id: logId,
            status: 'error',
            responseBody: errorBody,
            responseAt,
            targetUrl: targetUrl || error.config?.url,
            proxyUserAgent: cfgUa,
            latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
            upstreamStatus,
            clientStatus,
            responseBytes,
            streamBroken: 0,
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            tokensTotal: usage.tokensTotal
        });
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
    await runRetentionPurge().catch((e) => console.error('[Retention]', e));
    setInterval(() => {
        runRetentionPurge().catch((e) => console.error('[Retention]', e));
    }, 6 * 60 * 60 * 1000);
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

start();
