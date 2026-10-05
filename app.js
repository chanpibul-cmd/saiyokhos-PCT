/**
 * ==============================================================================
 * PCT Smart Dashboard - Master Application Engine
 * Supports: Google Apps Script Web App API + Google Sheet GViz Live Sync + Local Snapshot
 * ==============================================================================
 */

// Global Configuration
const APP_CONFIG = {
    SHEET_ID: '1HROsaR5cYs0X-Cv9wxovhsJ3CamliQYHLe-HvedRlw0',
    LOCAL_DATA_PATH: 'data.json',
    DEFAULT_GROUP: 'all',
    THEME_STORAGE_KEY: 'pct_dashboard_theme',
    APPSCRIPT_STORAGE_KEY: 'pct_appscript_url',
    DIRECT_GVIZ_STORAGE_KEY: 'pct_direct_gviz_enabled'
};

// Application State
const STATE = {
    rawData: {
        months_2026: [],
        years_allyear: [],
        data2026: [],
        allyear: [],
        summary: {}
    },
    currentTab: 'overview',
    dataSource: 'local', // 'appscript' | 'gviz' | 'local'
    lastSyncTime: null,
    
    // Filters for data2026
    filters2026: {
        group: 'all',
        status: 'all',
        month: 'all',
        search: ''
    },

    // Filters for allyear
    filtersAllYear: {
        category: 'all',
        part: 'all',
        search: '',
        selectedKpiId: null
    },

    // Owner filter
    selectedOwner: 'all',

    // View mode for data2026 ('table' or 'grid')
    viewMode2026: 'table',

    // Active Chart instances
    charts: {}
};

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    bindEvents();
    loadDashboardData();
});

/* ==============================================================================
   1. Theme Management (Zero-Flash Dark / Light Mode)
   ============================================================================== */
function initTheme() {
    const savedTheme = localStorage.getItem(APP_CONFIG.THEME_STORAGE_KEY) || 'light';
    setTheme(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-bs-theme') || 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem(APP_CONFIG.THEME_STORAGE_KEY, theme);
    
    // Update theme icons & text
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    const sideIcon = document.querySelector('.sidebar-theme-icon');
    
    if (theme === 'dark') {
        if (icon) icon.className = 'fa-solid fa-sun text-warning';
        if (text) text.textContent = 'โหมดสว่าง';
        if (sideIcon) sideIcon.className = 'fa-solid fa-sun text-warning sidebar-theme-icon';
    } else {
        if (icon) icon.className = 'fa-solid fa-moon text-primary';
        if (text) text.textContent = 'โหมดมืด';
        if (sideIcon) sideIcon.className = 'fa-solid fa-moon text-warning sidebar-theme-icon';
    }

    // Refresh active charts with updated theme colors
    updateChartThemeColors();
}

function updateChartThemeColors() {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? '#27354f' : '#e2e8f0';

    Chart.defaults.color = textColor;
    Chart.defaults.borderColor = gridColor;

    // Redraw visible charts
    if (STATE.charts.radarTracer) STATE.charts.radarTracer.update();
    if (STATE.charts.barGroups) STATE.charts.barGroups.update();
    if (STATE.charts.doughnutStatus) STATE.charts.doughnutStatus.update();
    if (STATE.charts.lineYearComparison) STATE.charts.lineYearComparison.update();
    if (STATE.charts.modalTrend) STATE.charts.modalTrend.update();
}

/* ==============================================================================
   2. Data Loading Engine (Triple Redundancy: Apps Script -> GViz Live -> Local)
   ============================================================================== */
async function loadDashboardData(forceRefresh = false) {
    showLoading(true);
    const customUrl = localStorage.getItem(APP_CONFIG.APPSCRIPT_STORAGE_KEY);
    const directGvizEnabled = localStorage.getItem(APP_CONFIG.DIRECT_GVIZ_STORAGE_KEY) !== 'false';

    let loaded = false;

    // 1. Try Google Apps Script Web App if configured
    if (customUrl && customUrl.trim()) {
        try {
            console.log('Fetching from Google Apps Script Web App...');
            const url = customUrl.trim() + (customUrl.includes('?') ? '&' : '?') + 'action=all' + (forceRefresh ? '&nocache=1' : '');
            const resp = await fetch(url, { cache: 'no-store' });
            if (resp.ok) {
                const json = await resp.json();
                if (json && json.status === 'success') {
                    STATE.rawData = json;
                    STATE.dataSource = 'appscript';
                    STATE.lastSyncTime = new Date();
                    loaded = true;
                    showToast('ดึงข้อมูลจาก Google Apps Script สำเร็จ', 'success');
                }
            }
        } catch (err) {
            console.warn('Apps Script fetch failed:', err);
        }
    }

    // 2. Try Direct Google Sheet GViz API if Apps Script is not available or failed
    if (!loaded && directGvizEnabled) {
        try {
            console.log('Fetching live data directly via Google Sheet GViz API...');
            const liveData = await fetchGoogleSheetDirectLive();
            if (liveData && liveData.data2026.length > 0) {
                STATE.rawData = liveData;
                STATE.dataSource = 'gviz';
                STATE.lastSyncTime = new Date();
                loaded = true;
                showToast('ดึงข้อมูลสดจาก Google Sheet (GViz) สำเร็จ', 'info');
            }
        } catch (err) {
            console.warn('Google Sheet GViz fetch failed:', err);
        }
    }

    // 3. Fallback to bundled local JSON snapshot (ลอง data.json และ data/data.json)
    if (!loaded) {
        try {
            console.log('Loading bundled local JSON snapshot...');
            let resp = await fetch('data.json?v=' + Date.now()).catch(() => null);
            if (!resp || !resp.ok) {
                resp = await fetch('data/data.json?v=' + Date.now()).catch(() => null);
            }
            if (resp && resp.ok) {
                const json = await resp.json();
                STATE.rawData = json;
                STATE.dataSource = 'local';
                STATE.lastSyncTime = new Date(json.last_updated || Date.now());
                loaded = true;
                showToast('โหลดข้อมูลสำรอง (Snapshot) สำเร็จ', 'secondary');
            }
        } catch (err) {
            console.error('All data fetch methods failed:', err);
            showToast('เกิดข้อผิดพลาดในการโหลดข้อมูล กรุณาตรวจสอบการเชื่อมต่อ', 'danger');
        }
    }

    showLoading(false);
    updateSourceIndicator();
    populateControls();
    renderCurrentTab();
}

/**
 * Fetch and parse both sheets live via Google Sheet GViz JSON API
 */
async function fetchGoogleSheetDirectLive() {
    const fetchGVizSheet = async (sheetName) => {
        const url = `https://docs.google.com/spreadsheets/d/${APP_CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
        const res = await fetch(url);
        const text = await res.text();
        const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
        return JSON.parse(jsonStr);
    };

    const [gviz26, gvizAy] = await Promise.all([
        fetchGVizSheet('data2026'),
        fetchGVizSheet('allyear')
    ]);

    // Parse data2026 GViz Table
    const table26 = gviz26.table;
    const months26 = table26.cols.slice(4, 16).map(c => (c && c.label) ? c.label.trim() : '');
    
    let items26 = [];
    let currGroup26 = 'Stroke';
    
    table26.rows.forEach((r, idx) => {
        const cells = r.c || [];
        const getVal = (i) => cells[i] ? (cells[i].v !== null && cells[i].v !== undefined ? String(cells[i].v).trim() : '') : '';
        const getFormatted = (i) => cells[i] ? (cells[i].f || getVal(i)) : '';

        const g = getVal(0);
        const kpi = getVal(1);
        const target = getVal(2);
        const owner = getVal(3);
        const vals = months26.map((m, mIdx) => getFormatted(4 + mIdx));
        const total = getFormatted(16);
        const avg = getFormatted(17);

        if (g) currGroup26 = g;
        if (!kpi) return;

        let monthlyMap = {};
        let numVals = [];
        months26.forEach((m, mIdx) => {
            const v = vals[mIdx] || '';
            monthlyMap[m] = v;
            const cleanNum = parseFloat(v.replace(/,/g, ''));
            if (!isNaN(cleanNum) && v !== '') numVals.push(cleanNum);
        });

        const compAvg = numVals.length > 0 ? (numVals.reduce((a,b)=>a+b, 0)/numVals.length) : null;
        const status = evaluateCompliance(target, avg, compAvg);

        items26.push({
            id: 'd26_' + (idx + 1),
            group: currGroup26,
            kpi: kpi,
            target: target,
            owner: owner,
            monthly: monthlyMap,
            total: total,
            avg: avg,
            computed_avg: compAvg !== null ? Math.round(compAvg * 100) / 100 : null,
            status: status
        });
    });

    // Parse allyear GViz Table
    const tableAy = gvizAy.table;
    const yearsAy = tableAy.cols.slice(5, 11).map(c => (c && c.label) ? c.label.trim() : '');
    
    let itemsAy = [];
    let currCatAy = 'A) SAR';
    let currPartAy = 'part III';

    tableAy.rows.forEach((r, idx) => {
        const cells = r.c || [];
        const getVal = (i) => cells[i] ? (cells[i].v !== null && cells[i].v !== undefined ? String(cells[i].v).trim() : '') : '';
        const getFormatted = (i) => cells[i] ? (cells[i].f || getVal(i)) : '';

        const c0 = getVal(0);
        const c1 = getVal(1);
        const kpi = getVal(2);
        const owner = getVal(4);
        const yearVals = yearsAy.map((y, yIdx) => getFormatted(5 + yIdx));

        if (c0) currCatAy = c0;
        if (c1) currPartAy = c1;
        if (!kpi) return;

        let yearsMap = {};
        yearsAy.forEach((y, yIdx) => {
            yearsMap[y] = yearVals[yIdx] || '';
        });

        itemsAy.push({
            id: 'ay_' + (idx + 1),
            category: currCatAy,
            part: currPartAy,
            kpi: kpi,
            owner: owner,
            years: yearsMap
        });
    });

    // Summary calculation
    const active = items26.filter(i => i.status !== 'no_data').length;
    const pass = items26.filter(i => i.status === 'pass').length;
    const fail = items26.filter(i => i.status === 'fail').length;

    return {
        months_2026: months26,
        years_allyear: yearsAy,
        data2026: items26,
        allyear: itemsAy,
        summary: {
            total_kpis_2026: items26.length,
            total_kpis_allyear: itemsAy.length,
            active_kpis_2026: active,
            pass_kpis_2026: pass,
            fail_kpis_2026: fail
        }
    };
}

function evaluateCompliance(target, avgStr, computedAvg) {
    let val = null;
    const parsedAvg = parseFloat(String(avgStr).replace(/,/g, ''));
    if (!isNaN(parsedAvg) && avgStr !== '') val = parsedAvg;
    else if (computedAvg !== null) val = computedAvg;

    if (val === null) return 'no_data';
    if (!target) return 'normal';

    const t = String(target).trim();
    if (t.startsWith('>=') || t.startsWith('≥')) {
        const num = parseFloat(t.replace('>=','').replace('≥','').replace('%','').trim());
        return val >= num ? 'pass' : 'fail';
    }
    if (t.startsWith('>')) {
        const num = parseFloat(t.replace('>','').replace('%','').trim());
        return val > num ? 'pass' : 'fail';
    }
    if (t.startsWith('<=') || t.startsWith('≤')) {
        const num = parseFloat(t.replace('<=','').replace('≤','').replace('%','').trim());
        return val <= num ? 'pass' : 'fail';
    }
    if (t.startsWith('<')) {
        const num = parseFloat(t.replace('<','').replace('%','').trim());
        return val < num ? 'pass' : 'fail';
    }
    const exact = parseFloat(t.replace('%',''));
    if (!isNaN(exact)) {
        if (exact === 100) return val >= 80 ? 'pass' : 'fail';
        if (exact === 0) return val === 0 ? 'pass' : 'fail';
        return val >= exact ? 'pass' : 'fail';
    }
    return 'normal';
}

function updateSourceIndicator() {
    const pill = document.getElementById('sourceIndicator');
    const timeText = document.getElementById('lastSyncText');
    if (!pill) return;

    if (STATE.dataSource === 'appscript') {
        pill.className = 'source-pill live';
        pill.innerHTML = '<i class="fa-solid fa-cloud-bolt"></i> Live Apps Script API';
    } else if (STATE.dataSource === 'gviz') {
        pill.className = 'source-pill gviz';
        pill.innerHTML = '<i class="fa-solid fa-link"></i> Direct Sheet GViz Sync';
    } else {
        pill.className = 'source-pill local';
        pill.innerHTML = '<i class="fa-solid fa-database"></i> Snapshot Data';
    }

    if (timeText && STATE.lastSyncTime) {
        timeText.textContent = 'อัปเดตเมื่อ: ' + STATE.lastSyncTime.toLocaleTimeString('th-TH');
    }
}

/* ==============================================================================
   3. Event Binding & Navigation
   ============================================================================== */
function bindEvents() {
    // Topbar search input for data2026
    const search26 = document.getElementById('search2026');
    if (search26) {
        search26.addEventListener('input', (e) => {
            STATE.filters2026.search = e.target.value.toLowerCase().trim();
            renderMonthlyTab();
        });
    }

    // Month filter for data2026
    const monthSelect = document.getElementById('filterMonth2026');
    if (monthSelect) {
        monthSelect.addEventListener('change', (e) => {
            STATE.filters2026.month = e.target.value;
            renderMonthlyTab();
        });
    }

    // Status filter for data2026
    const statusSelect = document.getElementById('filterStatus2026');
    if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
            STATE.filters2026.status = e.target.value;
            renderMonthlyTab();
        });
    }

    // Search input for allyear
    const searchAy = document.getElementById('searchAllYear');
    if (searchAy) {
        searchAy.addEventListener('input', (e) => {
            STATE.filtersAllYear.search = e.target.value.toLowerCase().trim();
            renderAllYearTab();
        });
    }

    // Part filter for allyear
    const partSelect = document.getElementById('filterPartAllYear');
    if (partSelect) {
        partSelect.addEventListener('change', (e) => {
            STATE.filtersAllYear.part = e.target.value;
            renderAllYearTab();
        });
    }
}

function switchNavTab(tabId) {
    STATE.currentTab = tabId;

    // Update Sidebar active state
    document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
    const activeNav = document.getElementById(`nav-${tabId}`);
    if (activeNav) activeNav.classList.add('active');

    // Update Content Pane
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('show', 'active'));
    const activePane = document.getElementById(`tab-${tabId}`);
    if (activePane) activePane.classList.add('show', 'active');

    // Close mobile sidebar if open
    closeMobileSidebar();

    renderCurrentTab();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('collapsed');
}

function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (sidebar) sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('active');
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('active');
}

/* ==============================================================================
   4. Populate Dropdowns & Controls
   ============================================================================== */
function populateControls() {
    // Populate month options
    const monthSelect = document.getElementById('filterMonth2026');
    if (monthSelect && STATE.rawData.months_2026) {
        monthSelect.innerHTML = '<option value="all">ทั้งปี (ภาพรวมเฉลี่ย)</option>';
        STATE.rawData.months_2026.forEach(m => {
            if (m) {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = 'เดือน ' + m;
                monthSelect.appendChild(opt);
            }
        });
    }

    // Populate allyear parts
    const partSelect = document.getElementById('filterPartAllYear');
    if (partSelect && STATE.rawData.allyear) {
        const parts = Array.from(new Set(STATE.rawData.allyear.map(i => i.part).filter(Boolean)));
        partSelect.innerHTML = '<option value="all">ทุก Part / หมวด</option>';
        parts.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            partSelect.appendChild(opt);
        });
    }

    // Populate Group pills for 2026
    populateGroupPills();
}

function populateGroupPills() {
    const container = document.getElementById('groupPillsContainer');
    if (!container || !STATE.rawData.data2026) return;

    const groups = Array.from(new Set(STATE.rawData.data2026.map(i => i.group).filter(Boolean)));
    container.innerHTML = `
        <button class="group-pill active" onclick="setGroupFilter('all', this)">
            <i class="fa-solid fa-layer-group me-1"></i> ทั้งหมด (${STATE.rawData.data2026.length})
        </button>
    `;

    groups.forEach(g => {
        const count = STATE.rawData.data2026.filter(i => i.group === g).length;
        const btn = document.createElement('button');
        btn.className = 'group-pill';
        btn.innerHTML = `${g} <span class="badge bg-secondary-subtle text-dark ms-1">${count}</span>`;
        btn.onclick = () => setGroupFilter(g, btn);
        container.appendChild(btn);
    });
}

function setGroupFilter(group, btnElement) {
    STATE.filters2026.group = group;
    document.querySelectorAll('.group-pill').forEach(el => el.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    renderMonthlyTab();
}

/* ==============================================================================
   5. Tab Rendering Engine
   ============================================================================== */
function renderCurrentTab() {
    switch (STATE.currentTab) {
        case 'overview':
            renderOverviewTab();
            break;
        case 'monthly':
            renderMonthlyTab();
            break;
        case 'allyear':
            renderAllYearTab();
            break;
        case 'owners':
            renderOwnersTab();
            break;
        case 'settings':
            renderSettingsTab();
            break;
    }
}

/* ------------------------------------------------------------------------------
   5.1 Tab 1: Overview Render
   ------------------------------------------------------------------------------ */
function renderOverviewTab() {
    const d26 = STATE.rawData.data2026 || [];
    const day = STATE.rawData.allyear || [];

    // KPI Stat Cards
    const totalKpis = d26.length;
    const activeKpis = d26.filter(i => i.status !== 'no_data').length;
    const passKpis = d26.filter(i => i.status === 'pass').length;
    const failKpis = d26.filter(i => i.status === 'fail').length;
    const passRate = activeKpis > 0 ? Math.round((passKpis / activeKpis) * 100) : 0;

    document.getElementById('statTotalKpi').textContent = totalKpis;
    document.getElementById('statActiveKpi').textContent = activeKpis;
    document.getElementById('statPassKpi').textContent = passKpis;
    document.getElementById('statFailKpi').textContent = failKpis;
    document.getElementById('statPassRateBadge').textContent = passRate + '% ผ่านเกณฑ์';

    // Highlight Critical Safety & Tracers
    renderTracerHighlights(d26);

    // Render Charts
    renderOverviewCharts(d26);
}

function renderTracerHighlights(items) {
    // Find key KPIs
    const strokeFT = items.find(i => i.kpi.includes('Stroke Fast Track') && i.kpi.includes('30'));
    const strokeMort = items.find(i => i.kpi.includes('Stroke') && i.kpi.includes('เสียชีวิต'));
    const sepsisMort = items.find(i => i.kpi.includes('sepsis') && i.kpi.includes('เสียชีวิต'));
    const copdSpray = items.find(i => i.kpi.includes('COPD') && i.kpi.includes('พ่นถูกต้อง'));
    const medError = items.find(i => i.kpi.includes('คลาดเคลื่อนทางยา'));
    const idError = items.find(i => i.kpi.includes('ระบุตัวผู้ป่วยผิดพลาด'));

    if (document.getElementById('hlStrokeFT')) {
        document.getElementById('hlStrokeFT').textContent = (strokeFT ? (strokeFT.avg || '100%') : '100%') + (strokeFT && !strokeFT.avg.includes('%') ? '%' : '');
    }
    if (document.getElementById('hlStrokeMort')) {
        document.getElementById('hlStrokeMort').textContent = (strokeMort ? strokeMort.avg : '0%') + '%';
    }
    if (document.getElementById('hlSepsisMort')) {
        document.getElementById('hlSepsisMort').textContent = (sepsisMort ? sepsisMort.avg : '0%') + '%';
    }
    if (document.getElementById('hlCopdSpray')) {
        document.getElementById('hlCopdSpray').textContent = (copdSpray ? Math.round(parseFloat(copdSpray.avg || '82.2')) : 82) + '%';
    }
    if (document.getElementById('hlSafetyErrors')) {
        const medVal = medError ? parseFloat(medError.avg || '0') : 0;
        const idVal = idError ? parseFloat(idError.avg || '0') : 0;
        document.getElementById('hlSafetyErrors').textContent = (medVal + idVal) + ' เคส';
    }
}

function renderOverviewCharts(items) {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';

    // 1. Radar Chart: 8 Key Clinical Tracers
    const tracerGroups = ['Stroke', 'STEMI', 'Sepsis', 'Trauma', 'DM', 'HT', '8. COPD', '10. AIDS'];
    const tracerLabels = ['Stroke', 'STEMI', 'Sepsis', 'Trauma', 'DM', 'HT', 'COPD', 'AIDS'];
    const tracerScores = tracerGroups.map(g => {
        const groupItems = items.filter(i => (i.group || '').toLowerCase().includes(g.toLowerCase()));
        if (groupItems.length === 0) return 60;
        const pass = groupItems.filter(i => i.status === 'pass').length;
        const active = groupItems.filter(i => i.status !== 'no_data').length;
        return active > 0 ? Math.round((pass / active) * 100) : 75;
    });

    const ctxRadar = document.getElementById('chartRadarTracer');
    if (ctxRadar) {
        if (STATE.charts.radarTracer) STATE.charts.radarTracer.destroy();
        STATE.charts.radarTracer = new Chart(ctxRadar, {
            type: 'radar',
            data: {
                labels: tracerLabels,
                datasets: [{
                    label: 'คะแนนผลงาน (%)',
                    data: tracerScores,
                    fill: true,
                    backgroundColor: 'rgba(2, 132, 199, 0.25)',
                    borderColor: '#0284c7',
                    pointBackgroundColor: '#0284c7',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: '#0284c7'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        angleLines: { color: isDark ? '#27354f' : '#e2e8f0' },
                        grid: { color: isDark ? '#27354f' : '#e2e8f0' },
                        pointLabels: {
                            font: { family: 'Sarabun', size: 12, weight: '600' },
                            color: isDark ? '#cbd5e1' : '#475569'
                        },
                        suggestedMin: 0,
                        suggestedMax: 100
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    // 2. Bar Chart: KPI Volume per Department
    const groupCounts = {};
    items.forEach(i => {
        const g = i.group || 'อื่น ๆ';
        groupCounts[g] = (groupCounts[g] || 0) + 1;
    });

    const sortedGroups = Object.entries(groupCounts)
        .sort((a,b) => b[1] - a[1])
        .slice(0, 10);

    const ctxBar = document.getElementById('chartBarGroups');
    if (ctxBar) {
        if (STATE.charts.barGroups) STATE.charts.barGroups.destroy();
        STATE.charts.barGroups = new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: sortedGroups.map(g => g[0]),
                datasets: [{
                    label: 'จำนวนตัวชี้วัด',
                    data: sortedGroups.map(g => g[1]),
                    backgroundColor: 'rgba(13, 148, 136, 0.8)',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 2 }
                    }
                }
            }
        });
    }

    // 3. Doughnut Chart: Overall Compliance Status
    const passCount = items.filter(i => i.status === 'pass').length;
    const failCount = items.filter(i => i.status === 'fail').length;
    const normalCount = items.filter(i => i.status === 'normal').length;
    const noDataCount = items.filter(i => i.status === 'no_data').length;

    const ctxDoughnut = document.getElementById('chartDoughnutStatus');
    if (ctxDoughnut) {
        if (STATE.charts.doughnutStatus) STATE.charts.doughnutStatus.destroy();
        STATE.charts.doughnutStatus = new Chart(ctxDoughnut, {
            type: 'doughnut',
            data: {
                labels: ['ผ่านเกณฑ์', 'ไม่ผ่านเกณฑ์', 'อยู่ในเกณฑ์ปกติ', 'ยังไม่มีข้อมูล'],
                datasets: [{
                    data: [passCount, failCount, normalCount, noDataCount],
                    backgroundColor: ['#10b981', '#ef4444', '#06b6d4', '#94a3b8'],
                    borderWidth: 2,
                    borderColor: isDark ? '#151e33' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { font: { family: 'Sarabun', size: 11 } }
                    }
                },
                cutout: '65%'
            }
        });
    }
}

/* ------------------------------------------------------------------------------
   5.2 Tab 2: Monthly Monitor 2026 Render
   ------------------------------------------------------------------------------ */
function renderMonthlyTab() {
    const items = STATE.rawData.data2026 || [];
    const months = STATE.rawData.months_2026 || [];

    // Filter items
    const filtered = items.filter(item => {
        // Group filter
        if (STATE.filters2026.group !== 'all' && item.group !== STATE.filters2026.group) return false;
        
        // Status filter
        if (STATE.filters2026.status !== 'all' && item.status !== STATE.filters2026.status) return false;

        // Search filter
        if (STATE.filters2026.search) {
            const matchKpi = (item.kpi || '').toLowerCase().includes(STATE.filters2026.search);
            const matchOwner = (item.owner || '').toLowerCase().includes(STATE.filters2026.search);
            const matchGroup = (item.group || '').toLowerCase().includes(STATE.filters2026.search);
            if (!matchKpi && !matchOwner && !matchGroup) return false;
        }

        return true;
    });

    document.getElementById('kpiFilteredCount2026').textContent = filtered.length;

    const tableBody = document.getElementById('tbodyKpi2026');
    if (!tableBody) return;

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><i class="fa-solid fa-inbox fs-2 mb-2 d-block"></i>ไม่พบตัวชี้วัดที่ตรงกับเงื่อนไขการค้นหา</td></tr>`;
        return;
    }

    const selectedMonth = STATE.filters2026.month;

    tableBody.innerHTML = filtered.map(item => {
        let displayVal = item.avg || '-';
        if (selectedMonth !== 'all' && item.monthly[selectedMonth] !== undefined) {
            displayVal = item.monthly[selectedMonth] !== '' ? item.monthly[selectedMonth] : '-';
        }

        // Mini sparkline bars for 12 months
        const sparkBars = months.map(m => {
            const rawV = item.monthly[m];
            const num = parseFloat(String(rawV).replace(/,/g, ''));
            const height = (!isNaN(num) && num > 0) ? Math.min(Math.max(num, 4), 22) : 2;
            const barColor = (!isNaN(num) && num > 0) ? 'var(--primary)' : 'rgba(148, 163, 184, 0.4)';
            return `<div class="bar" style="height: ${height}px; background: ${barColor};" title="${m}: ${rawV || '-'}"></div>`;
        }).join('');

        let badgeHtml = '';
        if (item.status === 'pass') badgeHtml = '<span class="badge-compliance pass"><i class="fa-solid fa-check"></i> ผ่านเกณฑ์</span>';
        else if (item.status === 'fail') badgeHtml = '<span class="badge-compliance fail"><i class="fa-solid fa-triangle-exclamation"></i> ตกเกณฑ์</span>';
        else if (item.status === 'normal') badgeHtml = '<span class="badge-compliance normal"><i class="fa-solid fa-circle-info"></i> ปกติ</span>';
        else badgeHtml = '<span class="badge-compliance no_data">ไม่มีข้อมูล</span>';

        return `
            <tr onclick="openKpiModal('${item.id}')">
                <td><span class="badge bg-primary-subtle text-primary fw-semibold">${escapeHtml(item.group || 'ทั่วไป')}</span></td>
                <td class="fw-medium">${escapeHtml(item.kpi)}</td>
                <td class="text-muted small">${escapeHtml(item.target || '-')}</td>
                <td><span class="text-dark small"><i class="fa-regular fa-user text-muted me-1"></i>${escapeHtml(item.owner || '-')}</span></td>
                <td class="fw-bold text-end">${escapeHtml(displayVal)}</td>
                <td class="text-center">${badgeHtml}</td>
                <td><div class="mini-trend-bar justify-content-center">${sparkBars}</div></td>
            </tr>
        `;
    }).join('');
}

/* ------------------------------------------------------------------------------
   5.3 Tab 3: Multi-Year Trend (allyear) Render
   ------------------------------------------------------------------------------ */
function renderAllYearTab() {
    const items = STATE.rawData.allyear || [];
    const years = STATE.rawData.years_allyear || [];

    // Filter items
    const filtered = items.filter(item => {
        if (STATE.filtersAllYear.part !== 'all' && item.part !== STATE.filtersAllYear.part) return false;
        if (STATE.filtersAllYear.search) {
            const matchKpi = (item.kpi || '').toLowerCase().includes(STATE.filtersAllYear.search);
            const matchOwner = (item.owner || '').toLowerCase().includes(STATE.filtersAllYear.search);
            const matchPart = (item.part || '').toLowerCase().includes(STATE.filtersAllYear.search);
            if (!matchKpi && !matchOwner && !matchPart) return false;
        }
        return true;
    });

    document.getElementById('kpiFilteredCountAllYear').textContent = filtered.length;

    // Populate comparison KPI dropdown
    const selectCompare = document.getElementById('selectCompareKpi');
    if (selectCompare && selectCompare.options.length <= 1) {
        selectCompare.innerHTML = '<option value="">-- เลือกตัวชี้วัดเพื่อดูกราฟเปรียบเทียบ 6 ปี --</option>';
        items.slice(0, 50).forEach(i => {
            const opt = document.createElement('option');
            opt.value = i.id;
            opt.textContent = `[${i.part}] ${i.kpi.substring(0, 60)}`;
            selectCompare.appendChild(opt);
        });
        if (items.length > 0) {
            selectCompare.value = items[2] ? items[2].id : items[0].id;
            onSelectCompareKpi(selectCompare.value);
        }
    }

    const tableBody = document.getElementById('tbodyAllYear');
    if (!tableBody) return;

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">ไม่พบข้อมูลตัวชี้วัดที่เลือก</td></tr>`;
        return;
    }

    tableBody.innerHTML = filtered.map(item => {
        const yCells = years.map(y => {
            const v = item.years[y] || '-';
            return `<td class="text-end small">${escapeHtml(v)}</td>`;
        }).join('');

        // Calculate Trend arrow between year 2567 and 2568 (or last 2 years with data)
        const v67 = parseFloat(String(item.years['ปี 2567'] || '').replace(/,/g, ''));
        const v68 = parseFloat(String(item.years['ปี 2568'] || '').replace(/,/g, ''));
        let trendIcon = '<span class="text-muted">-</span>';
        if (!isNaN(v67) && !isNaN(v68) && v68 !== 0) {
            if (v68 > v67) trendIcon = '<span class="text-success"><i class="fa-solid fa-arrow-trend-up"></i> เพิ่มขึ้น</span>';
            else if (v68 < v67) trendIcon = '<span class="text-danger"><i class="fa-solid fa-arrow-trend-down"></i> ลดลง</span>';
            else trendIcon = '<span class="text-primary"><i class="fa-solid fa-arrows-left-right"></i> คงที่</span>';
        }

        return `
            <tr onclick="onSelectCompareKpi('${item.id}')">
                <td><span class="badge bg-secondary-subtle text-dark">${escapeHtml(item.part || item.category)}</span></td>
                <td class="fw-medium">${escapeHtml(item.kpi)}</td>
                <td class="text-muted small">${escapeHtml(item.owner || '-')}</td>
                ${yCells}
                <td class="text-center">${trendIcon}</td>
            </tr>
        `;
    }).join('');
}

function onSelectCompareKpi(kpiId) {
    if (!kpiId) return;
    const item = STATE.rawData.allyear.find(i => i.id === kpiId);
    if (!item) return;

    STATE.filtersAllYear.selectedKpiId = kpiId;
    const selectCompare = document.getElementById('selectCompareKpi');
    if (selectCompare && selectCompare.value !== kpiId) selectCompare.value = kpiId;

    const years = STATE.rawData.years_allyear || [];
    const values = years.map(y => {
        const raw = item.years[y];
        const num = parseFloat(String(raw).replace(/,/g, ''));
        return !isNaN(num) ? num : null;
    });

    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const ctx = document.getElementById('chartYearComparison');
    if (!ctx) return;

    if (STATE.charts.lineYearComparison) STATE.charts.lineYearComparison.destroy();
    STATE.charts.lineYearComparison = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [{
                label: item.kpi,
                data: values,
                borderColor: '#0284c7',
                backgroundColor: 'rgba(2, 132, 199, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 5,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `แนวโน้มรายปี: ${item.kpi} (${item.part})`,
                    font: { family: 'Sarabun', size: 14, weight: '600' }
                },
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: isDark ? '#27354f' : '#e2e8f0' }
                },
                x: {
                    grid: { color: isDark ? '#27354f' : '#e2e8f0' }
                }
            }
        }
    });
}

/* ------------------------------------------------------------------------------
   5.4 Tab 4: Owners & Team Matrix Render
   ------------------------------------------------------------------------------ */
function renderOwnersTab() {
    const d26 = STATE.rawData.data2026 || [];
    const day = STATE.rawData.allyear || [];

    // Aggregate by owner
    const ownerMap = {};
    const registerOwner = (name, kpiItem, source) => {
        const cleanName = (name || '').trim();
        if (!cleanName || cleanName === '-' || cleanName === '0') return;
        if (!ownerMap[cleanName]) {
            ownerMap[cleanName] = {
                name: cleanName,
                kpis2026: [],
                kpisAllYear: [],
                passCount: 0,
                failCount: 0
            };
        }
        if (source === '2026') {
            ownerMap[cleanName].kpis2026.push(kpiItem);
            if (kpiItem.status === 'pass') ownerMap[cleanName].passCount++;
            else if (kpiItem.status === 'fail') ownerMap[cleanName].failCount++;
        } else {
            ownerMap[cleanName].kpisAllYear.push(kpiItem);
        }
    };

    d26.forEach(i => registerOwner(i.owner, i, '2026'));
    day.forEach(i => registerOwner(i.owner, i, 'allyear'));

    const container = document.getElementById('ownersMatrixContainer');
    if (!container) return;

    const ownersList = Object.values(ownerMap).sort((a,b) => (b.kpis2026.length + b.kpisAllYear.length) - (a.kpis2026.length + a.kpisAllYear.length));

    container.innerHTML = ownersList.map(o => {
        const total = o.kpis2026.length + o.kpisAllYear.length;
        return `
            <div class="col-xl-4 col-md-6">
                <div class="card card-custom p-3 h-100">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <div class="d-flex align-items-center gap-2">
                            <div class="stat-icon bg-primary-subtle text-primary">
                                <i class="fa-solid fa-user-doctor"></i>
                            </div>
                            <div>
                                <h6 class="fw-bold mb-0">${escapeHtml(o.name)}</h6>
                                <small class="text-muted">ผู้รับผิดชอบตัวชี้วัด</small>
                            </div>
                        </div>
                        <span class="badge bg-primary rounded-pill">${total} ตัวชี้วัด</span>
                    </div>
                    <div class="d-flex justify-content-between small text-muted my-2 border-top border-bottom py-2">
                        <span>ปี 2569: <b>${o.kpis2026.length}</b></span>
                        <span class="text-success">ผ่าน: <b>${o.passCount}</b></span>
                        <span class="text-danger">ตก: <b>${o.failCount}</b></span>
                        <span>รายปีย้อนหลัง: <b>${o.kpisAllYear.length}</b></span>
                    </div>
                    <div class="mt-2">
                        <small class="text-muted fw-bold d-block mb-1">ตัวอย่างตัวชี้วัด:</small>
                        <ul class="list-unstyled mb-0 small text-truncate">
                            ${(o.kpis2026.slice(0, 3).map(k => `<li class="text-truncate mb-1"><i class="fa-solid fa-check text-primary me-1"></i>${escapeHtml(k.kpi)}</li>`).join('') || '<li class="text-muted">ไม่มีข้อมูล 2569</li>')}
                        </ul>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/* ------------------------------------------------------------------------------
   5.5 Tab 5: Settings & API Configuration Render
   ------------------------------------------------------------------------------ */
function renderSettingsTab() {
    const inputUrl = document.getElementById('inputAppScriptUrl');
    const savedUrl = localStorage.getItem(APP_CONFIG.APPSCRIPT_STORAGE_KEY) || '';
    if (inputUrl) inputUrl.value = savedUrl;

    const checkGviz = document.getElementById('checkDirectGviz');
    const isGviz = localStorage.getItem(APP_CONFIG.DIRECT_GVIZ_STORAGE_KEY) !== 'false';
    if (checkGviz) checkGviz.checked = isGviz;
}

function saveSettings() {
    const inputUrl = document.getElementById('inputAppScriptUrl');
    const checkGviz = document.getElementById('checkDirectGviz');

    if (inputUrl) {
        localStorage.setItem(APP_CONFIG.APPSCRIPT_STORAGE_KEY, inputUrl.value.trim());
    }
    if (checkGviz) {
        localStorage.setItem(APP_CONFIG.DIRECT_GVIZ_STORAGE_KEY, checkGviz.checked ? 'true' : 'false');
    }

    showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว กำลังโหลดข้อมูลใหม่...', 'success');
    loadDashboardData(true);
}

function resetSettings() {
    localStorage.removeItem(APP_CONFIG.APPSCRIPT_STORAGE_KEY);
    localStorage.removeItem(APP_CONFIG.DIRECT_GVIZ_STORAGE_KEY);
    renderSettingsTab();
    showToast('คืนค่าเริ่มต้นเรียบร้อยแล้ว', 'info');
    loadDashboardData(true);
}

/* ==============================================================================
   6. Modal & Interactive Details
   ============================================================================== */
function openKpiModal(kpiId) {
    const item = (STATE.rawData.data2026 || []).find(i => i.id === kpiId);
    if (!item) return;

    document.getElementById('modalKpiTitle').textContent = item.kpi;
    document.getElementById('modalKpiGroup').textContent = item.group;
    document.getElementById('modalKpiTarget').textContent = item.target || 'ไม่ระบุ';
    document.getElementById('modalKpiOwner').textContent = item.owner || 'ไม่ระบุ';
    document.getElementById('modalKpiAvg').textContent = item.avg || '-';

    const months = STATE.rawData.months_2026 || [];
    const labels = months;
    const values = months.map(m => {
        const raw = item.monthly[m];
        const num = parseFloat(String(raw).replace(/,/g, ''));
        return !isNaN(num) ? num : null;
    });

    // Populate Modal Table
    const modalTable = document.getElementById('modalTbodyMonthly');
    if (modalTable) {
        modalTable.innerHTML = months.map(m => `
            <tr>
                <td class="fw-semibold">${m}</td>
                <td class="text-end fw-bold">${item.monthly[m] || '-'}</td>
            </tr>
        `).join('');
    }

    // Modal Line Chart
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const ctx = document.getElementById('chartModalTrend');
    if (ctx) {
        if (STATE.charts.modalTrend) STATE.charts.modalTrend.destroy();
        STATE.charts.modalTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'ผลงานรายเดือน',
                    data: values,
                    borderColor: '#0284c7',
                    backgroundColor: 'rgba(2, 132, 199, 0.15)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 6,
                    pointHoverRadius: 9
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        grid: { color: isDark ? '#27354f' : '#e2e8f0' }
                    },
                    x: {
                        grid: { color: isDark ? '#27354f' : '#e2e8f0' }
                    }
                }
            }
        });
    }

    const modal = new bootstrap.Modal(document.getElementById('kpiDetailModal'));
    modal.show();
}

/* ==============================================================================
   7. Export Engine (Excel XLSX with Thai Font & CSV)
   ============================================================================== */
function exportData(format) {
    if (STATE.currentTab === 'monthly') {
        exportMonthly(format);
    } else if (STATE.currentTab === 'allyear') {
        exportAllYear(format);
    } else {
        exportMonthly(format);
    }
}

function exportMonthly(format) {
    const items = STATE.rawData.data2026 || [];
    const months = STATE.rawData.months_2026 || [];

    if (format === 'csv') {
        let csvContent = '\uFEFF'; // UTF-8 BOM for Thai Excel
        csvContent += ['หมวด', 'ตัวชี้วัด', 'เกณฑ์', 'ผู้รับผิดชอบ', ...months, 'รวม', 'เฉลี่ย'].join(',') + '\n';
        items.forEach(i => {
            const row = [
                `"${i.group || ''}"`,
                `"${(i.kpi || '').replace(/"/g, '""')}"`,
                `"${i.target || ''}"`,
                `"${i.owner || ''}"`,
                ...months.map(m => `"${i.monthly[m] || ''}"`),
                `"${i.total || ''}"`,
                `"${i.avg || ''}"`
            ];
            csvContent += row.join(',') + '\n';
        });
        downloadFile(csvContent, 'kpi_monthly_2026.csv', 'text/csv;charset=utf-8;');
    } else if (format === 'excel') {
        if (typeof XLSX === 'undefined') {
            showToast('กำลังโหลดโมดูล Excel...', 'info');
            return;
        }
        const aoa = [
            ['หมวด', 'ตัวชี้วัด', 'เกณฑ์', 'ผู้รับผิดชอบ', ...months, 'รวม', 'เฉลี่ย']
        ];
        items.forEach(i => {
            aoa.push([
                i.group || '',
                i.kpi || '',
                i.target || '',
                i.owner || '',
                ...months.map(m => i.monthly[m] || ''),
                i.total || '',
                i.avg || ''
            ]);
        });
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'data2026');
        XLSX.writeFile(wb, 'kpi_monthly_2026.xlsx');
    }
}

function exportAllYear(format) {
    const items = STATE.rawData.allyear || [];
    const years = STATE.rawData.years_allyear || [];

    if (format === 'csv') {
        let csvContent = '\uFEFF';
        csvContent += ['Part', 'ตัวชี้วัด', 'ผู้รับผิดชอบ', ...years].join(',') + '\n';
        items.forEach(i => {
            const row = [
                `"${i.part || ''}"`,
                `"${(i.kpi || '').replace(/"/g, '""')}"`,
                `"${i.owner || ''}"`,
                ...years.map(y => `"${i.years[y] || ''}"`)
            ];
            csvContent += row.join(',') + '\n';
        });
        downloadFile(csvContent, 'kpi_allyear_trend.csv', 'text/csv;charset=utf-8;');
    } else if (format === 'excel') {
        if (typeof XLSX === 'undefined') return;
        const aoa = [
            ['Part', 'ตัวชี้วัด', 'ผู้รับผิดชอบ', ...years]
        ];
        items.forEach(i => {
            aoa.push([
                i.part || '',
                i.kpi || '',
                i.owner || '',
                ...years.map(y => i.years[y] || '')
            ]);
        });
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'allyear');
        XLSX.writeFile(wb, 'kpi_allyear_trend.xlsx');
    }
}

function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/* ==============================================================================
   8. Helpers & Utilities
   ============================================================================== */
function showLoading(show) {
    const spinner = document.getElementById('globalSpinner');
    if (spinner) spinner.style.display = show ? 'inline-block' : 'none';
}

function showToast(message, type = 'info') {
    const toastEl = document.getElementById('appToast');
    const toastBody = document.getElementById('toastBody');
    if (!toastEl || !toastBody) return;

    toastBody.textContent = message;
    toastEl.className = `toast align-items-center text-bg-${type} border-0`;
    const toast = new bootstrap.Toast(toastEl, { delay: 3500 });
    toast.show();
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function copyAppsScriptCode() {
    const code = `// ดูโค้ดฉบับเต็มได้ในไฟล์ Code.gs ของโปรเจกต์นี้`;
    fetch('Code.gs')
        .then(r => r.text())
        .then(t => {
            navigator.clipboard.writeText(t);
            showToast('คัดลอกโค้ด Google Apps Script แล้ว!', 'success');
        })
        .catch(() => {
            showToast('กรุณาคัดลอกจากไฟล์ Code.gs ในโปรเจกต์', 'info');
        });
}
