const axios = require('axios');

const CONCURRENCY = 5;

const VENDOR_PATTERNS = [
    {
        pattern: 'api.deepseek.com',
        id: 'deepseek',
        name: 'DeepSeek',
        intervalMs: 5 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            const res = await axios.get('https://api.deepseek.com/user/balance', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                timeout: 5000
            });
            const total = res.data?.balance_infos?.[0]?.total_balance;
            return total ? { balance: total } : null;
        }
    },
    {
        pattern: 'api.moonshot.ai',
        id: 'moonshot',
        name: 'Moonshot',
        intervalMs: 5 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            const res = await axios.get('https://api.moonshot.ai/v1/users/me/balance', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                timeout: 5000
            });
            const bal = res.data?.available_balance;
            return bal != null ? { balance: String(bal) } : null;
        }
    },
    {
        pattern: 'api.moonshot.cn',
        id: 'moonshot',
        name: 'Moonshot',
        intervalMs: 5 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            const res = await axios.get('https://api.moonshot.cn/v1/users/me/balance', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                timeout: 5000
            });
            const bal = res.data?.available_balance;
            return bal != null ? { balance: String(bal) } : null;
        }
    },
    {
        pattern: 'api.venice.ai',
        id: 'venice',
        name: 'Venice',
        intervalMs: 5 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            const res = await axios.get('https://api.venice.ai/api/v1/billing/balance', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                timeout: 5000
            });
            const bal = res.data?.usd_balance;
            return bal != null ? { balance: String(bal) } : null;
        }
    },
    {
        pattern: 'api.openai.com',
        id: 'openai',
        name: 'OpenAI',
        intervalMs: 30 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            let data = {};
            try {
                const costsRes = await axios.get('https://api.openai.com/v1/organization/costs', {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    timeout: 5000
                });
                const lines = costsRes.data?.data || [];
                const now = new Date();
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                let monthlyCost = 0;
                for (const l of lines) {
                    if (typeof l.amount?.value === 'number' && l.start_time >= monthStart) {
                        monthlyCost += Math.abs(l.amount.value);
                    }
                }
                if (monthlyCost > 0) data.monthlyCost = monthlyCost.toFixed(2);
            } catch {}
            if (Object.keys(data).length === 0) {
                try {
                    const grantRes = await axios.get('https://api.openai.com/v1/dashboard/billing/credit_grants', {
                        headers: { 'Authorization': `Bearer ${apiKey}` },
                        timeout: 5000
                    });
                    const avail = grantRes.data?.total_available;
                    if (avail != null) data.balance = String(avail);
                } catch {}
            }
            return data;
        }
    },
    {
        pattern: 'api.anthropic.com',
        id: 'anthropic',
        name: 'Anthropic',
        intervalMs: 30 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            try {
                const res = await axios.get('https://api.anthropic.com/v1/organizations/cost_report', {
                    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                    timeout: 5000
                });
                const lines = res.data?.data || [];
                const now = new Date();
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                let monthlyCost = 0;
                for (const l of lines) {
                    if (l.start_time >= monthStart) {
                        monthlyCost += Math.abs(parseFloat(l.cost) || 0);
                    }
                }
                return monthlyCost > 0 ? { monthlyCost: monthlyCost.toFixed(2) } : null;
            } catch {
                return null;
            }
        }
    },
    {
        pattern: 'api.elevenlabs.io',
        id: 'elevenlabs',
        name: 'ElevenLabs',
        intervalMs: 30 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            try {
                const res = await axios.get('https://api.elevenlabs.io/v1/user/subscription', {
                    headers: { 'xi-api-key': apiKey },
                    timeout: 5000
                });
                const c = res.data?.character;
                if (c && typeof c.limit === 'number' && typeof c.used === 'number') {
                    return { quotaLabel: '字符', used: c.used, limit: c.limit };
                }
                return null;
            } catch {
                return null;
            }
        }
    },
    {
        pattern: 'kimi-k2.ai',
        id: 'kimik2',
        name: 'Kimi K2',
        intervalMs: 30 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            try {
                const res = await axios.get('https://kimi-k2.ai/api/user/credits', {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    timeout: 5000
                });
                const consumed = res.data?.consumed;
                const remaining = res.data?.remaining;
                if (consumed != null && remaining != null) {
                    return { quotaLabel: 'Credits', used: consumed, limit: consumed + remaining };
                }
                return null;
            } catch {
                return null;
            }
        }
    },
    {
        pattern: 'api.groq.com',
        id: 'groq',
        name: 'Groq',
        intervalMs: 5 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            try {
                const query = 'rate(openai_request_total[5m])';
                const res = await axios.get('https://api.groq.com/metrics/prometheus/api/v1/query', {
                    params: { query },
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    timeout: 5000
                });
                const result = res.data?.data?.result?.[0]?.value?.[1];
                return result ? { rate: parseFloat(result).toFixed(2) } : null;
            } catch {
                return null;
            }
        }
    },
    {
        pattern: 'api.deepgram.com',
        id: 'deepgram',
        name: 'Deepgram',
        intervalMs: 30 * 60 * 1000,
        fetchData: async (apiKey) => {
            if (!apiKey) return null;
            try {
                const projRes = await axios.get('https://api.deepgram.com/v1/projects', {
                    headers: { 'Authorization': `Token ${apiKey}` },
                    timeout: 5000
                });
                const projectId = projRes.data?.projects?.[0]?.project_id;
                if (!projectId) return null;
                const usageRes = await axios.get(`https://api.deepgram.com/v1/projects/${projectId}/usage/breakdown`, {
                    headers: { 'Authorization': `Token ${apiKey}` },
                    timeout: 5000
                });
                const breakdown = usageRes.data?.breakdown || [];
                let totalHours = 0, billableHours = 0;
                for (const b of breakdown) {
                    totalHours += b.total_hours || 0;
                    billableHours += b.billable_hours || 0;
                }
                if (totalHours > 0) {
                    return { quotaLabel: '音频', used: Math.round(billableHours * 100) / 100, limit: Math.round(totalHours * 100) / 100 };
                }
                return null;
            } catch {
                return null;
            }
        }
    }
];

function detectVendor(baseUrl) {
    if (!baseUrl) return null;
    for (const v of VENDOR_PATTERNS) {
        if (baseUrl.includes(v.pattern)) return v;
    }
    return null;
}

class UsageCache {
    constructor(db) {
        this.db = db;
        this.lastRun = {};
        this.failCount = {};
    }

    start() {
        this.tick();
        setInterval(() => this.tick(), 60 * 1000);
    }

    async tick() {
        try {
            const providers = await this.db.all(
                'SELECT * FROM providers WHERE deletedAt IS NULL'
            );
            if (!providers.length) return;

            const allStats = providers.map(p => this._processStats(p));
            await runWithConcurrency(allStats, CONCURRENCY);

            const vendors = providers
                .map(p => ({ p, v: detectVendor(p.baseUrl) }))
                .filter(x => x.v);

            const dueVendors = vendors.filter(({ v }) => {
                const elapsed = Date.now() - (this.lastRun[v.id] || 0);
                return elapsed >= v.intervalMs;
            });

            if (dueVendors.length) {
                const allVendor = dueVendors.map(({ p, v }) => this._processVendor(p, v));
                await runWithConcurrency(allVendor, CONCURRENCY);
            }
        } catch (e) {
            console.error('[UsageCache] tick error:', e.message);
        }
    }

    async _processStats(p) {
        try {
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

            const [dailyRows, modelRows, summary] = await Promise.all([
                this.db.all(
                    `SELECT date(requestAt) as date,
                            COUNT(*) as requests,
                            COALESCE(SUM(tokensIn),0) as tokensIn,
                            COALESCE(SUM(tokensOut),0) as tokensOut
                     FROM stats_events
                     WHERE providerId = ? AND requestAt >= ? AND requestAt < ? AND status != 'error'
                     GROUP BY date(requestAt)`,
                    [p.id, monthStart, nextMonthStart]
                ),
                this.db.all(
                    `SELECT COALESCE(NULLIF(actualModel,''), requestedModel) as name,
                            COALESCE(SUM(tokensIn),0) as tokensIn,
                            COALESCE(SUM(tokensOut),0) as tokensOut
                     FROM stats_events
                     WHERE providerId = ? AND requestAt >= ? AND requestAt < ? AND status != 'error'
                     GROUP BY name
                     HAVING SUM(tokensIn) > 0 OR SUM(tokensOut) > 0
                     ORDER BY SUM(tokensIn) + SUM(tokensOut) DESC`,
                    [p.id, monthStart, nextMonthStart]
                ),
                this.db.get(
                    `SELECT COUNT(*) as requests,
                            COALESCE(SUM(tokensIn),0) as tokensIn,
                            COALESCE(SUM(tokensOut),0) as tokensOut
                     FROM stats_events
                     WHERE providerId = ? AND requestAt >= ? AND requestAt < ? AND status != 'error'`,
                    [p.id, monthStart, nextMonthStart]
                )
            ]);

            const upserts = dailyRows.map(row =>
                this.db.run(
                    `INSERT INTO provider_usage_cache (providerId, date, requests, tokensIn, tokensOut, updatedAt)
                     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
                     ON CONFLICT(providerId, date) DO UPDATE SET
                       requests = excluded.requests,
                       tokensIn = excluded.tokensIn,
                       tokensOut = excluded.tokensOut,
                       updatedAt = excluded.updatedAt
                     WHERE excluded.requests >= requests`,
                    [p.id, row.date, row.requests, row.tokensIn, row.tokensOut]
                )
            );
            await Promise.all(upserts);

            const vendor = detectVendor(p.baseUrl);
            const existing = await this.db.get(
                'SELECT vendor, vendorDataJson FROM provider_usage_cache WHERE providerId = ? AND date = ?',
                [p.id, 'summary']
            );

            await this.db.run(
                `INSERT INTO provider_usage_cache (providerId, date, vendor, requests, tokensIn, tokensOut, modelsJson, updatedAt)
                 VALUES (?, 'summary', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
                 ON CONFLICT(providerId, date) DO UPDATE SET
                   vendor = excluded.vendor,
                   requests = excluded.requests,
                   tokensIn = excluded.tokensIn,
                   tokensOut = excluded.tokensOut,
                   modelsJson = excluded.modelsJson,
                   updatedAt = excluded.updatedAt`,
                [p.id, vendor ? vendor.id : null, summary.requests, summary.tokensIn, summary.tokensOut, JSON.stringify(modelRows)]
            );

            this.failCount[p.id] = 0;
        } catch (e) {
            this.failCount[p.id] = (this.failCount[p.id] || 0) + 1;
            console.error(`[UsageCache] stats error provider=${p.id}:`, e.message);
        }
    }

    async _processVendor(p, vendor) {
        try {
            this.lastRun[vendor.id] = Date.now();
            let data = null;
            try {
                data = await vendor.fetchData(p.apiKey);
                this.failCount[p.id] = 0;
            } catch {
                this.failCount[p.id] = (this.failCount[p.id] || 0) + 1;
                if ((this.failCount[p.id] || 0) >= 3) {
                    console.warn(`[UsageCache] ${vendor.id} provider=${p.id} failed ${this.failCount[p.id]} times, skipping`);
                    return;
                }
            }

            const existing = await this.db.get(
                'SELECT vendorDataJson FROM provider_usage_cache WHERE providerId = ? AND date = ?',
                [p.id, 'summary']
            );

            let mergedData = data;
            if (!mergedData && existing?.vendorDataJson) {
                try { mergedData = JSON.parse(existing.vendorDataJson); } catch {}
            }

            if (existing?.vendorDataJson && mergedData) {
                try {
                    const prev = JSON.parse(existing.vendorDataJson);
                    mergedData = { ...prev, ...mergedData };
                } catch {}
            }

            await this.db.run(
                `UPDATE provider_usage_cache SET
                   vendorDataJson = ?,
                   updatedAt = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                 WHERE providerId = ? AND date = 'summary'`,
                [mergedData ? JSON.stringify(mergedData) : '{}', p.id]
            );
        } catch (e) {
            console.error(`[UsageCache] vendor error provider=${p.id}:`, e.message);
        }
    }
}

async function runWithConcurrency(tasks, concurrency) {
    let idx = 0;
    const results = [];
    async function worker() {
        while (idx < tasks.length) {
            const i = idx++;
            try { results[i] = await tasks[i]; } catch {}
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

module.exports = { UsageCache, detectVendor, VENDOR_PATTERNS };
