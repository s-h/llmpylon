<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import axios from 'axios';
import { io } from 'socket.io-client';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import {
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  History,
  Settings,
  Loader2,
  Check,
  ChevronRight,
  ChevronDown,
  ArrowRightLeft,
  LayoutGrid,
  Cpu,
  BarChart3,
  Users,
  User,
  BookOpen,
  X,
  Menu,
  ShieldCheck,
  ShieldAlert,
  Pencil,
  Download,
  Upload,
  Copy,
  Activity,
  AlertTriangle,
  Percent,
  Zap,
  Timer,
  TrendingUp
} from 'lucide-vue-next';

use([CanvasRenderer, CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, HeatmapChart, LineChart, PieChart]);

const hostname = window.location.hostname;
const API_BASE = `http://${hostname}:3000/api`;
let socket = null;

const ADMIN_TOKEN_STORAGE_KEY = 'llmpylon_admin_token';
/** Canonical magic model id; server match is case-insensitive. */
const MAGIC_PROXY_MODEL = 'llmpylon';
function isMagicProxyModel(s) {
  return typeof s === 'string' && s.toLowerCase() === MAGIC_PROXY_MODEL;
}

const authToken = ref(localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '');
const authUser = ref(null);
const mustChangePassword = ref(false);
const loginForm = ref({ username: 'llmpylon', password: '' });
const changePasswordForm = ref({ currentPassword: '', newPassword: '', confirmNewPassword: '' });

const setAuthToken = (token) => {
  authToken.value = token;
  if (token) {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    delete axios.defaults.headers.common['Authorization'];
  }
};

const connectSocket = () => {
  if (!authToken.value) return;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socket = io(`http://${hostname}:3000`, { auth: { token: authToken.value } });
  socket.on('log_update', handleLogUpdate);
};

const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

const checkProxyHealth = async () => {
  try {
    const res = await axios.get(`http://${hostname}:3000/healthz`, { timeout: 1500 });
    proxyHealth.value = { status: res.status === 200 && res.data?.ok ? 'up' : 'down', lastCheckAt: new Date() };
    if (res.data?.version != null && res.data.version !== '') {
      serverVersion.value = String(res.data.version);
    }
  } catch {
    proxyHealth.value = { status: 'down', lastCheckAt: new Date() };
  }
};

const startProxyHealthPolling = () => {
  if (proxyHealthTimer) clearInterval(proxyHealthTimer);
  checkProxyHealth();
  proxyHealthTimer = setInterval(checkProxyHealth, 5000);
};

const stopProxyHealthPolling = () => {
  if (proxyHealthTimer) {
    clearInterval(proxyHealthTimer);
    proxyHealthTimer = null;
  }
};

const isAuthenticated = computed(() => !!authUser.value && !!authToken.value);

if (authToken.value) {
  setAuthToken(authToken.value);
}

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      authUser.value = null;
      mustChangePassword.value = false;
      setAuthToken('');
      disconnectSocket();
    }
    return Promise.reject(error);
  }
);

const VALID_TABS = ['providers', 'keys', 'models', 'modelRules', 'logs', 'stats', 'config', 'help'];
const TAB_STORAGE_KEY = 'llmpylon_active_tab';
function readSavedTab() {
  try {
    const t = localStorage.getItem(TAB_STORAGE_KEY);
    if (t && VALID_TABS.includes(t)) return t;
  } catch {
    /* ignore */
  }
  return 'providers';
}

const activeTab = ref(readSavedTab());
const providers = ref([]);
const logs = ref([]);
const clientKeys = ref([]);
const managedModels = ref([]);
const modelsCatalog = ref([]);
const activeProviderId = ref(null);
const activeProviderDefaultModelId = ref(null);
const selectedModelProviderId = ref(null);
const newProvider = ref({ name: '', type: 'openai', baseUrl: '', apiKey: '' });
const newManagedModel = ref({ name: '' });
const newClientApp = ref({ name: '', providerId: null, managedModelId: null });
const editingProvider = ref(null);
const editingModel = ref(null);
const editingModelName = ref('');
const editingApp = ref(null);
const showAddProvider = ref(false);
const showAddApp = ref(false);
const showAddModel = ref(false);
const modelRules = ref([]);
const newModelRule = ref({ pattern: '*', targetModel: '', priority: 0 });
const editingModelRule = ref(null);
const showAddModelRule = ref(false);
const adminUsers = ref([]);
const newAdminUser = ref({ username: '', password: '', enabled: 1 });
const editingAdminUser = ref(null);
const showAddAdminUser = ref(false);
const resetPasswordUser = ref(null);
const resetPasswordValue = ref('');
const selectedLog = ref(null);
const logDetailLoading = ref(false);
const logDetailError = ref('');
const selectedClientKey = ref('all');
const logsPage = ref(1);
const logsPageSize = ref(50);
const logsTotal = ref(0);
const logsTotalPages = ref(1);
const hasNewLogs = ref(false);
const mobileMenuOpen = ref(false);
const isMobileViewport = ref(window.innerWidth < 1024);

const proxyHealth = ref({ status: 'unknown', lastCheckAt: null });
const serverVersion = ref('');
let proxyHealthTimer = null;
let resizeTimer = null;
let durationTimer = null;

const handleWindowResize = () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    isMobileViewport.value = window.innerWidth < 1024;
    if (!isMobileViewport.value) mobileMenuOpen.value = false;
  }, 120);
};

const showAddProviderModel = ref(false);
const providerModelTargetProvider = ref(null);
const newProviderModelName = ref('');

const showCopyProviderDialog = ref(false);
const copyProviderForm = ref({ name: '', type: 'openai', baseUrl: '', apiKey: '', protocolConvert: false });
const copyProviderModelNames = ref([]);
const copyDefaultModelName = ref('');
const newCopyModelRow = ref('');

// 回收站
const showRecycleBin = ref(false);
const deletedProviders = ref([]);

// 导入/导出相关状态
const showExportDialog = ref(false);
const exportIncludeApiKey = ref(false);
const showImportDialog = ref(false);
const importData = ref(null);
const importConflicts = ref([]);
const importMergeStrategy = ref({});
const importStep = ref('file');
const importResults = ref([]);
const showGlobalImportDialog = ref(false);
const globalImportData = ref(null);
const appSettings = ref({
  logRetentionDays: 0,
  statsRetentionDays: 0,
  upstreamTimeoutSeconds: 360,
  upstreamHeadersBlocklist: ['host', 'content-length', 'connection', 'accept-encoding']
});
const appSettingsSaving = ref(false);
const nowMs = ref(Date.now());

const statsRange = ref('30d');
const statsProviderId = ref('all');
const statsLoading = ref(false);
const statsData = ref(null);

const fetchStats = async () => {
  statsLoading.value = true;
  try {
    const params = { range: statsRange.value };
    if (statsProviderId.value !== 'all') {
      params.providerId = statsProviderId.value;
    }
    const res = await axios.get(`${API_BASE}/stats`, { params });
    statsData.value = res.data;
  } finally {
    statsLoading.value = false;
  }
};

const formatNumber = (n) => {
  if (n === null || n === undefined) return '-';
  const num = Number(n);
  if (!Number.isFinite(num)) return '-';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return String(num);
};

const formatMs = (ms) => {
  if (ms === null || ms === undefined) return '-';
  const num = Number(ms);
  if (!Number.isFinite(num)) return '-';
  if (num < 1000) return `${num.toFixed(0)}ms`;
  return `${(num / 1000).toFixed(2)}s`;
};

const formatBytes = (n) => {
  if (n === null || n === undefined) return '-';
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return '-';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
};

const formatLogLatency = (log) => {
  if (log.latencyMs != null && Number.isFinite(Number(log.latencyMs))) return formatMs(log.latencyMs);
  return calculateDuration(log.requestAt || log.createdAt, log.responseAt) || '-';
};

const modelCatalogMap = computed(() => {
  const map = new Map();
  for (const m of modelsCatalog.value) {
    map.set(m.id, m);
  }
  return map;
});

const getModelCatalogEntry = (id) => {
  if (id === null || id === undefined || id === '') return null;
  const n = Number(id);
  if (!Number.isNaN(n)) {
    const hit = modelCatalogMap.value.get(n);
    if (hit) return hit;
  }
  return modelCatalogMap.value.get(id) || null;
};

const activeProvider = computed(() => providers.value.find(p => p.active) || null);

const activeDefaultModel = computed(() => {
  if (!activeProviderDefaultModelId.value) return null;
  return managedModels.value.find(m => m.id === activeProviderDefaultModelId.value) || null;
});

const enabledModelRulesCount = computed(() => modelRules.value.filter(r => r.enabled).length);

const copyModelNamesForSelect = computed(() => {
  const out = [];
  const seen = new Set();
  for (const s of copyProviderModelNames.value) {
    const t = (s || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
});

const getModelOptionsForProvider = (providerId, selectedModelId) => {
  const selectedEntry = getModelCatalogEntry(selectedModelId);
  const options = [];
  if (selectedEntry) {
    options.push({ id: selectedEntry.id, name: selectedEntry.name, providers: selectedEntry.providers || [], _selected: true });
  }
  const hasProvider =
    providerId !== null && providerId !== undefined && providerId !== '';
  const pid = hasProvider ? Number(providerId) : null;
  const pidOk = hasProvider && !Number.isNaN(pid);

  for (const m of modelsCatalog.value) {
    if (selectedEntry && Number(m.id) === Number(selectedEntry.id)) continue;
    if (!hasProvider) {
      options.push(m);
      continue;
    }
    if (!pidOk) continue;
    const supported = (m.providers || []).some((p) => Number(p.id) === pid);
    if (supported) options.push(m);
  }
  return options;
};

const closeSidebarIfMobile = () => {
  if (isMobileViewport.value) mobileMenuOpen.value = false;
};

const handleLogUpdate = (data) => {
  const { appendResponseChunk, streamChunk, ...rest } = data;

  if (selectedLog.value && Number(selectedLog.value.id) === Number(rest.id)) {
    const cur = selectedLog.value;
    const nextResponseBody = appendResponseChunk
      ? `${cur.responseBody || ''}${streamChunk || ''}`
      : (rest.responseBody !== undefined ? rest.responseBody : cur.responseBody);
    selectedLog.value = { ...cur, ...rest, responseBody: nextResponseBody };
  }

  const index = logs.value.findIndex(l => l.id === rest.id);
  if (index !== -1) {
    const current = logs.value[index];
    const patch = { ...rest };
    delete patch.requestBody;
    delete patch.responseBody;
    const updatedLog = { ...current, ...patch, requestBody: undefined, responseBody: undefined };
    logs.value.splice(index, 1, updatedLog);
  } else if (logsPage.value === 1 && (selectedClientKey.value === 'all' || Number(rest.clientKeyId) === Number(selectedClientKey.value))) {
    fetchLogs();
  } else {
    hasNewLogs.value = true;
  }
};

const statsSummary = computed(() => {
  const s = statsData.value?.summary;
  if (!s) return null;
  const requestCount = Number(s.requestCount || 0);
  const errorCount = Number(s.errorCount || 0);
  const errorRate = requestCount ? (errorCount / requestCount) : 0;
  return {
    requestCount,
    errorCount,
    errorRate,
    tokensTotal: Number(s.tokensTotal || 0),
    avgLatencyMs: s.avgLatencyMs === null || s.avgLatencyMs === undefined ? null : Number(s.avgLatencyMs),
    activeDays: Number(s.activeDays || 0)
  };
});

const heatmapOption = computed(() => {
  const raw = statsData.value?.heatmapYear || [];
  const formatLocalDay = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const calendarRange = statsData.value?.heatmapYearRange || (() => {
    const end = new Date();
    const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
    return [formatLocalDay(start), formatLocalDay(end)];
  })();
  const startStr = calendarRange?.[0];
  const endStr = calendarRange?.[1];
  const start = startStr ? new Date(startStr + 'T00:00:00') : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const end = endStr ? new Date(endStr + 'T00:00:00') : new Date();

  const map = new Map(raw.map((d) => [d[0], Number(d[1] || 0)]));
  const filled = [];
  for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
    const day = formatLocalDay(dt);
    filled.push([day, map.get(day) || 0]);
  }

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const v = params?.value || params?.data;
        const day = Array.isArray(v) ? v[0] : '';
        const count = Array.isArray(v) ? Number(v[1] || 0) : 0;
        const active = count > 0 ? 1 : 0;
        return `${day}<br/>请求：${count} 次<br/>活跃：${active}`;
      }
    },
    visualMap: {
      type: 'piecewise',
      show: false,
      pieces: [
        { value: 0, color: '#ebedf0' },
        { min: 1, max: 4, color: '#9be9a8' },
        { min: 5, max: 9, color: '#40c463' },
        { min: 10, max: 19, color: '#30a14e' },
        { min: 20, color: '#216e39' }
      ]
    },
    calendar: {
      top: 10,
      left: 20,
      right: 20,
      cellSize: [12, 12],
      range: calendarRange,
      itemStyle: { color: '#ebedf0', borderWidth: 2, borderColor: '#fff' },
      splitLine: { show: false },
      dayLabel: { color: '#6b7280' },
      monthLabel: { color: '#6b7280', position: 'top', margin: 8, align: 'left' },
      yearLabel: { show: false }
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: filled
      }
    ]
  };
});

const requestsOption = computed(() => {
  const ts = statsData.value?.timeseries;
  const days = ts?.days || [];
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['请求', '错误'], top: 0 },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: days, axisLabel: { color: '#6b7280' } },
    yAxis: { type: 'value', axisLabel: { color: '#6b7280' } },
    series: [
      { name: '请求', type: 'line', smooth: true, data: ts?.requests || [], showSymbol: false },
      { name: '错误', type: 'line', smooth: true, data: ts?.errors || [], showSymbol: false }
    ]
  };
});

const tokensOption = computed(() => {
  const ts = statsData.value?.timeseries;
  const days = ts?.days || [];
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Tokens'], top: 0 },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: days, axisLabel: { color: '#6b7280' } },
    yAxis: { type: 'value', axisLabel: { color: '#6b7280' } },
    series: [
      { name: 'Tokens', type: 'line', smooth: true, data: ts?.tokensTotal || [], showSymbol: false }
    ]
  };
});

const latencyOption = computed(() => {
  const ts = statsData.value?.timeseries;
  const days = ts?.days || [];
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['平均耗时(ms)'], top: 0 },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: days, axisLabel: { color: '#6b7280' } },
    yAxis: { type: 'value', axisLabel: { color: '#6b7280' } },
    series: [
      { name: '平均耗时(ms)', type: 'line', smooth: true, data: ts?.avgLatencyMs || [], showSymbol: false }
    ]
  };
});

const modelPieOption = computed(() => {
  const rows = statsData.value?.distributions?.byModel || [];
  const data = rows.map(r => ({ name: r.name, value: Number(r.tokens || 0) }));
  return {
    tooltip: { trigger: 'item' },
    legend: { type: 'scroll', orient: 'vertical', right: 10, top: 10, bottom: 10 },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['40%', '55%'],
        data,
        avoidLabelOverlap: true,
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 12 } }
      }
    ]
  };
});

const loadAllData = async () => {
  await fetchProviders();
  await fetchClientKeys();
  if (selectedModelProviderId.value) {
    await fetchManagedModels(selectedModelProviderId.value);
  } else {
    await fetchManagedModels();
  }
  await fetchModelsCatalog();
  await fetchModelRules();
  await fetchLogs();
  if (activeTab.value === 'stats') {
    await fetchStats();
  }
};

const checkAuth = async () => {
  if (!authToken.value) return false;
  try {
    const res = await axios.get(`${API_BASE}/auth/me`);
    authUser.value = res.data.user;
    mustChangePassword.value = !!res.data.mustChangePassword;
    if (!mustChangePassword.value) connectSocket();
    return true;
  } catch (e) {
    authUser.value = null;
    mustChangePassword.value = false;
    setAuthToken('');
    disconnectSocket();
    return false;
  }
};

const login = async () => {
  const { username, password } = loginForm.value;
  try {
    const res = await axios.post(`${API_BASE}/auth/login`, { username, password });
    setAuthToken(res.data.token);
    authUser.value = res.data.user;
    mustChangePassword.value = !!res.data.mustChangePassword;
    if (!mustChangePassword.value) connectSocket();
    if (!mustChangePassword.value) {
      await loadAllData();
    }
  } catch (err) {
    alert('登录失败: ' + (err.response?.data?.error || err.message));
  }
};

const logout = async () => {
  try {
    await axios.post(`${API_BASE}/auth/logout`);
  } catch (e) {
  }
  authUser.value = null;
  mustChangePassword.value = false;
  setAuthToken('');
  disconnectSocket();
};

const changePassword = async () => {
  const { currentPassword, newPassword, confirmNewPassword } = changePasswordForm.value;
  if (!newPassword) return;
  if (newPassword !== confirmNewPassword) {
    alert('两次输入的新密码不一致');
    return;
  }
  try {
    await axios.post(`${API_BASE}/auth/change-password`, { currentPassword, newPassword });
    mustChangePassword.value = false;
    changePasswordForm.value = { currentPassword: '', newPassword: '', confirmNewPassword: '' };
    connectSocket();
    await loadAllData();
  } catch (err) {
    alert('修改密码失败: ' + (err.response?.data?.error || err.message));
  }
};

const fetchProviders = async () => {
  const res = await axios.get(`${API_BASE}/providers`);
  providers.value = res.data;
};

const fetchClientKeys = async () => {
  const res = await axios.get(`${API_BASE}/keys`);
  clientKeys.value = res.data;
};

const fetchManagedModels = async (providerId) => {
  const params = {};
  if (providerId) params.providerId = providerId;
  const res = await axios.get(`${API_BASE}/models`, { params });
  managedModels.value = res.data.models || [];
  activeProviderId.value = res.data.providerId || null;
  activeProviderDefaultModelId.value = res.data.defaultModelId || null;
};

const fetchModelRules = async () => {
  const res = await axios.get(`${API_BASE}/model-rules`);
  modelRules.value = res.data;
};

const fetchModelsCatalog = async () => {
  const res = await axios.get(`${API_BASE}/models/catalog`);
  modelsCatalog.value = res.data;
};

const fetchLogs = async () => {
  const params = { page: logsPage.value, pageSize: logsPageSize.value };
  if (selectedClientKey.value !== 'all') {
    params.clientKeyId = selectedClientKey.value;
  }
  const res = await axios.get(`${API_BASE}/logs`, { params });
  logs.value = res.data.items || [];
  logsTotal.value = Number(res.data.total || 0);
  logsTotalPages.value = Number(res.data.totalPages || 1);
  hasNewLogs.value = false;
};

const openLogDetail = async (log) => {
  logDetailError.value = '';
  logDetailLoading.value = true;
  selectedLog.value = { ...log };
  try {
    const res = await axios.get(`${API_BASE}/logs/${log.id}`);
    selectedLog.value = res.data;
  } catch (e) {
    logDetailError.value = e.response?.data?.error || e.message || '加载失败';
  } finally {
    logDetailLoading.value = false;
  }
};

const closeLogDetail = () => {
  selectedLog.value = null;
  logDetailError.value = '';
  logDetailLoading.value = false;
};

const ensureNoLogDetailOverlay = () => {
  if (selectedLog.value) closeLogDetail();
};

const fetchAdminUsers = async () => {
  const res = await axios.get(`${API_BASE}/users`);
  adminUsers.value = res.data;
};

const fetchAppSettings = async () => {
  try {
    const res = await axios.get(`${API_BASE}/settings`);
    appSettings.value = {
      logRetentionDays: Math.max(0, Number(res.data.logRetentionDays) || 0),
      statsRetentionDays: Math.max(0, Number(res.data.statsRetentionDays) || 0),
      upstreamTimeoutSeconds: Math.max(5, Math.min(86400, Number(res.data.upstreamTimeoutSeconds) || 360)),
      upstreamHeadersBlocklist: res.data.upstreamHeadersBlocklist || ['host', 'content-length', 'connection', 'accept-encoding']
    };
  } catch (e) {
    console.error('fetchAppSettings', e);
  }
};

const saveAppSettings = async () => {
  appSettingsSaving.value = true;
  try {
    const res = await axios.put(`${API_BASE}/settings`, {
      logRetentionDays: Math.max(0, Number(appSettings.value.logRetentionDays) || 0),
      statsRetentionDays: Math.max(0, Number(appSettings.value.statsRetentionDays) || 0),
      upstreamTimeoutSeconds: Math.max(5, Math.min(86400, Number(appSettings.value.upstreamTimeoutSeconds) || 360)),
      upstreamHeadersBlocklist: appSettings.value.upstreamHeadersBlocklist
    });
    appSettings.value.logRetentionDays = res.data.logRetentionDays;
    appSettings.value.statsRetentionDays = res.data.statsRetentionDays;
    appSettings.value.upstreamTimeoutSeconds = res.data.upstreamTimeoutSeconds;
    appSettings.value.upstreamHeadersBlocklist = res.data.upstreamHeadersBlocklist;
    alert('已保存');
  } catch (e) {
    alert('保存失败: ' + (e.response?.data?.error || e.message));
  } finally {
    appSettingsSaving.value = false;
  }
};

const clearAllStats = async () => {
  if (!confirm('确定清空全部统计数据？此操作不可恢复。')) return;
  try {
    const res = await axios.post(`${API_BASE}/stats/clear`);
    alert(`已清空 ${res.data.changes ?? 0} 条统计记录`);
    if (activeTab.value === 'stats') fetchStats();
  } catch (e) {
    alert('清空失败: ' + (e.response?.data?.error || e.message));
  }
};

const addAdminUser = async () => {
  if (!newAdminUser.value.username || !newAdminUser.value.password) return;
  await axios.post(`${API_BASE}/users`, newAdminUser.value);
  newAdminUser.value = { username: '', password: '', enabled: 1 };
  showAddAdminUser.value = false;
  fetchAdminUsers();
};

const updateAdminUser = async () => {
  if (!editingAdminUser.value) return;
  await axios.put(`${API_BASE}/users/${editingAdminUser.value.id}`, editingAdminUser.value);
  editingAdminUser.value = null;
  fetchAdminUsers();
};

const resetAdminPassword = async () => {
  if (!resetPasswordUser.value || !resetPasswordValue.value) return;
  await axios.post(`${API_BASE}/users/${resetPasswordUser.value.id}/reset-password`, { password: resetPasswordValue.value });
  resetPasswordUser.value = null;
  resetPasswordValue.value = '';
  fetchAdminUsers();
};

const deleteAdminUser = async (id) => {
  if (!confirm('确定要删除这个用户吗？')) return;
  await axios.delete(`${API_BASE}/users/${id}`);
  fetchAdminUsers();
};

const clearLogs = async () => {
  if (!confirm('确定要清空所有对话日志吗？')) return;
  try {
    await axios.delete(`${API_BASE}/logs`);
    logs.value = [];
    closeLogDetail();
    hasNewLogs.value = false;
    logsPage.value = 1;
    logsTotal.value = 0;
    logsTotalPages.value = 1;
    alert('日志已清空');
  } catch (err) {
    console.error('清空日志失败:', err);
    alert('清空日志失败: ' + (err.response?.data?.error || err.message));
  }
};

const goToLatestLogs = async () => {
  logsPage.value = 1;
  await fetchLogs();
};

const prevLogsPage = async () => {
  if (logsPage.value <= 1) return;
  logsPage.value -= 1;
  await fetchLogs();
};

const nextLogsPage = async () => {
  if (logsPage.value >= logsTotalPages.value) return;
  logsPage.value += 1;
  await fetchLogs();
};

const addProvider = async () => {
  await axios.post(`${API_BASE}/providers`, newProvider.value);
  newProvider.value = { name: '', type: 'openai', baseUrl: '', apiKey: '', protocolConvert: false };
  showAddProvider.value = false;
  fetchProviders();
};

const updateProvider = async () => {
  if (!editingProvider.value) return;
  await axios.put(`${API_BASE}/providers/${editingProvider.value.id}`, editingProvider.value);
  editingProvider.value = null;
  fetchProviders();
};

// 导入/导出方法
const openExportDialog = () => {
  exportIncludeApiKey.value = false;
  showExportDialog.value = true;
};

const doExport = async () => {
  try {
    const response = await fetch(`${API_BASE}/providers/export`, {
      headers: { 'Authorization': `Bearer ${authToken.value}` }
    });
    const data = await response.json();

    // 如果不包含 API Key，则移除
    if (!exportIncludeApiKey.value) {
      data.providers.forEach(p => p.apiKey = '');
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llmpylon-providers-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showExportDialog.value = false;
    await fetchProviders();
  } catch (err) {
    alert('导出失败：' + err.message);
  }
};

const openImportDialog = () => {
  importStep.value = 'file';
  importData.value = null;
  importConflicts.value = [];
  importMergeStrategy.value = {};
  importResults.value = [];
  showImportDialog.value = true;
};

const handleImportFileSelect = (e) => {
  const file = e.target.files[0];
  if (file) processImportFile(file);
};

const handleImportDrop = (e) => {
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/json') {
    processImportFile(file);
  }
};

const processImportFile = (file) => {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.providers || !Array.isArray(data.providers)) {
        throw new Error('无效的配置文件格式');
      }

      importData.value = data;

      // 检查冲突
      const existingNames = new Set(providers.value.map(p => p.name));
      importConflicts.value = data.providers
        .filter(p => existingNames.has(p.name))
        .map(p => ({ provider: p }));

      // 设置默认策略
      importConflicts.value.forEach(item => {
        importMergeStrategy.value[item.provider.name] = 'skip';
      });

      if (importConflicts.value.length) {
        importStep.value = 'conflict';
      } else {
        await doImport();
      }
    } catch (err) {
      alert('解析文件失败：' + err.message);
    }
  };
  reader.readAsText(file);
};

const doImport = async () => {
  try {
    const response = await fetch(`${API_BASE}/providers/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken.value}`
      },
      body: JSON.stringify({
        data: importData.value,
        mergeStrategy: importMergeStrategy.value
      })
    });
    const result = await response.json();
    importResults.value = result.results;
    importStep.value = 'result';
    await fetchProviders();
  } catch (err) {
    alert('导入失败：' + err.message);
  }
};

const closeImportDialog = () => {
  showImportDialog.value = false;
};

const exportGlobalConfig = async () => {
  try {
    if (!confirm('确认导出全局配置吗？')) return;
    const includeSecrets = confirm('是否包含厂商 API Key 和应用密钥？\n选择“取消”则导出时自动清空密钥字段。');
    const response = await fetch(`${API_BASE}/config/export?includeSecrets=${includeSecrets ? 1 : 0}`, {
      headers: { 'Authorization': `Bearer ${authToken.value}` }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llmpylon-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('导出全局配置失败：' + err.message);
  }
};

const openGlobalImportDialog = () => {
  globalImportData.value = null;
  showGlobalImportDialog.value = true;
};

const handleGlobalImportFileSelect = (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      const config = data?.config || data?.data?.config;
      if (!config || typeof config !== 'object') {
        throw new Error('文件中缺少 config 字段');
      }
      globalImportData.value = data;
    } catch (err) {
      alert('解析全局配置失败：' + err.message);
    }
  };
  reader.readAsText(file);
};

const doGlobalImport = async () => {
  if (!globalImportData.value) {
    alert('请先选择有效的全局配置文件');
    return;
  }
  if (!confirm('将覆盖当前所有业务配置（厂商、模型、应用、规则），不影响管理员账号。确定继续？')) {
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/config/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken.value}`
      },
      body: JSON.stringify({ data: globalImportData.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`);
    await loadAllData();
    showGlobalImportDialog.value = false;
    alert('全局配置导入成功');
  } catch (err) {
    alert('导入全局配置失败：' + err.message);
  }
};

const openEditModal = (provider) => {
  editingProvider.value = { ...provider, protocolConvert: provider.protocolConvert === 1 || provider.protocolConvert === true };
};

const openCopyProviderDialog = (p) => {
  copyProviderForm.value = {
    name: `${p.name} 副本`,
    type: p.type || 'openai',
    baseUrl: p.baseUrl || '',
    apiKey: p.apiKey || '',
    protocolConvert: p.protocolConvert === 1 || p.protocolConvert === true
  };
  copyProviderModelNames.value = (p.models || []).map((m) => m.name);
  const def = (p.models || []).find((m) => m.id === p.defaultModelId);
  copyDefaultModelName.value = def ? def.name : (copyModelNamesForSelect.value[0] || '');
  newCopyModelRow.value = '';
  showCopyProviderDialog.value = true;
};

const closeCopyProviderDialog = () => {
  showCopyProviderDialog.value = false;
  newCopyModelRow.value = '';
};

const removeCopyModelAt = (idx) => {
  const removed = (copyProviderModelNames.value[idx] || '').trim();
  copyProviderModelNames.value.splice(idx, 1);
  if (removed && copyDefaultModelName.value === removed) {
    const rest = copyModelNamesForSelect.value;
    copyDefaultModelName.value = rest[0] || '';
  }
};

const addCopyModelRow = () => {
  const n = newCopyModelRow.value.trim();
  if (!n) return;
  copyProviderModelNames.value.push(n);
  newCopyModelRow.value = '';
  if (!copyDefaultModelName.value) copyDefaultModelName.value = n;
};

const submitCopyProvider = async () => {
  const name = copyProviderForm.value.name?.trim();
  if (!name) {
    alert('请填写新厂商名称');
    return;
  }
  const modelsOrdered = [];
  const seen = new Set();
  for (const raw of copyProviderModelNames.value) {
    const m = (raw || '').trim();
    if (!m || seen.has(m)) continue;
    seen.add(m);
    modelsOrdered.push(m);
  }
  try {
    const res = await axios.post(`${API_BASE}/providers`, {
      name,
      type: copyProviderForm.value.type,
      baseUrl: copyProviderForm.value.baseUrl,
      apiKey: copyProviderForm.value.apiKey || null,
      protocolConvert: copyProviderForm.value.protocolConvert
    });
    const newId = res.data?.id;
    if (!newId) {
      alert('创建厂商失败：服务端未返回新厂商 ID，请确认已更新后端。');
      return;
    }
    const nameToId = {};
    for (const mname of modelsOrdered) {
      const r = await axios.post(`${API_BASE}/providers/${newId}/models`, { name: mname });
      nameToId[mname] = r.data.modelId;
    }
    const defPick = copyDefaultModelName.value?.trim();
    if (defPick && modelsOrdered.includes(defPick) && nameToId[defPick]) {
      await axios.put(`${API_BASE}/providers/${newId}/models/${nameToId[defPick]}/activate`);
    }
    closeCopyProviderDialog();
    await fetchProviders();
    await fetchModelsCatalog();
  } catch (err) {
    alert(err.response?.data?.error || err.response?.data?.message || err.message);
  }
};

const addClientApp = async () => {
  if (!newClientApp.value.name) return;
  try {
    await axios.post(`${API_BASE}/keys`, normalizeClientAppPayload(newClientApp.value));
  } catch (err) {
    alert(err.response?.data?.error || err.message);
    return;
  }
  newClientApp.value = { name: '', providerId: null, managedModelId: null };
  showAddApp.value = false;
  fetchClientKeys();
};

const updateClientApp = async () => {
  if (!editingApp.value) return;
  try {
    await axios.put(`${API_BASE}/keys/${editingApp.value.id}`, normalizeClientAppPayload(editingApp.value));
  } catch (err) {
    alert(err.response?.data?.error || err.message);
    return;
  }
  editingApp.value = null;
  fetchClientKeys();
};

const deleteClientApp = async (id) => {
  if (!confirm('确定要删除这个应用吗？')) return;
  await axios.delete(`${API_BASE}/keys/${id}`);
  fetchClientKeys();
};

const normalizeClientAppPayload = (payload) => {
  const p = { ...payload };
  if (!p.providerId) {
    p.providerId = null;
    p.managedModelId = null;
  }
  if (p.providerId && !p.managedModelId) {
    throw new Error('绑定了厂商后必须选择一个模型');
  }
  if (!p.managedModelId) p.managedModelId = null;
  return p;
};

const openEditClientApp = (k) => {
  if (selectedLog.value) closeLogDetail();
  const base = { ...k };
  if (!base.providerId) base.managedModelId = null;
  editingApp.value = base;
};

const onClientAppProviderChange = (target) => {
  if (!target.providerId) {
    target.providerId = null;
    target.managedModelId = null;
  } else {
    target.managedModelId = null;
  }
};

const toggleKey = async (id) => {
  await axios.put(`${API_BASE}/keys/${id}/toggle`);
  fetchClientKeys();
};

const activateProvider = async (id) => {
  await axios.put(`${API_BASE}/providers/${id}/activate`);
  await fetchProviders();
  await fetchManagedModels();
  await fetchModelsCatalog();
};

const deleteProvider = async (id) => {
  const isUsed = clientKeys.value.some(k => k.providerId === id);
  if (isUsed) {
    if (!confirm('该厂商已被某些应用绑定，删除后这些应用将回退到"默认厂商"。是否确认删除？')) return;
  }
  await axios.delete(`${API_BASE}/providers/${id}`);
  fetchProviders();
  fetchClientKeys();
};

const fetchDeletedProviders = async () => {
  const res = await axios.get(`${API_BASE}/providers/deleted`);
  deletedProviders.value = res.data;
};

const restoreProvider = async (id) => {
  await axios.post(`${API_BASE}/providers/${id}/restore`);
  fetchDeletedProviders();
  fetchProviders();
};

const permanentDeleteProvider = async (id) => {
  if (!confirm('确定要彻底删除该厂商吗？此操作不可恢复。')) return;
  await axios.delete(`${API_BASE}/providers/${id}/permanent`);
  fetchDeletedProviders();
  fetchProviders();
};

const addManagedModel = async () => {
  if (!newManagedModel.value.name) return;
  await axios.post(`${API_BASE}/models`, {
    name: newManagedModel.value.name,
    providerId: selectedModelProviderId.value || undefined
  });
  newManagedModel.value = { name: '' };
  showAddModel.value = false;
  await fetchManagedModels(selectedModelProviderId.value || undefined);
  await fetchProviders();
  await fetchModelsCatalog();
};

const activateModel = async (id) => {
  const params = {};
  if (selectedModelProviderId.value) params.providerId = selectedModelProviderId.value;
  await axios.put(`${API_BASE}/models/${id}/activate`, null, { params });
  await fetchManagedModels(selectedModelProviderId.value || undefined);
  await fetchProviders();
  await fetchModelsCatalog();
};

const deleteModel = async (id) => {
  const providerName = providers.find(p => p.id === selectedModelProviderId.value)?.name || '当前厂商';
  if (!confirm(`确定要从"${providerName}"中移除这个模型吗？`)) return;
  try {
    const params = {};
    if (selectedModelProviderId.value) params.providerId = selectedModelProviderId.value;
    await axios.delete(`${API_BASE}/models/${id}`, { params });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    alert(msg);
    return;
  }
  await fetchManagedModels(selectedModelProviderId.value || undefined);
  await fetchProviders();
  await fetchModelsCatalog();
};

const onModelProviderChange = () => {
  fetchManagedModels(selectedModelProviderId.value);
};

const startEditModel = (model) => {
  editingModel.value = model;
  editingModelName.value = model.name;
};

const saveEditModel = async () => {
  if (!editingModel.value || !editingModelName.value) return;
  try {
    await axios.put(`${API_BASE}/models/${editingModel.value.id}`, { name: editingModelName.value });
    editingModel.value = null;
    editingModelName.value = '';
    await fetchManagedModels(selectedModelProviderId.value || undefined);
    await fetchProviders();
    await fetchModelsCatalog();
  } catch (err) {
    alert(err.response?.data?.error || err.message);
  }
};

const cancelEditModel = () => {
  editingModel.value = null;
  editingModelName.value = '';
};

const openAddProviderModel = (provider) => {
  providerModelTargetProvider.value = provider;
  newProviderModelName.value = '';
  showAddProviderModel.value = true;
};

const addProviderModel = async () => {
  if (!providerModelTargetProvider.value || !newProviderModelName.value) return;
  await axios.post(`${API_BASE}/providers/${providerModelTargetProvider.value.id}/models`, { name: newProviderModelName.value });
  showAddProviderModel.value = false;
  providerModelTargetProvider.value = null;
  newProviderModelName.value = '';
  await fetchProviders();
  await fetchModelsCatalog();
  await fetchManagedModels();
};

const activateProviderModel = async (providerId, modelId) => {
  await axios.put(`${API_BASE}/providers/${providerId}/models/${modelId}/activate`);
  await fetchProviders();
  await fetchModelsCatalog();
  await fetchManagedModels();
};

const addModelRule = async () => {
  if (!newModelRule.value.pattern || !newModelRule.value.targetModel) return;
  await axios.post(`${API_BASE}/model-rules`, newModelRule.value);
  newModelRule.value = { pattern: '*', targetModel: '', priority: 0 };
  showAddModelRule.value = false;
  fetchModelRules();
};

const updateModelRule = async () => {
  if (!editingModelRule.value) return;
  await axios.put(`${API_BASE}/model-rules/${editingModelRule.value.id}`, editingModelRule.value);
  editingModelRule.value = null;
  fetchModelRules();
};

const toggleModelRule = async (id) => {
  await axios.put(`${API_BASE}/model-rules/${id}/toggle`);
  fetchModelRules();
};

const deleteModelRule = async (id) => {
  if (!confirm('确定要删除这个模型规则吗？')) return;
  await axios.delete(`${API_BASE}/model-rules/${id}`);
  fetchModelRules();
};

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  // SQLite 的 CURRENT_TIMESTAMP 不带 Z，需要补上以确保浏览器按 UTC 解析再转为本地时区
  let normalized = dateStr;
  if (typeof dateStr === 'string' && !dateStr.endsWith('Z') && !dateStr.includes('+')) {
    normalized = dateStr.replace(' ', 'T') + 'Z';
  }
  return new Date(normalized);
};

const formatTime = (dateStr) => {
  const date = parseDate(dateStr);
  if (!date) return '-';
  
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const time = date.toLocaleTimeString(undefined, { hour12: false });
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${y}-${m}-${d} ${time}.${ms}`;
};

const calculateDuration = (start, end) => {
  const startDate = parseDate(start);
  const endDate = parseDate(end) || new Date(nowMs.value);
  if (!startDate) return null;
  const duration = endDate - startDate;
  return (duration / 1000).toFixed(2) + 's';
};

const formatJson = (str) => {
  if (!str) return '';
  try {
    // 尝试解析为单一 JSON 对象
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch (e) {
    // 处理 SSE 格式或包含转义字符的字符串
    try {
      // 如果字符串本身包含转义的换行和引号，先尝试“解包”一层
      // 某些情况下后端存入的是 JSON.stringify 后的字符串，导致双重转义
      if (str.startsWith('"') && str.endsWith('"')) {
        const unquoted = JSON.parse(str);
        if (typeof unquoted === 'string') return formatJson(unquoted);
      }

      // 处理 SSE (Server-Sent Events) 格式
      if (str.includes('event:') || str.includes('data:')) {
        return str.split('\n').map(line => {
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            try {
              return `data: ${JSON.stringify(JSON.parse(dataStr), null, 2)}`;
            } catch (err) {
              return line;
            }
          }
          return line;
        }).join('\n');
      }

      // 如果只是带有 \n 等转义符的普通文本
      return str.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } catch (err2) {
      return str;
    }
  }
};

onMounted(async () => {
  window.addEventListener('resize', handleWindowResize);
  handleWindowResize();
  durationTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 500);

  const ok = await checkAuth();
  if (ok && !mustChangePassword.value) {
    await loadAllData();
  }
  startProxyHealthPolling();

});

watch(activeTab, (tab) => {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    /* ignore */
  }
  closeSidebarIfMobile();
  if (tab !== 'logs' && selectedLog.value) closeLogDetail();
  if (tab === 'stats') {
    if (isAuthenticated.value) fetchStats();
  }
  if (tab === 'modelRules') {
    if (isAuthenticated.value) fetchModelRules();
  }
  if (tab === 'models') {
    if (isAuthenticated.value) {
      if (!selectedModelProviderId.value && activeProvider.value) {
        selectedModelProviderId.value = activeProvider.value.id;
      }
      if (selectedModelProviderId.value) {
        fetchManagedModels(selectedModelProviderId.value);
      } else {
        fetchManagedModels();
      }
    }
  }
  if (tab === 'config') {
    if (isAuthenticated.value) {
      fetchAdminUsers();
      fetchAppSettings();
    }
  }
  if (tab === 'users') {
    if (isAuthenticated.value) fetchAdminUsers();
  }
  if (tab === 'logs') {
    if (isAuthenticated.value) fetchLogs();
  }
});

watch(statsRange, () => {
  if (activeTab.value === 'stats') {
    if (isAuthenticated.value) fetchStats();
  }
});

watch(statsProviderId, () => {
  if (activeTab.value === 'stats') {
    if (isAuthenticated.value) fetchStats();
  }
});

watch(isAuthenticated, () => {
  startProxyHealthPolling();
});

onUnmounted(() => {
  window.removeEventListener('resize', handleWindowResize);
  if (resizeTimer) clearTimeout(resizeTimer);
  if (durationTimer) clearInterval(durationTimer);
  disconnectSocket();
  stopProxyHealthPolling();
});
</script>

<template>
  <div v-if="!isAuthenticated" class="min-h-screen bg-gray-50 flex items-center justify-center p-6">
    <div class="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
      <div class="flex items-center gap-3 mb-6">
        <Settings class="w-8 h-8 text-blue-600" />
        <div>
          <h1 class="text-xl font-bold">llmPylon Admin</h1>
          <p class="text-xs text-gray-400">登录后才能进行管理操作</p>
        </div>
      </div>
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-bold text-gray-400 uppercase mb-1">用户名</label>
          <input v-model="loginForm.username" type="text" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-400 uppercase mb-1">密码</label>
          <input v-model="loginForm.password" type="password" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
        </div>
      </div>
      <button @click="login" class="w-full mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold">
        登录
      </button>
      <p class="text-[10px] text-gray-400 mt-4">默认用户/密码：llmpylon / llmpylon（首次登录必须修改密码）</p>
      <p v-if="serverVersion" class="text-center text-[10px] text-gray-400 font-mono mt-2">v{{ serverVersion }}</p>
    </div>
  </div>

  <div v-else class="relative flex h-screen bg-gray-50 text-gray-900 overflow-hidden">
    <div
      v-if="mobileMenuOpen"
      class="fixed inset-0 z-30 bg-black/40 lg:hidden"
      @click="mobileMenuOpen = false"
    ></div>
    <!-- Sidebar -->
    <div
      :class="[
        'w-64 bg-white border-r border-gray-200 flex flex-col fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 lg:static lg:translate-x-0',
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      ]"
    >
      <div class="p-6 border-b border-gray-200">
        <h1 class="text-xl font-bold flex items-center gap-2">
          <Settings class="w-6 h-6 text-blue-600" />
          llmPylon Admin
        </h1>
      </div>
      <nav class="flex-1 p-4 space-y-2">
        <button 
          @click="activeTab = 'providers'"
          :class="['w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors', activeTab === 'providers' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100']"
        >
          <Settings class="w-5 h-5" />
          <span class="flex-1 text-left whitespace-nowrap">厂商管理</span>
          <span
            v-if="activeProvider"
            class="ml-auto max-w-[140px] px-1.5 py-1 bg-purple-50 text-purple-700 rounded text-[8px] leading-none font-bold uppercase tracking-tight whitespace-nowrap overflow-hidden text-ellipsis"
            :title="activeProvider.name"
          >
            {{ activeProvider.name }}
          </span>
        </button>
        <button 
          @click="activeTab = 'keys'"
          :class="['w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors', activeTab === 'keys' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100']"
        >
          <LayoutGrid class="w-5 h-5" />
          应用管理
        </button>
        <button 
          @click="activeTab = 'models'"
          :class="['w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors', activeTab === 'models' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100']"
        >
          <Cpu class="w-5 h-5" />
          <span class="flex-1 text-left whitespace-nowrap">模型管理</span>
          <span
            v-if="activeDefaultModel"
            class="ml-auto max-w-[140px] px-1.5 py-1 bg-purple-50 text-purple-700 rounded text-[8px] leading-none font-semibold font-mono tracking-tight whitespace-nowrap overflow-hidden text-ellipsis"
            :title="activeDefaultModel.name"
          >
            {{ activeDefaultModel.name }}
          </span>
          <span
            v-else
            class="ml-auto max-w-[140px] px-1.5 py-1 bg-gray-100 text-gray-500 rounded text-[8px] leading-none font-bold uppercase tracking-tight whitespace-nowrap overflow-hidden text-ellipsis"
          >
            未设置
          </span>
        </button>
        <button 
          @click="activeTab = 'modelRules'"
          :class="['w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors', activeTab === 'modelRules' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100']"
        >
          <ArrowRightLeft class="w-5 h-5" />
          <span class="flex-1 text-left whitespace-nowrap">模型规则</span>
          <span
            v-if="enabledModelRulesCount"
            class="ml-auto max-w-[140px] px-1.5 py-1 bg-purple-50 text-purple-700 rounded text-[8px] leading-none font-bold uppercase tracking-tight whitespace-nowrap overflow-hidden text-ellipsis"
          >
            启用 {{ enabledModelRulesCount }}
          </span>
        </button>
        <button 
          @click="activeTab = 'logs'"
          :class="['w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors', activeTab === 'logs' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100']"
        >
          <History class="w-5 h-5" />
          对话日志
        </button>
        <button 
          @click="activeTab = 'stats'"
          :class="['w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors', activeTab === 'stats' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100']"
        >
          <BarChart3 class="w-5 h-5" />
          统计
        </button>
        <button
          @click="activeTab = 'config'"
          :class="['w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors', activeTab === 'config' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100']"
        >
          <Settings class="w-5 h-5" />
          配置管理
        </button>
        <button
          @click="activeTab = 'users'"
          :class="['w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors', activeTab === 'users' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100']"
        >
          <User class="w-5 h-5" />
          用户管理
        </button>
        <button 
          @click="activeTab = 'help'"
          :class="['w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors', activeTab === 'help' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100']"
        >
          <BookOpen class="w-5 h-5" />
          客户端帮助
        </button>
      </nav>
      <div class="p-4 border-t border-gray-200">
        <div class="flex items-center gap-2">
          <span
            :class="[
              'w-2.5 h-2.5 rounded-full',
              proxyHealth.status === 'up' ? 'bg-green-500' : (proxyHealth.status === 'down' ? 'bg-red-500' : 'bg-gray-300')
            ]"
          ></span>
          <span class="text-xs font-bold text-gray-600">
            {{ proxyHealth.status === 'up' ? 'Proxy 运行中' : (proxyHealth.status === 'down' ? 'Proxy 未运行' : 'Proxy 检测中') }}
          </span>
        </div>
        <p v-if="serverVersion" class="text-[10px] text-gray-400 font-mono mt-2">v{{ serverVersion }}</p>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <header class="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 lg:px-8">
        <div class="flex items-center gap-3 min-w-0">
          <button
            @click="mobileMenuOpen = true"
            class="inline-flex lg:hidden p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <Menu class="w-5 h-5" />
          </button>
          <h2 class="text-base sm:text-lg font-semibold truncate">{{ activeTab === 'providers' ? '厂商配置' : (activeTab === 'keys' ? '应用管理' : (activeTab === 'models' ? '模型管理' : (activeTab === 'modelRules' ? '模型规则' : (activeTab === 'stats' ? '统计' : (activeTab === 'config' ? '配置管理' : (activeTab === 'users' ? '用户管理' : (activeTab === 'help' ? '客户端帮助' : '对话历史'))))))) }}</h2>
        </div>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 sm:gap-3">
            <span v-if="serverVersion" class="hidden sm:inline text-[10px] text-gray-400 font-mono tabular-nums" title="软件版本">v{{ serverVersion }}</span>
            <span class="hidden sm:inline text-xs font-bold text-gray-500">{{ authUser?.username }}</span>
            <button @click="logout" class="px-2.5 sm:px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors whitespace-nowrap">
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main class="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
        <div v-if="activeTab === 'help'" class="space-y-6">
          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            <h3 class="text-lg font-bold text-gray-900 mb-2">快速开始</h3>
            <p class="text-sm text-gray-600 leading-relaxed">llmPylon 提供统一代理入口，客户端统一指向同一个 Base URL，通过模型名与后台策略决定最终路由到的厂商与模型。</p>
            <div class="rounded-xl border border-gray-200 bg-gray-50 p-5 mt-6">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-3">客户端设置</p>
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <span class="px-2 py-1 bg-purple-50 text-purple-700 rounded text-[10px] font-bold uppercase tracking-tight">Base URL</span>
                  <code class="text-xs font-mono text-gray-700 break-all">http://你的服务器ip:3000/proxy</code>
                </div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-1 bg-purple-50 text-purple-700 rounded text-[10px] font-bold uppercase tracking-tight">API Key</span>
                  <code class="text-xs font-mono text-gray-700 break-all">使用平台创建的应用 key</code>
                </div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-1 bg-purple-50 text-purple-700 rounded text-[10px] font-bold uppercase tracking-tight">Model</span>
                  <code class="text-xs font-mono text-gray-700 break-all">建议设置为 {{ MAGIC_PROXY_MODEL }}（大小写不敏感）</code>
                </div>
              </div>
              <p class="text-[10px] text-gray-500 mt-3 leading-relaxed">建议客户端模型统一设置为 <span class="font-mono">{{ MAGIC_PROXY_MODEL }}</span>（大小写不敏感），由代理平台统一管理模型与厂商切换。</p>
            </div>
            <div class="rounded-xl border border-gray-200 bg-gray-50 p-5 mt-6">
              <p class="text-xs font-bold text-gray-500 mb-2">{{ MAGIC_PROXY_MODEL }} 是什么？</p>
              <p class="text-sm text-gray-700 leading-relaxed">当客户端把 Model 设置为 <span class="font-mono text-xs">{{ MAGIC_PROXY_MODEL }}</span>（大小写不敏感）时，平台会自动选择实际模型：优先使用应用绑定模型，其次使用当前厂商默认模型。你可以在“厂商管理”快速切换当前生效厂商（默认厂商）。</p>
            </div>
          </div>

          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            <h3 class="text-lg font-bold text-gray-900 mb-2">如何获取客户端 Key</h3>
            <div class="space-y-4 text-sm text-gray-700 leading-relaxed">
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <p class="text-xs font-bold text-gray-500 mb-2">创建应用并自动生成 Key</p>
                <p>进入“应用管理”点击“创建应用”，平台会自动生成一个应用 key。客户端请求时使用该 key 作为 API Key。</p>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <p class="text-xs font-bold text-gray-500 mb-2">厂商 Key 由平台统一托管</p>
                <p>在“厂商管理”配置各厂商的托管 API Key。客户端只需要使用平台生成的应用 key，不直接持有厂商 key。</p>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            <h3 class="text-lg font-bold text-gray-900 mb-2">对应用指定厂商与模型</h3>
            <div class="space-y-4 text-sm text-gray-700 leading-relaxed">
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <p class="text-xs font-bold text-gray-500 mb-2">应用绑定（固定路由）</p>
                <p>在“应用管理”中可以为某个应用单独绑定厂商与模型。绑定后，该应用的请求将优先使用自己的配置，不会受“厂商管理/模型管理”的切换影响。</p>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <p class="text-xs font-bold text-gray-500 mb-2">默认路由（可快速切换）</p>
                <p>若应用未绑定厂商与模型，则使用“厂商管理”当前生效厂商 + 该厂商默认模型。你可以在厂商管理中快速切换当前厂商，实现全局默认路由切换。</p>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <p class="text-xs font-bold text-gray-500 mb-2">模型规则（强制转换）</p>
                <p>当客户端请求 Model 不是 {{ MAGIC_PROXY_MODEL }}（大小写不敏感）时，会先匹配“模型规则”进行强制转换（支持 * 通配符，大小写敏感）。客户端使用 {{ MAGIC_PROXY_MODEL }} 时不参与规则匹配。</p>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            <h3 class="text-lg font-bold text-gray-900 mb-2">常见问题</h3>
            <div class="space-y-3 text-sm text-gray-700">
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <p class="font-bold text-gray-700 mb-1">为什么我设置了模型，但实际走了另一个模型？</p>
                <p>若请求 model 不是 {{ MAGIC_PROXY_MODEL }}（大小写不敏感），可能命中了模型规则被强制转换；若为 {{ MAGIC_PROXY_MODEL }}，则会按“应用绑定模型/厂商默认模型”选择实际模型。</p>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <p class="font-bold text-gray-700 mb-1">如何看实际路由到的厂商/模型？</p>
                <p>进入“对话日志”查看每条请求的 <span class="font-mono text-xs">model</span> 与 <span class="font-mono text-xs">actualModel</span>，以及目标 URL。</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Providers View -->
        <div v-if="activeTab === 'providers'" class="space-y-6">
          <div class="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:justify-between sm:items-center">
            <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">{{ showRecycleBin ? '回收站' : '当前已添加的厂商' }}</h3>
            <div class="flex flex-wrap gap-2">
              <template v-if="!showRecycleBin">
                <button
                  @click="openExportDialog"
                  class="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm border border-gray-200"
                >
                  <Download class="w-4 h-4" />
                  导出
                </button>
                <button
                  @click="openImportDialog"
                  class="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm border border-gray-200"
                >
                  <Upload class="w-4 h-4" />
                  导入
                </button>
                <button
                  @click="showAddProvider = true; if (selectedLog) closeLogDetail()"
                class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                <Plus class="w-4 h-4" />
                添加厂商
                </button>
                <button
                  @click="showRecycleBin = true; fetchDeletedProviders()"
                  class="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-sm border border-gray-200"
                >
                  <Trash2 class="w-4 h-4" />
                  回收站
                  <span v-if="deletedProviders.length" class="px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold">{{ deletedProviders.length }}</span>
                </button>
              </template>
              <button
                v-else
                @click="showRecycleBin = false"
                class="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm border border-gray-200"
              >
                厂商列表
              </button>
            </div>
          </div>

          <!-- Normal provider list -->
          <div v-if="!showRecycleBin" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div 
              v-for="p in providers" 
              :key="p.id"
              @click="!p.active && activateProvider(p.id)"
              class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden cursor-pointer"
              :class="{'border-blue-500 ring-1 ring-blue-500': p.active}"
            >
              <div v-if="p.active" class="absolute top-0 right-0 bg-blue-500 text-white px-2 py-1 text-[10px] font-bold rounded-bl-lg flex items-center gap-1">
                <Check class="w-3 h-3" /> 生效中
              </div>
              
              <div class="flex justify-between items-start mb-4">
                <div>
                  <h4 class="font-bold text-lg">{{ p.name }}</h4>
                  <div class="flex flex-wrap gap-1.5 mt-1">
                    <span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full border border-gray-200 uppercase">{{ p.type }}</span>
                    <span v-if="p.protocolConvert" class="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full border border-amber-200 font-medium">转换</span>
                  </div>
                </div>
                <div class="flex gap-2">
                  <button 
                    @click.stop="openEditModal(p)"
                    class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="编辑厂商"
                  >
                    <Pencil class="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    @click.stop="openCopyProviderDialog(p)"
                    class="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    title="复制厂商"
                  >
                    <Copy class="w-5 h-5" />
                  </button>
                  <button 
                    v-if="!p.active"
                    @click.stop="activateProvider(p.id)"
                    class="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    title="设置为生效"
                  >
                    <CheckCircle2 class="w-5 h-5" />
                  </button>
                  <button 
                    @click.stop="deleteProvider(p.id)"
                    class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除"
                  >
                    <Trash2 class="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div class="text-sm text-gray-500 break-all">
                <span class="block font-medium text-gray-400 text-xs mb-1 uppercase">基础地址</span>
                {{ p.baseUrl }}
              </div>
              <div class="text-sm text-gray-500 break-all mt-4">
                <span class="block font-medium text-gray-400 text-xs mb-1 uppercase">托管 Key</span>
                <span class="font-mono text-xs blur-sm hover:blur-none transition-all cursor-help">{{ p.apiKey || '未设置' }}</span>
              </div>
              <div class="text-sm text-gray-500 break-all mt-4">
                <div class="flex justify-between items-center">
                  <span class="block font-medium text-gray-400 text-xs uppercase">模型</span>
                  <button
                    @click.stop="openAddProviderModel(p)"
                    class="text-xs font-bold text-blue-600 hover:underline"
                  >
                    添加模型
                  </button>
                </div>
                <div class="flex flex-wrap gap-2 mt-2">
                  <button
                    v-for="m in (p.models || [])"
                    :key="m.id"
                    @click.stop="activateProviderModel(p.id, m.id)"
                    :class="[
                      'px-2 py-1 rounded text-[10px] font-semibold font-mono tracking-tight border transition-colors',
                      p.defaultModelId === m.id ? 'bg-purple-600 text-white border-purple-600 shadow-sm' : 'bg-purple-50 text-purple-700 border-purple-100 hover:border-purple-300'
                    ]"
                  >
                    {{ m.name }}
                  </button>
                  <span v-if="!(p.models || []).length" class="text-gray-400 text-xs italic">未添加</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Recycle bin view -->
          <div v-if="showRecycleBin" class="space-y-4">
            <div v-if="!deletedProviders.length" class="text-center py-12 text-gray-400 text-sm bg-white rounded-xl border border-gray-200 shadow-sm">
              回收站为空
            </div>
            <div v-for="p in deletedProviders" :key="p.id" class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <div class="flex justify-between items-start mb-4">
                <div>
                  <h4 class="font-bold text-lg">{{ p.name }}</h4>
                  <div class="flex flex-wrap gap-1.5 mt-1">
                    <span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full border border-gray-200 uppercase">{{ p.type }}</span>
                    <span class="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded-full border border-red-100 font-medium">已删除</span>
                  </div>
                  <p class="text-[10px] text-gray-400 mt-1">删除时间：{{ formatTime(p.deletedAt) }}</p>
                </div>
                <div class="flex gap-2">
                  <button
                    @click="restoreProvider(p.id)"
                    class="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-bold"
                    title="恢复厂商"
                  >
                    恢复
                  </button>
                  <button
                    @click="permanentDeleteProvider(p.id)"
                    class="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-xs font-bold"
                    title="彻底删除"
                  >
                    彻底删除
                  </button>
                </div>
              </div>
              <div class="text-sm text-gray-500 break-all">
                <span class="block font-medium text-gray-400 text-xs mb-1 uppercase">基础地址</span>
                {{ p.baseUrl }}
              </div>
              <div class="text-sm text-gray-500 mt-3">
                <span class="block font-medium text-gray-400 text-xs mb-1 uppercase">模型</span>
                <div class="flex flex-wrap gap-2">
                  <span v-for="m in (p.models || [])" :key="m.id" class="px-2 py-1 rounded text-[10px] font-semibold font-mono bg-gray-100 text-gray-600 border border-gray-200">{{ m.name }}</span>
                  <span v-if="!(p.models || []).length" class="text-gray-400 text-xs italic">无关联模型</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Apps View (Renamed from Keys) -->
        <div v-if="activeTab === 'keys'" class="space-y-6">
          <div class="flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
            <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">应用管理</h3>
            <button 
              @click="showAddApp = true; if (selectedLog) closeLogDetail()"
              class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <Plus class="w-4 h-4" />
              创建应用
            </button>
          </div>

          <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div class="overflow-x-auto">
            <table class="w-full min-w-[680px] text-left text-sm">
              <thead class="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th class="px-6 py-4 font-semibold text-gray-600">应用名称</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">绑定厂商</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">绑定模型</th>
                  <th class="px-6 py-4 font-semibold text-gray-600 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                <tr v-for="k in clientKeys" :key="k.id" class="hover:bg-gray-50 transition-colors">
                  <td class="px-6 py-4">
                    <div class="font-medium text-gray-900">{{ k.name }}</div>
                    <div class="font-mono text-[10px] text-gray-400 mt-0.5">{{ k.key }}</div>
                  </td>
                  <td class="px-6 py-4">
                    <span v-if="k.providerId" class="px-2 py-1 bg-blue-50 text-blue-700 rounded text-[10px] font-bold border border-blue-100">
                      {{ providers.find(p => p.id === k.providerId)?.name || '未知厂商' }}
                    </span>
                    <span v-else class="text-gray-400 text-xs italic">全局默认</span>
                  </td>
                  <td class="px-6 py-4">
                    <template v-if="k.managedModelId">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="px-2 py-1 bg-green-50 text-green-700 rounded text-[10px] font-bold border border-green-100">
                          {{ getModelCatalogEntry(k.managedModelId)?.name || '未知模型' }}
                        </span>
                      </div>
                    </template>
                    <span v-else class="text-gray-400 text-xs italic">默认</span>
                  </td>
                  <td class="px-6 py-4 text-right space-x-3">
                    <button 
                      @click="toggleKey(k.id)"
                      :class="k.enabled ? 'text-amber-600' : 'text-green-600'"
                      class="hover:underline font-medium text-xs"
                    >
                      {{ k.enabled ? '禁用' : '启用' }}
                    </button>
                    <button 
                      @click="openEditClientApp(k)"
                      class="text-blue-600 hover:underline font-medium text-xs"
                    >
                      配置
                    </button>
                    <button 
                      @click="deleteClientApp(k.id)"
                      class="text-red-600 hover:underline font-medium text-xs"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <!-- Models View -->
        <div v-if="activeTab === 'models'" class="space-y-6">
          <div class="flex flex-col gap-3">
            <div class="flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
              <div class="space-y-1">
                <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">模型管理</h3>
                <p class="text-[10px] text-gray-400">选择厂商后管理其模型，在此页面选择的默认模型会被记住并用于 {{ MAGIC_PROXY_MODEL }}</p>
              </div>
              <button 
                @click="showAddModel = true"
                class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                <Plus class="w-4 h-4" />
                添加模型
              </button>
            </div>
            <div class="flex items-center gap-3">
              <label class="text-xs font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">选择厂商</label>
              <select
                v-model="selectedModelProviderId"
                @change="onModelProviderChange"
                class="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white min-w-[200px]"
              >
                <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }} {{ p.active ? '(生效中)' : '' }}</option>
              </select>
              <span v-if="activeProviderId" class="text-[10px] text-gray-400">默认模型：{{ activeDefaultModel?.name || '未设置' }}</span>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div 
              v-for="m in managedModels" 
              :key="m.id"
              class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
              :class="{'border-blue-500 ring-1 ring-blue-500': activeProviderDefaultModelId === m.id}"
            >
              <div v-if="activeProviderDefaultModelId === m.id" class="absolute top-0 right-0 bg-blue-500 text-white px-2 py-1 text-[10px] font-bold rounded-bl-lg flex items-center gap-1">
                <Check class="w-3 h-3" /> 默认
              </div>
              
              <div v-if="editingModel && editingModel.id === m.id" class="flex flex-col gap-3">
                <input
                  v-model="editingModelName"
                  @keyup.enter="saveEditModel"
                  @keyup.escape="cancelEditModel"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="模型名称"
                  autofocus
                />
                <div class="flex gap-2">
                  <button @click.stop="saveEditModel" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold">
                    保存
                  </button>
                  <button @click.stop="cancelEditModel" class="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-xs font-bold">
                    取消
                  </button>
                </div>
              </div>

              <div v-else class="flex justify-between items-start mb-4">
                <div class="min-w-0 flex-1">
                  <h4 class="font-bold text-lg truncate" :title="m.name">{{ m.name }}</h4>
                </div>
                <div class="flex gap-2 shrink-0 ml-2">
                  <button 
                    @click.stop="startEditModel(m)"
                    class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="编辑模型名称"
                  >
                    <Pencil class="w-4 h-4" />
                  </button>
                  <button 
                    v-if="activeProviderDefaultModelId !== m.id"
                    @click.stop="activateModel(m.id)"
                    class="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    title="设置为默认"
                  >
                    <CheckCircle2 class="w-5 h-5" />
                  </button>
                  <button 
                    @click.stop="deleteModel(m.id)"
                    class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除"
                  >
                    <Trash2 class="w-5 h-5" />
                  </button>
                </div>
              </div>
              <p class="text-[10px] text-gray-400">客户端请求模型为 <span class="font-bold text-green-600">{{ MAGIC_PROXY_MODEL }}</span>（大小写不敏感）时，若应用未指定模型，将使用当前厂商的默认模型。</p>
            </div>
            <div v-if="!managedModels.length" class="col-span-full text-center py-10 text-gray-400 text-sm">
              该厂商暂无模型，请添加模型
            </div>
          </div>
        </div>

        <!-- Model Rules View -->
        <div v-if="activeTab === 'modelRules'" class="space-y-6">
          <div class="flex justify-between items-center">
            <div class="space-y-1">
              <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">模型规则管理</h3>
              <p class="text-[10px] text-gray-400">支持 * 通配符，大小写敏感。按优先级从高到低匹配，命中第一条后强制转换模型。</p>
            </div>
            <button 
              @click="showAddModelRule = true"
              class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <Plus class="w-4 h-4" />
              添加规则
            </button>
          </div>

          <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div class="overflow-x-auto">
            <table class="w-full min-w-[720px] text-left text-sm">
              <thead class="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th class="px-6 py-4 font-semibold text-gray-600">优先级</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">匹配模式</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">转换为</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">状态</th>
                  <th class="px-6 py-4 font-semibold text-gray-600 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                <tr v-for="r in modelRules" :key="r.id" class="hover:bg-gray-50 transition-colors">
                  <td class="px-6 py-4 font-mono text-xs text-gray-700">{{ r.priority }}</td>
                  <td class="px-6 py-4 font-mono text-xs text-gray-700">{{ r.pattern }}</td>
                  <td class="px-6 py-4 font-mono text-xs text-blue-700 font-medium">{{ r.targetModel }}</td>
                  <td class="px-6 py-4">
                    <span 
                      v-if="r.enabled" 
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200"
                    >
                      <ShieldCheck class="w-3 h-3" />
                      已启用
                    </span>
                    <span 
                      v-else 
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-500 border border-gray-200"
                    >
                      <ShieldAlert class="w-3 h-3" />
                      已禁用
                    </span>
                  </td>
                  <td class="px-6 py-4 text-right space-x-3">
                    <button 
                      @click="toggleModelRule(r.id)"
                      :class="r.enabled ? 'text-amber-600' : 'text-green-600'"
                      class="hover:underline font-medium text-xs"
                    >
                      {{ r.enabled ? '禁用' : '启用' }}
                    </button>
                    <button 
                      @click="editingModelRule = { ...r }"
                      class="text-blue-600 hover:underline font-medium text-xs"
                    >
                      编辑
                    </button>
                    <button 
                      @click="deleteModelRule(r.id)"
                      class="text-red-600 hover:underline font-medium text-xs"
                    >
                      删除
                    </button>
                  </td>
                </tr>
                <tr v-if="!modelRules.length">
                  <td colspan="5" class="px-6 py-10 text-center text-gray-400 text-sm">暂无规则</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <!-- Users View -->
        <div v-if="activeTab === 'users'" class="space-y-6">
          <div class="flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
            <div class="space-y-1">
              <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">用户管理</h3>
              <p class="text-[10px] text-gray-400">首次登录默认用户必须修改密码；支持创建/禁用/重置密码。</p>
            </div>
            <button
              @click="showAddAdminUser = true"
              class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <Plus class="w-4 h-4" />
              添加用户
            </button>
          </div>

          <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div class="overflow-x-auto">
            <table class="w-full min-w-[760px] text-left text-sm">
              <thead class="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th class="px-6 py-4 font-semibold text-gray-600">用户名</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">状态</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">强制改密</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">创建时间</th>
                  <th class="px-6 py-4 font-semibold text-gray-600 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                <tr v-for="u in adminUsers" :key="u.id" class="hover:bg-gray-50 transition-colors">
                  <td class="px-6 py-4 font-medium text-gray-900">{{ u.username }}</td>
                  <td class="px-6 py-4">
                    <span
                      v-if="u.enabled"
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200"
                    >
                      <ShieldCheck class="w-3 h-3" />
                      已启用
                    </span>
                    <span
                      v-else
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-500 border border-gray-200"
                    >
                      <ShieldAlert class="w-3 h-3" />
                      已禁用
                    </span>
                  </td>
                  <td class="px-6 py-4">
                    <span v-if="u.mustChangePassword" class="text-amber-600 font-bold text-xs">是</span>
                    <span v-else class="text-gray-400 text-xs">否</span>
                  </td>
                  <td class="px-6 py-4 text-gray-500 font-mono text-xs">{{ formatTime(u.createdAt) }}</td>
                  <td class="px-6 py-4 text-right space-x-3">
                    <button
                      @click="editingAdminUser = { ...u }"
                      class="text-blue-600 hover:underline font-medium text-xs"
                    >
                      编辑
                    </button>
                    <button
                      @click="resetPasswordUser = u; resetPasswordValue = ''"
                      class="text-amber-600 hover:underline font-medium text-xs"
                    >
                      重置密码
                    </button>
                    <button
                      v-if="authUser && u.id !== authUser.id"
                      @click="deleteAdminUser(u.id)"
                      class="text-red-600 hover:underline font-medium text-xs"
                    >
                      删除
                    </button>
                  </td>
                </tr>
                <tr v-if="!adminUsers.length">
                  <td colspan="5" class="px-6 py-10 text-center text-gray-400 text-sm">暂无用户</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <!-- Stats View -->
        <div v-if="activeTab === 'stats'" class="space-y-8">
          <div class="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-xl shadow-slate-900/15 sm:p-8">
            <div class="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-500/15 blur-3xl" />
            <div class="pointer-events-none absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-indigo-500/10 blur-3xl" />
            <div class="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div class="max-w-xl">
                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Analytics</p>
                <h3 class="mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">使用统计</h3>
                <p class="mt-2 text-sm leading-relaxed text-slate-400">请求量、错误与 Token 消耗趋势；可按时间范围筛选，厂商筛选影响下方图表（热力图除外）。</p>
              </div>
              <button
                type="button"
                @click="fetchStats"
                class="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/15"
              >
                <Clock class="h-4 w-4 opacity-90" />
                刷新数据
              </button>
              <button
                type="button"
                @click="clearAllStats"
                class="inline-flex shrink-0 items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-200 backdrop-blur-sm transition hover:bg-rose-500/20"
              >
                <Trash2 class="h-4 w-4 opacity-90" />
                清空统计
              </button>
            </div>

            <div class="relative mt-6 flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-md sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div class="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  @click="statsRange = '7d'"
                  :class="[
                    'rounded-lg px-3 py-2 text-xs font-semibold transition',
                    statsRange === '7d'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  ]"
                >
                  7 天
                </button>
                <button
                  type="button"
                  @click="statsRange = '30d'"
                  :class="[
                    'rounded-lg px-3 py-2 text-xs font-semibold transition',
                    statsRange === '30d'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  ]"
                >
                  30 天
                </button>
                <button
                  type="button"
                  @click="statsRange = '90d'"
                  :class="[
                    'rounded-lg px-3 py-2 text-xs font-semibold transition',
                    statsRange === '90d'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  ]"
                >
                  90 天
                </button>
                <button
                  type="button"
                  @click="statsRange = 'all'"
                  :class="[
                    'rounded-lg px-3 py-2 text-xs font-semibold transition',
                    statsRange === 'all'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  ]"
                >
                  全部
                </button>
              </div>
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <label class="flex items-center gap-2 text-xs font-medium text-slate-300">
                  <span class="whitespace-nowrap">厂商</span>
                  <select
                    v-model="statsProviderId"
                    class="min-w-[8rem] rounded-lg border border-white/15 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-white outline-none ring-0 focus:border-cyan-400/50"
                  >
                    <option value="all" class="text-slate-900">全部</option>
                    <option v-for="p in providers" :key="p.id" :value="p.id" class="text-slate-900">{{ p.name }}</option>
                  </select>
                </label>
                <span class="text-[11px] text-slate-500">热力图不受厂商筛选影响</span>
              </div>
            </div>
          </div>

          <div v-if="statsLoading" class="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-12 text-slate-600">
            <Loader2 class="h-8 w-8 animate-spin text-cyan-600" />
            <p class="text-sm font-medium">正在加载统计数据…</p>
          </div>

          <div v-else class="space-y-8">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div class="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
                <div class="flex items-start justify-between gap-3">
                  <div class="rounded-xl bg-blue-50 p-2.5 text-blue-600">
                    <Activity class="h-5 w-5" />
                  </div>
                </div>
                <p class="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">请求数</p>
                <p class="mt-1 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{{ statsSummary ? formatNumber(statsSummary.requestCount) : '—' }}</p>
              </div>
              <div class="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
                <div class="flex items-start justify-between gap-3">
                  <div class="rounded-xl bg-rose-50 p-2.5 text-rose-600">
                    <AlertTriangle class="h-5 w-5" />
                  </div>
                </div>
                <p class="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">错误数</p>
                <p class="mt-1 text-3xl font-bold tabular-nums tracking-tight text-rose-600">{{ statsSummary ? formatNumber(statsSummary.errorCount) : '—' }}</p>
              </div>
              <div class="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
                <div class="flex items-start justify-between gap-3">
                  <div class="rounded-xl bg-amber-50 p-2.5 text-amber-600">
                    <Percent class="h-5 w-5" />
                  </div>
                </div>
                <p class="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">错误率</p>
                <p class="mt-1 text-3xl font-bold tabular-nums tracking-tight text-amber-600">{{ statsSummary ? (statsSummary.errorRate * 100).toFixed(2) + '%' : '—' }}</p>
              </div>
              <div class="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
                <div class="flex items-start justify-between gap-3">
                  <div class="rounded-xl bg-cyan-50 p-2.5 text-cyan-600">
                    <Zap class="h-5 w-5" />
                  </div>
                </div>
                <p class="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Tokens</p>
                <p class="mt-1 text-3xl font-bold tabular-nums tracking-tight text-cyan-700">{{ statsSummary ? formatNumber(statsSummary.tokensTotal) : '—' }}</p>
              </div>
              <div class="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md sm:col-span-2 xl:col-span-1">
                <div class="flex items-start justify-between gap-3">
                  <div class="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
                    <Timer class="h-5 w-5" />
                  </div>
                </div>
                <p class="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">平均耗时</p>
                <p class="mt-1 text-3xl font-bold tabular-nums tracking-tight text-emerald-700">{{ statsSummary ? formatMs(statsSummary.avgLatencyMs) : '—' }}</p>
              </div>
            </div>

            <div class="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
              <div class="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex items-center gap-2">
                  <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                    <BarChart3 class="h-4 w-4" />
                  </span>
                  <div>
                    <h3 class="text-sm font-semibold text-slate-900">活跃热力图</h3>
                    <p class="text-xs text-slate-500">按天请求量分布（近一年）</p>
                  </div>
                </div>
                <span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  活跃天数 {{ statsSummary ? statsSummary.activeDays : '—' }}
                </span>
              </div>
              <VChart :option="heatmapOption" autoresize class="h-52" />
              <div class="mt-4 flex flex-wrap items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <span>少</span>
                <span class="h-3 w-3 rounded-sm border border-slate-200/80" style="background:#ebedf0" title="0 次"></span>
                <span class="h-3 w-3 rounded-sm border border-slate-200/80" style="background:#9be9a8" title="1–4 次"></span>
                <span class="h-3 w-3 rounded-sm border border-slate-200/80" style="background:#40c463" title="5–9 次"></span>
                <span class="h-3 w-3 rounded-sm border border-slate-200/80" style="background:#30a14e" title="10–19 次"></span>
                <span class="h-3 w-3 rounded-sm border border-slate-200/80" style="background:#216e39" title="≥ 20 次"></span>
                <span>多</span>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div class="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
                <div class="mb-4 flex items-center gap-2">
                  <TrendingUp class="h-4 w-4 text-slate-400" />
                  <h3 class="text-sm font-semibold text-slate-900">请求与错误趋势</h3>
                </div>
                <VChart :option="requestsOption" autoresize class="h-64" />
              </div>
              <div class="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
                <div class="mb-4 flex items-center gap-2">
                  <Zap class="h-4 w-4 text-slate-400" />
                  <h3 class="text-sm font-semibold text-slate-900">Tokens 趋势</h3>
                </div>
                <VChart :option="tokensOption" autoresize class="h-64" />
              </div>
            </div>

            <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div class="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
                <div class="mb-4 flex items-center gap-2">
                  <Timer class="h-4 w-4 text-slate-400" />
                  <h3 class="text-sm font-semibold text-slate-900">平均耗时趋势</h3>
                </div>
                <VChart :option="latencyOption" autoresize class="h-64" />
              </div>
              <div class="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
                <div class="mb-4 flex items-center gap-2">
                  <Cpu class="h-4 w-4 text-slate-400" />
                  <h3 class="text-sm font-semibold text-slate-900">模型占比（按 Tokens）</h3>
                </div>
                <VChart :option="modelPieOption" autoresize class="h-64" />
              </div>
            </div>

            <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div class="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
                <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-4">
                  <h3 class="text-sm font-semibold text-slate-900">慢请求 Top 10</h3>
                  <span class="text-xs text-slate-500">按耗时降序</span>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr class="border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th class="px-5 py-3">应用</th>
                        <th class="px-5 py-3">厂商</th>
                        <th class="px-5 py-3">模型</th>
                        <th class="px-5 py-3 text-right">耗时</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <tr v-for="row in (statsData?.top?.slow || [])" :key="row.id" class="transition hover:bg-slate-50/80">
                        <td class="px-5 py-3 font-medium text-slate-800">{{ row.appName }}</td>
                        <td class="px-5 py-3 text-slate-600">{{ row.providerName }}</td>
                        <td class="px-5 py-3 font-mono text-xs text-slate-600">
                          <span v-if="!row.actualModel || row.requestedModel === row.actualModel">{{ row.requestedModel }}</span>
                          <span v-else>{{ row.requestedModel }} → {{ row.actualModel }}</span>
                        </td>
                        <td class="px-5 py-3 text-right font-mono text-xs font-bold text-rose-600">{{ formatMs(row.latencyMs) }}</td>
                      </tr>
                      <tr v-if="!(statsData?.top?.slow || []).length">
                        <td colspan="4" class="px-5 py-10 text-center text-sm text-slate-400">暂无数据</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
                <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-4">
                  <h3 class="text-sm font-semibold text-slate-900">错误 Top 10</h3>
                  <span class="text-xs text-slate-500">最近错误记录</span>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[700px] text-left text-sm">
                    <thead>
                      <tr class="border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th class="px-5 py-3">时间</th>
                        <th class="px-5 py-3">应用</th>
                        <th class="px-5 py-3">厂商</th>
                        <th class="px-5 py-3">错误</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      <tr v-for="row in (statsData?.top?.errors || [])" :key="row.id" class="transition hover:bg-slate-50/80">
                        <td class="px-5 py-3 font-mono text-xs text-slate-500">{{ formatTime(row.requestAt) }}</td>
                        <td class="px-5 py-3 font-medium text-slate-800">{{ row.appName }}</td>
                        <td class="px-5 py-3 text-slate-600">{{ row.providerName }}</td>
                        <td class="px-5 py-3 font-mono text-[11px] leading-relaxed text-rose-600 break-all">{{ row.errorMessage || '-' }}</td>
                      </tr>
                      <tr v-if="!(statsData?.top?.errors || []).length">
                        <td colspan="4" class="px-5 py-10 text-center text-sm text-slate-400">暂无数据</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeTab === 'config'" class="space-y-6">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 text-xs text-gray-500">
            <span>
              当前软件版本
              <code class="ml-1 font-mono text-sm font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">v{{ serverVersion || '…' }}</code>
            </span>
            <span class="text-gray-400 sm:text-right">与根目录 <code class="font-mono text-[10px]">package.json</code> 及 <code class="font-mono text-[10px]">GET /healthz</code> 一致</span>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div class="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
              <div>
                <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">全局配置导入/导出</h3>
                <p class="text-xs text-gray-400 mt-1">可导入导出厂商、模型、应用、模型规则等业务配置，不包含管理员用户名和密码。</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  @click="exportGlobalConfig"
                  class="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm border border-gray-200"
                >
                  <Download class="w-4 h-4" />
                  导出全局配置
                </button>
                <button
                  @click="openGlobalImportDialog"
                  class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                >
                  <Upload class="w-4 h-4" />
                  导入全局配置
                </button>
              </div>
            </div>
          </div>

          <!-- 对话日志保留 -->
          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">对话日志保留</h3>
                <p class="text-xs text-gray-400 mt-1">按天自动删除过期数据；0 表示不自动删除。保存后立即按新规则清理一次，之后约每 6 小时再执行。</p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  v-model.number="appSettings.logRetentionDays"
                  type="number"
                  min="0"
                  step="1"
                  class="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <span class="text-sm text-gray-500">天</span>
              </div>
            </div>
          </div>

          <!-- 统计数据保留 -->
          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">统计数据保留</h3>
                <p class="text-xs text-gray-400 mt-1">按天自动删除过期统计数据；0 表示不自动删除。</p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  v-model.number="appSettings.statsRetentionDays"
                  type="number"
                  min="0"
                  step="1"
                  class="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <span class="text-sm text-gray-500">天</span>
              </div>
            </div>
          </div>

          <!-- 上游超时 -->
          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">上游 HTTP 超时</h3>
                <p class="text-xs text-gray-400 mt-1">代理请求大模型 API 的单次 HTTP 超时时间。默认 360，范围 5～86400 秒。</p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  v-model.number="appSettings.upstreamTimeoutSeconds"
                  type="number"
                  min="5"
                  max="86400"
                  step="1"
                  class="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <span class="text-sm text-gray-500">秒</span>
              </div>
            </div>
          </div>

          <!-- 请求头转发黑名单 -->
          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">请求头转发黑名单</h3>
                <p class="text-xs text-gray-400 mt-1">这些请求头不会转发到上游。默认: host, content-length, connection, accept-encoding。</p>
              </div>
              <div class="flex-1 max-w-md">
                <input
                  :value="appSettings.upstreamHeadersBlocklist.join(', ')"
                  @input="appSettings.upstreamHeadersBlocklist = $event.target.value.split(',').map(s => s.trim()).filter(s => s)"
                  type="text"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
            </div>
          </div>

          <!-- 保存按钮 -->
          <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div class="flex justify-end">
              <button
                type="button"
                :disabled="appSettingsSaving"
                @click="saveAppSettings"
                class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-bold disabled:opacity-50"
              >
                {{ appSettingsSaving ? '保存中…' : '保存配置' }}
              </button>
            </div>
          </div>

        </div>

        <!-- Logs View -->
        <div v-if="activeTab === 'logs'" class="space-y-4">
          <div class="flex flex-col lg:flex-row gap-3 lg:justify-between lg:items-center mb-4">
            <div class="flex flex-col gap-2">
              <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wider">对话历史记录</h3>
              <div class="flex flex-wrap gap-2">
                <button 
                  @click="selectedClientKey = 'all'; logsPage = 1; fetchLogs()"
                  :class="['px-3 py-1 rounded-full text-xs font-bold transition-all border', 
                    selectedClientKey === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400']"
                >
                  全部客户端
                </button>
                <button 
                  v-for="key in clientKeys" 
                  :key="key.id"
                  @click="selectedClientKey = key.id; logsPage = 1; fetchLogs()"
                  :class="['px-3 py-1 rounded-full text-xs font-bold transition-all border', 
                    selectedClientKey === key.id ? 'bg-purple-600 text-white border-purple-600 shadow-sm' : 'bg-purple-50 text-purple-600 border-purple-100 hover:border-purple-300']"
                >
                  {{ key.name }}
                </button>
              </div>
            </div>
            <button 
              @click="clearLogs"
              class="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-bold border border-red-200"
            >
              <Trash2 class="w-4 h-4" />
              清空对话日志
            </button>
          </div>
          <div v-if="hasNewLogs" class="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 flex items-center justify-between">
            <div class="text-sm font-medium">有新日志到达</div>
            <button @click="goToLatestLogs" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors">
              加载最新
            </button>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div class="overflow-x-auto">
            <table class="w-full min-w-[1100px] text-left text-sm">
              <thead class="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th class="px-6 py-4 font-semibold text-gray-600">时间</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">客户端 Key</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">厂商</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">模型</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">路径</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">耗时</th>
                  <th class="px-6 py-4 font-semibold text-gray-600">状态</th>
                  <th class="px-6 py-4 font-semibold text-gray-600 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                <tr v-for="log in logs" :key="log.id" class="hover:bg-gray-50 transition-colors">
                  <td class="px-6 py-4 text-gray-500 font-mono text-xs">{{ formatTime(log.requestAt || log.createdAt) }}</td>
                  <td class="px-6 py-4">
                    <span class="px-2 py-1 bg-purple-50 text-purple-700 rounded text-[10px] font-bold uppercase tracking-tight">{{ log.clientKeyName || '未知' }}</span>
                  </td>
                  <td class="px-6 py-4 font-medium">{{ log.providerName }}</td>
                  <td class="px-6 py-4 font-mono text-xs">
                    <template v-if="!log.actualModel || log.model === log.actualModel">
                      <span :class="isMagicProxyModel(log.model) ? 'text-green-600 font-bold' : 'text-gray-600'">{{ log.model }}</span>
                    </template>
                    <template v-else>
                      <span class="text-green-600 font-bold">{{ log.model }}</span>
                      <span class="mx-2 text-gray-400">→</span>
                      <span class="text-blue-600 font-medium">{{ log.actualModel }}</span>
                    </template>
                  </td>
                  <td class="px-6 py-4 text-gray-600 font-mono text-[10px] max-w-[200px]">
                    <span class="text-gray-400">{{ log.httpMethod || 'POST' }}</span>
                    <span class="block truncate text-gray-700" :title="log.requestPath || ''">{{ log.requestPath || '—' }}</span>
                  </td>
                  <td class="px-6 py-4 text-gray-700 font-mono text-xs">
                    {{ formatLogLatency(log) }}
                  </td>
                  <td class="px-6 py-4">
                    <span 
                      v-if="log.status === 'waiting'" 
                      class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                    >
                      <Loader2 class="w-3 h-3 animate-spin" />
                      等待响应中
                    </span>
                    <span 
                      v-else-if="log.status === 'completed'" 
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200"
                    >
                      <CheckCircle2 class="w-3 h-3" />
                      已完成
                    </span>
                    <span 
                      v-else 
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200"
                    >
                      错误
                    </span>
                    <p v-if="Number(log.isStream) === 1" class="mt-1 text-[9px] text-gray-500 font-mono">
                      流式<span v-if="Number(log.streamBroken) === 1" class="text-red-600"> · 流中断</span>
                    </p>
                  </td>
                  <td class="px-6 py-4 text-right">
                    <button 
                      type="button"
                      @click="openLogDetail(log)"
                      class="text-blue-600 hover:underline font-medium"
                    >
                      查看详情
                    </button>
                  </td>
                </tr>
                <tr v-if="!logs.length">
                  <td colspan="8" class="px-6 py-10 text-center text-gray-400 text-sm">暂无数据</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
          <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between bg-white rounded-xl border border-gray-200 shadow-sm px-4 sm:px-6 py-4">
            <div class="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span>总计 {{ logsTotal }} 条</span>
              <div class="flex items-center gap-2">
                <span>每页</span>
                <select v-model.number="logsPageSize" @change="logsPage = 1; fetchLogs()" class="px-2 py-1 border border-gray-200 rounded-lg bg-white text-xs">
                  <option :value="20">20</option>
                  <option :value="50">50</option>
                  <option :value="100">100</option>
                </select>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <button @click="prevLogsPage" :disabled="logsPage <= 1" class="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors">
                上一页
              </button>
              <span class="text-xs text-gray-600 font-bold">第 {{ logsPage }} / {{ logsTotalPages }} 页</span>
              <button @click="nextLogsPage" :disabled="logsPage >= logsTotalPages" class="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors">
                下一页
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- 导出对话框 -->
    <div v-if="showExportDialog" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">导出厂商配置</h3>

        <div class="space-y-4">
          <div class="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <input
              v-model="exportIncludeApiKey"
              type="checkbox"
              id="includeApiKey"
              class="w-5 h-5 text-amber-600 rounded focus:ring-amber-500"
            >
            <label for="includeApiKey" class="text-sm">
              <span class="font-medium text-gray-900">包含 API Key</span>
              <p class="text-gray-600 mt-1">⚠️ 警告：导出的文件包含敏感信息，请勿随意分享或公开存储！</p>
            </label>
          </div>

          <div class="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p class="text-sm text-gray-700">
              导出内容包括：
            </p>
            <ul class="text-sm text-gray-600 mt-2 space-y-1 list-disc list-inside">
              <li>厂商名称、类型、API 基础地址</li>
              <li>激活状态</li>
              <li>模型关联关系</li>
              <li>默认模型设置</li>
              <li v-if="exportIncludeApiKey" class="text-red-600 font-medium">API Key</li>
            </ul>
          </div>
        </div>

        <div class="flex gap-3 mt-6">
          <button
            @click="doExport"
            class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            确认导出
          </button>
          <button
            @click="showExportDialog = false"
            class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>

    <!-- 导入对话框 -->
    <div v-if="showImportDialog" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <!-- 步骤1: 选择文件 -->
      <div v-if="importStep === 'file'" class="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">导入厂商配置</h3>

        <div
          @dragover.prevent
          @drop.prevent="handleImportDrop"
          @click="$refs.importFileInput?.click()"
          class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
        >
          <Upload class="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p class="text-sm text-gray-600">拖放 JSON 文件到此处，或点击选择文件</p>
          <p class="text-xs text-gray-400 mt-2">支持 .json 格式的厂商配置文件</p>
        </div>
        <input
          ref="importFileInput"
          type="file"
          accept=".json"
          @change="handleImportFileSelect"
          class="hidden"
        >

        <div class="flex gap-3 mt-6">
          <button
            @click="showImportDialog = false"
            class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
        </div>
      </div>

      <!-- 步骤2: 处理冲突 -->
      <div v-if="importStep === 'conflict'" class="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-2">处理冲突</h3>
        <p class="text-sm text-gray-600 mb-4">以下厂商名称已存在，请选择处理方式：</p>

        <div class="space-y-3">
          <div
            v-for="item in importConflicts"
            :key="item.provider.name"
            class="p-4 border border-gray-200 rounded-lg"
          >
            <div class="flex items-center justify-between mb-3">
              <span class="font-medium text-gray-900">{{ item.provider.name }}</span>
              <span class="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full">冲突</span>
            </div>
            <div class="flex gap-2">
              <button
                @click="importMergeStrategy[item.provider.name] = 'skip'"
                :class="importMergeStrategy[item.provider.name] === 'skip' ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-gray-100'"
                class="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                跳过
              </button>
              <button
                @click="importMergeStrategy[item.provider.name] = 'overwrite'"
                :class="importMergeStrategy[item.provider.name] === 'overwrite' ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-gray-100'"
                class="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                覆盖
              </button>
            </div>
          </div>
        </div>

        <div class="flex gap-3 mt-6">
          <button
            @click="doImport"
            class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            确认导入
          </button>
          <button
            @click="showImportDialog = false"
            class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
        </div>
      </div>

      <!-- 步骤3: 导入结果 -->
      <div v-if="importStep === 'result'" class="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">导入完成</h3>

        <div class="space-y-2 max-h-60 overflow-y-auto">
          <div
            v-for="result in importResults"
            :key="result.name"
            class="flex items-center justify-between p-3 rounded-lg"
            :class="{
              'bg-green-50': result.action === 'created',
              'bg-amber-50': result.action === 'overwritten',
              'bg-gray-50': result.action === 'skipped'
            }"
          >
            <span class="font-medium">{{ result.name }}</span>
            <span class="text-xs px-2 py-1 rounded-full" :class="{
              'bg-green-200 text-green-800': result.action === 'created',
              'bg-amber-200 text-amber-800': result.action === 'overwritten',
              'bg-gray-200 text-gray-800': result.action === 'skipped'
            }">
              {{ result.action === 'created' ? '已创建' : result.action === 'overwritten' ? '已覆盖' : '已跳过' }}
            </span>
          </div>
        </div>

        <button
          @click="closeImportDialog"
          class="w-full mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          关闭
        </button>
      </div>
    </div>

    <!-- 全局配置导入对话框 -->
    <div v-if="showGlobalImportDialog" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-2">导入全局配置</h3>
        <p class="text-sm text-gray-600 mb-4">将覆盖当前业务配置（厂商、模型、应用、规则），不影响管理员用户名和密码。</p>

        <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
          导入前建议先执行“导出全局配置”作为备份。
        </div>

        <input
          type="file"
          accept=".json"
          @change="handleGlobalImportFileSelect"
          class="block w-full text-sm text-gray-700 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
        />
        <p class="text-xs text-gray-500 mt-2">
          {{ globalImportData ? '已选择并解析配置文件，可执行导入。' : '请选择导出的全局配置 JSON 文件。' }}
        </p>

        <div class="flex gap-3 mt-6">
          <button
            @click="doGlobalImport"
            :disabled="!globalImportData"
            class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            确认导入
          </button>
          <button
            @click="showGlobalImportDialog = false"
            class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>

    <!-- Copy Provider Modal -->
    <div v-if="showCopyProviderDialog" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div class="bg-white rounded-2xl w-full max-w-lg p-8 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
        <h3 class="text-xl font-bold mb-1">复制厂商</h3>
        <p class="text-xs text-gray-500 mb-6">填写新厂商名称；基础地址、托管 Key、类型默认与源厂商一致，可直接修改。模型列表默认与源一致，可自行增删；保存后会创建新厂商并关联模型。</p>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">新厂商名称 <span class="text-red-500">*</span></label>
            <input v-model="copyProviderForm.name" type="text" placeholder="例如：生产环境-OpenAI" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">厂商类型</label>
            <select v-model="copyProviderForm.type" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic 兼容</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">基础地址 (Base URL)</label>
            <input v-model="copyProviderForm.baseUrl" type="text" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">托管 API Key</label>
            <input v-model="copyProviderForm.apiKey" type="password" placeholder="默认已填入源厂商 Key，可修改" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div class="flex items-center justify-between py-2">
            <div>
              <label class="block text-xs font-bold text-gray-400 uppercase mb-0.5">协议强制转换</label>
              <p class="text-[10px] text-gray-400">开启后只接受非原生协议的客户端请求并自动转换</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" v-model="copyProviderForm.protocolConvert" class="sr-only peer" />
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">默认模型（保存后生效）</label>
            <select v-model="copyDefaultModelName" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm">
              <option value="">暂不设置默认（创建后在卡片上点选）</option>
              <option v-for="n in copyModelNamesForSelect" :key="'def-' + n" :value="n">{{ n }}</option>
            </select>
          </div>
          <div>
            <div class="flex justify-between items-center mb-2">
              <span class="text-xs font-bold text-gray-400 uppercase">模型列表</span>
            </div>
            <div class="space-y-2 max-h-48 overflow-y-auto rounded-lg border border-gray-100 p-2 bg-gray-50/80">
              <div v-for="(row, idx) in copyProviderModelNames" :key="'cm-' + idx" class="flex gap-2 items-center">
                <input
                  v-model="copyProviderModelNames[idx]"
                  type="text"
                  placeholder="模型名"
                  class="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <button type="button" @click="removeCopyModelAt(idx)" class="shrink-0 p-2 text-red-600 hover:bg-red-50 rounded-lg" title="删除">
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
              <p v-if="!copyProviderModelNames.length" class="text-xs text-gray-400 py-2 text-center">暂无模型，可在下方添加</p>
            </div>
            <div class="flex gap-2 mt-2">
              <input
                v-model="newCopyModelRow"
                type="text"
                placeholder="新模型名称"
                class="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                @keydown.enter.prevent="addCopyModelRow"
              />
              <button type="button" @click="addCopyModelRow" class="px-3 py-2 text-sm font-bold bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200">添加</button>
            </div>
          </div>
        </div>
        <div class="flex gap-3 mt-8">
          <button type="button" @click="closeCopyProviderDialog" class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button type="button" @click="submitCopyProvider" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold">创建副本</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Provider Modal -->
    <div v-if="showAddProvider || editingProvider" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl w-full max-w-md p-8 shadow-2xl">
        <h3 class="text-xl font-bold mb-6">{{ editingProvider ? '编辑厂商配置' : '添加厂商配置' }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">厂商名称</label>
            <input v-model="(editingProvider || newProvider).name" type="text" placeholder="例如: GPT-4 生产线" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">厂商类型</label>
            <select v-model="(editingProvider || newProvider).type" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic 兼容</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">基础地址 (Base URL)</label>
            <input v-model="(editingProvider || newProvider).baseUrl" type="text" placeholder="https://api.openai.com" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">托管 API Key</label>
            <input v-model="(editingProvider || newProvider).apiKey" type="password" placeholder="sk-..." class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div class="flex items-center justify-between py-2">
            <div>
              <label class="block text-xs font-bold text-gray-400 uppercase mb-0.5">协议强制转换</label>
              <p class="text-[10px] text-gray-400">开启后只接受非原生协议的客户端请求并自动转换</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" v-model="(editingProvider || newProvider).protocolConvert" class="sr-only peer" />
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
        <div class="flex gap-3 mt-8">
          <button @click="showAddProvider = false; editingProvider = null" class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button @click="editingProvider ? updateProvider() : addProvider()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold">保存配置</button>
        </div>
      </div>
    </div>

    <div v-if="showAddProviderModel" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl w-full max-w-md p-8 shadow-2xl">
        <h3 class="text-xl font-bold mb-6">为厂商添加模型</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">厂商</label>
            <div class="px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm font-bold text-gray-700">{{ providerModelTargetProvider?.name || '-' }}</div>
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">模型名称</label>
            <input v-model="newProviderModelName" type="text" placeholder="例如: glm-4.7" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
        </div>
        <p class="text-[10px] text-gray-400 mt-2">注意：模型名称区分大小写，将以您输入的内容为准进行存储和显示。</p>
        <div class="flex gap-3 mt-8">
          <button @click="showAddProviderModel = false; providerModelTargetProvider = null; newProviderModelName = ''" class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button @click="addProviderModel" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold">添加</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit App Modal -->
    <div v-if="showAddApp || editingApp" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl w-full max-w-md p-8 shadow-2xl">
        <h3 class="text-xl font-bold mb-6">{{ editingApp ? '应用配置' : '创建新应用' }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">应用名称</label>
            <input v-model="(editingApp || newClientApp).name" type="text" placeholder="例如: 我的应用-1" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">绑定厂商 (Provider)</label>
            <select v-model="(editingApp || newClientApp).providerId" @change="onClientAppProviderChange(editingApp || newClientApp)" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              <option :value="null">默认厂商 (全局生效)</option>
              <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">绑定模型 (Model)</label>
            <select v-model="(editingApp || newClientApp).managedModelId" :disabled="!(editingApp || newClientApp).providerId" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed">
              <option
                v-for="m in getModelOptionsForProvider((editingApp || newClientApp).providerId, (editingApp || newClientApp).managedModelId)"
                :key="m.id"
                :value="m.id"
              >
                {{ m.name }}
              </option>
            </select>
            <p v-if="!(editingApp || newClientApp).providerId" class="text-[10px] text-gray-400 mt-2">选择默认厂商时，模型固定为默认。</p>
            <p v-else-if="!(editingApp || newClientApp).managedModelId" class="text-[10px] text-red-600 mt-2">已选择厂商，必须选择该厂商中的一个模型。</p>
          </div>
        </div>
        <p class="text-[10px] text-gray-400 mt-4 italic">当厂商为默认时，模型固定为默认；当绑定了厂商后，才允许为该应用指定模型。</p>
        <div class="flex gap-3 mt-8">
          <button @click="showAddApp = false; editingApp = null" class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button @click="editingApp ? updateClientApp() : addClientApp()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold">保存应用</button>
        </div>
      </div>
    </div>

    <div v-if="showAddAdminUser || editingAdminUser" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl w-full max-w-md p-8 shadow-2xl">
        <h3 class="text-xl font-bold mb-6">{{ editingAdminUser ? '编辑用户' : '添加用户' }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">用户名</label>
            <input v-model="(editingAdminUser || newAdminUser).username" type="text" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div v-if="!editingAdminUser">
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">初始密码</label>
            <input v-model="newAdminUser.password" type="password" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
            <p class="text-[10px] text-gray-400 mt-1">用户首次登录会被要求强制修改密码。</p>
          </div>
          <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <p class="text-xs font-bold text-gray-500">状态</p>
              <p class="text-[10px] text-gray-400">禁用后无法登录</p>
            </div>
            <button
              @click="(editingAdminUser || newAdminUser).enabled = (editingAdminUser || newAdminUser).enabled ? 0 : 1"
              :class="(editingAdminUser || newAdminUser).enabled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'"
              class="px-3 py-1.5 rounded-lg border text-xs font-bold"
            >
              {{ (editingAdminUser || newAdminUser).enabled ? '已启用' : '已禁用' }}
            </button>
          </div>
        </div>
        <div class="flex gap-3 mt-8">
          <button @click="showAddAdminUser = false; editingAdminUser = null" class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button @click="editingAdminUser ? updateAdminUser() : addAdminUser()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold">保存用户</button>
        </div>
      </div>
    </div>

    <div v-if="resetPasswordUser" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl w-full max-w-md p-8 shadow-2xl">
        <h3 class="text-xl font-bold mb-2">重置密码</h3>
        <p class="text-xs text-gray-500 mb-6">用户 {{ resetPasswordUser.username }} 下次登录将强制修改密码。</p>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">新密码</label>
            <input v-model="resetPasswordValue" type="password" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
        </div>
        <div class="flex gap-3 mt-8">
          <button @click="resetPasswordUser = null; resetPasswordValue = ''" class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button @click="resetAdminPassword" class="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-bold">确认重置</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Model Modal -->
    <div v-if="showAddModel" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl w-full max-w-md p-8 shadow-2xl">
        <h3 class="text-xl font-bold mb-6">添加模型</h3>
        <p class="text-xs text-gray-500 mb-4">厂商：<span class="font-bold text-gray-700">{{ providers.find(p => p.id === selectedModelProviderId)?.name || '当前生效厂商' }}</span></p>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">模型名称</label>
            <input v-model="newManagedModel.name" type="text" placeholder="例如: gpt-4o 或 claude-3-5-sonnet" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
        </div>
        <p class="text-[10px] text-gray-400 mt-4">注意：模型名称区分大小写，将以您输入的内容为准进行存储和显示。</p>
        <div class="flex gap-3 mt-8">
          <button @click="showAddModel = false" class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button @click="addManagedModel" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold">保存配置</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Model Rule Modal -->
    <div v-if="showAddModelRule || editingModelRule" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl w-full max-w-md p-8 shadow-2xl">
        <h3 class="text-xl font-bold mb-6">{{ editingModelRule ? '编辑模型规则' : '添加模型规则' }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">匹配模式 (支持*)</label>
            <input v-model="(editingModelRule || newModelRule).pattern" type="text" placeholder="例如: gpt-* 或 glm-4.7" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">转换为 (Target Model)</label>
            <input v-model="(editingModelRule || newModelRule).targetModel" type="text" placeholder="例如: gpt-4o 或 glm-4.7" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">优先级</label>
            <input v-model.number="(editingModelRule || newModelRule).priority" type="number" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div v-if="editingModelRule" class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <p class="text-xs font-bold text-gray-500">状态</p>
              <p class="text-[10px] text-gray-400">禁用后不会参与匹配</p>
            </div>
            <button
              @click="editingModelRule.enabled = editingModelRule.enabled ? 0 : 1"
              :class="editingModelRule.enabled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'"
              class="px-3 py-1.5 rounded-lg border text-xs font-bold"
            >
              {{ editingModelRule.enabled ? '已启用' : '已禁用' }}
            </button>
          </div>
        </div>
        <p class="text-[10px] text-gray-400 mt-4">大小写敏感；按优先级从高到低匹配，命中第一条后生效。</p>
        <div class="flex gap-3 mt-8">
          <button @click="showAddModelRule = false; editingModelRule = null" class="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">取消</button>
          <button @click="editingModelRule ? updateModelRule() : addModelRule()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold">保存规则</button>
        </div>
      </div>
    </div>

    <!-- Log Detail Modal -->
    <div v-if="selectedLog" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" @click.self="closeLogDetail">
      <div class="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div class="p-6 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h3 class="text-xl font-bold">对话详情</h3>
            <p class="text-sm text-gray-500">
              <span v-if="!selectedLog.actualModel || selectedLog.model === selectedLog.actualModel">{{ selectedLog.model }}</span>
              <span v-else>{{ selectedLog.model }} → {{ selectedLog.actualModel }}</span>
              @ {{ selectedLog.providerName }}
            </p>
          </div>
          <button type="button" @click="closeLogDetail" class="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X class="w-6 h-6 text-gray-400" />
          </button>
        </div>
        <div v-if="logDetailError" class="mx-6 mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {{ logDetailError }}
        </div>
        <div v-if="logDetailLoading" class="flex-1 flex flex-col items-center justify-center gap-3 py-24 text-gray-500">
          <Loader2 class="w-10 h-10 animate-spin text-blue-500" />
          <p class="text-sm">正在加载完整日志…</p>
        </div>
        <div v-else-if="!logDetailError" class="flex-1 overflow-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="lg:col-span-2 flex flex-col sm:flex-row gap-4 mb-2">
            <div class="flex-1 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">客户端密钥</p>
              <p class="text-sm font-medium text-purple-700">{{ selectedLog.clientKeyName || '未知' }}</p>
            </div>
            <div class="flex-1 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">生效厂商</p>
              <p class="text-sm font-medium text-blue-700">{{ selectedLog.providerName }}</p>
            </div>
            <div class="flex-1 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">响应耗时</p>
              <p class="text-sm font-medium text-green-700">{{ formatLogLatency(selectedLog) || '计算中...' }}</p>
            </div>
          </div>
          <div class="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2 text-xs">
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">HTTP</p>
              <p class="font-mono text-gray-800">{{ selectedLog.httpMethod || 'POST' }} <span class="text-gray-500">{{ selectedLog.requestPath || '—' }}</span></p>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">客户端 IP</p>
              <p class="font-mono text-gray-800">{{ selectedLog.clientIp || '—' }}</p>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100 sm:col-span-2">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">User-Agent（客户端）</p>
              <p class="font-mono text-gray-700 break-all">{{ selectedLog.clientUserAgent || '—' }}</p>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100 sm:col-span-2">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">User-Agent（发往上游）</p>
              <p class="font-mono text-gray-700 break-all">{{ selectedLog.proxyUserAgent || '—' }}</p>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">流式 / 中断</p>
              <p class="text-gray-800">
                {{ Number(selectedLog.isStream) === 1 ? '是' : '否' }}
                <span v-if="selectedLog.responseBody && selectedLog.responseBody.includes('tool_use')" class="text-amber-600 font-bold"> · 工具调用</span>
                <span v-if="Number(selectedLog.isStream) === 1 && Number(selectedLog.streamBroken) === 1" class="text-red-600 font-bold"> · 流中断</span>
              </p>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">上游 / 客户端 HTTP 状态</p>
              <p class="font-mono text-gray-800">{{ selectedLog.upstreamStatus ?? '—' }} / {{ selectedLog.clientStatus ?? '—' }}</p>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">请求体 / 响应体</p>
              <p class="font-mono text-gray-800">{{ formatBytes(selectedLog.requestBytes) }} / {{ formatBytes(selectedLog.responseBytes) }}</p>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p class="text-[10px] text-gray-400 font-bold uppercase mb-1">Token（入 / 出 / 计）</p>
              <p class="font-mono text-gray-800">{{ selectedLog.tokensIn != null ? formatNumber(selectedLog.tokensIn) : '—' }} / {{ selectedLog.tokensOut != null ? formatNumber(selectedLog.tokensOut) : '—' }} / {{ selectedLog.tokensTotal != null ? formatNumber(selectedLog.tokensTotal) : '—' }}</p>
            </div>
          </div>
          <div class="lg:col-span-2 space-y-2 mb-2">
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100 flex items-center gap-3">
              <span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold uppercase">客户端 URL</span>
              <code class="text-xs text-gray-600 font-mono flex-1 truncate">{{ selectedLog.clientUrl || '-' }}</code>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg border border-gray-100 flex items-center gap-3">
              <span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-bold uppercase">代理目标 URL</span>
              <code class="text-xs text-gray-600 font-mono flex-1 truncate">{{ selectedLog.targetUrl || '-' }}</code>
            </div>
          </div>
          <div class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center">
              <h4 class="text-xs font-bold text-gray-400 uppercase">客户端请求头</h4>
            </div>
            <pre
              class="bg-gray-900 text-gray-100 p-4 rounded-xl overflow-auto text-xs leading-relaxed max-h-[600px]"
            >{{ formatJson(selectedLog.clientRequestHeaders) }}</pre>
          </div>
          <div class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center">
              <h4 class="text-xs font-bold text-gray-400 uppercase">代理请求头（发往上游）</h4>
            </div>
            <pre
              class="bg-gray-900 text-gray-100 p-4 rounded-xl overflow-auto text-xs leading-relaxed max-h-[600px]"
            >{{ formatJson(selectedLog.proxyRequestHeaders) }}</pre>
          </div>
          <div class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center">
              <h4 class="text-xs font-bold text-gray-400 uppercase">请求正文 (JSON)</h4>
              <span class="text-[10px] text-gray-400 font-mono">{{ formatTime(selectedLog.requestAt) }}</span>
            </div>
            <pre
              class="bg-gray-900 text-gray-100 p-4 rounded-xl overflow-auto text-xs leading-relaxed max-h-[600px]"
            >{{ formatJson(selectedLog.requestBody) }}</pre>
          </div>
          <div v-if="selectedLog.proxyRequestBody" class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center">
              <h4 class="text-xs font-bold text-gray-400 uppercase">代理请求正文（发往上游）</h4>
            </div>
            <pre
              class="bg-gray-900 text-gray-100 p-4 rounded-xl overflow-auto text-xs leading-relaxed max-h-[600px]"
            >{{ formatJson(selectedLog.proxyRequestBody) }}</pre>
          </div>
          <div class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center">
              <h4 class="text-xs font-bold text-gray-400 uppercase">响应正文</h4>
              <span v-if="selectedLog.responseAt" class="text-[10px] text-gray-400 font-mono">{{ formatTime(selectedLog.responseAt) }}</span>
            </div>
            <div v-if="selectedLog.status === 'waiting' && !selectedLog.responseBody" class="h-[200px] flex flex-col items-center justify-center text-gray-400 gap-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              <Loader2 class="w-12 h-12 animate-spin text-blue-500" />
              <p class="animate-pulse">正在等待厂商响应...</p>
            </div>
            <pre
              v-else
              class="bg-gray-900 text-gray-100 p-4 rounded-xl overflow-auto text-xs leading-relaxed max-h-[600px]"
            >{{ formatJson(selectedLog.responseBody) }}</pre>
          </div>
        </div>
      </div>
    </div>

    <div v-if="mustChangePassword" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-2xl w-full max-w-md p-8 shadow-2xl">
        <h3 class="text-xl font-bold mb-2">请先修改密码</h3>
        <p class="text-xs text-gray-500 mb-6">首次登录必须修改默认密码后才能继续使用管理功能。</p>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">当前密码</label>
            <input v-model="changePasswordForm.currentPassword" type="password" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">新密码</label>
            <input v-model="changePasswordForm.newPassword" type="password" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">确认新密码</label>
            <input v-model="changePasswordForm.confirmNewPassword" type="password" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
        </div>
        <button @click="changePassword" class="w-full mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold">
          修改密码并继续
        </button>
        <button @click="logout" class="w-full mt-3 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-bold text-gray-700">
          退出登录
        </button>
      </div>
    </div>
  </div>
</template>

<style>
@import './style.css';

mark {
  background-color: #fef08a; /* yellow-200 */
  color: #854d0e; /* yellow-900 */
  border-radius: 2px;
  padding: 0 2px;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #e2e8f0;
  border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
  background: #cbd5e1;
}
</style>
