<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
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
  List,
  ArrowUpDown,
  GripVertical,
  Cpu,
  BarChart3,
  Users,
  User,
  BookOpen,
  Bell,
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
  TrendingUp,
  Gauge,
  Radio,
  WifiOff,
  HardDrive,
  Eye,
  EyeOff,
  Flame
} from 'lucide-vue-next';

use([CanvasRenderer, CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, HeatmapChart, LineChart, PieChart, BarChart]);
import { BarChart } from 'echarts/charts';

const { locale } = useI18n();
const savedLang = localStorage.getItem('llmpylon_lang');
if (savedLang === 'en' || savedLang === 'zh') locale.value = savedLang;

const currentLang = computed(() => locale.value);
const toggleLang = () => {
  locale.value = locale.value === 'zh' ? 'en' : 'zh';
  localStorage.setItem('llmpylon_lang', locale.value);
};

const isDark = ref(localStorage.getItem('llmpylon_theme') === 'dark');
const applyTheme = (v) => {
  document.documentElement.classList.toggle('dark', v);
};
applyTheme(isDark.value);
const toggleTheme = () => {
  isDark.value = !isDark.value;
  applyTheme(isDark.value);
  localStorage.setItem('llmpylon_theme', isDark.value ? 'dark' : 'light');
};

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

const VALID_TABS = ['providers', 'keys', 'models', 'modelRules', 'logs', 'stats', 'config', 'notifications', 'help'];
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
const showProviderApiKey = ref(false);
const showCopyApiKey = ref(false);
const showApiKeyInCard = ref({});
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
const expandedSections = ref({
  clientHeaders: false,
  proxyHeaders: false,
  requestBody: false,
  proxyRequestBody: false,
  responseBody: false,
  proxyResponseBody: false
});
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
  logRetentionDays: 60,
  statsRetentionDays: 180,
  upstreamTimeoutSeconds: 360,
  upstreamHeadersBlocklist: ['host', 'content-length', 'connection', 'accept-encoding'],
  notificationCooldownSeconds: 5,
  notificationLogRetentionDays: 7,
  notificationToolUseTimeoutSeconds: 10,
  notificationMuteEnabled: false,
  notificationMuteStart: '00:00',
  notificationMuteEnd: '00:00',
  timezone: 'Asia/Shanghai'
});

const appSettingsSaving = ref(false);
const muteEditing = ref(false);
const muteSavedToast = ref(false);

const nowInMute = computed(() => {
  if (!appSettings.value.notificationMuteEnabled) return false;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = String(appSettings.value.notificationMuteStart || '00:00').split(':').map(Number);
  const [eh, em] = String(appSettings.value.notificationMuteEnd || '00:00').split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return false;
  if (s <= e) return mins >= s && mins < e;
  return mins >= s || mins < e;
});
const notifLogsTotalPages = computed(() => Math.max(1, Math.ceil(notifLogsTotal.value / notifLogsPageSize.value)));
const notificationConfigs = ref([]);
const editingNotifConfig = ref(undefined);
const notifConfigForm = ref({ clientKeyIds: [], enabled: true, webhookUrl: '', httpMethod: 'POST', headers: [], bodyTemplate: '', cooldownSeconds: 5 });
const notifConfigSaving = ref(false);
const notifLogs = ref([]);
const notifLogsTotal = ref(0);
const notifLogsPage = ref(1);
const notifLogsPageSize = ref(20);
const notifLogsFilter = ref({ clientKeyId: 'all', status: 'all' });
const selectedNotifLog = ref(null);
const notifLogDetailLoading = ref(false);
const notifLogDetailError = ref('');
const showKeyRecycleBin = ref(false);
const deletedKeys = ref([]);
const nowMs = ref(Date.now());

const providerViewMode = ref(localStorage.getItem('providerViewMode') || 'grid');
const providerSortBy = ref(localStorage.getItem('providerSortBy') || 'custom');
const providerSortOrder = ref(localStorage.getItem('providerSortOrder') || 'asc');
const modelViewMode = ref(localStorage.getItem('modelViewMode') || 'grid');
const modelSortBy = ref(localStorage.getItem('modelSortBy') || 'custom');
const modelSortOrder = ref(localStorage.getItem('modelSortOrder') || 'asc');

function persistViewMode() {
  localStorage.setItem('providerViewMode', providerViewMode.value);
  localStorage.setItem('providerSortBy', providerSortBy.value);
  localStorage.setItem('providerSortOrder', providerSortOrder.value);
  localStorage.setItem('modelViewMode', modelViewMode.value);
  localStorage.setItem('modelSortBy', modelSortBy.value);
  localStorage.setItem('modelSortOrder', modelSortOrder.value);
}

const providerUsageData = ref({});
const providerUsageLoading = ref(false);
const showAllModels = ref({});

const fetchProviderUsage = async () => {
  providerUsageLoading.value = true;
  try {
    const res = await axios.get(`${API_BASE}/providers/usage`);
    providerUsageData.value = res.data;
  } catch (e) {
    console.error('fetchProviderUsage', e);
  } finally {
    providerUsageLoading.value = false;
  }
};

// Provider drag state
const providerDragIndex = ref(null);

function onProviderDragStart(e, idx) {
  if (providerSortBy.value !== 'custom') return;
  providerDragIndex.value = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(idx));
}

function onProviderDragOver(e) {
  e.preventDefault();
}

function onProviderDrop(e, idx) {
  e.preventDefault();
  if (providerSortBy.value !== 'custom') return;
  const from = providerDragIndex.value;
  if (from === null || from === idx) return;
  const list = [...sortedProviders.value];
  const [moved] = list.splice(from, 1);
  list.splice(idx, 0, moved);
  const orderedIds = list.map(p => p.id);
  providerDragIndex.value = null;
  axios.put(`${API_BASE}/providers/reorder`, { orderedIds }).then(() => fetchProviders()).catch(e => {
    const msg = e.response?.data?.error || e.message;
    console.error('Reorder failed:', msg);
  });
}

function onProviderDragEnd() {
  providerDragIndex.value = null;
}

// Model drag state
const modelDragIndex = ref(null);

function onModelDragStart(e, idx) {
  if (modelSortBy.value !== 'custom') return;
  modelDragIndex.value = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(idx));
}

function onModelDragOver(e) {
  e.preventDefault();
}

function onModelDrop(e, idx) {
  e.preventDefault();
  if (modelSortBy.value !== 'custom') return;
  const from = modelDragIndex.value;
  if (from === null || from === idx) return;
  const list = [...sortedManagedModels.value];
  const [moved] = list.splice(from, 1);
  list.splice(idx, 0, moved);
  const orderedIds = list.map(m => m.id);
  modelDragIndex.value = null;
  axios.put(`${API_BASE}/models/reorder`, { orderedIds }).then(() => fetchManagedModels(selectedModelProviderId.value || undefined)).catch(e => {
    const msg = e.response?.data?.error || e.message;
    console.error('Reorder failed:', msg);
  });
}

function onModelDragEnd() {
  modelDragIndex.value = null;
}

const statsRange = ref('30d');
const statsProviderId = ref('all');
const statsIsStream = ref('all');
const statsClientProtocol = ref('all');
const statsLoading = ref(false);
const statsData = ref(null);

const fetchStats = async () => {
  statsLoading.value = true;
  try {
    const params = { range: statsRange.value };
    if (statsProviderId.value !== 'all') {
      params.providerId = statsProviderId.value;
    }
    if (statsIsStream.value !== 'all') {
      params.isStream = statsIsStream.value;
    }
    if (statsClientProtocol.value !== 'all') {
      params.clientProtocol = statsClientProtocol.value;
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
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

function sortByField(list, field, order) {
  const sorted = [...list].sort((a, b) => {
    let va, vb;
    if (field === 'name') {
      va = (a.name || '').toLowerCase();
      vb = (b.name || '').toLowerCase();
      return va.localeCompare(vb);
    }
    if (field === 'createdAt') {
      va = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      vb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return va - vb;
    }
    // custom: sort by position
    va = a.position ?? 0;
    vb = b.position ?? 0;
    if (va === vb) return (a.id || 0) - (b.id || 0);
    return va - vb;
  });
  if (order === 'desc') sorted.reverse();
  return sorted;
}

const sortedProviders = computed(() => {
  return sortByField(providers.value, providerSortBy.value, providerSortOrder.value);
});

const sortedManagedModels = computed(() => {
  return sortByField(managedModels.value, modelSortBy.value, modelSortOrder.value);
});

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
    tokensInTotal: Number(s.tokensInTotal || 0),
    tokensOutTotal: Number(s.tokensOutTotal || 0),
    avgLatencyMs: s.avgLatencyMs === null || s.avgLatencyMs === undefined ? null : Number(s.avgLatencyMs),
    activeDays: Number(s.activeDays || 0),
    streamCount: Number(s.streamCount || 0),
    nonStreamCount: Number(s.nonStreamCount || 0),
    ttfbAvgMs: s.ttfbAvgMs === null || s.ttfbAvgMs === undefined ? null : Number(s.ttfbAvgMs),
    responseBytesTotal: Number(s.responseBytesTotal || 0),
    streamBrokenCount: Number(s.streamBrokenCount || 0),
    streamBrokenRate: Number(s.streamBrokenRate || 0),
    latencyPercentiles: statsData.value?.latencyPercentiles || null,
    ttfbPercentiles: statsData.value?.ttfbPercentiles || null
  };
});

const HEATMAP_INTENSITY = (count) => {
  if (count === 0) return 0;
  if (count < 5) return 1;
  if (count < 10) return 2;
  if (count < 20) return 3;
  return 4;
};

const HEATMAP_COLORS = [
  { bg: 'var(--color-surface-elevated)', border: 'var(--color-border-default)' },
  { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.18)' },
  { bg: 'rgba(59,130,246,0.28)', border: 'rgba(59,130,246,0.32)' },
  { bg: 'rgba(59,130,246,0.55)', border: 'rgba(59,130,246,0.50)' },
  { bg: '#3b82f6', border: '#3b82f6' }
];

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

const heatmapCells = computed(() => {
  const raw = statsData.value?.heatmapYear || [];
  if (!raw.length) return { weeks: [], totalDays: 0, activeDays: 0 };

  const map = new Map(raw.map((d) => [d[0], Number(d[1] || 0)]));
  const calendarRange = statsData.value?.heatmapYearRange;
  const start = calendarRange?.[0] ? new Date(calendarRange[0] + 'T00:00:00') : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const end = calendarRange?.[1] ? new Date(calendarRange[1] + 'T00:00:00') : new Date();

  const formatLocalDay = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  let activeDays = 0;
  const weeks = [];
  let col = [];
  let colDayOfWeek = start.getDay() === 0 ? 6 : start.getDay() - 1; // Mon=0

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = formatLocalDay(d);
    const count = map.get(dateStr) || 0;
    const lvl = HEATMAP_INTENSITY(count);
    if (count > 0) activeDays++;
    col.push({ date: dateStr, count, lvl });
    if (col.length === 7) {
      weeks.push(col);
      col = [];
    }
  }
  if (col.length) weeks.push(col);

  return { weeks, totalDays: map.size, activeDays };
});

const requestsOption = computed(() => {
  const ts = statsData.value?.timeseries;
  const days = ts?.days || [];
  return {
    tooltip: echartsTooltip({ trigger: 'axis' }),
    legend: { data: ['请求', '错误'], top: 0, textStyle: { fontSize: 11, color: 'var(--color-text-secondary)' } },
    grid: echartsGrid({ left: 8, right: 20, top: 36, bottom: 24 }),
    xAxis: echartsXAxis(days),
    yAxis: echartsYAxis({ axisLabel: { fontSize: 10, color: 'var(--color-text-tertiary)' } }),
    series: [
      echartsSmoothLine('请求', ts?.requests || [], '#3b82f6'),
      echartsSmoothLine('错误', ts?.errors || [], '#f43f5e')
    ]
  };
});

const tokensOption = computed(() => {
  const ts = statsData.value?.timeseries;
  const days = ts?.days || [];
  return {
    tooltip: echartsTooltip({ trigger: 'axis' }),
    legend: { data: ['Tokens 入', 'Tokens 出'], top: 0, textStyle: { fontSize: 11, color: 'var(--color-text-secondary)' } },
    grid: echartsGrid({ left: 8, right: 20, top: 36, bottom: 24 }),
    xAxis: echartsXAxis(days),
    yAxis: echartsYAxis({ axisLabel: { fontSize: 10, color: 'var(--color-text-tertiary)' } }),
    series: [
      echartsSmoothLine('Tokens 入', ts?.tokensIn || [], '#06b6d4'),
      echartsSmoothLine('Tokens 出', ts?.tokensOut || [], '#14b8a6')
    ]
  };
});

const latencyTtfbOption = computed(() => {
  const ts = statsData.value?.timeseries;
  const days = ts?.days || [];
  return {
    tooltip: echartsTooltip({ trigger: 'axis' }),
    legend: { data: ['平均耗时', 'TTFB'], top: 0, textStyle: { fontSize: 11, color: 'var(--color-text-secondary)' } },
    grid: echartsGrid({ left: 8, right: 20, top: 36, bottom: 24 }),
    xAxis: echartsXAxis(days),
    yAxis: echartsYAxis({ axisLabel: { fontSize: 10, color: 'var(--color-text-tertiary)' } }),
    series: [
      echartsSmoothLine('平均耗时', ts?.avgLatencyMs || [], '#059669'),
      echartsSmoothLine('TTFB', ts?.ttfbAvgMs || [], '#7c3aed')
    ]
  };
});

const genDonutColors = (n) => Array.from({ length: Math.max(n, 1) }, (_, i) =>
  `hsl(${(i * 360 / n + 15).toFixed(1)}, 52%, 58%)`
);

const errorRateOption = computed(() => {
  const ts = statsData.value?.timeseries;
  const days = ts?.days || [];
  return {
    tooltip: echartsTooltip({ trigger: 'axis', valueFormatter: (v) => (v * 100).toFixed(2) + '%' }),
    legend: { data: ['错误率'], top: 0, textStyle: { fontSize: 11, color: 'var(--color-text-secondary)' } },
    grid: echartsGrid({ left: 8, right: 20, top: 36, bottom: 24 }),
    xAxis: echartsXAxis(days),
    yAxis: echartsYAxis({ axisLabel: { fontSize: 10, color: 'var(--color-text-tertiary)', formatter: (v) => (v * 100).toFixed(0) + '%' }, min: 0 }),
    series: [
      { ...echartsSmoothLine('错误率', ts?.errorRate || [], '#f43f5e'), areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(244,63,94,0.10)' }, { offset: 1, color: 'rgba(244,63,94,0.01)' }] } } }
    ]
  };
});

const donutStyle = () => ({
  type: 'pie',
  radius: ['50%', '75%'],
  center: ['50%', '52%'],
  padAngle: 2,
  avoidLabelOverlap: false,
  label: { show: false },
  emphasis: { label: { show: true, fontSize: 12 } }
});

const modelPieOption = computed(() => {
  const rows = statsData.value?.distributions?.byModel || [];
  const data = rows.map(r => ({ name: r.name, value: Number(r.tokens || 0) }));
  return {
    tooltip: echartsTooltip({ trigger: 'item' }),
    color: genDonutColors(data.length),
    legend: { type: 'scroll', orient: 'horizontal', left: 'center', bottom: 0, itemGap: 8, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10, color: 'var(--color-text-secondary)' }, pageTextStyle: { color: 'var(--color-text-tertiary)' } },
    series: [{ ...donutStyle(), data }]
  };
});

const protocolPieOption = computed(() => {
  const rows = statsData.value?.distributions?.byClientProtocol || [];
  const data = rows.map(r => ({ name: r.name, value: Number(r.tokens || 0) }));
  return {
    tooltip: echartsTooltip({ trigger: 'item' }),
    color: genDonutColors(data.length),
    legend: { type: 'scroll', orient: 'horizontal', left: 'center', bottom: 0, itemGap: 8, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10, color: 'var(--color-text-secondary)' }, pageTextStyle: { color: 'var(--color-text-tertiary)' } },
    series: [{ ...donutStyle(), data }]
  };
});

const streamPieOption = computed(() => {
  const rows = statsData.value?.distributions?.byStreamType || [];
  const data = rows.map(r => ({ name: r.name, value: Number(r.tokens || 0) }));
  return {
    tooltip: echartsTooltip({ trigger: 'item' }),
    color: genDonutColors(data.length),
    legend: { type: 'scroll', orient: 'horizontal', left: 'center', bottom: 0, itemGap: 8, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10, color: 'var(--color-text-secondary)' }, pageTextStyle: { color: 'var(--color-text-tertiary)' } },
    series: [{ ...donutStyle(), data }]
  };
});

const errorCategoryPieOption = computed(() => {
  const rows = statsData.value?.distributions?.byErrorCategory || [];
  const data = rows.map(r => ({ name: r.name, value: Number(r.requests || 0) }));
  return {
    tooltip: echartsTooltip({ trigger: 'item' }),
    color: genDonutColors(data.length),
    legend: { type: 'scroll', orient: 'horizontal', left: 'center', bottom: 0, itemGap: 8, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10, color: 'var(--color-text-secondary)' }, pageTextStyle: { color: 'var(--color-text-tertiary)' } },
    series: [{ ...donutStyle(), data }]
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
  await fetchAppSettings();
  await fetchLogs();
  fetchDeletedProviders().catch(() => {});
  fetchDeletedKeys().catch(() => {});
  if (activeTab.value === 'stats') {
    await fetchStats();
  }
  if (activeTab.value === 'notifications') {
    await fetchNotificationConfigs();
    await fetchNotifLogs(1);
  }
  if (providerViewMode.value === 'usage') {
    await fetchProviderUsage();
  }
  if (appViewMode.value === 'usage' && activeTab.value === 'keys') {
    await fetchAppUsage();
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
      logRetentionDays: Math.max(0, Number(res.data.logRetentionDays) || 60),
      statsRetentionDays: res.data.statsRetentionDays === 0 || res.data.statsRetentionDays === '0' ? 0 : Math.max(31, Number(res.data.statsRetentionDays) || 180),
      upstreamTimeoutSeconds: Math.max(5, Math.min(86400, Number(res.data.upstreamTimeoutSeconds) || 360)),
      upstreamHeadersBlocklist: res.data.upstreamHeadersBlocklist || ['host', 'content-length', 'connection', 'accept-encoding'],
      notificationCooldownSeconds: Math.max(1, Math.min(300, Number(res.data.notificationCooldownSeconds) || 5)),
      notificationLogRetentionDays: Math.max(0, Math.min(365, Number(res.data.notificationLogRetentionDays) || 7)),
      notificationToolUseTimeoutSeconds: Math.max(1, Math.min(600, Number(res.data.notificationToolUseTimeoutSeconds) || 10)),
      notificationMuteEnabled: !!(res.data.notificationMute?.enabled),
      notificationMuteStart: res.data.notificationMute?.start || '00:00',
      notificationMuteEnd: res.data.notificationMute?.end || '00:00',
      timezone: res.data.adminTimezone || 'Asia/Shanghai'
    };
  } catch (e) {
    console.error('fetchAppSettings', e);
  }
};

const saveAppSettings = async () => {
  const sd = Number(appSettings.value.statsRetentionDays);
  if (sd !== 0 && sd < 31) {
    alert('统计数据保留天数必须 ≥ 31 天，或设为 0（永不清除）');
    return;
  }
  appSettingsSaving.value = true;
  try {
    const res = await axios.put(`${API_BASE}/settings`, {
      logRetentionDays: Math.max(0, Number(appSettings.value.logRetentionDays) || 0),
      statsRetentionDays: Math.max(0, Number(appSettings.value.statsRetentionDays) || 0),
      upstreamTimeoutSeconds: Math.max(5, Math.min(86400, Number(appSettings.value.upstreamTimeoutSeconds) || 360)),
      upstreamHeadersBlocklist: appSettings.value.upstreamHeadersBlocklist,
      notificationCooldownSeconds: Math.max(1, Math.min(300, Number(appSettings.value.notificationCooldownSeconds) || 5)),
      notificationLogRetentionDays: Math.max(0, Math.min(365, Number(appSettings.value.notificationLogRetentionDays) || 7)),
      notificationToolUseTimeoutSeconds: Math.max(1, Math.min(600, Number(appSettings.value.notificationToolUseTimeoutSeconds) || 10)),
      notificationMute: {
        enabled: !!appSettings.value.notificationMuteEnabled,
        start: appSettings.value.notificationMuteStart || '00:00',
        end: appSettings.value.notificationMuteEnd || '00:00'
      },
      timezone: appSettings.value.timezone
    });
    appSettings.value.logRetentionDays = res.data.logRetentionDays;
    appSettings.value.statsRetentionDays = res.data.statsRetentionDays;
    appSettings.value.upstreamTimeoutSeconds = res.data.upstreamTimeoutSeconds;
    appSettings.value.upstreamHeadersBlocklist = res.data.upstreamHeadersBlocklist;
    appSettings.value.notificationCooldownSeconds = res.data.notificationCooldownSeconds;
    appSettings.value.notificationLogRetentionDays = res.data.notificationLogRetentionDays;
    appSettings.value.notificationToolUseTimeoutSeconds = res.data.notificationToolUseTimeoutSeconds;
    appSettings.value.notificationMuteEnabled = !!(res.data.notificationMute?.enabled);
    appSettings.value.notificationMuteStart = res.data.notificationMute?.start || '00:00';
    appSettings.value.notificationMuteEnd = res.data.notificationMute?.end || '00:00';
    appSettings.value.timezone = res.data.adminTimezone || 'Asia/Shanghai';
    alert('已保存');
  } catch (e) {
    alert('保存失败: ' + (e.response?.data?.error || e.message));
  } finally {
    appSettingsSaving.value = false;
  }
};

const saveMuteSettings = async () => {
  appSettingsSaving.value = true;
  try {
    const res = await axios.put(`${API_BASE}/settings`, {
      notificationMute: {
        enabled: !!appSettings.value.notificationMuteEnabled,
        start: appSettings.value.notificationMuteStart || '00:00',
        end: appSettings.value.notificationMuteEnd || '00:00'
      }
    });
    appSettings.value.notificationMuteEnabled = !!(res.data.notificationMute?.enabled);
    appSettings.value.notificationMuteStart = res.data.notificationMute?.start || '00:00';
    appSettings.value.notificationMuteEnd = res.data.notificationMute?.end || '00:00';
    muteEditing.value = false;
    muteSavedToast.value = true;
    setTimeout(() => { muteSavedToast.value = false; }, 3000);
  } catch (e) {
    alert('保存失败: ' + (e.response?.data?.error || e.message));
  } finally {
    appSettingsSaving.value = false;
  }
};

const cancelMuteSettings = async () => {
  muteEditing.value = false;
  await fetchAppSettings();
};

const fetchNotificationConfigs = async () => {
  try {
    const res = await axios.get(`${API_BASE}/notification-configs`);
    notificationConfigs.value = res.data;
  } catch (e) {
    console.error('fetchNotificationConfigs', e);
  }
};

const openNotifEditor = (config) => {
  notifConfigSaving.value = false;
  if (config) {
    editingNotifConfig.value = config.id;
    let headersObj = {};
    if (typeof config.headers === 'string') {
      try { headersObj = JSON.parse(config.headers); } catch {}
    } else if (typeof config.headers === 'object' && config.headers !== null) {
      headersObj = config.headers;
    }
    const headersArr = Object.entries(headersObj).map(([k, v]) => ({ key: k, value: String(v) }));
    notifConfigForm.value = {
      clientKeyIds: Array.isArray(config.clientKeyIds) ? [...config.clientKeyIds] : (config.clientKeyId ? [config.clientKeyId] : []),
      name: config.name || '',
      enabled: !!config.enabled,
      webhookUrl: config.webhookUrl || '',
      httpMethod: config.httpMethod || 'POST',
      headers: headersArr.length > 0 ? headersArr : [{ key: '', value: '' }],
      bodyTemplate: config.bodyTemplate || '',
      cooldownSeconds: config.cooldownSeconds || 5,
      notificationType: config.notificationType || 'completion',
      toolUseTimeoutSeconds: config.toolUseTimeoutSeconds || 10
    };
  } else {
    editingNotifConfig.value = null;
    notifConfigForm.value = { clientKeyIds: [], name: '', notificationType: 'completion', enabled: true, webhookUrl: '', httpMethod: 'POST', headers: [], bodyTemplate: '', cooldownSeconds: 5, toolUseTimeoutSeconds: 10, errorSuppressSeconds: 60 };
  }
};

const cancelNotifEditor = () => {
  editingNotifConfig.value = undefined;
  notifConfigForm.value = { clientKeyIds: [], enabled: true, webhookUrl: '', httpMethod: 'POST', headers: [], bodyTemplate: '', cooldownSeconds: 5 };
};

const addNotifHeader = () => {
  notifConfigForm.value.headers.push({ key: '', value: '' });
};

const removeNotifHeader = (index) => {
  notifConfigForm.value.headers.splice(index, 1);
};

const toggleNotifKey = (id) => {
  const idx = notifConfigForm.value.clientKeyIds.indexOf(id);
  if (idx >= 0) notifConfigForm.value.clientKeyIds.splice(idx, 1);
  else notifConfigForm.value.clientKeyIds.push(id);
};

const cleanHeaderValue = (v) => {
  let s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
};

const saveNotifConfig = async () => {
  if (!notifConfigForm.value.name.trim()) {
    alert('请输入规则名称');
    return;
  }
  if (notifConfigForm.value.bodyTemplate.trim()) {
    try { JSON.parse(notifConfigForm.value.bodyTemplate); } catch {
      alert('通知体模板 JSON 格式错误，请检查后重试');
      return;
    }
  }
  notifConfigSaving.value = true;
  try {
    let headersObj = {};
    for (const h of notifConfigForm.value.headers) {
      const k = cleanHeaderValue(h.key);
      if (k) headersObj[k] = cleanHeaderValue(h.value);
    }
    
    const payload = {
      clientKeyIds: notifConfigForm.value.clientKeyIds,
      name: notifConfigForm.value.name,
      notificationType: notifConfigForm.value.notificationType,
      enabled: notifConfigForm.value.enabled,
      webhookUrl: notifConfigForm.value.webhookUrl,
      httpMethod: notifConfigForm.value.httpMethod,
      headers: headersObj,
      bodyTemplate: notifConfigForm.value.bodyTemplate,
      cooldownSeconds: Number(notifConfigForm.value.cooldownSeconds) || 5,
      toolUseTimeoutSeconds: Number(notifConfigForm.value.toolUseTimeoutSeconds) || 10,
      errorSuppressSeconds: Number(notifConfigForm.value.errorSuppressSeconds) || 60
    };

    if (editingNotifConfig.value) {
      await axios.put(`${API_BASE}/notification-configs/${editingNotifConfig.value}`, payload);
    } else {
      await axios.post(`${API_BASE}/notification-configs`, payload);
    }
    await fetchNotificationConfigs();
    cancelNotifEditor();
  } catch (e) {
    alert('保存失败: ' + (e.response?.data?.error || e.message));
  } finally {
    notifConfigSaving.value = false;
  }
};

const deleteNotifConfig = async (id) => {
  if (!confirm('确定删除此通知配置？')) return;
  try {
    await axios.delete(`${API_BASE}/notification-configs/${id}`);
    await fetchNotificationConfigs();
  } catch (e) {
    alert('删除失败: ' + (e.response?.data?.error || e.message));
  }
};

const toggleNotifEnabled = async (cfg) => {
  cfg.enabled = !cfg.enabled;
  try {
    await axios.put(`${API_BASE}/notification-configs/${cfg.id}`, { enabled: cfg.enabled });
  } catch (e) {
    cfg.enabled = !cfg.enabled;
    alert('操作失败: ' + (e.response?.data?.error || e.message));
  }
};

const fetchNotifLogs = async (page = 1) => {
  try {
    const params = { page, pageSize: notifLogsPageSize.value };
    if (notifLogsFilter.value.clientKeyId !== 'all') params.clientKeyId = notifLogsFilter.value.clientKeyId;
    if (notifLogsFilter.value.status !== 'all') params.status = notifLogsFilter.value.status;
    const res = await axios.get(`${API_BASE}/notification-logs`, { params });
    notifLogs.value = res.data.rows;
    notifLogsTotal.value = res.data.total;
    notifLogsPage.value = res.data.page;
  } catch (e) {
    console.error('fetchNotifLogs', e);
  }
};

const clearNotifLogs = async () => {
  if (!confirm('确定清空所有推送日志？此操作不可恢复。')) return;
  try {
    await axios.delete(`${API_BASE}/notification-logs`);
    notifLogsPage.value = 1;
    await fetchNotifLogs(1);
  } catch (e) {
    alert('清空失败: ' + (e.response?.data?.error || e.message));
  }
};

const openNotifLogDetail = async (log) => {
  notifLogDetailLoading.value = true;
  notifLogDetailError.value = '';
  try {
    const res = await axios.get(`${API_BASE}/notification-logs/${log.id}`);
    selectedNotifLog.value = res.data;
  } catch (e) {
    notifLogDetailError.value = e.response?.data?.error || e.message || '加载失败';
    selectedNotifLog.value = null;
  } finally {
    notifLogDetailLoading.value = false;
  }
};

const closeNotifLogDetail = () => {
  selectedNotifLog.value = null;
  notifLogDetailError.value = '';
  notifLogDetailLoading.value = false;
};

const getKeyColor = (keyId) => {
  const key = clientKeys.value.find(k => k.id === keyId);
  return key?.colorRgb || '156, 163, 175';
};

const keyBadgeStyle = (keyId) => {
  const rgb = getKeyColor(keyId);
  return {
    backgroundColor: `rgba(${rgb}, 0.12)`,
    color: `rgb(${rgb})`,
    borderColor: `rgba(${rgb}, 0.28)`,
  };
};

const fetchDeletedKeys = async () => {
  try {
    const res = await axios.get(`${API_BASE}/keys/deleted`);
    deletedKeys.value = res.data;
  } catch (e) {
    console.error('fetchDeletedKeys', e);
  }
};

const restoreKey = async (id) => {
  await axios.post(`${API_BASE}/keys/${id}/restore`);
  fetchDeletedKeys();
  fetchClientKeys();
};

const permanentDeleteKey = async (id) => {
  if (!confirm('确定要彻底删除此应用吗？此操作不可恢复！')) return;
  await axios.delete(`${API_BASE}/keys/${id}/permanent`);
  fetchDeletedKeys();
  fetchClientKeys();
};

const clearAllStats = async () => {
  if (!confirm('确定清空全部统计数据？此操作不可恢复。')) return;
  try {
    const res = await axios.post(`${API_BASE}/stats/clear`, { range: statsRange.value });
    alert(`已清空 ${res.data.changes ?? 0} 条统计记录`);
    if (activeTab.value === 'stats') fetchStats();
  } catch (e) {
    alert('清空失败: ' + (e.response?.data?.error || e.message));
  }
};

const exportStats = async () => {
  try {
    const params = { range: statsRange.value, format: 'csv' };
    if (statsProviderId.value !== 'all') params.providerId = statsProviderId.value;
    if (statsIsStream.value !== 'all') params.isStream = statsIsStream.value;
    if (statsClientProtocol.value !== 'all') params.clientProtocol = statsClientProtocol.value;
    const res = await axios.get(`${API_BASE}/stats/export`, { params, responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stats_export.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('导出失败: ' + (e.response?.data?.error || e.message));
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
  showProviderApiKey.value = false;
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
  showCopyApiKey.value = false;
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
  if (!confirm('确定要删除这个应用吗？应用的请求日志会保留，通知配置中会移除此应用。')) return;
  await axios.delete(`${API_BASE}/keys/${id}`);
  fetchClientKeys();
  if (showKeyRecycleBin.value) fetchDeletedKeys();
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
  const providerName = providers.value.find(p => p.id === selectedModelProviderId.value)?.name || '当前厂商';
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
  const tz = appSettings.value?.timezone || 'Asia/Shanghai';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(date);
  }
  const get = (t) => parts.find(p => p.type === t)?.value || '00';
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}.${ms}`;
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

const appViewMode = ref(localStorage.getItem('appViewMode') || 'table');
const appUsageData = ref({});
const appUsageLoading = ref(false);

const persistAppViewMode = () => {
  localStorage.setItem('appViewMode', appViewMode.value);
};

const fetchAppUsage = async () => {
  appUsageLoading.value = true;
  try {
    const res = await axios.get(`${API_BASE}/keys/usage`);
    appUsageData.value = res.data;
  } catch (e) {
    console.error('fetchAppUsage', e);
  } finally {
    appUsageLoading.value = false;
  }
};

const formatTokens = (n) => {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return String(n);
};

const vendorLabel = (v) => {
  const labels = { deepseek: 'DeepSeek', moonshot: 'Moonshot', venice: 'Venice', openai: 'OpenAI', anthropic: 'Anthropic', elevenlabs: 'ElevenLabs', kimik2: 'Kimi K2', groq: 'Groq', deepgram: 'Deepgram' };
  return labels[v] || v || '';
};

const vendorColor = (v) => {
  const colors = { deepseek: 'bg-blue-100 text-accent', moonshot: 'bg-purple-100 text-purple-700', venice: 'bg-cyan-100 text-cyan-700', openai: 'bg-green-100 text-green-700', anthropic: 'bg-orange-100 text-orange-700', elevenlabs: 'bg-pink-100 text-pink-700', kimik2: 'bg-indigo-100 text-indigo-700', groq: 'bg-amber-100 text-amber-700', deepgram: 'bg-teal-100 text-teal-700' };
  return colors[v] || 'bg-surface-elevated text-secondary';
};

const VENDOR_URL_PATTERNS = [
  { pattern: 'api.deepseek.com',  id: 'deepseek' },
  { pattern: 'api.moonshot.ai',   id: 'moonshot' },
  { pattern: 'api.moonshot.cn',   id: 'moonshot' },
  { pattern: 'api.venice.ai',     id: 'venice' },
  { pattern: 'api.openai.com',    id: 'openai' },
  { pattern: 'api.anthropic.com',  id: 'anthropic' },
  { pattern: 'api.elevenlabs.io', id: 'elevenlabs' },
  { pattern: 'kimi-k2.ai',        id: 'kimik2' },
  { pattern: 'api.groq.com',      id: 'groq' },
  { pattern: 'api.deepgram.com',  id: 'deepgram' },
];

const FALLBACK_PALETTE = [
  '#3b82f6', '#ec4899', '#84cc16', '#8b5cf6',
  '#f59e0b', '#06b6d4', '#f97316', '#10b981',
  '#6366f1', '#ef4444', '#14b8a6', '#a855f7',
  '#eab308', '#22d3ee',
];

const vendorAccentColor = (provider) => {
  if (!provider) return '#3b82f6';
  const baseUrl = provider.baseUrl || '';
  for (const vp of VENDOR_URL_PATTERNS) {
    if (baseUrl.includes(vp.pattern)) {
      const c = VENDOR_CHART_COLORS[vp.id]?.[0];
      if (c) return c;
    }
  }
  let hash = 0;
  const s = baseUrl || provider.name || '';
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash) + s.charCodeAt(i);
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
};

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const date = parseDate(dateStr);
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚更新';
  if (mins < 60) return mins + ' 分钟前更新';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' 小时前更新';
  return Math.floor(hrs / 24) + ' 天前更新';
};

const VENDOR_CHART_COLORS = {
  deepseek: ['#3b82f6', '#22c55e'], moonshot: ['#a855f7', '#d946ef'], venice: ['#06b6d4', '#22d3ee'],
  openai: ['#22c55e', '#86efac'], anthropic: ['#f59e0b', '#fbbf24'], elevenlabs: ['#ec4899', '#f472b6'],
  kimik2: ['#6366f1', '#818cf8'], groq: ['#84cc16', '#a3e635'], deepgram: ['#14b8a6', '#2dd4bf']
};

const echartsTooltip = (extra) => ({
  ...extra,
  appendToBody: true,
  backgroundColor: 'var(--color-surface-card)',
  borderColor: 'var(--color-border-default)',
  borderWidth: 1,
  borderRadius: 10,
  padding: [12, 16],
  textStyle: { color: 'var(--color-text-primary)', fontSize: 12 },
  extraCssText: 'box-shadow: var(--shadow-modal);'
});

const echartsGrid = (overrides) => ({
  left: 4, right: 4, top: 6, bottom: 20,
  containLabel: false,
  ...overrides
});

const echartsXAxis = (data, overrides) => ({
  type: 'category',
  data,
  axisLabel: { fontSize: 10, color: 'var(--color-text-tertiary)', margin: 6 },
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { show: false },
  ...overrides
});

const echartsYAxis = (overrides) => ({
  type: 'value',
  axisLabel: { fontSize: 10, color: 'var(--color-text-tertiary)', margin: 6, showMaxLabel: false },
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { show: true, lineStyle: { color: 'var(--color-border-default)', type: [4, 4], dashOffset: 0 } },
  ...overrides
});

const echartsSmoothLine = (name, data, hexColor, opts) => ({
  name,
  type: 'line',
  smooth: 0.4,
  data,
  showSymbol: false,
  symbolSize: 4,
  lineStyle: { width: 2, color: hexColor },
  itemStyle: { color: hexColor },
  ...opts
});

const echartsBar = (name, data, hexColor, opts) => ({
  name,
  type: 'bar',
  data,
  barMaxWidth: 24,
  itemStyle: {
    color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: hexColor }, { offset: 1, color: hexColor + '60' }] },
    borderRadius: [4, 4, 0, 0]
  },
  emphasis: { itemStyle: { color: hexColor } },
  ...opts
});

const usageChartOption = (data) => {
  const days = data?.daily || [];
  const vendor = data?.vendor;
  const c1 = VENDOR_CHART_COLORS[vendor]?.[0] || '#3b82f6';
  const c2 = VENDOR_CHART_COLORS[vendor]?.[1] || '#22c55e';
  const labels = days.map(d => d.date.slice(5));
  return {
    tooltip: echartsTooltip({
      trigger: 'axis',
      formatter: (params) => {
        const date = params[0]?.axisValue || '';
        const totalTokens = params.reduce((s, p) => s + p.value, 0);
        let s = `<div style="font-weight:600;margin-bottom:6px;color:var(--color-text-primary)">${date}</div>`;
        for (const p of params) {
          s += `<div style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span><span style="color:var(--color-text-tertiary);flex:1">${p.seriesName}</span><span style="font-weight:600;color:var(--color-text-primary)">${formatTokens(p.value)}</span></div>`;
        }
        s += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--color-border-default);font-weight:600;color:var(--color-text-primary)">${formatTokens(totalTokens)} tokens</div>`;
        return s;
      }
    }),
    grid: echartsGrid({ bottom: 24 }),
    xAxis: echartsXAxis(labels),
    yAxis: echartsYAxis({ show: false }),
    series: [
      echartsBar('输入', days.map(d => d.tokensIn), c1, { stack: 'total' }),
      echartsBar('输出', days.map(d => d.tokensOut), c2, { stack: 'total' })
    ]
  };
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
  if (tab === 'keys') {
    if (isAuthenticated.value && appViewMode.value === 'usage') fetchAppUsage();
  }
  if (tab === 'config') {
    if (isAuthenticated.value) {
      fetchAdminUsers();
      fetchAppSettings();
    }
  }
  if (tab === 'notifications') {
    if (isAuthenticated.value) {
      fetchAppSettings();
      fetchNotificationConfigs();
      fetchNotifLogs(1);
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

watch(statsIsStream, () => {
  if (activeTab.value === 'stats') {
    if (isAuthenticated.value) fetchStats();
  }
});

watch(statsClientProtocol, () => {
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
  <div v-if="!isAuthenticated" class="min-h-screen bg-surface-primary relative flex items-center justify-center p-6">
    <div class="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      <div class="grid-bg absolute inset-0"></div>
      <div class="absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full" style="background:radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 70%);filter:blur(40px)"></div>
      <div class="absolute -bottom-60 -right-20 h-[500px] w-[500px] rounded-full" style="background:radial-gradient(circle, rgba(139,92,246,0.04) 0%, transparent 70%);filter:blur(60px)"></div>
    </div>
    <div class="w-full max-w-md glow-card p-8 relative z-10">
      <div class="flex items-center gap-3 mb-6">
        <div class="flex h-9 w-9 items-center justify-center rounded-btn accent-soft0/12 ring-1 ring-blue-500/25">
          <Settings class="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 class="text-lg font-bold" style="color:var(--color-text-primary)">llmPylon Admin</h1>
          <p class="text-[11px]" style="color:var(--color-text-tertiary)">登录后才能进行管理操作</p>
        </div>
      </div>
      <div class="space-y-4">
        <div>
          <label class="block text-[11px] font-semibold uppercase tracking-wide mb-1.5" style="color:var(--color-text-tertiary)">用户名</label>
          <input v-model="loginForm.username" type="text" class="w-full px-4 py-2.5 rounded-btn text-sm outline-none transition-colors" style="background-color:var(--color-surface-input);border:1px solid var(--color-border-default);color:var(--color-text-primary)" placeholder="llmpylon" />
        </div>
        <div>
          <label class="block text-[11px] font-semibold uppercase tracking-wide mb-1.5" style="color:var(--color-text-tertiary)">密码</label>
          <input v-model="loginForm.password" type="password" class="w-full px-4 py-2.5 rounded-btn text-sm outline-none transition-colors" style="background-color:var(--color-surface-input);border:1px solid var(--color-border-default);color:var(--color-text-primary)" placeholder="••••••••" />
        </div>
      </div>
      <button @click="login" class="w-full mt-6 px-4 py-2.5 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-semibold text-sm">
        登录
      </button>
      <p class="text-[11px] mt-4" style="color:var(--color-text-tertiary)">默认用户/密码：llmpylon / llmpylon（首次登录必须修改密码）</p>
      <p v-if="serverVersion" class="text-center text-[11px] font-mono mt-2" style="color:var(--color-text-tertiary)">v{{ serverVersion }}</p>
    </div>
  </div>

  <div v-else class="relative flex h-screen bg-surface-primary overflow-hidden" style="color:var(--color-text-primary)">
    <div class="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      <div class="grid-bg absolute inset-0"></div>
      <div class="absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full" style="background:radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 70%);filter:blur(40px)"></div>
      <div class="absolute -bottom-60 -right-20 h-[500px] w-[500px] rounded-full" style="background:radial-gradient(circle, rgba(139,92,246,0.04) 0%, transparent 70%);filter:blur(60px)"></div>
    </div>
    <div
      v-if="mobileMenuOpen"
      @click="mobileMenuOpen = false"
      class="modal-overlay lg:hidden"
    ></div>
    <!-- Sidebar -->
    <div
      :class="[
        'w-64 flex flex-col fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:static lg:translate-x-0 backdrop-blur-md',
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      ]"
      style="background-color:var(--color-surface-sidebar);border-right:1px solid var(--color-border-default)"
    >
      <div class="flex h-14 items-center justify-between px-4" style="border-bottom:1px solid var(--color-border-default)">
        <div class="flex items-center gap-2.5">
          <div class="flex h-7 w-7 items-center justify-center rounded-btn accent-soft0/12 ring-1 ring-blue-500/25">
            <Settings class="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <p class="text-sm font-semibold leading-tight" style="color:var(--color-text-primary)">llmPylon Admin</p>
            <p class="text-[10px]" style="color:var(--color-text-tertiary)">{{ $t('nav.subtitle') }}</p>
          </div>
        </div>
        <span v-if="serverVersion" class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold font-mono" style="background-color:var(--color-accent-soft);color:#60a5fa;border:1px solid rgba(59,130,246,0.2)">v{{ serverVersion }}</span>
      </div>
      <nav class="flex-1 overflow-y-auto p-3" style="min-height:0">
        <p class="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider" style="color:var(--color-text-tertiary)">{{ $t('nav.manage') }}</p>
        <button 
          @click="activeTab = 'providers'"
          :class="['nav-item', activeTab === 'providers' ? 'active' : '']"
        >
          <Settings class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.providers') }}</span>
          <span
            v-if="activeProvider"
            class="ml-auto max-w-[130px] px-1.5 py-0.5 rounded text-[9px] leading-none font-semibold font-mono truncate"
            :title="activeProvider.name"
            style="background-color:var(--color-accent-soft);color:#60a5fa;border:1px solid rgba(59,130,246,0.15)"
          >
            {{ activeProvider.name }}
          </span>
        </button>
        <button 
          @click="activeTab = 'keys'"
          :class="['nav-item', activeTab === 'keys' ? 'active' : '']"
        >
          <LayoutGrid class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.keys') }}</span>
        </button>
        <button 
          @click="activeTab = 'models'"
          :class="['nav-item', activeTab === 'models' ? 'active' : '']"
        >
          <Cpu class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.models') }}</span>
          <span
            v-if="activeDefaultModel"
            class="ml-auto max-w-[130px] px-1.5 py-0.5 rounded text-[9px] leading-none font-semibold font-mono truncate"
            :title="activeDefaultModel.name"
            style="background-color:var(--color-accent-soft);color:#60a5fa;border:1px solid rgba(59,130,246,0.15)"
          >
            {{ activeDefaultModel.name }}
          </span>
          <span
            v-else
            class="ml-auto max-w-[130px] px-1.5 py-0.5 rounded text-[9px] leading-none font-semibold font-mono truncate"
            style="background-color:var(--color-surface-elevated);color:var(--color-text-tertiary);border:1px solid var(--color-border-default)"
          >
            {{ $t('nav.notSet') }}
          </span>
        </button>
        <button 
          @click="activeTab = 'modelRules'"
          :class="['nav-item', activeTab === 'modelRules' ? 'active' : '']"
        >
          <ArrowRightLeft class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.modelRules') }}</span>
          <span
            v-if="enabledModelRulesCount"
            class="ml-auto max-w-[130px] px-1.5 py-0.5 rounded text-[9px] leading-none font-semibold font-mono truncate"
            style="background-color:var(--color-accent-soft);color:#60a5fa;border:1px solid rgba(59,130,246,0.15)"
          >
            {{ $t('nav.enabled') }} {{ enabledModelRulesCount }}
          </span>
        </button>
        <button 
          @click="activeTab = 'logs'"
          :class="['nav-item', activeTab === 'logs' ? 'active' : '']"
        >
          <History class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.logs') }}</span>
        </button>
        <button 
          @click="activeTab = 'stats'"
          :class="['nav-item', activeTab === 'stats' ? 'active' : '']"
        >
          <BarChart3 class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.stats') }}</span>
        </button>
        <button
          @click="activeTab = 'config'"
          :class="['nav-item', activeTab === 'config' ? 'active' : '']"
        >
          <Settings class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.config') }}</span>
        </button>
        <button
          @click="activeTab = 'notifications'"
          :class="['nav-item', activeTab === 'notifications' ? 'active' : '']"
        >
          <Bell class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.notifications') }}</span>
        </button>
        <button
          @click="activeTab = 'users'"
          :class="['nav-item', activeTab === 'users' ? 'active' : '']"
        >
          <User class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.users') }}</span>
        </button>
        <button 
          @click="activeTab = 'help'"
          :class="['nav-item', activeTab === 'help' ? 'active' : '']"
        >
          <BookOpen class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-left whitespace-nowrap">{{ $t('nav.help') }}</span>
        </button>
      </nav>
      <div class="flex flex-col gap-1 p-3" style="border-top:1px solid var(--color-border-default)">
        <button @click="toggleTheme" class="nav-item justify-between" :title="isDark ? '切换白天模式' : '切换夜晚模式'">
          <span class="flex items-center gap-2.5">
            <svg v-if="isDark" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 text-yellow-400"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            <span style="color:var(--color-text-secondary)">{{ isDark ? (currentLang === 'zh' ? '夜晚模式' : 'Night') : (currentLang === 'zh' ? '白天模式' : 'Day') }}</span>
          </span>
          <div class="flex h-5 w-9 items-center rounded-full px-0.5 transition-all duration-300" :style="{ backgroundColor: isDark ? 'rgba(59,130,246,0.3)' : 'rgba(234,179,8,0.3)', justifyContent: isDark ? 'flex-end' : 'flex-start' }">
            <div class="h-4 w-4 rounded-full bg-white shadow-sm" />
          </div>
        </button>
        <button @click="toggleLang" class="nav-item justify-between" :title="currentLang === 'zh' ? 'Switch to English' : '切换为中文'">
          <span class="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
            <span>{{ currentLang === 'zh' ? '中文' : 'English' }}</span>
          </span>
          <span class="num rounded border px-1.5 py-0.5 text-[11px]" style="border-color:var(--color-border-default);color:var(--color-text-tertiary)">{{ currentLang === 'zh' ? 'EN' : '中' }}</span>
        </button>
        <div class="flex items-center gap-2 px-3 py-1">
          <span
            :class="[
              'w-2.5 h-2.5 rounded-full',
              proxyHealth.status === 'up' ? 'bg-green-500' : (proxyHealth.status === 'down' ? 'bg-red-500' : 'bg-gray-300')
            ]"
          ></span>
          <span class="text-[11px] font-semibold" style="color:var(--color-text-secondary)">
            {{ proxyHealth.status === 'up' ? $t('nav.proxyUp') : (proxyHealth.status === 'down' ? $t('nav.proxyDown') : $t('nav.proxyChecking')) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <header class="sticky top-0 z-20 flex h-14 items-center justify-between px-4 md:px-6 backdrop-blur-md" style="background-color:var(--color-surface-overlay);border-bottom:1px solid var(--color-border-default)">
        <div class="flex items-center gap-3 min-w-0">
          <button
            @click="mobileMenuOpen = true"
            class="flex h-8 w-8 items-center justify-center rounded-btn transition-colors hover:bg-black/5 lg:hidden"
            style="color:var(--color-text-secondary)"
          >
            <Menu class="w-5 h-5" />
          </button>
          <h2 class="text-sm font-semibold truncate" style="color:var(--color-text-primary)">{{ activeTab === 'providers' ? '厂商配置' : (activeTab === 'keys' ? '应用管理' : (activeTab === 'models' ? '模型管理' : (activeTab === 'modelRules' ? '模型规则' : (activeTab === 'stats' ? '统计' : (activeTab === 'config' ? '配置管理' : (activeTab === 'notifications' ? '通知管理' : (activeTab === 'users' ? '用户管理' : (activeTab === 'help' ? '客户端帮助' : '对话历史')))))))) }}</h2>
        </div>
        <div class="flex items-center gap-3">
          <span v-if="serverVersion" class="hidden sm:inline text-[10px] font-mono tabular-nums" style="color:var(--color-text-tertiary)">v{{ serverVersion }}</span>
          <span class="hidden sm:inline text-xs font-semibold" style="color:var(--color-text-secondary)">{{ authUser?.username }}</span>
          <button @click="logout" class="px-3 py-1.5 text-xs font-semibold rounded-btn transition-colors whitespace-nowrap" style="border:1px solid var(--color-border-default);color:var(--color-text-secondary);background:transparent">
            退出登录
          </button>
        </div>
      </header>

      <main class="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
        <div v-if="activeTab === 'help'" class="space-y-6">
          <div class="glow-card p-8">
            <h3 class="text-lg font-bold mb-3" style="color:var(--color-text-primary)">客户端设置</h3>
            <div class="rounded-card p-5 mt-4" style="background-color:var(--color-surface-elevated);border:1px solid var(--color-border-default)">
              <div class="space-y-3">
                <div class="flex items-center gap-2">
                  <span class="badge-sm" style="background-color:rgba(139,92,246,0.10);color:#7c3aed;border:1px solid rgba(139,92,246,0.18)">Base URL</span>
                  <code class="text-xs font-mono break-all" style="color:var(--color-text-secondary)">http://你的服务器IP:3000/proxy</code>
                </div>
                <div class="text-xs ml-1" style="color:var(--color-text-tertiary)">
                  不同客户端需使用不同的请求路径：OpenAI 客户端使用 <code class="text-[10px] font-mono">/proxy/v1/chat/completions</code>，Anthropic 客户端使用 <code class="text-[10px] font-mono">/proxy/v1/messages</code>
                </div>
                <div class="flex items-center gap-2">
                  <span class="badge-sm" style="background-color:rgba(139,92,246,0.10);color:#7c3aed;border:1px solid rgba(139,92,246,0.18)">API Key</span>
                  <code class="text-xs font-mono break-all" style="color:var(--color-text-secondary)">在应用管理中创建应用，复制生成的 key</code>
                </div>
                <div class="flex items-center gap-2">
                  <span class="badge-sm" style="background-color:rgba(139,92,246,0.10);color:#7c3aed;border:1px solid rgba(139,92,246,0.18)">Model</span>
                  <code class="text-xs font-mono break-all" style="color:var(--color-text-secondary)">建议设置为 {{ MAGIC_PROXY_MODEL }}（大小写不敏感），自动解析为绑定的默认模型</code>
                </div>
              </div>
            </div>
          </div>

          <div class="glow-card p-8">
            <h3 class="text-lg font-bold mb-3" style="color:var(--color-text-primary)">使用方法</h3>
            <div class="space-y-3 text-sm" style="color:var(--color-text-secondary)">
              <div class="rounded-card p-5" style="background-color:var(--color-surface-elevated);border:1px solid var(--color-border-default)">
                <p class="text-xs font-semibold mb-1" style="color:var(--color-text-secondary)">切换厂商和默认模型</p>
                <p>在"厂商管理"中点击厂商卡片即可切换生效厂商；在"模型管理"中选择厂商后点击模型卡片设置该厂商的默认模型。客户端使用 {{ MAGIC_PROXY_MODEL }} 作为 model 时会根据优先级自动路由：App 绑定模型 &gt; 厂商默认模型 &gt; 全局默认模型。</p>
              </div>
              <div class="rounded-card p-5" style="background-color:var(--color-surface-elevated);border:1px solid var(--color-border-default)">
                <p class="text-xs font-semibold mb-1" style="color:var(--color-text-secondary)">创建应用并绑定模型</p>
                <p>在"应用管理"中创建应用获得客户端 Key。可为每个应用单独绑定厂商和模型，绑定后不受全局切换影响。每个应用自动分配独立颜色，在对话日志中一目了然。</p>
              </div>
              <div class="rounded-card p-5" style="background-color:var(--color-surface-elevated);border:1px solid var(--color-border-default)">
                <p class="text-xs font-semibold mb-1" style="color:var(--color-text-secondary)">模型规则强制映射</p>
                <p>在"模型规则"中添加规则（支持 * 通配符，大小写敏感），请求的 model 字段命中规则后自动替换为目标模型。</p>
              </div>
              <div class="rounded-card p-5" style="background-color:var(--color-surface-elevated);border:1px solid var(--color-border-default)">
                <p class="text-xs font-semibold mb-1" style="color:var(--color-text-secondary)">开启协议转换</p>
                <p>编辑厂商，打开"协议强制转换"开关，支持 OpenAI ↔ Anthropic 双向转换。例如：OpenAI 厂商开启后，客户端使用 <code>/proxy/v1/messages</code> 访问；Anthropic 厂商开启后，客户端使用 <code>/proxy/v1/chat/completions</code> 访问。</p>
              </div>
              <div class="rounded-card p-5" style="background-color:var(--color-surface-elevated);border:1px solid var(--color-border-default)">
                <p class="text-xs font-semibold mb-1" style="color:var(--color-text-secondary)">删除/恢复厂商和应用</p>
                <p>删除时移入回收站（可恢复），在厂商管理或应用管理页点击"回收站"进入。可恢复或彻底删除。彻底删除前会清理关联配置和日志。</p>
              </div>
              <div class="rounded-card p-5" style="background-color:var(--color-surface-elevated);border:1px solid var(--color-border-default)">
                <p class="text-xs font-semibold mb-1" style="color:var(--color-text-secondary)">消息通知</p>
                <p>在"通知管理"中为 App 配置 webhook。一轮对话完成后自动发送 HTTP 通知到指定 URL。支持自定义请求方法、Headers、JSON 模板、客户端类型过滤，还可设置对话结束等待时间避免频繁通知。</p>
              </div>
              <div class="rounded-card border border-primary bg-surface-elevated p-5">
                <p class="text-xs font-bold text-secondary mb-1">统计面板与配置管理</p>
                <p>"统计"页提供请求趋势图、模型分布饼图、活动热力图、延迟 P50/P90/P99 百分位、Top 慢/错请求。"配置管理"页可设置日志/统计保留天数、上游 HTTP 超时、请求头过滤黑名单。</p>
              </div>
              <div class="rounded-card border border-primary bg-surface-elevated p-5">
                <p class="text-xs font-bold text-secondary mb-1">备份配置</p>
                <p>厂商管理页可导出/导入单个厂商。配置管理页可导出/导入全局配置（含厂商、模型、应用、规则、回收站内容）。</p>
              </div>
            </div>
          </div>

          <div class="glow-card p-8">
            <h3 class="text-lg font-bold text-primary mb-2">排查问题</h3>
            <div class="space-y-3 text-sm text-secondary">
              <div class="rounded-card border border-primary bg-surface-elevated p-5">
                <p class="text-xs font-bold text-secondary mb-1">模型路由不符合预期</p>
                <p>进入"对话日志"，查看请求的 <span class="font-mono text-xs">model → actualModel</span> 和目标 URL，确认模型规则和应用绑定是否正确。</p>
              </div>
              <div class="rounded-card border border-primary bg-surface-elevated p-5">
                <p class="text-xs font-bold text-secondary mb-1">协议错误</p>
                <p>日志状态显示"协议错误"时，检查厂商的协议转换开关与客户端使用的 endpoint 是否匹配：转换开启时使用非原生协议，关闭时使用原生协议。</p>
              </div>
              <div class="rounded-card border border-primary bg-surface-elevated p-5">
                <p class="text-xs font-bold text-secondary mb-1">流中断</p>
                <p>日志状态显示"流中断"时，可能是上游响应异常或网络波动。代理内置流式重试机制（可配置重试次数和超时时间）。展开对话日志详情可查看原始上游响应和转换后响应。</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Providers View -->
        <div v-if="activeTab === 'providers'" class="space-y-6">
          <div class="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:justify-between sm:items-center">
            <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">{{ showRecycleBin ? '回收站' : '当前已添加的厂商' }}</h3>
            <div class="flex flex-wrap gap-2">
              <template v-if="!showRecycleBin">
                <button
                  @click="openExportDialog"
                  class="flex items-center gap-2 px-4 py-2 bg-surface-elevated text-secondary rounded-btn hover:bg-surface-elevated transition-colors text-sm border border-primary"
                >
                  <Download class="w-4 h-4" />
                  导出
                </button>
                <button
                  @click="openImportDialog"
                  class="flex items-center gap-2 px-4 py-2 bg-surface-elevated text-secondary rounded-btn hover:bg-surface-elevated transition-colors text-sm border border-primary"
                >
                  <Upload class="w-4 h-4" />
                  导入
                </button>
                <button
                  @click="showAddProvider = true; showProviderApiKey = false; if (selectedLog) closeLogDetail()"
                class="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors text-sm"
              >
                <Plus class="w-4 h-4" />
                添加厂商
                </button>
                <button
                  @click="showRecycleBin = true; fetchDeletedProviders()"
                  class="flex items-center gap-2 px-4 py-2 bg-surface-elevated text-secondary rounded-btn hover:bg-surface-elevated transition-colors text-sm border border-primary"
                >
                  <Trash2 class="w-4 h-4" />
                  回收站
                  <span v-if="deletedProviders.length" class="px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold">{{ deletedProviders.length }}</span>
                </button>
              </template>
              <button
                v-else
                @click="showRecycleBin = false"
                class="flex items-center gap-2 px-4 py-2 bg-surface-elevated text-secondary rounded-btn hover:bg-surface-elevated transition-colors text-sm border border-primary"
              >
                厂商列表
              </button>
            </div>
          </div>

          <!-- Sort & view controls -->
          <div v-if="!showRecycleBin" class="flex flex-wrap items-center gap-2">
            <select v-model="providerSortBy" @change="persistViewMode()" class="text-xs px-3 py-1.5 border border-primary rounded-btn bg-white text-secondary outline-none">
              <option value="custom">自定义排序</option>
              <option value="name">按名称</option>
              <option value="createdAt">按创建时间</option>
            </select>
            <button @click="providerSortOrder = providerSortOrder === 'asc' ? 'desc' : 'asc'; persistViewMode()" class="p-1.5 text-secondary hover:bg-surface-elevated rounded-btn transition-colors" :title="providerSortOrder === 'asc' ? '升序' : '降序'">
              <ArrowUpDown class="w-4 h-4" :class="providerSortOrder === 'desc' ? 'rotate-180' : ''" />
            </button>
            <div class="flex ml-auto gap-1 bg-surface-elevated rounded-btn p-0.5">
              <button @click="providerViewMode = 'grid'; persistViewMode()" class="p-1.5 rounded-md transition-colors" :class="providerViewMode === 'grid' ? 'bg-white shadow text-accent' : 'text-tertiary hover:text-secondary'" title="网格视图">
                <LayoutGrid class="w-4 h-4" />
              </button>
              <button @click="providerViewMode = 'list'; persistViewMode()" class="p-1.5 rounded-md transition-colors" :class="providerViewMode === 'list' ? 'bg-white shadow text-accent' : 'text-tertiary hover:text-secondary'" title="列表视图">
                <List class="w-4 h-4" />
              </button>
              <button @click="providerViewMode = 'usage'; persistViewMode(); fetchProviderUsage()" class="p-1.5 rounded-md transition-colors" :class="providerViewMode === 'usage' ? 'bg-white shadow text-accent' : 'text-tertiary hover:text-secondary'" title="用量视图">
                <BarChart3 class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Grid view -->
          <div v-if="!showRecycleBin && providerViewMode === 'grid'" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div 
              v-for="(p, idx) in sortedProviders" 
              :key="p.id"
              @click="!p.active && activateProvider(p.id)"
              :draggable="providerSortBy === 'custom'"
              @dragstart="onProviderDragStart($event, idx)"
              @dragend="onProviderDragEnd"
              @dragover="onProviderDragOver"
              @drop="onProviderDrop($event, idx)"
              class="glow-card p-6 hover:shadow-md transition-shadow relative overflow-hidden cursor-pointer"
              :class="{'border-blue-500 ring-1 ring-blue-500': p.active, 'opacity-50': providerDragIndex === idx}"
            >
              <div class="h-[2px] absolute top-0 left-0 right-0" :style="{ background: `linear-gradient(90deg, ${vendorAccentColor(p)}80, transparent 60%)` }" />
              <div v-if="providerSortBy === 'custom'" class="absolute top-2 left-2 text-tertiary cursor-grab active:cursor-grabbing">
                <GripVertical class="w-4 h-4" />
              </div>
              <div v-if="p.active" class="absolute top-0 right-0 bg-accent text-white px-2 py-1 text-[10px] font-bold rounded-bl-lg flex items-center gap-1">
                <Check class="w-3 h-3" /> 生效中
              </div>
              
              <div class="flex justify-between items-start mb-4">
                <div>
                  <h4 class="font-bold text-lg">{{ p.name }}</h4>
                  <div class="flex flex-wrap gap-1.5 mt-1">
                    <span class="text-xs px-2 py-0.5 bg-surface-elevated text-secondary rounded-full border border-primary uppercase">{{ p.type }}</span>
                    <span v-if="p.protocolConvert" class="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full border border-amber-200 font-medium">转换</span>
                  </div>
                </div>
                <div class="flex gap-2">
                  <button 
                    @click.stop="openEditModal(p)"
                    class="p-2 text-accent hover:bg-accent-soft rounded-btn transition-colors"
                    title="编辑厂商"
                  >
                    <Pencil class="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    @click.stop="openCopyProviderDialog(p)"
                    class="p-2 text-slate-600 hover:bg-slate-100 rounded-btn transition-colors"
                    title="复制厂商"
                  >
                    <Copy class="w-5 h-5" />
                  </button>
                  <button 
                    v-if="!p.active"
                    @click.stop="activateProvider(p.id)"
                    class="p-2 text-green-600 hover:bg-green-50 rounded-btn transition-colors"
                    title="设置为生效"
                  >
                    <CheckCircle2 class="w-5 h-5" />
                  </button>
                  <button 
                    @click.stop="deleteProvider(p.id)"
                    class="p-2 text-red-600 hover:bg-red-50 rounded-btn transition-colors"
                    title="删除"
                  >
                    <Trash2 class="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div class="text-sm text-secondary break-all">
                <span class="block font-medium text-tertiary text-xs mb-1 uppercase">基础地址</span>
                {{ p.baseUrl }}
              </div>
              <div class="text-sm text-secondary break-all mt-4">
                <span class="block font-medium text-tertiary text-xs mb-1 uppercase">托管 Key</span>
                <div class="flex items-center gap-1">
                  <span v-if="showApiKeyInCard[p.id]" class="font-mono text-xs break-all">{{ p.apiKey || '未设置' }}</span>
                  <span v-else class="font-mono text-xs text-tertiary">••••••••••••</span>
                  <button
                    v-if="p.apiKey"
                    @click.stop="showApiKeyInCard[p.id] = !showApiKeyInCard[p.id]"
                    class="flex-shrink-0 p-0.5 rounded hover:bg-surface-elevated transition-colors"
                    :title="showApiKeyInCard[p.id] ? '隐藏' : '显示'"
                  >
                    <EyeOff v-if="showApiKeyInCard[p.id]" class="w-3 h-3 text-tertiary" />
                    <Eye v-else class="w-3 h-3 text-tertiary" />
                  </button>
                </div>
              </div>
              <div class="text-sm text-secondary break-all mt-4">
                <div class="flex justify-between items-center">
                  <span class="block font-medium text-tertiary text-xs uppercase">模型</span>
                  <button
                    @click.stop="openAddProviderModel(p)"
                    class="text-xs font-bold text-accent hover:underline"
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
                      p.defaultModelId === m.id ? 'bg-purple-600 text-white border-purple-600 shadow-card' : 'bg-purple-50 text-purple-700 border-purple-100 hover:border-purple-300'
                    ]"
                  >
                    {{ m.name }}
                  </button>
                  <span v-if="!(p.models || []).length" class="text-tertiary text-xs italic">未添加</span>
                </div>
              </div>
            </div>
          </div>
          <div v-if="!showRecycleBin && providerViewMode === 'grid' && !providers.length" class="text-center py-12 glow-card text-tertiary text-sm">
            暂无厂商，点击"添加厂商"开始
          </div>

          <!-- List view -->
          <div v-if="!showRecycleBin && providerViewMode === 'list'" class="glow-card overflow-hidden relative">
            <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #3b82f680, transparent 60%)" />
            <div 
              v-for="(p, idx) in sortedProviders" 
              :key="p.id"
              @click="!p.active && activateProvider(p.id)"
              :draggable="providerSortBy === 'custom'"
              @dragstart="onProviderDragStart($event, idx)"
              @dragend="onProviderDragEnd"
              @dragover="onProviderDragOver"
              @drop="onProviderDrop($event, idx)"
              class="flex items-center gap-4 px-5 py-3 border-b border-primary last:border-b-0 hover:bg-surface-elevated transition-colors cursor-pointer"
              :class="{'accent-soft/50 border-l-2 border-l-blue-500': p.active, 'opacity-50': providerDragIndex === idx}"
            >
              <span v-if="providerSortBy === 'custom'" class="text-tertiary cursor-grab shrink-0"><GripVertical class="w-4 h-4" /></span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-sm truncate">{{ p.name }}</span>
                  <span v-if="p.active" class="shrink-0 px-1.5 py-0.5 bg-blue-100 text-accent rounded text-[10px] font-bold">生效中</span>
                  <span class="shrink-0 px-1.5 py-0.5 bg-surface-elevated text-secondary rounded text-[10px] uppercase">{{ p.type }}</span>
                  <span v-if="p.protocolConvert" class="shrink-0 px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[10px] border border-amber-200">转换</span>
                </div>
                <div class="text-[10px] text-tertiary truncate mt-0.5">{{ p.baseUrl }}</div>
              </div>
              <div class="flex gap-1 shrink-0">
                <button @click.stop="openEditModal(p)" class="p-1.5 text-accent hover:bg-accent-soft rounded-btn" title="编辑"><Pencil class="w-4 h-4" /></button>
                <button @click.stop="openCopyProviderDialog(p)" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-btn" title="复制"><Copy class="w-4 h-4" /></button>
                <button v-if="!p.active" @click.stop="activateProvider(p.id)" class="p-1.5 text-green-600 hover:bg-green-50 rounded-btn" title="生效"><CheckCircle2 class="w-4 h-4" /></button>
                <button @click.stop="deleteProvider(p.id)" class="p-1.5 text-red-600 hover:bg-red-50 rounded-btn" title="删除"><Trash2 class="w-4 h-4" /></button>
              </div>
            </div>
            <div v-if="!providers.length" class="text-center py-12 text-tertiary text-sm">
              暂无厂商
            </div>
          </div>

          <!-- Usage view -->
          <div v-if="!showRecycleBin && providerViewMode === 'usage'" class="space-y-4">
            <div v-if="providerUsageLoading" class="flex justify-center py-12">
              <Loader2 class="w-8 h-8 animate-spin text-accent" />
            </div>
            <div v-else-if="!providers.length" class="text-center py-12 glow-card text-tertiary text-sm">
              暂无厂商
            </div>
            <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div v-for="p in providers" :key="p.id"
                   :class="['glow-card p-5 space-y-3 relative overflow-hidden', showAllModels[p.id] ? 'max-h-none overflow-visible' : 'h-80 overflow-hidden']">
                <div class="h-[2px] absolute top-0 left-0 right-0" :style="{ background: `linear-gradient(90deg, ${vendorAccentColor(p)}80, transparent 60%)` }" />
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <h4 class="font-bold text-base truncate">{{ p.name }}</h4>
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                      <span v-if="providerUsageData[p.id]?.vendor" :class="vendorColor(providerUsageData[p.id]?.vendor) + ' shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium'">{{ vendorLabel(providerUsageData[p.id]?.vendor) }}</span>
                    </div>
                  </div>
                  <span v-if="providerUsageData[p.id]?.updatedAt" class="text-[10px] text-tertiary shrink-0">{{ timeAgo(providerUsageData[p.id].updatedAt) }}</span>
                </div>

                <div v-if="providerUsageData[p.id]?.daily?.length" class="space-y-0.5 text-xs text-secondary">
                  <div class="flex items-center gap-2"><span class="text-tertiary w-10 shrink-0">请求</span>{{ providerUsageData[p.id].summary.requests }} 次</div>
                  <div class="flex items-center gap-2"><span class="text-tertiary w-10 shrink-0">输入</span>{{ formatTokens(providerUsageData[p.id].summary.tokensIn) }} tokens</div>
                  <div class="flex items-center gap-2"><span class="text-tertiary w-10 shrink-0">输出</span>{{ formatTokens(providerUsageData[p.id].summary.tokensOut) }} tokens</div>
                </div>
                <div v-else class="text-xs text-tertiary py-4 text-center">暂无用量数据</div>

                <!-- Vendor-specific data -->
                <div v-if="providerUsageData[p.id]?.vendorData" class="space-y-1.5">
                  <div v-if="providerUsageData[p.id].vendorData.balance" class="flex items-center gap-2 text-xs">
                    <span class="text-tertiary w-10 shrink-0">余额</span><span class="font-bold text-green-600">${{ providerUsageData[p.id].vendorData.balance }}</span>
                  </div>
                  <div v-if="providerUsageData[p.id].vendorData.monthlyCost" class="flex items-center gap-2 text-xs">
                    <span class="text-tertiary w-10 shrink-0">月消费</span><span class="font-bold text-orange-600">${{ providerUsageData[p.id].vendorData.monthlyCost }}</span>
                  </div>
                  <div v-if="providerUsageData[p.id].vendorData.quotaLabel" class="flex items-center gap-2 text-xs">
                    <span class="text-tertiary w-10 shrink-0">{{ providerUsageData[p.id].vendorData.quotaLabel }}</span>
                    <div class="flex-1 h-2 bg-surface-elevated rounded-full overflow-hidden">
                      <div class="h-full rounded-full accent-soft0" :style="{ width: Math.min(100, providerUsageData[p.id].vendorData.used / providerUsageData[p.id].vendorData.limit * 100) + '%' }"></div>
                    </div>
                    <span class="text-secondary shrink-0">{{ formatTokens(providerUsageData[p.id].vendorData.used) }}/{{ formatTokens(providerUsageData[p.id].vendorData.limit) }}</span>
                  </div>
                </div>

                <div v-if="providerUsageData[p.id]?.daily?.length" style="height:110px">
                  <v-chart :option="usageChartOption(providerUsageData[p.id])" autoresize style="height:110px" />
                </div>

                <div v-if="providerUsageData[p.id]?.summary?.models?.length" class="space-y-1 pt-2 border-t border-primary">
                  <div v-for="(m, i) in providerUsageData[p.id].summary.models"
                       :key="m.name"
                       v-show="showAllModels[p.id] || i < 3"
                       class="flex justify-between gap-2 text-[10px] text-secondary">
                    <span class="font-mono truncate min-w-0">{{ m.name }}</span>
                    <span class="shrink-0 whitespace-nowrap">{{ formatTokens(m.tokensIn) }} in / {{ formatTokens(m.tokensOut) }} out</span>
                  </div>
                  <button v-if="!showAllModels[p.id] && providerUsageData[p.id].summary.models.length > 3"
                          @click="showAllModels[p.id] = true"
                          class="text-[10px] text-accent font-medium hover:underline mt-0.5">
                    + {{ providerUsageData[p.id].summary.models.length - 3 }} 个更多 ▸
                  </button>
                  <button v-else-if="showAllModels[p.id]"
                          @click="showAllModels[p.id] = false"
                          class="text-[10px] text-accent font-medium hover:underline mt-0.5">
                    ▸ 收起
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Recycle bin view -->
          <div v-if="showRecycleBin" class="space-y-4">
            <div v-if="!deletedProviders.length" class="text-center py-12 text-tertiary text-sm glow-card">
              回收站为空
            </div>
            <div v-for="p in deletedProviders" :key="p.id" class="glow-card p-6">
              <div class="flex justify-between items-start mb-4">
                <div>
                  <h4 class="font-bold text-lg">{{ p.name }}</h4>
                  <div class="flex flex-wrap gap-1.5 mt-1">
                    <span class="text-xs px-2 py-0.5 bg-surface-elevated text-secondary rounded-full border border-primary uppercase">{{ p.type }}</span>
                    <span class="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded-full border border-red-100 font-medium">已删除</span>
                  </div>
                  <p class="text-[10px] text-tertiary mt-1">删除时间：{{ formatTime(p.deletedAt) }}</p>
                </div>
                <div class="flex gap-2">
                  <button
                    @click="restoreProvider(p.id)"
                    class="px-3 py-2 bg-green-600 text-white rounded-btn hover:bg-green-700 transition-colors text-xs font-bold"
                    title="恢复厂商"
                  >
                    恢复
                  </button>
                  <button
                    @click="permanentDeleteProvider(p.id)"
                    class="px-3 py-2 bg-red-600 text-white rounded-btn hover:bg-red-700 transition-colors text-xs font-bold"
                    title="彻底删除"
                  >
                    彻底删除
                  </button>
                </div>
              </div>
              <div class="text-sm text-secondary break-all">
                <span class="block font-medium text-tertiary text-xs mb-1 uppercase">基础地址</span>
                {{ p.baseUrl }}
              </div>
              <div class="text-sm text-secondary mt-3">
                <span class="block font-medium text-tertiary text-xs mb-1 uppercase">模型</span>
                <div class="flex flex-wrap gap-2">
                  <span v-for="m in (p.models || [])" :key="m.id" class="px-2 py-1 rounded text-[10px] font-semibold font-mono bg-surface-elevated text-secondary border border-primary">{{ m.name }}</span>
                  <span v-if="!(p.models || []).length" class="text-tertiary text-xs italic">无关联模型</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Apps View (Renamed from Keys) -->
        <div v-if="activeTab === 'keys'" class="space-y-6">
          <div class="flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
            <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">{{ showKeyRecycleBin ? '回收站' : '应用管理' }}</h3>
            <div class="flex flex-wrap gap-2">
              <template v-if="!showKeyRecycleBin">
                <div class="flex gap-1 bg-surface-elevated rounded-btn p-0.5 border border-primary">
                  <button @click="appViewMode = 'table'; persistAppViewMode()" class="px-2 py-1.5 rounded-md text-xs font-medium transition-colors" :class="appViewMode === 'table' ? 'bg-white text-accent shadow-sm' : 'text-tertiary hover:text-secondary'" title="表格视图"><List class="w-3.5 h-3.5" /></button>
                  <button @click="appViewMode = 'grid'; persistAppViewMode()" class="px-2 py-1.5 rounded-md text-xs font-medium transition-colors" :class="appViewMode === 'grid' ? 'bg-white text-accent shadow-sm' : 'text-tertiary hover:text-secondary'" title="网格视图"><LayoutGrid class="w-3.5 h-3.5" /></button>
                  <button @click="appViewMode = 'usage'; persistAppViewMode(); fetchAppUsage()" class="px-2 py-1.5 rounded-md text-xs font-medium transition-colors" :class="appViewMode === 'usage' ? 'bg-white text-accent shadow-sm' : 'text-tertiary hover:text-secondary'" title="用量视图"><BarChart3 class="w-3.5 h-3.5" /></button>
                </div>
                <button 
                  @click="showAddApp = true; if (selectedLog) closeLogDetail()"
                  class="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors text-sm"
                >
                  <Plus class="w-4 h-4" />
                  创建应用
                </button>
                <button
                  @click="showKeyRecycleBin = true; fetchDeletedKeys()"
                  class="flex items-center gap-2 px-4 py-2 bg-surface-elevated text-secondary rounded-btn hover:bg-surface-elevated transition-colors text-sm border border-primary"
                >
                  <Trash2 class="w-4 h-4" />
                  回收站
                  <span v-if="deletedKeys.length" class="px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold">{{ deletedKeys.length }}</span>
                </button>
              </template>
              <button
                v-else
                @click="showKeyRecycleBin = false"
                class="flex items-center gap-2 px-4 py-2 bg-surface-elevated text-secondary rounded-btn hover:bg-surface-elevated transition-colors text-sm border border-primary"
              >
                应用列表
              </button>
            </div>
          </div>

          <!-- Recycle bin -->
          <div v-if="showKeyRecycleBin" class="space-y-4">
            <div v-if="!deletedKeys.length" class="text-center py-12 text-tertiary text-sm glow-card">回收站为空</div>
            <div v-for="k in deletedKeys" :key="k.id" class="glow-card p-6">
              <div class="flex justify-between items-start mb-4">
                <div>
                  <div class="flex items-center gap-2">
                    <span :style="keyBadgeStyle(k.id)" class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tight border">{{ k.name }}</span>
                    <span class="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded-full border border-red-100 font-medium">已删除</span>
                  </div>
                  <div class="font-mono text-[10px] text-tertiary mt-1">{{ k.key }}</div>
                  <p class="text-[10px] text-tertiary mt-1">删除时间：{{ formatTime(k.deletedAt) }}</p>
                </div>
                <div class="flex gap-2">
                  <button @click="restoreKey(k.id)" class="px-3 py-2 bg-green-600 text-white rounded-btn hover:bg-green-700 transition-colors text-xs font-bold">恢复</button>
                  <button @click="permanentDeleteKey(k.id)" class="px-3 py-2 bg-red-600 text-white rounded-btn hover:bg-red-700 transition-colors text-xs font-bold">彻底删除</button>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <span v-if="k.providerId" class="px-2 py-1 accent-soft text-accent rounded text-[10px] font-bold uppercase tracking-tight border border-blue-200">
                  绑定厂商: {{ providers.find(p => p.id === k.providerId)?.name || '未知' }}
                </span>
                <span v-else class="text-tertiary text-xs italic">绑定厂商: 全局默认</span>
                <span v-if="k.managedModelId" class="px-2 py-1 bg-green-50 text-green-700 rounded text-[10px] font-bold uppercase tracking-tight border border-green-200">
                  绑定模型: {{ getModelCatalogEntry(k.managedModelId)?.name || '未知' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Table view -->
          <div v-else-if="appViewMode === 'table'" class="glow-card overflow-hidden relative">
            <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #3b82f680, transparent 60%)" />
            <div class="overflow-x-auto">
            <table class="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr class="text-xs font-semibold uppercase tracking-wide text-tertiary" style="border-bottom:1px solid var(--color-border-default)">
                  <th class="px-6 py-4">应用名称</th>
                  <th class="px-6 py-4">绑定厂商</th>
                  <th class="px-6 py-4">绑定模型</th>
                  <th class="px-6 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="k in clientKeys" :key="k.id" class="transition hover:bg-surface-elevated" style="border-bottom:1px solid var(--color-border-default)">
                  <td class="px-6 py-4">
                    <span :style="keyBadgeStyle(k.id)" class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tight border">{{ k.name }}</span>
                    <div class="font-mono text-[10px] text-tertiary mt-0.5">{{ k.key }}</div>
                  </td>
                  <td class="px-6 py-4">
                    <span v-if="k.providerId" class="px-2 py-1 accent-soft text-accent rounded text-[10px] font-bold uppercase tracking-tight border border-blue-200">
                      {{ providers.find(p => p.id === k.providerId)?.name || '未知厂商' }}
                    </span>
                    <span v-else class="text-tertiary text-xs italic">全局默认</span>
                  </td>
                  <td class="px-6 py-4">
                    <template v-if="k.managedModelId">
                      <span class="px-2 py-1 bg-green-50 text-green-700 rounded text-[10px] font-bold uppercase tracking-tight border border-green-200">
                        {{ getModelCatalogEntry(k.managedModelId)?.name || '未知模型' }}
                      </span>
                    </template>
                    <span v-else class="text-tertiary text-xs italic">默认</span>
                  </td>
                  <td class="px-6 py-4 text-right space-x-3">
                    <button @click="toggleKey(k.id)" :class="k.enabled ? 'text-amber-600' : 'text-green-600'" class="hover:underline font-medium text-xs">{{ k.enabled ? '禁用' : '启用' }}</button>
                    <button @click="openEditClientApp(k)" class="text-accent hover:underline font-medium text-xs">配置</button>
                    <button @click="deleteClientApp(k.id)" class="text-red-600 hover:underline font-medium text-xs">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>

          <!-- Grid view -->
          <div v-else-if="appViewMode === 'grid'" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div v-for="k in clientKeys" :key="k.id" class="glow-card p-6 relative overflow-hidden transition-shadow hover:shadow-md">
              <div class="h-[2px] absolute top-0 left-0 right-0" :style="{ background: `linear-gradient(90deg, rgba(${getKeyColor(k.id)}, 0.5), transparent 60%)` }" />
              <div class="flex justify-between items-start mb-4">
                <div>
                  <span :style="keyBadgeStyle(k.id)" class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tight border inline-block mb-1">{{ k.name }}</span>
                  <div class="font-mono text-xs text-tertiary mt-1">{{ k.key }}</div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer shrink-0 ml-2" @click.stop>
                  <input type="checkbox" :checked="k.enabled" @change="toggleKey(k.id)" class="sr-only peer" />
                  <div class="w-9 h-5 bg-surface-elevated peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-primary after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-accent"></div>
                </label>
              </div>
              <div class="space-y-2">
                <div class="flex items-center gap-2 text-xs">
                  <span class="text-tertiary w-14 shrink-0">厂商</span>
                  <span v-if="k.providerId" class="px-1.5 py-0.5 accent-soft text-accent rounded text-[10px] font-bold border border-blue-200">{{ providers.find(p => p.id === k.providerId)?.name || '未知厂商' }}</span>
                  <span v-else class="text-tertiary italic">全局默认</span>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <span class="text-tertiary w-14 shrink-0">模型</span>
                  <span v-if="k.managedModelId" class="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[10px] font-bold border border-green-200">{{ getModelCatalogEntry(k.managedModelId)?.name || '未知模型' }}</span>
                  <span v-else class="text-tertiary italic">默认</span>
                </div>
              </div>
              <div class="flex gap-2 mt-4 pt-3" style="border-top:1px solid var(--color-border-default)">
                <button @click.stop="openEditClientApp(k)" class="flex-1 px-3 py-1.5 text-xs font-semibold rounded-btn transition-colors" style="background-color:var(--color-surface-elevated);color:var(--color-text-secondary);border:1px solid var(--color-border-default)">配置</button>
                <button @click.stop="deleteClientApp(k.id)" class="flex-1 px-3 py-1.5 text-xs font-semibold rounded-btn transition-colors" style="background-color:rgba(239,68,68,0.08);color:#dc2626;border:1px solid rgba(239,68,68,0.2)">删除</button>
              </div>
            </div>
            <div v-if="!clientKeys.length" class="col-span-full text-center py-12 glow-card text-tertiary text-sm">暂无应用</div>
          </div>

           <!-- Usage view -->
          <div v-else-if="appViewMode === 'usage'">
            <div v-if="appUsageLoading" class="flex justify-center py-12"><Loader2 class="w-8 h-8 animate-spin text-accent" /></div>
            <div v-else-if="!clientKeys.length" class="text-center py-12 glow-card text-tertiary text-sm">暂无应用</div>
            <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div v-for="k in clientKeys" :key="k.id" class="glow-card relative overflow-hidden flex flex-col" style="padding:0;min-height:200px">
                <div class="h-[2px]" :style="{ background: `linear-gradient(90deg, rgba(${getKeyColor(k.id)}, 0.5), transparent 60%)` }" />
                <div class="flex items-start justify-between gap-2 px-5 pt-5 pb-3" style="border-bottom:1px solid var(--color-border-default)">
                  <div class="min-w-0 flex-1">
                    <span :style="keyBadgeStyle(k.id)" class="px-2 py-1 rounded text-xs font-bold uppercase tracking-tight border inline-block">{{ k.name }}</span>
                    <div class="font-mono text-[10px] text-tertiary mt-0.5 truncate">{{ k.key }}</div>
                  </div>
                </div>
                <div class="flex-1 grid grid-cols-2 gap-2 px-5 py-3">
                  <div class="rounded-btn p-2.5" style="background-color:var(--color-surface-elevated)">
                    <span class="text-tertiary text-[10px] block">请求</span>
                    <span class="num text-sm font-bold" style="color:var(--color-text-primary)">{{ formatNumber(appUsageData[k.id]?.requests ?? 0) }}</span>
                  </div>
                  <div class="rounded-btn p-2.5" style="background-color:var(--color-surface-elevated)">
                    <span class="text-tertiary text-[10px] block">错误</span>
                    <span class="num text-sm font-bold" style="color:#f43f5e">{{ formatNumber(appUsageData[k.id]?.errors ?? 0) }}</span>
                  </div>
                  <div class="rounded-btn p-2.5" style="background-color:var(--color-surface-elevated)">
                    <span class="text-tertiary text-[10px] block">Tokens</span>
                    <span class="num text-sm font-bold" style="color:var(--color-text-primary)">{{ formatTokens(appUsageData[k.id]?.tokensTotal ?? 0) }}</span>
                  </div>
                  <div class="rounded-btn p-2.5" style="background-color:var(--color-surface-elevated)">
                    <span class="text-tertiary text-[10px] block">今日</span>
                    <span class="num text-sm font-bold" style="color:var(--color-text-primary)">{{ appUsageData[k.id]?.todayCount ?? 0 }}</span>
                  </div>
                </div>
                <div class="px-5 pb-4 text-[10px]" style="color:var(--color-text-tertiary)">{{ appUsageData[k.id]?.lastActiveDay ? '最近活跃：' + appUsageData[k.id].lastActiveDay : '暂无使用数据' }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Models View -->
        <div v-if="activeTab === 'models'" class="space-y-6">
          <div class="flex flex-col gap-3">
            <div class="flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
              <div class="space-y-1">
                <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">模型管理</h3>
                <p class="text-[10px] text-tertiary">选择厂商后管理其模型，在此页面选择的默认模型会被记住并用于 {{ MAGIC_PROXY_MODEL }}</p>
              </div>
              <button 
                @click="showAddModel = true"
                class="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors text-sm"
              >
                <Plus class="w-4 h-4" />
                添加模型
              </button>
            </div>
            <div class="flex items-center gap-3">
              <label class="text-xs font-bold text-tertiary uppercase tracking-wider whitespace-nowrap">选择厂商</label>
              <select
                v-model="selectedModelProviderId"
                @change="onModelProviderChange"
                class="px-3 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input bg-surface-card min-w-[200px]"
              >
                <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }} {{ p.active ? '(生效中)' : '' }}</option>
              </select>
              <span v-if="activeProviderId" class="text-[10px] text-tertiary">默认模型：{{ activeDefaultModel?.name || '未设置' }}</span>
            </div>
            <!-- Sort & view controls -->
            <div class="flex flex-wrap items-center gap-2">
              <select v-model="modelSortBy" @change="persistViewMode()" class="text-xs px-3 py-1.5 border border-primary rounded-btn bg-surface-card text-secondary outline-none">
                <option value="custom">自定义排序</option>
                <option value="name">按名称</option>
                <option value="createdAt">按创建时间</option>
              </select>
              <button @click="modelSortOrder = modelSortOrder === 'asc' ? 'desc' : 'asc'; persistViewMode()" class="p-1.5 text-secondary hover:bg-surface-elevated rounded-btn transition-colors" :title="modelSortOrder === 'asc' ? '升序' : '降序'">
                <ArrowUpDown class="w-4 h-4" :class="modelSortOrder === 'desc' ? 'rotate-180' : ''" />
              </button>
              <div class="flex ml-auto gap-1 bg-surface-elevated rounded-btn p-0.5">
                <button @click="modelViewMode = 'grid'; persistViewMode()" class="p-1.5 rounded-md transition-colors" :class="modelViewMode === 'grid' ? 'bg-white shadow text-accent' : 'text-tertiary hover:text-secondary'">
                  <LayoutGrid class="w-4 h-4" />
                </button>
                <button @click="modelViewMode = 'list'; persistViewMode()" class="p-1.5 rounded-md transition-colors" :class="modelViewMode === 'list' ? 'bg-white shadow text-accent' : 'text-tertiary hover:text-secondary'">
                  <List class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div v-if="modelViewMode === 'grid'" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div 
              v-for="(m, idx) in sortedManagedModels" 
              :key="m.id"
              :draggable="modelSortBy === 'custom'"
              @dragstart="onModelDragStart($event, idx)"
              @dragend="onModelDragEnd"
              @dragover="onModelDragOver"
              @drop="onModelDrop($event, idx)"
              class="glow-card p-6 hover:shadow-md transition-shadow relative overflow-hidden cursor-pointer"
              :class="{'border-blue-500 ring-1 ring-blue-500': activeProviderDefaultModelId === m.id, 'opacity-50': modelDragIndex === idx}"
              @click="activeProviderDefaultModelId !== m.id && activateModel(m.id)"
            >
              <div class="h-[2px] absolute top-0 left-0 right-0" :style="{ background: `linear-gradient(90deg, ${vendorAccentColor(providers.find(p => p.id === selectedModelProviderId) || activeProvider)}80, transparent 60%)` }" />
              <div v-if="modelSortBy === 'custom'" class="absolute top-2 left-2 text-tertiary cursor-grab active:cursor-grabbing">
                <GripVertical class="w-4 h-4" />
              </div>
              <div v-if="activeProviderDefaultModelId === m.id" class="absolute top-0 right-0 bg-accent text-white px-2 py-1 text-[10px] font-bold rounded-bl-lg flex items-center gap-1">
                <Check class="w-3 h-3" /> 默认
              </div>
              
              <div v-if="editingModel && editingModel.id === m.id" class="flex flex-col gap-3">
                <input
                  v-model="editingModelName"
                  @keyup.enter="saveEditModel"
                  @keyup.escape="cancelEditModel"
                  class="w-full px-3 py-2 border border-primary rounded-btn text-sm font-bold focus:ring-accent focus:ring-2 focus:border-transparent outline-none"
                  placeholder="模型名称"
                  autofocus
                />
                <div class="flex gap-2">
                  <button @click.stop="saveEditModel" class="px-3 py-1.5 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors text-xs font-bold">
                    保存
                  </button>
                  <button @click.stop="cancelEditModel" class="px-3 py-1.5 bg-surface-elevated text-secondary rounded-btn hover:bg-surface-elevated transition-colors text-xs font-bold">
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
                    class="p-2 text-accent hover:bg-accent-soft rounded-btn transition-colors"
                    title="编辑模型名称"
                  >
                    <Pencil class="w-4 h-4" />
                  </button>
                  <button 
                    v-if="activeProviderDefaultModelId !== m.id"
                    @click.stop="activateModel(m.id)"
                    class="p-2 text-green-600 hover:bg-green-50 rounded-btn transition-colors"
                    title="设置为默认"
                  >
                    <CheckCircle2 class="w-5 h-5" />
                  </button>
                  <button 
                    @click.stop="deleteModel(m.id)"
                    class="p-2 text-red-600 hover:bg-red-50 rounded-btn transition-colors"
                    title="删除"
                  >
                    <Trash2 class="w-5 h-5" />
                  </button>
                </div>
              </div>
              <p class="text-[10px] text-tertiary">客户端请求模型为 <span class="font-bold text-green-600">{{ MAGIC_PROXY_MODEL }}</span>（大小写不敏感）时，若应用未指定模型，将使用当前厂商的默认模型。</p>
            </div>
             <div v-if="!managedModels.length" class="col-span-full text-center py-10 text-tertiary text-sm">
               该厂商暂无模型，请添加模型
             </div>
          </div>
          <div v-if="modelViewMode === 'grid' && !managedModels.length" class="text-center py-12 glow-card text-tertiary text-sm">
            该厂商暂无模型，请添加模型
          </div>

          <!-- List view -->
          <div v-if="modelViewMode === 'list'" class="glow-card overflow-hidden relative">
            <div class="h-[2px] absolute top-0 left-0 right-0" :style="{ background: `linear-gradient(90deg, ${vendorAccentColor(providers.find(p => p.id === selectedModelProviderId) || activeProvider)}80, transparent 60%)` }" />
            <div 
              v-for="(m, idx) in sortedManagedModels" 
              :key="m.id"
              :draggable="modelSortBy === 'custom'"
              @dragstart="onModelDragStart($event, idx)"
              @dragend="onModelDragEnd"
              @dragover="onModelDragOver"
              @drop="onModelDrop($event, idx)"
              @click="activeProviderDefaultModelId !== m.id && activateModel(m.id)"
              class="flex items-center gap-4 px-5 py-3 border-b border-primary last:border-b-0 hover:bg-surface-elevated transition-colors cursor-pointer"
              :class="{'accent-soft/50 border-l-2 border-l-blue-500': activeProviderDefaultModelId === m.id, 'opacity-50': modelDragIndex === idx}"
            >
              <span v-if="modelSortBy === 'custom'" class="text-tertiary cursor-grab shrink-0"><GripVertical class="w-4 h-4" /></span>
              <div v-if="editingModel && editingModel.id === m.id" class="flex flex-1 items-center gap-3">
                <input v-model="editingModelName" @keyup.enter="saveEditModel" @keyup.escape="cancelEditModel" class="px-3 py-1.5 border border-primary rounded text-sm font-bold outline-none focus:ring-accent focus:ring-2" placeholder="模型名称" autofocus @click.stop />
                <button @click.stop="saveEditModel" class="px-3 py-1 bg-accent text-white rounded text-xs font-bold">保存</button>
                <button @click.stop="cancelEditModel" class="px-3 py-1 bg-surface-elevated text-secondary rounded text-xs font-bold">取消</button>
              </div>
              <template v-else>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-sm truncate">{{ m.name }}</span>
                    <span v-if="activeProviderDefaultModelId === m.id" class="shrink-0 px-1.5 py-0.5 bg-blue-100 text-accent rounded text-[10px] font-bold">默认</span>
                  </div>
                  <div v-if="m.createdAt" class="text-[10px] text-tertiary mt-0.5">创建于 {{ formatTime(m.createdAt) }}</div>
                </div>
                <div class="flex gap-1 shrink-0">
                  <button @click.stop="startEditModel(m)" class="p-1.5 text-accent hover:bg-accent-soft rounded-btn transition-colors" title="编辑"><Pencil class="w-4 h-4" /></button>
                  <button v-if="activeProviderDefaultModelId !== m.id" @click.stop="activateModel(m.id)" class="p-1.5 text-green-600 hover:bg-green-50 rounded-btn transition-colors" title="默认"><CheckCircle2 class="w-4 h-4" /></button>
                  <button @click.stop="deleteModel(m.id)" class="p-1.5 text-red-600 hover:bg-red-50 rounded-btn transition-colors" title="删除"><Trash2 class="w-4 h-4" /></button>
                </div>
              </template>
            </div>
            <div v-if="!managedModels.length" class="text-center py-12 text-tertiary text-sm">
              该厂商暂无模型
            </div>
          </div>
        </div>

        <!-- Model Rules View -->
        <div v-if="activeTab === 'modelRules'" class="space-y-6">
          <div class="flex justify-between items-center">
            <div class="space-y-1">
              <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">模型规则管理</h3>
              <p class="text-[10px] text-tertiary">支持 * 通配符，大小写敏感。按优先级从高到低匹配，命中第一条后强制转换模型。</p>
            </div>
            <button 
              @click="showAddModelRule = true"
              class="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors text-sm"
            >
              <Plus class="w-4 h-4" />
              添加规则
            </button>
          </div>

          <div class="glow-card overflow-hidden">
            <div class="overflow-x-auto">
            <table class="w-full min-w-[720px] text-left text-sm">
              <thead class="bg-surface-elevated border-b border-primary">
                <tr>
                  <th class="px-6 py-4 font-semibold text-secondary">优先级</th>
                  <th class="px-6 py-4 font-semibold text-secondary">匹配模式</th>
                  <th class="px-6 py-4 font-semibold text-secondary">转换为</th>
                  <th class="px-6 py-4 font-semibold text-secondary">状态</th>
                  <th class="px-6 py-4 font-semibold text-secondary text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                <tr v-for="r in modelRules" :key="r.id" class="hover:bg-surface-elevated transition-colors">
                  <td class="px-6 py-4 font-mono text-xs text-secondary">{{ r.priority }}</td>
                  <td class="px-6 py-4 font-mono text-xs text-secondary">{{ r.pattern }}</td>
                  <td class="px-6 py-4 font-mono text-xs text-accent font-medium">{{ r.targetModel }}</td>
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
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-elevated text-secondary border border-primary"
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
                      class="text-accent hover:underline font-medium text-xs"
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
                  <td colspan="5" class="px-6 py-10 text-center text-tertiary text-sm">暂无规则</td>
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
              <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">用户管理</h3>
              <p class="text-[10px] text-tertiary">首次登录默认用户必须修改密码；支持创建/禁用/重置密码。</p>
            </div>
            <button
              @click="showAddAdminUser = true"
              class="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors text-sm"
            >
              <Plus class="w-4 h-4" />
              添加用户
            </button>
          </div>

          <div class="glow-card overflow-hidden">
            <div class="overflow-x-auto">
            <table class="w-full min-w-[760px] text-left text-sm">
              <thead class="bg-surface-elevated border-b border-primary">
                <tr>
                  <th class="px-6 py-4 font-semibold text-secondary">用户名</th>
                  <th class="px-6 py-4 font-semibold text-secondary">状态</th>
                  <th class="px-6 py-4 font-semibold text-secondary">强制改密</th>
                  <th class="px-6 py-4 font-semibold text-secondary">创建时间</th>
                  <th class="px-6 py-4 font-semibold text-secondary text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                <tr v-for="u in adminUsers" :key="u.id" class="hover:bg-surface-elevated transition-colors">
                  <td class="px-6 py-4 font-medium text-primary">{{ u.username }}</td>
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
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-elevated text-secondary border border-primary"
                    >
                      <ShieldAlert class="w-3 h-3" />
                      已禁用
                    </span>
                  </td>
                  <td class="px-6 py-4">
                    <span v-if="u.mustChangePassword" class="text-amber-600 font-bold text-xs">是</span>
                    <span v-else class="text-tertiary text-xs">否</span>
                  </td>
                  <td class="px-6 py-4 text-secondary font-mono text-xs">{{ formatTime(u.createdAt) }}</td>
                  <td class="px-6 py-4 text-right space-x-3">
                    <button
                      @click="editingAdminUser = { ...u }"
                      class="text-accent hover:underline font-medium text-xs"
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
                  <td colspan="5" class="px-6 py-10 text-center text-tertiary text-sm">暂无用户</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <!-- Stats View -->
        <div v-if="activeTab === 'stats'" class="space-y-6">
          <div class="glow-card p-6 sm:p-8">
            <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div class="max-w-xl">
                <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-tertiary">Analytics</p>
                <h3 class="mt-1.5 text-2xl font-bold tracking-tight text-primary sm:text-3xl">使用统计</h3>
                <p class="mt-2 text-sm leading-relaxed text-secondary">请求量、错误与 Token 消耗趋势；可按时间范围筛选，厂商筛选影响下方图表（热力图除外）。</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  @click="fetchStats"
                  class="inline-flex shrink-0 items-center gap-2 rounded-btn border border-primary bg-surface-elevated px-4 py-2 text-sm font-semibold text-secondary transition hover:bg-surface-elevated/80"
                >
                  <Clock class="h-4 w-4" />
                  刷新数据
                </button>
                <button
                  type="button"
                  @click="clearAllStats"
                  class="inline-flex shrink-0 items-center gap-2 rounded-btn border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100"
                >
                  <Trash2 class="h-4 w-4" />
                  清空统计
                </button>
                <button
                  type="button"
                  @click="exportStats"
                  class="inline-flex shrink-0 items-center gap-2 rounded-btn border border-primary bg-surface-elevated px-4 py-2 text-sm font-semibold text-secondary transition hover:bg-surface-elevated/80"
                >
                  <Download class="h-4 w-4" />
                  导出 CSV
                </button>
              </div>
            </div>

            <div class="mt-6 flex flex-col gap-4 rounded-btn border border-primary bg-surface-elevated p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div class="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  @click="statsRange = '7d'"
                  :class="[
                    'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                    statsRange === '7d'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-tertiary hover:text-secondary'
                  ]"
                >
                  7 天
                </button>
                <button
                  type="button"
                  @click="statsRange = '30d'"
                  :class="[
                    'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                    statsRange === '30d'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-tertiary hover:text-secondary'
                  ]"
                >
                  30 天
                </button>
                <button
                  type="button"
                  @click="statsRange = '90d'"
                  :class="[
                    'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                    statsRange === '90d'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-tertiary hover:text-secondary'
                  ]"
                >
                  90 天
                </button>
                <button
                  type="button"
                  @click="statsRange = 'all'"
                  :class="[
                    'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                    statsRange === 'all'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-tertiary hover:text-secondary'
                  ]"
                >
                  全部
                </button>
              </div>
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <label class="flex items-center gap-2 text-xs font-medium text-secondary">
                  <span class="whitespace-nowrap">厂商</span>
                  <select
                    v-model="statsProviderId"
                    class="min-w-[8rem] rounded-btn border border-primary bg-surface-input px-3 py-2 text-xs font-semibold text-primary outline-none focus:border-accent/50"
                  >
                    <option value="all">全部</option>
                    <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
                  </select>
                </label>
                <span class="text-[11px] text-tertiary">热力图不受厂商筛选影响</span>
              </div>
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <label class="flex items-center gap-2 text-xs font-medium text-secondary">
                  <span class="whitespace-nowrap">类型</span>
                  <select
                    v-model="statsIsStream"
                    class="min-w-[7rem] rounded-btn border border-primary bg-surface-input px-3 py-2 text-xs font-semibold text-primary outline-none focus:border-accent/50"
                  >
                    <option value="all">全部</option>
                    <option value="1">流式</option>
                    <option value="0">非流式</option>
                  </select>
                </label>
                <label class="flex items-center gap-2 text-xs font-medium text-secondary">
                  <span class="whitespace-nowrap">协议</span>
                  <select
                    v-model="statsClientProtocol"
                    class="min-w-[7rem] rounded-btn border border-primary bg-surface-input px-3 py-2 text-xs font-semibold text-primary outline-none focus:border-accent/50"
                  >
                    <option value="all">全部</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div v-if="statsLoading" class="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-card border border-primary bg-surface-elevated/80 p-12 text-secondary">
            <Loader2 class="h-8 w-8 animate-spin text-cyan-600" />
            <p class="text-sm font-medium">正在加载统计数据…</p>
          </div>

          <div v-else class="space-y-8">

            <!-- ════════ KPI 概览 ════════ -->
            <div class="flex items-center gap-3">
              <span class="text-[10px] font-semibold uppercase tracking-widest" style="color:var(--color-text-tertiary)">KPI 概览</span>
              <div class="flex-1 border-t" style="border-color:var(--color-border-default)" />
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #3b82f680, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">请求数</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#3b82f618"><Activity class="h-3.5 w-3.5" style="color:#3b82f6" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:var(--color-text-primary)">{{ statsSummary ? formatNumber(statsSummary.requestCount) : '—' }}</p>
              </div>
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #f43f5e80, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">错误数</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#f43f5e18"><AlertTriangle class="h-3.5 w-3.5" style="color:#f43f5e" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:#f43f5e">{{ statsSummary ? formatNumber(statsSummary.errorCount) : '—' }}</p>
              </div>
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #f59e0b80, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">错误率</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#f59e0b18"><Percent class="h-3.5 w-3.5" style="color:#f59e0b" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:#f59e0b">{{ statsSummary ? (statsSummary.errorRate * 100).toFixed(2) + '%' : '—' }}</p>
              </div>
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #06b6d480, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">Tokens 入</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#06b6d418"><Download class="h-3.5 w-3.5" style="color:#06b6d4" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:#0891b2">{{ statsSummary ? formatNumber(statsSummary.tokensInTotal) : '—' }}</p>
              </div>
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #14b8a680, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">Tokens 出</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#14b8a618"><Upload class="h-3.5 w-3.5" style="color:#14b8a6" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:#0d9488">{{ statsSummary ? formatNumber(statsSummary.tokensOutTotal) : '—' }}</p>
              </div>
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5 sm:col-span-2 xl:col-span-1">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #10b98180, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">平均耗时</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#10b98118"><Timer class="h-3.5 w-3.5" style="color:#10b981" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:#059669">{{ statsSummary ? formatMs(statsSummary.avgLatencyMs) : '—' }}</p>
              </div>
            </div>

            <!-- ════════ 指标详情 ════════ -->
            <div class="flex items-center gap-3">
              <span class="text-[10px] font-semibold uppercase tracking-widest" style="color:var(--color-text-tertiary)">指标详情</span>
              <div class="flex-1 border-t" style="border-color:var(--color-border-default)" />
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #8b5cf680, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">流式请求</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#8b5cf618"><Radio class="h-3.5 w-3.5" style="color:#8b5cf6" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:#7c3aed">{{ statsSummary ? formatNumber(statsSummary.streamCount) : '—' }}</p>
              </div>
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #a855f780, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">TTFB 平均</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#a855f718"><Gauge class="h-3.5 w-3.5" style="color:#a855f7" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:#9333ea">{{ statsSummary ? formatMs(statsSummary.ttfbAvgMs) : '—' }}</p>
              </div>
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #0ea5e980, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">数据传输</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#0ea5e918"><HardDrive class="h-3.5 w-3.5" style="color:#0ea5e9" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:#0284c7">{{ statsSummary ? formatBytes(statsSummary.responseBytesTotal) : '—' }}</p>
              </div>
              <div class="relative overflow-hidden glow-card flex flex-col overflow-hidden gap-3 p-5">
                <div class="h-[2px] absolute top-0 left-0 right-0" style="background:linear-gradient(90deg, #f9731680, transparent 60%)" />
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" style="color:var(--color-text-tertiary)">流中断率</span>
                  <div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color:#f9731618"><WifiOff class="h-3.5 w-3.5" style="color:#f97316" /></div>
                </div>
                <p class="num text-2xl font-bold" style="color:#ea580c">{{ statsSummary ? (statsSummary.streamBrokenRate * 100).toFixed(2) + '%' : '—' }}</p>
              </div>
            </div>

            <div v-if="statsSummary?.latencyPercentiles || statsSummary?.ttfbPercentiles" class="glow-card flex flex-col overflow-hidden" style="padding:0">
              <div class="h-[2px]" style="background:linear-gradient(90deg, #3b82f680, transparent 60%)" />
              <div class="flex flex-wrap gap-4 px-5 py-4">
                <template v-if="statsSummary?.latencyPercentiles">
                  <span class="text-xs font-semibold uppercase tracking-wide self-center" style="color:var(--color-text-tertiary)">延迟分位数</span>
                  <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" style="background-color:#05966918;color:#059669;border:1px solid rgba(5,150,105,0.2)">P50 {{ formatMs(statsSummary.latencyPercentiles.p50) }}</span>
                  <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" style="background-color:#05966918;color:#059669;border:1px solid rgba(5,150,105,0.2)">P90 {{ formatMs(statsSummary.latencyPercentiles.p90) }}</span>
                  <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" style="background-color:#05966918;color:#059669;border:1px solid rgba(5,150,105,0.2)">P99 {{ formatMs(statsSummary.latencyPercentiles.p99) }}</span>
                </template>
                <template v-if="statsSummary?.ttfbPercentiles">
                  <span class="text-xs font-semibold uppercase tracking-wide self-center" style="color:var(--color-text-tertiary)">TTFB 分位数</span>
                  <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" style="background-color:#7c3aed18;color:#7c3aed;border:1px solid rgba(124,58,237,0.2)">P50 {{ formatMs(statsSummary.ttfbPercentiles.p50) }}</span>
                  <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" style="background-color:#7c3aed18;color:#7c3aed;border:1px solid rgba(124,58,237,0.2)">P90 {{ formatMs(statsSummary.ttfbPercentiles.p90) }}</span>
                  <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" style="background-color:#7c3aed18;color:#7c3aed;border:1px solid rgba(124,58,237,0.2)">P99 {{ formatMs(statsSummary.ttfbPercentiles.p99) }}</span>
                </template>
              </div>
            </div>

            <!-- ════════ 活动趋势 ════════ -->
            <div class="flex items-center gap-3">
              <span class="text-[10px] font-semibold uppercase tracking-widest" style="color:var(--color-text-tertiary)">活动趋势</span>
              <div class="flex-1 border-t" style="border-color:var(--color-border-default)" />
            </div>

            <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
              <div class="h-[2px]" style="background:linear-gradient(90deg, #f9731680, transparent 60%)" />
              <div class="flex items-start justify-between px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                <div class="flex items-center gap-3">
                  <div class="flex h-8 w-8 items-center justify-center rounded-btn" style="background-color:var(--color-surface-elevated);color:var(--color-text-secondary)">
                    <Flame class="h-4 w-4" />
                  </div>
                  <div>
                    <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">活跃热力图</h3>
                    <p class="text-xs" style="color:var(--color-text-tertiary)">按天请求量分布（近一年）</p>
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-[11px] font-semibold rounded-btn px-2.5 py-1" style="background-color:rgba(59,130,246,0.08);color:#60a5fa;border:1px solid rgba(59,130,246,0.18)">
                    活跃 {{ heatmapCells.activeDays }} 天
                  </span>
                  <span v-if="statsSummary?.activeDays" class="text-[11px] font-semibold rounded-btn px-2.5 py-1" style="background-color:var(--color-surface-elevated);color:var(--color-text-secondary);border:1px solid var(--color-border-default)">
                    总计 {{ statsSummary.requestCount }} 请求
                  </span>
                </div>
              </div>

              <div class="flex-1 overflow-x-auto">
                <div class="flex gap-1 p-4" style="min-width:fit-content">
                  <div class="flex flex-col gap-1 pt-0">
                    <span v-for="(d, di) in WEEKDAY_LABELS" :key="di" class="flex h-3 w-3 items-center text-[9px] font-medium" :style="{ color: di % 2 === 0 ? 'var(--color-text-tertiary)' : 'transparent' }">{{ d }}</span>
                  </div>

                  <div class="flex gap-1">
                    <div v-for="(week, wi) in heatmapCells.weeks" :key="wi" class="flex flex-col gap-1">
                      <div
                        v-for="cell in week" :key="cell.date"
                        :title="`${cell.date} · ${cell.count} 次请求`"
                        class="h-3 w-3 cursor-default rounded-[2px] transition-opacity hover:opacity-80"
                        :style="{
                          backgroundColor: HEATMAP_COLORS[cell.lvl].bg,
                          border: `1px solid ${HEATMAP_COLORS[cell.lvl].border}`,
                          animationDelay: `${(wi * 7 + (week.indexOf(cell))) * 5}ms`
                        }"
                        style="animation: heatmapFadeIn 0.2s ease both"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div class="flex items-center justify-end gap-1.5 px-4 pb-4">
                <span class="text-[10px] font-medium" style="color:var(--color-text-tertiary)">少</span>
                <div v-for="(c, i) in HEATMAP_COLORS" :key="i" class="h-2.5 w-2.5 rounded-[2px]" :style="{ backgroundColor: c.bg, border: `1px solid ${c.border}` }" />
                <span class="text-[10px] font-medium" style="color:var(--color-text-tertiary)">多</span>
              </div>
            </div>

            <!-- ════════ 图表分析 ════════ -->
            <div class="flex items-center gap-3">
              <span class="text-[10px] font-semibold uppercase tracking-widest" style="color:var(--color-text-tertiary)">图表分析</span>
              <div class="flex-1 border-t" style="border-color:var(--color-border-default)" />
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #3b82f680, transparent 60%)" />
                <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <TrendingUp class="h-4 w-4" style="color:var(--color-text-tertiary)" />
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">请求与错误趋势</h3>
                </div>
                <div class="p-4"><VChart :option="requestsOption" autoresize class="h-60" /></div>
              </div>
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #f43f5e80, transparent 60%)" />
                <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <AlertTriangle class="h-4 w-4" style="color:var(--color-text-tertiary)" />
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">错误率趋势</h3>
                </div>
                <div class="p-4"><VChart :option="errorRateOption" autoresize class="h-60" /></div>
              </div>
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #14b8a680, transparent 60%)" />
                <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <Zap class="h-4 w-4" style="color:var(--color-text-tertiary)" />
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">Tokens 趋势</h3>
                </div>
                <div class="p-4"><VChart :option="tokensOption" autoresize class="h-60" /></div>
              </div>
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #05966980, transparent 60%)" />
                <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <Timer class="h-4 w-4" style="color:var(--color-text-tertiary)" />
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">延迟与 TTFB</h3>
                </div>
                <div class="p-4"><VChart :option="latencyTtfbOption" autoresize class="h-60" /></div>
              </div>
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #8b5cf680, transparent 60%)" />
                <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <Cpu class="h-4 w-4" style="color:var(--color-text-tertiary)" />
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">模型占比（按 Tokens）</h3>
                </div>
                <div class="p-4"><VChart :option="modelPieOption" autoresize class="h-60" /></div>
              </div>
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #8b5cf680, transparent 60%)" />
                <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <ArrowRightLeft class="h-4 w-4" style="color:var(--color-text-tertiary)" />
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">协议分布（按 Tokens）</h3>
                </div>
                <div class="p-4"><VChart :option="protocolPieOption" autoresize class="h-60" /></div>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #f43f5e80, transparent 60%)" />
                <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <AlertTriangle class="h-4 w-4" style="color:var(--color-text-tertiary)" />
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">错误分类</h3>
                </div>
                <div class="p-4"><VChart :option="errorCategoryPieOption" autoresize class="h-60" /></div>
              </div>
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #06b6d480, transparent 60%)" />
                <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <Radio class="h-4 w-4" style="color:var(--color-text-tertiary)" />
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">流式类型分布（按 Tokens）</h3>
                </div>
                <div class="p-4"><VChart :option="streamPieOption" autoresize class="h-60" /></div>
              </div>
            </div>

            <!-- ════════ 明细 ════════ -->
            <div class="flex items-center gap-3">
              <span class="text-[10px] font-semibold uppercase tracking-widest" style="color:var(--color-text-tertiary)">明细</span>
              <div class="flex-1 border-t" style="border-color:var(--color-border-default)" />
            </div>

            <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #3b82f680, transparent 60%)" />
                <div class="flex items-center justify-between px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">慢请求 Top 10</h3>
                  <span class="text-xs" style="color:var(--color-text-tertiary)">按耗时降序</span>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr class="text-xs font-semibold uppercase tracking-wide" style="color:var(--color-text-tertiary);border-bottom:1px solid var(--color-border-default)">
                        <th class="px-5 py-3">应用</th>
                        <th class="px-5 py-3">厂商</th>
                        <th class="px-5 py-3">模型</th>
                        <th class="px-5 py-3 text-right">耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in (statsData?.top?.slow || [])" :key="row.id" class="transition hover:bg-surface-elevated" style="border-bottom:1px solid var(--color-border-default)">
                        <td class="px-5 py-3 font-medium" style="color:var(--color-text-primary)">{{ row.appName }}</td>
                        <td class="px-5 py-3" style="color:var(--color-text-secondary)">{{ row.providerName }}</td>
                        <td class="px-5 py-3 font-mono text-xs max-w-[160px] truncate" style="color:var(--color-text-secondary)">
                          <span v-if="!row.actualModel || row.requestedModel === row.actualModel">{{ row.requestedModel }}</span>
                          <span v-else>{{ row.requestedModel }} → {{ row.actualModel }}</span>
                        </td>
                        <td class="px-5 py-3 text-right font-mono text-xs font-bold" style="color:#f43f5e">{{ formatMs(row.latencyMs) }}</td>
                      </tr>
                      <tr v-if="!(statsData?.top?.slow || []).length">
                        <td colspan="4" class="px-5 py-10 text-center text-sm" style="color:var(--color-text-tertiary)">暂无数据</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="glow-card flex flex-col overflow-hidden" style="padding:0">
                <div class="h-[2px]" style="background:linear-gradient(90deg, #f43f5e80, transparent 60%)" />
                <div class="flex items-center justify-between px-5 py-4" style="border-bottom:1px solid var(--color-border-default)">
                  <h3 class="text-sm font-semibold" style="color:var(--color-text-primary)">错误 Top 10</h3>
                  <span class="text-xs" style="color:var(--color-text-tertiary)">最近错误记录</span>
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[700px] text-left text-sm">
                    <thead>
                      <tr class="text-xs font-semibold uppercase tracking-wide" style="color:var(--color-text-tertiary);border-bottom:1px solid var(--color-border-default)">
                        <th class="px-5 py-3">时间</th>
                        <th class="px-5 py-3">应用</th>
                        <th class="px-5 py-3">厂商</th>
                        <th class="px-5 py-3">错误</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in (statsData?.top?.errors || [])" :key="row.id" class="transition hover:bg-surface-elevated" style="border-bottom:1px solid var(--color-border-default)">
                        <td class="px-5 py-3 font-mono text-xs" style="color:var(--color-text-secondary)">{{ formatTime(row.requestAt) }}</td>
                        <td class="px-5 py-3 font-medium" style="color:var(--color-text-primary)">{{ row.appName }}</td>
                        <td class="px-5 py-3" style="color:var(--color-text-secondary)">{{ row.providerName }}</td>
                        <td class="px-5 py-3 font-mono text-[11px] leading-relaxed max-w-[200px] truncate" style="color:#f43f5e" :title="row.errorMessage || ''">{{ row.errorMessage || '-' }}</td>
                      </tr>
                      <tr v-if="!(statsData?.top?.errors || []).length">
                        <td colspan="4" class="px-5 py-10 text-center text-sm" style="color:var(--color-text-tertiary)">暂无数据</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeTab === 'config'" class="space-y-6">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1 text-xs text-secondary">
            <span>
              当前软件版本
              <code class="ml-1 font-mono text-sm font-bold text-primary bg-surface-elevated px-2 py-0.5 rounded border border-primary">v{{ serverVersion || '…' }}</code>
            </span>
            <span class="text-tertiary sm:text-right">与根目录 <code class="font-mono text-[10px]">package.json</code> 及 <code class="font-mono text-[10px]">GET /healthz</code> 一致</span>
          </div>
          <div class="glow-card p-6">
            <div class="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
              <div>
                <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">全局配置导入/导出</h3>
                <p class="text-xs text-tertiary mt-1">可导入导出厂商、模型、应用、模型规则等业务配置，不包含管理员用户名和密码。</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  @click="exportGlobalConfig"
                  class="flex items-center gap-2 px-4 py-2 bg-surface-elevated text-secondary rounded-btn hover:bg-surface-elevated transition-colors text-sm border border-primary"
                >
                  <Download class="w-4 h-4" />
                  导出全局配置
                </button>
                <button
                  @click="openGlobalImportDialog"
                  class="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors text-sm"
                >
                  <Upload class="w-4 h-4" />
                  导入全局配置
                </button>
              </div>
            </div>
          </div>

          <!-- 对话日志保留 -->
          <div class="glow-card p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">对话日志保留</h3>
                <p class="text-xs text-tertiary mt-1">按天自动删除过期数据；0 表示不自动删除。保存后立即按新规则清理一次，之后约每 6 小时再执行。</p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  v-model.number="appSettings.logRetentionDays"
                  type="number"
                  min="0"
                  step="1"
                  class="w-24 px-3 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input"
                />
                <span class="text-sm text-secondary">天</span>
              </div>
            </div>
          </div>

          <!-- 统计数据保留 -->
          <div class="glow-card p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">统计数据保留</h3>
                <p class="text-xs text-tertiary mt-1">按天自动删除过期统计数据；0 表示不自动删除。</p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  v-model.number="appSettings.statsRetentionDays"
                  type="number"
                  min="0"
                  step="1"
                  class="w-24 px-3 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input"
                />
                <span class="text-sm text-secondary">天</span>
              </div>
            </div>
          </div>

          <!-- 上游超时 -->
          <div class="glow-card p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">上游 HTTP 超时</h3>
                <p class="text-xs text-tertiary mt-1">代理请求大模型 API 的单次 HTTP 超时时间。默认 360，范围 5～86400 秒。</p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  v-model.number="appSettings.upstreamTimeoutSeconds"
                  type="number"
                  min="5"
                  max="86400"
                  step="1"
                  class="w-24 px-3 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input"
                />
                <span class="text-sm text-secondary">秒</span>
              </div>
            </div>
          </div>

          <!-- 请求头转发黑名单 -->
          <div class="glow-card p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">请求头转发黑名单</h3>
                <p class="text-xs text-tertiary mt-1">这些请求头不会转发到上游。默认: host, content-length, connection, accept-encoding。</p>
              </div>
              <div class="flex-1 max-w-md">
                <input
                  :value="appSettings.upstreamHeadersBlocklist.join(', ')"
                  @input="appSettings.upstreamHeadersBlocklist = $event.target.value.split(',').map(s => s.trim()).filter(s => s)"
                  type="text"
                  class="w-full px-3 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input"
                />
              </div>
            </div>
          </div>

          <!-- 通知推送日志保留 -->
          <div class="glow-card p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">通知推送日志保留</h3>
                <p class="text-xs text-tertiary mt-1">按天自动删除过期的通知推送日志；0 表示不自动删除。默认 7 天，范围 0～365 天。</p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  v-model.number="appSettings.notificationLogRetentionDays"
                  type="number"
                  min="0"
                  max="365"
                  step="1"
                  class="w-24 px-3 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input"
                />
                <span class="text-sm text-secondary">天</span>
              </div>
            </div>
          </div>

          <!-- 管理员时区 -->
          <div class="glow-card p-6">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">管理员时区</h3>
                <p class="text-xs text-tertiary mt-1">所有时间显示将使用此时区（如日志时间、推送详情、更新时间等）。</p>
              </div>
              <div class="flex items-center gap-3">
                <select
                  v-model="appSettings.timezone"
                  class="px-3 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input"
                >
                  <option value="Asia/Shanghai">UTC+8 上海</option>
                  <option value="Asia/Tokyo">UTC+9 东京</option>
                  <option value="Asia/Seoul">UTC+9 首尔</option>
                  <option value="Asia/Kolkata">UTC+5:30 加尔各答</option>
                  <option value="Asia/Dubai">UTC+4 迪拜</option>
                  <option value="Europe/London">UTC+0 伦敦</option>
                  <option value="Europe/Paris">UTC+1 巴黎</option>
                  <option value="Europe/Moscow">UTC+3 莫斯科</option>
                  <option value="America/New_York">UTC-5 纽约</option>
                  <option value="America/Chicago">UTC-6 芝加哥</option>
                  <option value="America/Denver">UTC-7 丹佛</option>
                  <option value="America/Los_Angeles">UTC-8 洛杉矶</option>
                  <option value="Pacific/Auckland">UTC+12 奥克兰</option>
                  <option value="UTC">UTC 协调世界时</option>
                </select>
              </div>
            </div>
          </div>

          <!-- 保存按钮 -->
          <div class="glow-card p-6">
            <div class="flex justify-end">
              <button
                type="button"
                :disabled="appSettingsSaving"
                @click="saveAppSettings"
                class="px-6 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors text-sm font-bold disabled:opacity-50"
              >
                {{ appSettingsSaving ? '保存中…' : '保存配置' }}
              </button>
            </div>
          </div>

        </div>


        <!-- Notifications View -->
        <div v-if="activeTab === 'notifications'" class="space-y-6">
          <!-- 全局静默通知 -->
          <div class="glow-card p-6">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center flex-wrap gap-2">
                  <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">全局静默通知</h3>
                  <span v-if="appSettings.notificationMuteEnabled"
                        :class="nowInMute ? 'bg-green-100 text-green-700 border-green-200' : 'bg-surface-elevated text-secondary border-primary'"
                        class="px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap">
                    {{ nowInMute ? '● 静默中' : '○ 非静默时段' }}
                  </span>
                </div>
                <p class="text-xs text-tertiary mt-1">开启后，指定时段内所有通知暂停发送</p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer flex-shrink-0 ml-auto">
                <input type="checkbox" v-model="appSettings.notificationMuteEnabled" class="sr-only peer" />
                <div class="w-11 h-6 bg-surface-elevated peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-primary after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
              </label>
            </div>

            <!-- 显示模式 -->
            <div v-if="appSettings.notificationMuteEnabled && !muteEditing" class="pt-4 border-t border-primary">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs text-secondary font-medium">静默时段</span>
                  <span class="font-mono font-bold text-primary bg-surface-elevated px-2.5 py-1 rounded-btn text-sm">{{ appSettings.notificationMuteStart }}</span>
                  <span class="text-tertiary">→</span>
                  <span class="font-mono font-bold text-primary bg-surface-elevated px-2.5 py-1 rounded-btn text-sm">{{ appSettings.notificationMuteEnd }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span v-if="muteSavedToast" class="text-xs text-green-600 font-medium flex-shrink-0">✓ 已保存</span>
                  <button @click="muteEditing = true" class="flex items-center gap-1 px-3 py-1.5 text-xs text-accent font-medium hover:bg-accent-soft rounded-btn transition-colors">
                    <Pencil class="w-3 h-3" /> 编辑
                  </button>
                </div>
              </div>
            </div>

            <!-- 编辑模式 -->
            <div v-if="appSettings.notificationMuteEnabled && muteEditing" class="space-y-4 pt-4 border-t border-primary">
              <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <div class="flex items-center gap-2">
                  <label class="text-xs font-bold text-secondary uppercase whitespace-nowrap">开始时间</label>
                  <input v-model="appSettings.notificationMuteStart" type="time" class="px-3 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input w-32" />
                </div>
                <span class="hidden sm:inline text-tertiary text-xs">→</span>
                <div class="flex items-center gap-2">
                  <label class="text-xs font-bold text-secondary uppercase whitespace-nowrap">结束时间</label>
                  <input v-model="appSettings.notificationMuteEnd" type="time" class="px-3 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input w-32" />
                </div>
              </div>
              <p class="text-[10px] text-tertiary">支持跨天时段，如 22:00 → 08:00 将覆盖夜晚到次日早晨</p>
              <div class="flex justify-end gap-3">
                <button @click="cancelMuteSettings" class="px-4 py-2 text-sm border border-primary rounded-btn hover:bg-surface-elevated transition-colors">取消</button>
                <button @click="saveMuteSettings" :disabled="appSettingsSaving" class="px-4 py-2 text-sm bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold disabled:opacity-50">
                  {{ appSettingsSaving ? '保存中…' : '保存设置' }}
                </button>
              </div>
            </div>
          </div>
          <!-- 消息通知配置 -->
          <div class="glow-card p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">消息通知配置</h3>
              <button @click="openNotifEditor(null)" v-if="editingNotifConfig === undefined" class="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors text-xs font-bold flex-shrink-0">
                <Plus class="w-3 h-3" /> 添加
              </button>
            </div>
            <p class="text-xs text-tertiary mb-4">为 App Key 配置通知规则，超时时间根据通知类型自动适配。</p>
            <div v-if="notificationConfigs.length > 0" class="space-y-3 mb-4">
              <div v-for="cfg in notificationConfigs" :key="cfg.id"
                   :class="['flex items-center justify-between gap-3 p-4 glow-card transition-shadow', cfg.enabled ? 'border-primary hover:shadow-md' : 'border-primary opacity-60']">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-sm text-primary">{{ cfg.name || cfg.clientKeyNames || cfg.clientKeyName || ('App #' + cfg.clientKeyId) }}</span>
                    <span :class="cfg.notificationType === 'error' ? 'bg-red-100 text-red-600 border-red-200' : cfg.notificationType === 'tool_use_confirmation' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-blue-100 text-accent border-blue-200'" class="px-1.5 py-0.5 rounded text-[10px] font-medium border">{{ cfg.notificationType === 'error' ? '错误' : cfg.notificationType === 'tool_use_confirmation' ? '确认' : '完成' }}</span>
                    <label class="relative inline-flex items-center cursor-pointer" @click.stop>
                      <input type="checkbox" :checked="cfg.enabled" @change="toggleNotifEnabled(cfg)" class="sr-only peer" />
                      <div class="w-9 h-5 bg-surface-elevated peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-primary after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-green-500"></div>
                    </label>
                  </div>
                  <div class="text-xs text-secondary mt-0.5 truncate">{{ cfg.webhookUrl || '未配置 URL' }}</div>
                  <div class="text-[10px] text-tertiary mt-0.5">
                    方法: {{ cfg.httpMethod }} | 等待: {{ (cfg.notificationType === 'error' ? cfg.errorSuppressSeconds : cfg.notificationType === 'tool_use_confirmation' ? cfg.toolUseTimeoutSeconds : cfg.cooldownSeconds) || '?' }}秒
                    <span v-if="cfg.filterClientApps && cfg.filterClientApps.length"> | 客户端: {{ cfg.filterClientApps.join(', ') }}</span>
                  </div>
                </div>
                <div class="flex gap-1 shrink-0">
                  <button @click="openNotifEditor(cfg)" class="p-2 text-accent hover:bg-accent-soft rounded-btn transition-colors"><Pencil class="w-4 h-4" /></button>
                  <button @click="deleteNotifConfig(cfg.id)" class="p-2 text-red-600 hover:bg-red-50 rounded-btn transition-colors"><Trash2 class="w-4 h-4" /></button>
                </div>
              </div>
            </div>
            <div v-else class="text-xs text-tertiary mb-4">暂无通知配置，点击右上方按钮添加。</div>

            <!-- 通知配置编辑 Modal -->
            <div v-if="editingNotifConfig !== undefined" class="modal-overlay" @click.self="cancelNotifEditor">
              <div class="glow-card w-full max-w-lg p-6 shadow-modal max-h-[90vh] overflow-y-auto">
                <div class="flex items-center justify-between mb-4">
                  <h4 class="text-lg font-bold text-primary">{{ editingNotifConfig ? '编辑通知配置' : '添加通知配置' }}</h4>
                  <button @click="cancelNotifEditor" class="p-1.5 hover:bg-surface-elevated rounded-full transition-colors">
                    <X class="w-5 h-5 text-tertiary" />
                  </button>
                </div>
                <div class="space-y-4">
                  <div class="flex flex-col gap-1">
                    <label class="block text-xs font-bold text-tertiary uppercase mb-1">规则名称 *</label>
                    <input v-model="notifConfigForm.name" type="text" placeholder="例如: ClaudeCode 通知" required class="w-full px-4 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input" />
                  </div>
                  <div class="flex items-center justify-between">
                    <label class="block text-xs font-bold text-tertiary uppercase mb-0">启用</label>
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" v-model="notifConfigForm.enabled" class="sr-only peer" />
                      <div class="w-11 h-6 bg-surface-elevated peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-primary after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                    </label>
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="block text-xs font-bold text-tertiary uppercase mb-1">通知类型</label>
                    <div class="flex gap-3">
                      <label class="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" v-model="notifConfigForm.notificationType" value="completion" class="text-accent" />
                        <span>对话完成</span>
                      </label>
                      <label class="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" v-model="notifConfigForm.notificationType" value="tool_use_confirmation" class="text-accent" />
                        <span>等待确认</span>
                      </label>
                      <label class="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" v-model="notifConfigForm.notificationType" value="error" class="text-accent" />
                        <span>错误通知</span>
                      </label>
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <div class="flex flex-col gap-1">
                      <label class="block text-xs font-bold text-tertiary uppercase mb-1">
                        {{ notifConfigForm.notificationType === 'error' ? '错误抑制时间（秒）' : notifConfigForm.notificationType === 'tool_use_confirmation' ? '等待确认超时（秒）' : '对话结束等待（秒）' }}
                        <span class="text-red-500">*</span>
                      </label>
                      <input v-if="notifConfigForm.notificationType === 'error'" v-model.number="notifConfigForm.errorSuppressSeconds" type="number" min="10" max="600" required class="w-24 px-4 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input" />
                      <input v-else-if="notifConfigForm.notificationType === 'tool_use_confirmation'" v-model.number="notifConfigForm.toolUseTimeoutSeconds" type="number" min="1" max="600" required class="w-24 px-4 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input" />
                      <input v-else v-model.number="notifConfigForm.cooldownSeconds" type="number" min="1" max="300" required class="w-24 px-4 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input" />
                    </div>
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="block text-xs font-bold text-tertiary uppercase mb-1">App Key（多选）</label>
                    <div class="flex flex-wrap gap-1.5">
                      <button
                        v-for="key in clientKeys" :key="key.id"
                        @click="toggleNotifKey(key.id)"
                        type="button"
                        :style="notifConfigForm.clientKeyIds.includes(key.id) ? { backgroundColor: `rgb(${getKeyColor(key.id)})`, color: '#fff', borderColor: `rgb(${getKeyColor(key.id)})` } : keyBadgeStyle(key.id)"
                        class="px-2 py-1 rounded text-[10px] font-semibold font-mono tracking-tight border transition-colors"
                      >{{ key.name }}</button>
                      <span v-if="clientKeys.length === 0" class="text-xs text-tertiary">暂无 App Key</span>
                    </div>
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="block text-xs font-bold text-tertiary uppercase mb-1">Webhook URL</label>
                    <input v-model="notifConfigForm.webhookUrl" type="text" placeholder="https://example.com/webhook" class="w-full px-4 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="block text-xs font-bold text-tertiary uppercase mb-1">HTTP 方法</label>
                    <select v-model="notifConfigForm.httpMethod" class="w-full px-4 py-2 border border-primary rounded-btn text-sm focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input">
                      <option>POST</option>
                      <option>PUT</option>
                    </select>
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="block text-xs font-bold text-tertiary uppercase mb-1">自定义 Headers</label>
                    <div class="space-y-1.5">
                      <div v-for="(h, i) in notifConfigForm.headers" :key="i" class="flex gap-1.5 items-start">
                        <input v-model="h.key" type="text" placeholder="Header 名" class="flex-1 px-3 py-2 border border-primary rounded-btn text-xs focus:ring-accent focus:ring-2 focus:border-transparent outline-none font-mono bg-surface-input" />
                        <input v-model="h.value" type="text" placeholder="Header 值" class="flex-1 px-3 py-2 border border-primary rounded-btn text-xs focus:ring-accent focus:ring-2 focus:border-transparent outline-none font-mono bg-surface-input" />
                        <button @click="removeNotifHeader(i)" class="shrink-0 p-1.5 text-red-600 hover:bg-red-50 rounded-btn transition-colors"><X class="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <button @click="addNotifHeader" class="flex items-center gap-1 text-xs text-accent hover:text-accent mt-1 self-start">
                      <Plus class="w-3 h-3" /> 添加 Header
                    </button>
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="block text-xs font-bold text-tertiary uppercase mb-1">通知体模板 (JSON, 支持 {{变量}})</label>
                    <textarea v-model="notifConfigForm.bodyTemplate" rows="4" placeholder='留空使用默认模板，支持变量如 {{model}} {{totalTokens}} {{clientApp}} {{clientName}} {{status}}' class="w-full px-4 py-2 border border-primary rounded-btn text-xs font-mono focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input"></textarea>
                  </div>
                </div>
                <div class="flex gap-3 mt-6">
                  <button @click="cancelNotifEditor" class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors text-sm">取消</button>
                  <button @click="saveNotifConfig" :disabled="notifConfigSaving" class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold text-sm disabled:opacity-50">
                    {{ notifConfigSaving ? '保存中…' : '保存' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 推送日志 -->
          <div class="glow-card p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">推送日志</h3>
              <div class="flex gap-2">
                <button @click="fetchNotifLogs(notifLogsPage)" class="flex items-center gap-1 px-3 py-1.5 bg-surface-elevated text-secondary rounded-btn hover:bg-surface-elevated text-xs border border-primary">
                  <Clock class="w-3 h-3" /> 刷新
                </button>
                <button @click="clearNotifLogs" class="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-600 rounded-btn hover:bg-red-100 transition-colors text-xs font-bold border border-red-200">
                  <Trash2 class="w-3 h-3" /> 清空日志
                </button>
              </div>
            </div>
            <div class="flex gap-2 mb-4">
              <select v-model="notifLogsFilter.clientKeyId" @change="fetchNotifLogs(1)" class="px-3 py-1.5 border border-primary rounded-btn text-xs focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input">
                <option value="all">全部 App</option>
                <option v-for="key in clientKeys" :key="key.id" :value="key.id">{{ key.name }}</option>
              </select>
              <select v-model="notifLogsFilter.status" @change="fetchNotifLogs(1)" class="px-3 py-1.5 border border-primary rounded-btn text-xs focus:ring-accent focus:ring-2 focus:border-transparent outline-none bg-surface-input">
                <option value="all">全部状态</option>
                <option value="success">成功</option>
                <option value="error">失败</option>
              </select>
            </div>
            <div v-if="notifLogs.length > 0" class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-surface-elevated border-b border-primary text-secondary">
                  <tr>
                    <th class="px-3 py-2 font-medium">时间</th>
                    <th class="px-3 py-2 font-medium">App</th>
                    <th class="px-3 py-2 font-medium">规则名称</th>
                    <th class="px-3 py-2 font-medium">通知类型</th>
                    <th class="px-3 py-2 font-medium">状态</th>
                    <th class="px-3 py-2 font-medium">URL</th>
                    <th class="px-3 py-2 font-medium text-right">响应码</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="l in notifLogs" :key="l.id" @click="openNotifLogDetail(l)" class="hover:bg-surface-elevated cursor-pointer transition-colors">
                    <td class="px-3 py-2 font-mono text-[10px] text-secondary whitespace-nowrap">{{ formatTime(l.createdAt) }}</td>
                    <td class="px-3 py-2 font-medium">{{ l.clientKeyName || ('App #' + l.clientKeyId) }}</td>
                    <td class="px-3 py-2 font-medium text-secondary text-[11px] max-w-[120px] truncate">{{ l.ruleName || '-' }}</td>
                    <td class="px-3 py-2"><span :class="l.notificationType === 'error' ? 'bg-red-50 text-red-700' : l.notificationType === 'tool_use_confirmation' ? 'bg-amber-50 text-amber-700' : 'accent-soft text-accent'" class="px-2 py-0.5 rounded text-[10px] font-bold">{{ l.notificationType === 'error' ? '错误通知' : l.notificationType === 'tool_use_confirmation' ? '等待确认' : '对话完成' }}</span></td>
                    <td class="px-3 py-2">
                      <span :class="l.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'" class="px-2 py-0.5 rounded text-[10px] font-bold">{{ l.status === 'success' ? '成功' : '失败' }}</span>
                    </td>
                    <td class="px-3 py-2 text-secondary truncate max-w-[300px]">{{ l.webhookUrl }}</td>
                    <td class="px-3 py-2 text-right font-mono text-[10px] max-w-[200px] truncate"
                        :class="l.status === 'error' ? 'text-red-600' : (l.responseStatusCode && l.responseStatusCode < 400 ? 'text-green-600' : 'text-red-600')"
                        :title="l.status === 'error' ? l.errorMessage || '' : ''">
                      {{ l.status === 'error' && l.errorMessage ? l.errorMessage.substring(0, 30) + (l.errorMessage.length > 30 ? '…' : '') : (l.responseStatusCode || '-') }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="flex items-center justify-between mt-4 pt-3 border-t border-primary">
                <div class="flex items-center gap-3">
                  <span class="text-xs text-tertiary">共 {{ notifLogsTotal }} 条</span>
                  <select v-model.number="notifLogsPageSize" @change="fetchNotifLogs(1)" class="px-2 py-1 text-xs border border-primary rounded-btn outline-none bg-surface-input">
                    <option :value="20">20 条/页</option>
                    <option :value="50">50 条/页</option>
                    <option :value="100">100 条/页</option>
                  </select>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-secondary">第 {{ notifLogsPage }} / {{ notifLogsTotalPages }} 页</span>
                  <div class="flex gap-1">
                    <button :disabled="notifLogsPage <= 1" @click="fetchNotifLogs(notifLogsPage - 1)" class="px-3 py-1.5 text-xs border border-primary rounded-btn hover:bg-surface-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-bold">上一页</button>
                    <button :disabled="notifLogsPage >= notifLogsTotalPages" @click="fetchNotifLogs(notifLogsPage + 1)" class="px-3 py-1.5 text-xs border border-primary rounded-btn hover:bg-surface-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-bold">下一页</button>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="notifLogs.length === 0 && notifLogsTotal === 0 && notifLogsFilter.clientKeyId === 'all' && notifLogsFilter.status === 'all'" class="text-xs text-tertiary">暂无推送日志。</div>
            <div v-else-if="notifLogs.length === 0" class="text-xs text-tertiary">没有符合条件的记录，请调整筛选条件。</div>
          </div>

          <!-- 推送日志详情 Modal -->
          <div v-if="selectedNotifLog" class="modal-overlay" @click.self="closeNotifLogDetail">
            <div class="glow-card w-full max-w-2xl max-h-[90vh] flex flex-col shadow-modal overflow-hidden">
              <div class="p-5 border-b border-primary flex justify-between items-center">
                <div>
                  <h3 class="text-lg font-bold text-primary">推送详情</h3>
                  <p class="text-xs text-secondary mt-0.5">{{ selectedNotifLog.ruleName || '未命名规则' }}</p>
                </div>
                <button type="button" @click="closeNotifLogDetail" class="p-1.5 hover:bg-surface-elevated rounded-full transition-colors">
                  <X class="w-5 h-5 text-tertiary" />
                </button>
              </div>
              <div v-if="notifLogDetailLoading" class="flex flex-col items-center justify-center gap-3 py-16 text-secondary">
                <Loader2 class="w-8 h-8 animate-spin text-accent" />
                <p class="text-sm">正在加载推送详情…</p>
              </div>
              <div v-else-if="notifLogDetailError" class="m-5 rounded-btn border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {{ notifLogDetailError }}
              </div>
              <div v-else class="flex-1 overflow-auto p-5 space-y-4">
                <div class="grid grid-cols-2 gap-3 text-sm">
                  <div><span class="text-secondary">方法:</span> <span class="font-mono font-medium">{{ selectedNotifLog.httpMethod }}</span></div>
                  <div><span class="text-secondary">状态:</span> <span :class="selectedNotifLog.status === 'success' ? 'text-green-600 font-bold' : 'text-red-600 font-bold'">{{ selectedNotifLog.status === 'success' ? '成功' : '失败' }}</span></div>
                  <div class="col-span-2"><span class="text-secondary">URL:</span> <span class="font-mono text-xs break-all">{{ selectedNotifLog.webhookUrl }}</span></div>
                  <div v-if="selectedNotifLog.responseStatusCode"><span class="text-secondary">响应码:</span> <span class="font-mono">{{ selectedNotifLog.responseStatusCode }}</span></div>
                  <div v-if="selectedNotifLog.errorMessage" class="col-span-2"><span class="text-secondary">错误:</span> <span class="text-red-600">{{ selectedNotifLog.errorMessage }}</span></div>
                </div>
                <div v-if="selectedNotifLog.requestHeaders" class="space-y-1">
                  <span class="text-xs text-secondary font-medium">请求 Headers</span>
                  <pre class="bg-gray-900 text-gray-100 p-3 rounded-btn overflow-auto text-[10px] leading-relaxed max-h-[200px]">{{ formatJson(selectedNotifLog.requestHeaders) }}</pre>
                </div>
                <div v-if="selectedNotifLog.requestBodyPreview" class="space-y-1">
                  <span class="text-xs text-secondary font-medium">请求 Body</span>
                  <pre class="bg-gray-900 text-gray-100 p-3 rounded-btn overflow-auto text-[10px] leading-relaxed max-h-[200px]">{{ formatJson(selectedNotifLog.requestBodyPreview) }}</pre>
                </div>
                <div v-if="selectedNotifLog.responseBodyPreview" class="space-y-1">
                  <span class="text-xs text-secondary font-medium">响应 Body</span>
                  <pre class="bg-gray-900 text-gray-100 p-3 rounded-btn overflow-auto text-[10px] leading-relaxed max-h-[200px]">{{ formatJson(selectedNotifLog.responseBodyPreview) }}</pre>
                </div>
              </div>
            </div>
          </div>
          </div>

        <!-- Logs View -->
        <div v-if="activeTab === 'logs'" class="space-y-4">
          <div class="flex flex-col lg:flex-row gap-3 lg:justify-between lg:items-center mb-4">
            <div class="flex flex-col gap-2">
              <h3 class="text-sm font-medium text-secondary uppercase tracking-wider">对话历史记录</h3>
              <div class="flex flex-wrap gap-2">
                <button 
                  @click="selectedClientKey = 'all'; logsPage = 1; fetchLogs()"
                  :class="['px-3 py-1 rounded text-xs font-bold transition-all border', 
                    selectedClientKey === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-surface-elevated text-secondary border-primary hover:border-accent/50']"
                >
                  全部客户端
                </button>
                <button 
                  v-for="key in clientKeys" 
                  :key="key.id"
                  @click="selectedClientKey = key.id; logsPage = 1; fetchLogs()"
                  :style="selectedClientKey === key.id ? { backgroundColor: `rgb(${getKeyColor(key.id)})`, color: '#fff', borderColor: `rgb(${getKeyColor(key.id)})` } : keyBadgeStyle(key.id)"
                  class="px-3 py-1 rounded text-xs font-bold transition-all border shadow-card"
                >
                  {{ key.name }}
                </button>
              </div>
            </div>
            <button 
              @click="clearLogs"
              class="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-btn hover:bg-red-100 transition-colors text-sm font-bold border border-red-200"
            >
              <Trash2 class="w-4 h-4" />
              清空对话日志
            </button>
          </div>
          <div v-if="hasNewLogs" class="accent-soft border border-blue-200 text-accent rounded-btn px-4 py-3 flex items-center justify-between">
            <div class="text-sm font-medium">有新日志到达</div>
            <button @click="goToLatestLogs" class="px-3 py-1.5 bg-accent text-white rounded-btn text-xs font-bold hover:bg-accent-hover transition-colors">
              加载最新
            </button>
          </div>
          <div class="glow-card overflow-hidden">
            <div class="overflow-x-auto">
            <table class="w-full min-w-[1100px] text-left text-sm">
              <thead class="bg-surface-elevated border-b border-primary">
                <tr>
                  <th class="px-6 py-4 font-semibold text-secondary">时间</th>
                  <th class="px-6 py-4 font-semibold text-secondary">客户端 Key</th>
                  <th class="px-6 py-4 font-semibold text-secondary">厂商</th>
                  <th class="px-6 py-4 font-semibold text-secondary">模型</th>
                  <th class="px-6 py-4 font-semibold text-secondary">路径</th>
                  <th class="px-6 py-4 font-semibold text-secondary">耗时</th>
                  <th class="px-6 py-4 font-semibold text-secondary">状态</th>
                  <th class="px-6 py-4 font-semibold text-secondary text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                <tr v-for="log in logs" :key="log.id" class="hover:bg-surface-elevated transition-colors">
                  <td class="px-6 py-4 text-secondary font-mono text-xs">{{ formatTime(log.requestAt || log.createdAt) }}</td>
                  <td class="px-6 py-4">
                    <span :style="keyBadgeStyle(log.clientKeyId)" class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tight border">{{ log.clientKeyName || '未知' }}</span>
                    <span v-if="log.clientApp" class="ml-1 text-[8px] text-tertiary italic">{{ log.clientApp }}</span>
                  </td>
                  <td class="px-6 py-4 font-medium">{{ log.providerName }}</td>
                  <td class="px-6 py-4 font-mono text-xs">
                    <template v-if="!log.actualModel || log.model === log.actualModel">
                      <span :class="isMagicProxyModel(log.model) ? 'text-green-600 font-bold' : 'text-secondary'">{{ log.model }}</span>
                    </template>
                    <template v-else>
                      <span class="text-green-600 font-bold">{{ log.model }}</span>
                      <span class="mx-2 text-tertiary">→</span>
                      <span class="text-accent font-medium">{{ log.actualModel }}</span>
                    </template>
                  </td>
                  <td class="px-6 py-4 text-secondary font-mono text-[10px] max-w-[200px]">
                    <span class="text-tertiary">{{ log.httpMethod || 'POST' }}</span>
                    <span class="block truncate text-secondary" :title="log.requestPath || ''">{{ log.requestPath || '—' }}</span>
                  </td>
                  <td class="px-6 py-4 text-secondary font-mono text-xs">
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
                      {{ log.responseBody && log.responseBody.includes('Missing API Key') ? '缺少 API Key' : log.responseBody && log.responseBody.includes('Invalid API Key') ? '无效 API Key' : log.responseBody && log.responseBody.includes('disabled') ? 'Key 已禁用' : log.responseBody && log.responseBody.includes('协议错误') ? '协议错误' : '错误' }}
                    </span>
                    <p v-if="Number(log.isStream) === 1" class="mt-1 text-[9px] text-secondary font-mono">
                      流式<span v-if="Number(log.streamBroken) === 1" class="text-red-600"> · 流中断</span>
                    </p>
                  </td>
                  <td class="px-6 py-4 text-right">
                    <button 
                      type="button"
                      @click="openLogDetail(log)"
                      class="text-accent hover:underline font-medium"
                    >
                      查看详情
                    </button>
                  </td>
                </tr>
                <tr v-if="!logs.length">
                  <td colspan="8" class="px-6 py-10 text-center text-tertiary text-sm">暂无数据</td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
          <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between glow-card px-4 sm:px-6 py-4">
            <div class="flex flex-wrap items-center gap-3 text-xs text-secondary">
              <span>总计 {{ logsTotal }} 条</span>
              <div class="flex items-center gap-2">
                <span>每页</span>
                <select v-model.number="logsPageSize" @change="logsPage = 1; fetchLogs()" class="px-2 py-1 border border-primary rounded-btn bg-surface-input text-xs">
                  <option :value="20">20</option>
                  <option :value="50">50</option>
                  <option :value="100">100</option>
                </select>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <button @click="prevLogsPage" :disabled="logsPage <= 1" class="px-3 py-1.5 rounded-btn border border-primary text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-elevated transition-colors">
                上一页
              </button>
              <span class="text-xs text-secondary font-bold">第 {{ logsPage }} / {{ logsTotalPages }} 页</span>
              <button @click="nextLogsPage" :disabled="logsPage >= logsTotalPages" class="px-3 py-1.5 rounded-btn border border-primary text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-elevated transition-colors">
                下一页
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- 导出对话框 -->
    <div v-if="showExportDialog" class="modal-overlay">
      <div class="glow-card shadow-modal max-w-md w-full p-6">
        <h3 class="text-lg font-semibold text-primary mb-4">导出厂商配置</h3>

        <div class="space-y-4">
          <div class="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-btn">
            <input
              v-model="exportIncludeApiKey"
              type="checkbox"
              id="includeApiKey"
              class="w-5 h-5 text-amber-600 rounded focus:ring-amber-500"
            >
            <label for="includeApiKey" class="text-sm">
              <span class="font-medium text-primary">包含 API Key</span>
              <p class="text-secondary mt-1">⚠️ 警告：导出的文件包含敏感信息，请勿随意分享或公开存储！</p>
            </label>
          </div>

          <div class="p-4 accent-soft border border-blue-200 rounded-btn">
            <p class="text-sm text-secondary">
              导出内容包括：
            </p>
            <ul class="text-sm text-secondary mt-2 space-y-1 list-disc list-inside">
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
            class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors"
          >
            确认导出
          </button>
          <button
            @click="showExportDialog = false"
            class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>

    <!-- 导入对话框 -->
    <div v-if="showImportDialog" class="modal-overlay">
      <!-- 步骤1: 选择文件 -->
      <div v-if="importStep === 'file'" class="glow-card shadow-modal max-w-md w-full p-6">
        <h3 class="text-lg font-semibold text-primary mb-4">导入厂商配置</h3>

        <div
          @dragover.prevent
          @drop.prevent="handleImportDrop"
          @click="$refs.importFileInput?.click()"
          class="border-2 border-dashed border-primary rounded-btn p-8 text-center cursor-pointer hover:border-accent/50 hover:bg-accent-soft transition-colors"
        >
          <Upload class="w-12 h-12 mx-auto text-tertiary mb-3" />
          <p class="text-sm text-secondary">拖放 JSON 文件到此处，或点击选择文件</p>
          <p class="text-xs text-tertiary mt-2">支持 .json 格式的厂商配置文件</p>
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
            class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors"
          >
            取消
          </button>
        </div>
      </div>

      <!-- 步骤2: 处理冲突 -->
      <div v-if="importStep === 'conflict'" class="glow-card shadow-modal max-w-lg w-full max-h-[80vh] overflow-y-auto p-6">
        <h3 class="text-lg font-semibold text-primary mb-2">处理冲突</h3>
        <p class="text-sm text-secondary mb-4">以下厂商名称已存在，请选择处理方式：</p>

        <div class="space-y-3">
          <div
            v-for="item in importConflicts"
            :key="item.provider.name"
            class="p-4 border border-primary rounded-btn"
          >
            <div class="flex items-center justify-between mb-3">
              <span class="font-medium text-primary">{{ item.provider.name }}</span>
              <span class="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full">冲突</span>
            </div>
            <div class="flex gap-2">
              <button
                @click="importMergeStrategy[item.provider.name] = 'skip'"
                :class="importMergeStrategy[item.provider.name] === 'skip' ? 'ring-2 ring-blue-500 accent-soft' : 'bg-surface-elevated'"
                class="flex-1 px-3 py-2 rounded-btn text-sm font-medium transition-colors"
              >
                跳过
              </button>
              <button
                @click="importMergeStrategy[item.provider.name] = 'overwrite'"
                :class="importMergeStrategy[item.provider.name] === 'overwrite' ? 'ring-2 ring-blue-500 accent-soft' : 'bg-surface-elevated'"
                class="flex-1 px-3 py-2 rounded-btn text-sm font-medium transition-colors"
              >
                覆盖
              </button>
            </div>
          </div>
        </div>

        <div class="flex gap-3 mt-6">
          <button
            @click="doImport"
            class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors"
          >
            确认导入
          </button>
          <button
            @click="showImportDialog = false"
            class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors"
          >
            取消
          </button>
        </div>
      </div>

      <!-- 步骤3: 导入结果 -->
      <div v-if="importStep === 'result'" class="glow-card shadow-modal max-w-md w-full p-6">
        <h3 class="text-lg font-semibold text-primary mb-4">导入完成</h3>

        <div class="space-y-2 max-h-60 overflow-y-auto">
          <div
            v-for="result in importResults"
            :key="result.name"
            class="flex items-center justify-between p-3 rounded-btn"
            :class="{
              'bg-green-50': result.action === 'created',
              'bg-amber-50': result.action === 'overwritten',
              'bg-surface-elevated': result.action === 'skipped'
            }"
          >
            <span class="font-medium">{{ result.name }}</span>
            <span class="text-xs px-2 py-1 rounded-full" :class="{
              'bg-green-200 text-green-800': result.action === 'created',
              'bg-amber-200 text-amber-800': result.action === 'overwritten',
              'bg-surface-elevated text-primary': result.action === 'skipped'
            }">
              {{ result.action === 'created' ? '已创建' : result.action === 'overwritten' ? '已覆盖' : '已跳过' }}
            </span>
          </div>
        </div>

        <button
          @click="closeImportDialog"
          class="w-full mt-6 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors"
        >
          关闭
        </button>
      </div>
    </div>

    <!-- 全局配置导入对话框 -->
    <div v-if="showGlobalImportDialog" class="modal-overlay">
      <div class="glow-card shadow-modal max-w-lg w-full p-6">
        <h3 class="text-lg font-semibold text-primary mb-2">导入全局配置</h3>
        <p class="text-sm text-secondary mb-4">将覆盖当前业务配置（厂商、模型、应用、规则），不影响管理员用户名和密码。</p>

        <div class="rounded-btn border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4">
          导入前建议先执行“导出全局配置”作为备份。
        </div>

        <input
          type="file"
          accept=".json"
          @change="handleGlobalImportFileSelect"
          class="block w-full text-sm text-secondary file:mr-3 file:px-3 file:py-2 file:rounded-btn file:border-0 file:bg-surface-elevated file:text-secondary hover:file:bg-surface-elevated/80"
        />
        <p class="text-xs text-secondary mt-2">
          {{ globalImportData ? '已选择并解析配置文件，可执行导入。' : '请选择导出的全局配置 JSON 文件。' }}
        </p>

        <div class="flex gap-3 mt-6">
          <button
            @click="doGlobalImport"
            :disabled="!globalImportData"
            class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            确认导入
          </button>
          <button
            @click="showGlobalImportDialog = false"
            class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>

    <!-- Copy Provider Modal -->
    <div v-if="showCopyProviderDialog" class="modal-overlay overflow-y-auto">
      <div class="glow-card shadow-modal w-full max-w-lg p-8 my-8 max-h-[90vh] overflow-y-auto">
        <h3 class="text-xl font-bold mb-1">复制厂商</h3>
        <p class="text-xs text-secondary mb-6">填写新厂商名称；基础地址、托管 Key、类型默认与源厂商一致，可直接修改。模型列表默认与源一致，可自行增删；保存后会创建新厂商并关联模型。</p>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">新厂商名称 <span class="text-red-500">*</span></label>
            <input v-model="copyProviderForm.name" type="text" placeholder="例如：生产环境-OpenAI" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">厂商类型</label>
            <select v-model="copyProviderForm.type" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none">
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic 兼容</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">基础地址 (Base URL)</label>
            <input v-model="copyProviderForm.baseUrl" type="text" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">托管 API Key</label>
            <div class="relative">
              <input v-model="copyProviderForm.apiKey" :type="showCopyApiKey ? 'text' : 'password'" placeholder="默认已填入源厂商 Key，可修改" class="w-full px-4 py-2 pr-10 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
              <button
                @click="showCopyApiKey = !showCopyApiKey"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-elevated transition-colors"
                :title="showCopyApiKey ? '隐藏' : '显示'"
              >
                <EyeOff v-if="showCopyApiKey" class="w-4 h-4 text-tertiary" />
                <Eye v-else class="w-4 h-4 text-tertiary" />
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between py-2">
            <div>
              <label class="block text-xs font-bold text-tertiary uppercase mb-0.5">协议强制转换</label>
              <p class="text-[10px] text-tertiary">开启后只接受非原生协议的客户端请求并自动转换</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" v-model="copyProviderForm.protocolConvert" class="sr-only peer" />
              <div class="w-11 h-6 bg-surface-elevated peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-primary after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
            </label>
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">默认模型（保存后生效）</label>
            <select v-model="copyDefaultModelName" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none text-sm">
              <option value="">暂不设置默认（创建后在卡片上点选）</option>
              <option v-for="n in copyModelNamesForSelect" :key="'def-' + n" :value="n">{{ n }}</option>
            </select>
          </div>
          <div>
            <div class="flex justify-between items-center mb-2">
              <span class="text-xs font-bold text-tertiary uppercase">模型列表</span>
            </div>
            <div class="space-y-2 max-h-48 overflow-y-auto rounded-btn border border-primary p-2 bg-surface-elevated/80">
              <div v-for="(row, idx) in copyProviderModelNames" :key="'cm-' + idx" class="flex gap-2 items-center">
                <input
                  v-model="copyProviderModelNames[idx]"
                  type="text"
                  placeholder="模型名"
                  class="flex-1 min-w-0 px-3 py-2 text-sm border border-primary rounded-btn bg-white focus:ring-accent focus:ring-2 focus:border-transparent outline-none"
                />
                <button type="button" @click="removeCopyModelAt(idx)" class="shrink-0 p-2 text-red-600 hover:bg-red-50 rounded-btn" title="删除">
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
              <p v-if="!copyProviderModelNames.length" class="text-xs text-tertiary py-2 text-center">暂无模型，可在下方添加</p>
            </div>
            <div class="flex gap-2 mt-2">
              <input
                v-model="newCopyModelRow"
                type="text"
                placeholder="新模型名称"
                class="flex-1 px-3 py-2 text-sm border border-primary rounded-btn focus:ring-accent focus:ring-2 outline-none"
                @keydown.enter.prevent="addCopyModelRow"
              />
              <button type="button" @click="addCopyModelRow" class="px-3 py-2 text-sm font-bold bg-surface-elevated border border-primary rounded-btn hover:bg-surface-elevated">添加</button>
            </div>
          </div>
        </div>
        <div class="flex gap-3 mt-8">
          <button type="button" @click="closeCopyProviderDialog" class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors">取消</button>
          <button type="button" @click="submitCopyProvider" class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold">创建副本</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Provider Modal -->
    <div v-if="showAddProvider || editingProvider" class="modal-overlay">
      <div class="glow-card shadow-modal w-full max-w-md p-8">
        <h3 class="text-xl font-bold mb-6">{{ editingProvider ? '编辑厂商配置' : '添加厂商配置' }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">厂商名称</label>
            <input v-model="(editingProvider || newProvider).name" type="text" placeholder="例如: GPT-4 生产线" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">厂商类型</label>
            <select v-model="(editingProvider || newProvider).type" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none">
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic 兼容</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">基础地址 (Base URL)</label>
            <input v-model="(editingProvider || newProvider).baseUrl" type="text" placeholder="https://api.openai.com" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">托管 API Key</label>
            <div class="relative">
              <input v-model="(editingProvider || newProvider).apiKey" :type="showProviderApiKey ? 'text' : 'password'" placeholder="sk-..." class="w-full px-4 py-2 pr-10 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
              <button
                @click="showProviderApiKey = !showProviderApiKey"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-elevated transition-colors"
                :title="showProviderApiKey ? '隐藏' : '显示'"
              >
                <EyeOff v-if="showProviderApiKey" class="w-4 h-4 text-tertiary" />
                <Eye v-else class="w-4 h-4 text-tertiary" />
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between py-2">
            <div>
              <label class="block text-xs font-bold text-tertiary uppercase mb-0.5">协议强制转换</label>
              <p class="text-[10px] text-tertiary">开启后只接受非原生协议的客户端请求并自动转换</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" v-model="(editingProvider || newProvider).protocolConvert" class="sr-only peer" />
              <div class="w-11 h-6 bg-surface-elevated peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-primary after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
            </label>
          </div>
        </div>
        <div class="flex gap-3 mt-8">
          <button @click="showAddProvider = false; editingProvider = null" class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors">取消</button>
          <button @click="editingProvider ? updateProvider() : addProvider()" class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold">保存配置</button>
        </div>
      </div>
    </div>

    <div v-if="showAddProviderModel" class="modal-overlay">
      <div class="glow-card shadow-modal w-full max-w-md p-8">
        <h3 class="text-xl font-bold mb-6">为厂商添加模型</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">厂商</label>
            <div class="px-4 py-2 border border-primary rounded-btn bg-surface-elevated text-sm font-bold text-secondary">{{ providerModelTargetProvider?.name || '-' }}</div>
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">模型名称</label>
            <input v-model="newProviderModelName" type="text" placeholder="例如: glm-4.7" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
        </div>
        <p class="text-[10px] text-tertiary mt-2">注意：模型名称区分大小写，将以您输入的内容为准进行存储和显示。</p>
        <div class="flex gap-3 mt-8">
          <button @click="showAddProviderModel = false; providerModelTargetProvider = null; newProviderModelName = ''" class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors">取消</button>
          <button @click="addProviderModel" class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold">添加</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit App Modal -->
    <div v-if="showAddApp || editingApp" class="modal-overlay">
      <div class="glow-card shadow-modal w-full max-w-md p-8">
        <h3 class="text-xl font-bold mb-6">{{ editingApp ? '应用配置' : '创建新应用' }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">应用名称</label>
            <input v-model="(editingApp || newClientApp).name" type="text" placeholder="例如: 我的应用-1" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">绑定厂商 (Provider)</label>
            <select v-model="(editingApp || newClientApp).providerId" @change="onClientAppProviderChange(editingApp || newClientApp)" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none">
              <option :value="null">默认厂商 (全局生效)</option>
              <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">绑定模型 (Model)</label>
            <select v-model="(editingApp || newClientApp).managedModelId" :disabled="!(editingApp || newClientApp).providerId" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none disabled:bg-surface-elevated disabled:text-tertiary disabled:cursor-not-allowed">
              <option
                v-for="m in getModelOptionsForProvider((editingApp || newClientApp).providerId, (editingApp || newClientApp).managedModelId)"
                :key="m.id"
                :value="m.id"
              >
                {{ m.name }}
              </option>
            </select>
            <p v-if="!(editingApp || newClientApp).providerId" class="text-[10px] text-tertiary mt-2">选择默认厂商时，模型固定为默认。</p>
            <p v-else-if="!(editingApp || newClientApp).managedModelId" class="text-[10px] text-red-600 mt-2">已选择厂商，必须选择该厂商中的一个模型。</p>
          </div>
        </div>
        <p class="text-[10px] text-tertiary mt-4 italic">当厂商为默认时，模型固定为默认；当绑定了厂商后，才允许为该应用指定模型。</p>
        <div class="flex gap-3 mt-8">
          <button @click="showAddApp = false; editingApp = null" class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors">取消</button>
          <button @click="editingApp ? updateClientApp() : addClientApp()" class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold">保存应用</button>
        </div>
      </div>
    </div>

    <div v-if="showAddAdminUser || editingAdminUser" class="modal-overlay">
      <div class="glow-card shadow-modal w-full max-w-md p-8">
        <h3 class="text-xl font-bold mb-6">{{ editingAdminUser ? '编辑用户' : '添加用户' }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">用户名</label>
            <input v-model="(editingAdminUser || newAdminUser).username" type="text" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div v-if="!editingAdminUser">
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">初始密码</label>
            <input v-model="newAdminUser.password" type="password" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
            <p class="text-[10px] text-tertiary mt-1">用户首次登录会被要求强制修改密码。</p>
          </div>
          <div class="flex items-center justify-between p-3 bg-surface-elevated rounded-btn border border-primary">
            <div>
              <p class="text-xs font-bold text-secondary">状态</p>
              <p class="text-[10px] text-tertiary">禁用后无法登录</p>
            </div>
            <button
              @click="(editingAdminUser || newAdminUser).enabled = (editingAdminUser || newAdminUser).enabled ? 0 : 1"
              :class="(editingAdminUser || newAdminUser).enabled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-surface-elevated text-secondary border-primary'"
              class="px-3 py-1.5 rounded-btn border text-xs font-bold"
            >
              {{ (editingAdminUser || newAdminUser).enabled ? '已启用' : '已禁用' }}
            </button>
          </div>
        </div>
        <div class="flex gap-3 mt-8">
          <button @click="showAddAdminUser = false; editingAdminUser = null" class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors">取消</button>
          <button @click="editingAdminUser ? updateAdminUser() : addAdminUser()" class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold">保存用户</button>
        </div>
      </div>
    </div>

    <div v-if="resetPasswordUser" class="modal-overlay">
      <div class="glow-card shadow-modal w-full max-w-md p-8">
        <h3 class="text-xl font-bold mb-2">重置密码</h3>
        <p class="text-xs text-secondary mb-6">用户 {{ resetPasswordUser.username }} 下次登录将强制修改密码。</p>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">新密码</label>
            <input v-model="resetPasswordValue" type="password" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
        </div>
        <div class="flex gap-3 mt-8">
          <button @click="resetPasswordUser = null; resetPasswordValue = ''" class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors">取消</button>
          <button @click="resetAdminPassword" class="flex-1 px-4 py-2 bg-amber-600 text-white rounded-btn hover:bg-amber-700 transition-colors font-bold">确认重置</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Model Modal -->
    <div v-if="showAddModel" class="modal-overlay">
      <div class="glow-card shadow-modal w-full max-w-md p-8">
        <h3 class="text-xl font-bold mb-6">添加模型</h3>
        <p class="text-xs text-secondary mb-4">厂商：<span class="font-bold text-secondary">{{ providers.find(p => p.id === selectedModelProviderId)?.name || '当前生效厂商' }}</span></p>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">模型名称</label>
            <input v-model="newManagedModel.name" type="text" placeholder="例如: gpt-4o 或 claude-3-5-sonnet" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
        </div>
        <p class="text-[10px] text-tertiary mt-4">注意：模型名称区分大小写，将以您输入的内容为准进行存储和显示。</p>
        <div class="flex gap-3 mt-8">
          <button @click="showAddModel = false" class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors">取消</button>
          <button @click="addManagedModel" class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold">保存配置</button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Model Rule Modal -->
    <div v-if="showAddModelRule || editingModelRule" class="modal-overlay">
      <div class="glow-card shadow-modal w-full max-w-md p-8">
        <h3 class="text-xl font-bold mb-6">{{ editingModelRule ? '编辑模型规则' : '添加模型规则' }}</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">匹配模式 (支持*)</label>
            <input v-model="(editingModelRule || newModelRule).pattern" type="text" placeholder="例如: gpt-* 或 glm-4.7" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">转换为 (Target Model)</label>
            <input v-model="(editingModelRule || newModelRule).targetModel" type="text" placeholder="例如: gpt-4o 或 glm-4.7" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">优先级</label>
            <input v-model.number="(editingModelRule || newModelRule).priority" type="number" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div v-if="editingModelRule" class="flex items-center justify-between p-3 bg-surface-elevated rounded-btn border border-primary">
            <div>
              <p class="text-xs font-bold text-secondary">状态</p>
              <p class="text-[10px] text-tertiary">禁用后不会参与匹配</p>
            </div>
            <button
              @click="editingModelRule.enabled = editingModelRule.enabled ? 0 : 1"
              :class="editingModelRule.enabled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-surface-elevated text-secondary border-primary'"
              class="px-3 py-1.5 rounded-btn border text-xs font-bold"
            >
              {{ editingModelRule.enabled ? '已启用' : '已禁用' }}
            </button>
          </div>
        </div>
        <p class="text-[10px] text-tertiary mt-4">大小写敏感；按优先级从高到低匹配，命中第一条后生效。</p>
        <div class="flex gap-3 mt-8">
          <button @click="showAddModelRule = false; editingModelRule = null" class="flex-1 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors">取消</button>
          <button @click="editingModelRule ? updateModelRule() : addModelRule()" class="flex-1 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold">保存规则</button>
        </div>
      </div>
    </div>

    <!-- Log Detail Modal -->
    <div v-if="selectedLog" class="modal-overlay" @click.self="closeLogDetail">
      <div class="glow-card shadow-modal w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div class="p-6 border-b border-primary flex justify-between items-center">
          <div>
            <h3 class="text-xl font-bold">对话详情</h3>
            <p class="text-sm text-secondary">
              <span v-if="!selectedLog.actualModel || selectedLog.model === selectedLog.actualModel">{{ selectedLog.model }}</span>
              <span v-else>{{ selectedLog.model }} → {{ selectedLog.actualModel }}</span>
              @ {{ selectedLog.providerName }}
            </p>
          </div>
          <button type="button" @click="closeLogDetail" class="p-2 hover:bg-surface-elevated rounded-full transition-colors">
            <X class="w-6 h-6 text-tertiary" />
          </button>
        </div>
        <div v-if="logDetailError" class="mx-6 mt-2 rounded-btn border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {{ logDetailError }}
        </div>
        <div v-if="logDetailLoading" class="flex-1 flex flex-col items-center justify-center gap-3 py-24 text-secondary">
          <Loader2 class="w-10 h-10 animate-spin text-accent" />
          <p class="text-sm">正在加载完整日志…</p>
        </div>
        <div v-else-if="!logDetailError" class="flex-1 overflow-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="lg:col-span-2 flex flex-col sm:flex-row gap-4 mb-2">
            <div class="flex-1 p-3 bg-surface-elevated rounded-btn border border-primary">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">客户端密钥</p>
              <span :style="keyBadgeStyle(selectedLog.clientKeyId)" class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tight border inline-block">{{ selectedLog.clientKeyName || '未知' }}</span>
              <p v-if="selectedLog.clientApp" class="text-[10px] text-tertiary mt-0.5">{{ selectedLog.clientApp }}</p>
            </div>
            <div class="flex-1 p-3 bg-surface-elevated rounded-btn border border-primary">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">生效厂商</p>
              <p class="text-sm font-medium text-accent">{{ selectedLog.providerName }}</p>
            </div>
            <div class="flex-1 p-3 bg-surface-elevated rounded-btn border border-primary">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">响应耗时</p>
              <p class="text-sm font-medium text-green-700">{{ formatLogLatency(selectedLog) || '计算中...' }}</p>
            </div>
          </div>
          <div class="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2 text-xs">
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">HTTP</p>
              <p class="font-mono text-primary">{{ selectedLog.httpMethod || 'POST' }} <span class="text-secondary">{{ selectedLog.requestPath || '—' }}</span></p>
            </div>
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">客户端 IP</p>
              <p class="font-mono text-primary">{{ selectedLog.clientIp || '—' }}</p>
            </div>
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary sm:col-span-2">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">User-Agent（客户端）</p>
              <p class="font-mono text-secondary break-all">{{ selectedLog.clientUserAgent || '—' }}</p>
            </div>
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary sm:col-span-2">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">User-Agent（发往上游）</p>
              <p class="font-mono text-secondary break-all">{{ selectedLog.proxyUserAgent || '—' }}</p>
            </div>
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">流式 / 中断</p>
              <p class="text-primary">
                {{ Number(selectedLog.isStream) === 1 ? '是' : '否' }}
                <span v-if="selectedLog.responseBody && selectedLog.responseBody.includes('tool_use')" class="text-amber-600 font-bold"> · 工具调用</span>
                <span v-if="Number(selectedLog.isStream) === 1 && Number(selectedLog.streamBroken) === 1" class="text-red-600 font-bold"> · 流中断</span>
              </p>
            </div>
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">上游 / 客户端 HTTP 状态</p>
              <p class="font-mono text-primary">{{ selectedLog.upstreamStatus ?? '—' }} / {{ selectedLog.clientStatus ?? '—' }}</p>
            </div>
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">请求体 / 响应体</p>
              <p class="font-mono text-primary">{{ formatBytes(selectedLog.requestBytes) }} / {{ formatBytes(selectedLog.responseBytes) }}</p>
            </div>
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary">
              <p class="text-[10px] text-tertiary font-bold uppercase mb-1">Token（入 / 出 / 计）</p>
              <p class="font-mono text-primary">{{ selectedLog.tokensIn != null ? formatNumber(selectedLog.tokensIn) : '—' }} / {{ selectedLog.tokensOut != null ? formatNumber(selectedLog.tokensOut) : '—' }} / {{ selectedLog.tokensTotal != null ? formatNumber(selectedLog.tokensTotal) : '—' }}</p>
            </div>
          </div>
          <div class="lg:col-span-2 space-y-2 mb-2">
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary flex items-center gap-3">
              <span class="px-2 py-0.5 bg-blue-100 text-accent rounded text-[10px] font-bold uppercase">客户端 URL</span>
              <code class="text-xs text-secondary font-mono flex-1 truncate">{{ selectedLog.clientUrl || '-' }}</code>
            </div>
            <div class="p-3 bg-surface-elevated rounded-btn border border-primary flex items-center gap-3">
              <span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-bold uppercase">代理目标 URL</span>
              <code class="text-xs text-secondary font-mono flex-1 truncate">{{ selectedLog.targetUrl || '-' }}</code>
            </div>
          </div>
          <div class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center cursor-pointer select-none" @click="expandedSections.clientHeaders = !expandedSections.clientHeaders">
              <div class="flex items-center gap-2">
                <ChevronRight class="w-4 h-4 text-tertiary transition-transform duration-200" :class="{'rotate-90': expandedSections.clientHeaders}" />
                <h4 class="text-xs font-bold text-tertiary uppercase">客户端请求头</h4>
              </div>
            </div>
            <div v-show="expandedSections.clientHeaders">
              <pre class="bg-gray-900 text-gray-100 p-4 rounded-card overflow-auto text-xs leading-relaxed max-h-[600px]">{{ formatJson(selectedLog.clientRequestHeaders) }}</pre>
            </div>
          </div>
          <div class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center cursor-pointer select-none" @click="expandedSections.proxyHeaders = !expandedSections.proxyHeaders">
              <div class="flex items-center gap-2">
                <ChevronRight class="w-4 h-4 text-tertiary transition-transform duration-200" :class="{'rotate-90': expandedSections.proxyHeaders}" />
                <h4 class="text-xs font-bold text-tertiary uppercase">代理请求头（发往上游）</h4>
              </div>
            </div>
            <div v-show="expandedSections.proxyHeaders">
              <pre class="bg-gray-900 text-gray-100 p-4 rounded-card overflow-auto text-xs leading-relaxed max-h-[600px]">{{ formatJson(selectedLog.proxyRequestHeaders) }}</pre>
            </div>
          </div>
          <div class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center cursor-pointer select-none" @click="expandedSections.requestBody = !expandedSections.requestBody">
              <div class="flex items-center gap-2">
                <ChevronRight class="w-4 h-4 text-tertiary transition-transform duration-200" :class="{'rotate-90': expandedSections.requestBody}" />
                <h4 class="text-xs font-bold text-tertiary uppercase">请求正文</h4>
              </div>
              <span class="text-[10px] text-tertiary font-mono">{{ formatTime(selectedLog.requestAt) }}</span>
            </div>
            <div v-show="expandedSections.requestBody">
              <pre class="bg-gray-900 text-gray-100 p-4 rounded-card overflow-auto text-xs leading-relaxed max-h-[600px]">{{ formatJson(selectedLog.requestBody) }}</pre>
            </div>
          </div>
          <div v-if="selectedLog.proxyRequestBody" class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center cursor-pointer select-none" @click="expandedSections.proxyRequestBody = !expandedSections.proxyRequestBody">
              <div class="flex items-center gap-2">
                <ChevronRight class="w-4 h-4 text-tertiary transition-transform duration-200" :class="{'rotate-90': expandedSections.proxyRequestBody}" />
                <h4 class="text-xs font-bold text-tertiary uppercase">代理请求正文（发往上游）</h4>
              </div>
            </div>
            <div v-show="expandedSections.proxyRequestBody">
              <pre class="bg-gray-900 text-gray-100 p-4 rounded-card overflow-auto text-xs leading-relaxed max-h-[600px]">{{ formatJson(selectedLog.proxyRequestBody) }}</pre>
            </div>
          </div>
          <div v-if="selectedLog.proxyResponseBody" class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center cursor-pointer select-none" @click="expandedSections.proxyResponseBody = !expandedSections.proxyResponseBody">
              <div class="flex items-center gap-2">
                <ChevronRight class="w-4 h-4 text-tertiary transition-transform duration-200" :class="{'rotate-90': expandedSections.proxyResponseBody}" />
                <h4 class="text-xs font-bold text-tertiary uppercase">上游原始响应</h4>
              </div>
            </div>
            <div v-show="expandedSections.proxyResponseBody">
              <pre class="bg-gray-900 text-gray-100 p-4 rounded-card overflow-auto text-xs leading-relaxed max-h-[600px]">{{ formatJson(selectedLog.proxyResponseBody) }}</pre>
            </div>
          </div>
          <div class="lg:col-span-2 space-y-4">
            <div class="flex justify-between items-center cursor-pointer select-none" @click="expandedSections.responseBody = !expandedSections.responseBody">
              <div class="flex items-center gap-2">
                <ChevronRight class="w-4 h-4 text-tertiary transition-transform duration-200" :class="{'rotate-90': expandedSections.responseBody}" />
                <h4 class="text-xs font-bold text-tertiary uppercase">响应正文（发往客户端）</h4>
              </div>
              <span v-if="selectedLog.responseAt" class="text-[10px] text-tertiary font-mono">{{ formatTime(selectedLog.responseAt) }}</span>
            </div>
            <div v-show="expandedSections.responseBody">
              <div v-if="selectedLog.status === 'waiting' && !selectedLog.responseBody" class="h-[200px] flex flex-col items-center justify-center text-tertiary gap-4 bg-surface-elevated rounded-card border border-dashed border-primary">
                <Loader2 class="w-12 h-12 animate-spin text-accent" />
                <p class="animate-pulse">正在等待厂商响应...</p>
              </div>
              <pre v-else class="bg-gray-900 text-gray-100 p-4 rounded-card overflow-auto text-xs leading-relaxed max-h-[600px]">{{ formatJson(selectedLog.responseBody) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="mustChangePassword" class="modal-overlay">
      <div class="glow-card shadow-modal w-full max-w-md p-8">
        <h3 class="text-xl font-bold mb-2">请先修改密码</h3>
        <p class="text-xs text-secondary mb-6">首次登录必须修改默认密码后才能继续使用管理功能。</p>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">当前密码</label>
            <input v-model="changePasswordForm.currentPassword" type="password" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">新密码</label>
            <input v-model="changePasswordForm.newPassword" type="password" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-tertiary uppercase mb-1">确认新密码</label>
            <input v-model="changePasswordForm.confirmNewPassword" type="password" class="w-full px-4 py-2 border border-primary rounded-btn focus:ring-accent focus:ring-2 focus:border-transparent outline-none" />
          </div>
        </div>
        <button @click="changePassword" class="w-full mt-6 px-4 py-2 bg-accent text-white rounded-btn hover:bg-accent-hover transition-colors font-bold">
          修改密码并继续
        </button>
        <button @click="logout" class="w-full mt-3 px-4 py-2 border border-primary rounded-btn hover:bg-surface-elevated transition-colors font-bold text-secondary">
          退出登录
        </button>
      </div>
    </div>
  </div>
</template>

<style>
@import './style.css';

mark {
  background-color: #fef08a;
  color: #854d0e;
  border-radius: 2px;
  padding: 0 2px;
}
</style>
