const axios = require('axios');

class Notifier {
    constructor(db) {
        this.db = db;
        this.rounds = new Map();
        this.errorBatches = new Map();
        this.timers = new Map();
    }

    handleRequestCompleted(logId) {
        this._process(logId).catch(e => console.error('[Notifier]', e.message));
    }

    handleRequestStarted(clientKeyId) {
        if (this.timers.has(clientKeyId)) {
            const t = this.timers.get(clientKeyId);
            if (t.round) { clearTimeout(t.round); t.round = null; }
            if (t.error) { clearTimeout(t.error); t.error = null; }
        }
    }

    async _process(logId) {
        const log = await this.db.get(
            `SELECT l.*, ck.name as clientKeyName
             FROM conversation_logs l
             JOIN client_keys ck ON ck.id = l.clientKeyId
             WHERE l.id = ?`,
            [logId]
        );
        if (!log) return;

        // Load timezone setting for mute window check
        if (!this._timezone) {
            const tzRow = await this.db.get("SELECT value FROM app_settings WHERE key = 'admin_timezone'");
            this._timezone = tzRow?.value || 'Asia/Shanghai';
        }

        // Global mute check
        const muteRow = await this.db.get("SELECT value FROM app_settings WHERE key = 'notification_mute'");
        if (muteRow) {
            try {
                const mute = JSON.parse(muteRow.value);
                if (mute.enabled && this._inMuteWindow(mute.start, mute.end)) return;
            } catch {}
        }

        const key = log.clientKeyId;

        // Error branch — independent of conversation round tracking
        if (log.status === 'error') {
            const config = await this._findConfig(key, 'error');
            if (!config || !config.enabled) return;

            if (!this.errorBatches.has(key)) {
                this.errorBatches.set(key, {
                    clientKeyId: key,
                    clientKeyName: log.clientKeyName || '',
                    clientApp: log.clientApp || 'unknown',
                    errors: [],
                    startTime: log.requestAt,
                    lastErrorAt: log.requestAt,
                    configId: config.id
                });
            }
            const batch = this.errorBatches.get(key);
            batch.errors.push(log);
            batch.lastErrorAt = log.requestAt;
            batch.configId = config.id;

            if (!this.timers.has(key)) {
                this.timers.set(key, { round: null, error: null });
            }
            const t = this.timers.get(key);
            if (t.error) { clearTimeout(t.error); }
            t.error = setTimeout(() => {
                this._finalizeErrorBatch(key).catch(e => console.error('[Notifier] finalize error:', e.message));
            }, (config.errorSuppressSeconds || 60) * 1000);
            return;
        }

        // Normal request — conversation round tracking
        if (!this.rounds.has(key)) {
            this.rounds.set(key, {
                clientKeyId: key,
                clientKeyName: log.clientKeyName || '',
                clientApp: log.clientApp || 'unknown',
                providerId: log.providerId,
                model: log.model,
                actualModel: log.actualModel,
                logs: [],
                startTime: log.requestAt,
                configId: null,
                notificationType: null
            });
        }
        const round = this.rounds.get(key);
        round.logs.push(log);

        // Cancel existing round timer (new request invalidates old round timer)
        if (!this.timers.has(key)) {
            this.timers.set(key, { round: null, error: null });
        }
        const t = this.timers.get(key);
        if (t.round) { clearTimeout(t.round); t.round = null; }

        const finishReason = this._extractFinishReason(log.responseBody, log.status);

        let config = null;
        let timeoutMs = null;

        if (finishReason === 'stop' || finishReason === 'end_turn') {
            config = await this._findConfig(key, 'completion');
            if (config && config.enabled) {
                timeoutMs = (config.cooldownSeconds || 5) * 1000;
            }
        } else if (finishReason === 'tool_use' || finishReason === 'tool_calls') {
            config = await this._findConfig(key, 'tool_use_confirmation');
            if (config && config.enabled) {
                timeoutMs = (config.toolUseTimeoutSeconds || 10) * 1000;
            }
        }

        if (config && timeoutMs) {
            round.configId = config.id;
            round.notificationType = config.notificationType;
            t.round = setTimeout(() => {
                this._finalizeRound(key).catch(e => console.error('[Notifier] finalize:', e.message));
            }, timeoutMs);
        }
    }

    async _finalizeRound(clientKeyId) {
        const round = this.rounds.get(clientKeyId);
        if (!round || round.logs.length === 0) return;

        this.rounds.delete(clientKeyId);
        if (this.timers.has(clientKeyId)) {
            const t = this.timers.get(clientKeyId);
            if (t.round) { clearTimeout(t.round); t.round = null; }
        }

        if (!round.configId) return;

        const config = await this._getConfigById(round.configId);
        if (!config || !config.enabled) return;

        const logs = round.logs;
        const summary = {
            clientKeyId: round.clientKeyId,
            clientKeyName: round.clientKeyName,
            clientName: round.clientKeyName,
            clientApp: round.clientApp,
            model: round.model,
            actualModel: round.actualModel,
            providerId: round.providerId,
            notificationType: round.notificationType,
            status: logs.every(l => l.status === 'completed') ? 'completed'
                : logs.every(l => l.status === 'error') ? 'error'
                : 'partial',
            requestCount: logs.length,
            totalTokensIn: logs.reduce((s, l) => s + (l.tokensIn || 0), 0),
            totalTokensOut: logs.reduce((s, l) => s + (l.tokensOut || 0), 0),
            totalTokens: logs.reduce((s, l) => s + (l.tokensTotal || 0), 0),
            totalLatencyMs: logs.reduce((s, l) => s + (l.latencyMs || 0), 0),
            startTime: round.startTime,
            endTime: logs[logs.length - 1].responseAt,
            requests: logs.map(l => ({
                id: l.id,
                model: l.actualModel || l.model,
                status: l.status,
                tokensIn: l.tokensIn || 0,
                tokensOut: l.tokensOut || 0,
                tokensTotal: l.tokensTotal || 0,
                latencyMs: l.latencyMs || 0,
                ttfbMs: l.ttfbMs || null,
                streamBroken: l.streamBroken || 0,
                requestAt: l.requestAt,
                responseAt: l.responseAt
            }))
        };

        await this._sendNotification(config, summary);
    }

    async _finalizeErrorBatch(clientKeyId) {
        const batch = this.errorBatches.get(clientKeyId);
        if (!batch || batch.errors.length === 0) return;

        this.errorBatches.delete(clientKeyId);
        if (this.timers.has(clientKeyId)) {
            const t = this.timers.get(clientKeyId);
            if (t.error) { clearTimeout(t.error); t.error = null; }
        }

        const config = await this._getConfigById(batch.configId);
        if (!config || !config.enabled) return;

        const distinctMsgs = [...new Set(batch.errors.map(e => {
            try { return JSON.parse(e.responseBody).error; } catch { return e.responseBody || 'unknown'; }
        }))];

        const summary = {
            clientKeyId: batch.clientKeyId,
            clientKeyName: batch.clientKeyName,
            clientName: batch.clientKeyName,
            clientApp: batch.clientApp,
            notificationType: 'error',
            status: 'error',
            errorCount: batch.errors.length,
            errorMessages: distinctMsgs.join(', '),
            firstErrorAt: batch.startTime,
            lastErrorAt: batch.lastErrorAt,
            startTime: batch.startTime,
            endTime: batch.lastErrorAt,
            requestCount: batch.errors.length,
            totalTokensIn: 0,
            totalTokensOut: 0,
            totalTokens: 0,
            totalLatencyMs: 0,
            errors: batch.errors.map(e => ({
                id: e.id,
                status: e.status,
                error: e.responseBody,
                clientStatus: e.clientStatus,
                requestAt: e.requestAt
            }))
        };

        await this._sendNotification(config, summary);
    }

    async _sendNotification(config, data) {
        const rendered = this._renderTemplate(config.bodyTemplate, data);
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'llmpylon-notifier/1.0',
            ...(typeof config.headers === 'object' && config.headers !== null ? config.headers : {})
        };

        const reqBodyStr = typeof rendered === 'string' ? rendered : JSON.stringify(rendered);
        const reqBodyPreview = reqBodyStr.length > 2000 ? reqBodyStr.slice(0, 2000) + '…[truncated]' : reqBodyStr;

        let logId = null;
        try {
            const result = await this.db.run(
                `INSERT INTO notification_logs (clientKeyId, status, webhookUrl, httpMethod, requestHeaders, requestBodyPreview, roundSummary, ruleName, notificationType)
                 VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.clientKeyId,
                    config.webhookUrl,
                    config.httpMethod || 'POST',
                    JSON.stringify(headers),
                    reqBodyPreview,
                    JSON.stringify({
                        notificationType: data.notificationType,
                        clientApp: data.clientApp,
                        model: data.actualModel || data.model,
                        status: data.status,
                        requestCount: data.requestCount || 0,
                        totalTokens: data.totalTokens || 0,
                        totalLatencyMs: data.totalLatencyMs || 0,
                        errorCount: data.errorCount,
                        errorMessages: data.errorMessages,
                        startTime: data.startTime,
                        endTime: data.endTime
                    }),
                    config.name || '',
                    data.notificationType || ''
                ]
            );
            logId = result.lastID;
        } catch (e) {
            console.error('[Notifier] log insert failed:', e.message);
        }

        try {
            const response = await axios({
                method: config.httpMethod || 'POST',
                url: config.webhookUrl,
                headers,
                data: rendered,
                timeout: 15000,
                validateStatus: () => true
            });

            const respBodyStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            const respPreview = respBodyStr.length > 2000 ? respBodyStr.slice(0, 2000) + '…[truncated]' : respBodyStr;

            if (logId) {
                await this.db.run(
                    `UPDATE notification_logs SET status = 'success', responseStatusCode = ?, responseBodyPreview = ? WHERE id = ?`,
                    [response.status, respPreview, logId]
                );
            }
        } catch (e) {
            if (logId) {
                await this.db.run(
                    `UPDATE notification_logs SET status = 'error', errorMessage = ? WHERE id = ?`,
                    [e.message || 'Unknown error', logId]
                );
            }
            console.error('[Notifier] HTTP send failed:', e.message);
        }
    }

    _renderTemplate(template, data) {
        if (typeof template === 'string' && template.trim()) {
            try {
                const parsed = JSON.parse(template);
                return this._replaceVars(parsed, data);
            } catch {}
            return { text: String(template) };
        }
        return {
            app: data.clientKeyName,
            clientName: data.clientKeyName,
            clientApp: data.clientApp,
            model: data.actualModel || data.model,
            notificationType: data.notificationType,
            status: data.status,
            requestCount: data.requestCount,
            errorCount: data.errorCount,
            errorMessages: data.errorMessages,
            tokens: {
                in: data.totalTokensIn,
                out: data.totalTokensOut,
                total: data.totalTokens
            },
            latencyMs: data.totalLatencyMs,
            time: { start: data.startTime, end: data.endTime },
            requests: data.requests,
            errors: data.errors
        };
    }

    _replaceVars(obj, data) {
        if (typeof obj === 'string') {
            return obj.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
                const val = path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), data);
                return val !== undefined ? val : '';
            });
        }
        if (Array.isArray(obj)) {
            return obj.map(v => this._replaceVars(v, data));
        }
        if (typeof obj === 'object' && obj !== null) {
            const result = {};
            for (const [k, v] of Object.entries(obj)) {
                result[k] = this._replaceVars(v, data);
            }
            return result;
        }
        return obj;
    }

    _extractFinishReason(responseBody, status) {
        if (status === 'error' || !responseBody) return 'error';
        if (typeof responseBody !== 'string') return 'unknown';

        if (responseBody.includes('"stop_reason":"end_turn"') || responseBody.includes('"stop_reason": "end_turn"')) {
            return 'end_turn';
        }
        if (responseBody.includes('"stop_reason":"tool_use"') || responseBody.includes('"stop_reason": "tool_use"')) {
            return 'tool_use';
        }
        if (responseBody.includes('"finish_reason":"stop"') || responseBody.includes('"finish_reason": "stop"')) {
            return 'stop';
        }
        if (responseBody.includes('"finish_reason":"tool_calls"') || responseBody.includes('"finish_reason": "tool_calls"')) {
            return 'tool_calls';
        }
        return 'unknown';
    }

    async _findConfig(clientKeyId, notificationType) {
        const rows = await this.db.all(
            'SELECT * FROM notification_configs WHERE enabled = 1'
        );
        for (const row of rows) {
            const ids = this._safeJsonParse(row.clientKeyIds, []);
            if (ids.includes(clientKeyId) && row.notificationType === notificationType) {
                return {
                    ...row,
                    headers: this._safeJsonParse(row.headers, {}),
                    filterClientApps: this._safeJsonParse(row.filterClientApps, []),
                    filterStatuses: this._safeJsonParse(row.filterStatuses, []),
                    enabled: true
                };
            }
        }
        return null;
    }

    async _getConfigById(id) {
        const row = await this.db.get('SELECT * FROM notification_configs WHERE id = ?', [id]);
        if (!row) return null;
        return {
            ...row,
            headers: this._safeJsonParse(row.headers, {}),
            filterClientApps: this._safeJsonParse(row.filterClientApps, []),
            filterStatuses: this._safeJsonParse(row.filterStatuses, []),
            enabled: row.enabled === 1
        };
    }

    _inMuteWindow(start, end) {
        const now = new Date();
        let h = now.getHours(), m = now.getMinutes();
        try {
            const tz = new Intl.DateTimeFormat('en', { timeZone: this._timezone || 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
            const parts = tz.split(':').map(Number);
            h = parts[0];
            m = parts[1];
        } catch {}
        const mins = h * 60 + m;
        const [sh, sm] = String(start || '00:00').split(':').map(Number);
        const [eh, em] = String(end || '00:00').split(':').map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        if (startMin === endMin) return false;
        if (startMin <= endMin) return mins >= startMin && mins < endMin;
        return mins >= startMin || mins < endMin;
    }

    _safeJsonParse(str, defaultVal) {
        try {
            return JSON.parse(str);
        } catch {
            return defaultVal;
        }
    }
}

let notifier = null;

function initNotifier(db) {
    notifier = new Notifier(db);
    return notifier;
}

function getNotifier() {
    return notifier;
}

module.exports = { initNotifier, getNotifier };
