const axios = require('axios');

class Notifier {
    constructor(db) {
        this.db = db;
        this.rounds = new Map();
        this.timers = new Map();
    }

    handleRequestCompleted(logId) {
        this._process(logId).catch(e => console.error('[Notifier]', e.message));
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

        const config = await this._findConfig(log.clientKeyId);
        if (!config || !config.enabled) return;

        const key = log.clientKeyId;

        if (!this.rounds.has(key)) {
            this.rounds.set(key, {
                clientKeyId: key,
                clientKeyName: log.clientKeyName || '',
                clientApp: log.clientApp || 'unknown',
                providerId: log.providerId,
                model: log.model,
                actualModel: log.actualModel,
                logs: [],
                startTime: log.requestAt
            });
        }
        const round = this.rounds.get(key);
        round.logs.push(log);

        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }

        const finishReason = this._extractFinishReason(log.responseBody, log.status);
        const cooldownMs = (config.cooldownSeconds || 5) * 1000;

        if (finishReason === 'stop' || finishReason === 'end_turn' || log.status === 'error') {
            this.timers.set(key, setTimeout(() => {
                this._finalizeRound(key).catch(e => console.error('[Notifier] finalize:', e.message));
            }, cooldownMs));
        }
    }

    async _finalizeRound(clientKeyId) {
        const round = this.rounds.get(clientKeyId);
        if (!round || round.logs.length === 0) return;

        this.rounds.delete(clientKeyId);
        this.timers.delete(clientKeyId);

        const config = await this._findConfig(clientKeyId);
        if (!config || !config.enabled) return;

        const logs = round.logs;
        const summary = {
            clientKeyId: round.clientKeyId,
            clientKeyName: round.clientKeyName,
            clientApp: round.clientApp,
            model: round.model,
            actualModel: round.actualModel,
            providerId: round.providerId,
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
                `INSERT INTO notification_logs (clientKeyId, status, webhookUrl, httpMethod, requestHeaders, requestBodyPreview, roundSummary)
                 VALUES (?, 'pending', ?, ?, ?, ?, ?)`,
                [
                    data.clientKeyId,
                    config.webhookUrl,
                    config.httpMethod || 'POST',
                    JSON.stringify(headers),
                    reqBodyPreview,
                    JSON.stringify({
                        clientApp: data.clientApp,
                        model: data.actualModel || data.model,
                        status: data.status,
                        requestCount: data.requestCount,
                        totalTokens: data.totalTokens,
                        totalLatencyMs: data.totalLatencyMs,
                        startTime: data.startTime,
                        endTime: data.endTime
                    })
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
            clientApp: data.clientApp,
            model: data.actualModel || data.model,
            status: data.status,
            requestCount: data.requestCount,
            tokens: {
                in: data.totalTokensIn,
                out: data.totalTokensOut,
                total: data.totalTokens
            },
            latencyMs: data.totalLatencyMs,
            time: { start: data.startTime, end: data.endTime },
            requests: data.requests
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

    async _findConfig(clientKeyId) {
        const rows = await this.db.all(
            'SELECT * FROM notification_configs WHERE enabled = 1'
        );
        for (const row of rows) {
            const ids = this._safeJsonParse(row.clientKeyIds, []);
            if (ids.includes(clientKeyId)) {
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
