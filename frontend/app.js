const API = 'http://localhost:3000';

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
let token = localStorage.getItem('fv_token');
let username = localStorage.getItem('fv_username');
let currentSymbol = null;
let currentPrice = null;
let currentQuote = null;
let currentChartData = null;
let currentChartMeta = null;
let activeIndicators = [];
let activeStrategies = [];
let activeStrategyFilter = null;
let tradeSide = 'buy';
let priceChart = null;
let gnewsKeyConfigured = false;

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
function init() {
    if (token && username) {
        checkProfileAndRoute();
    } else {
        showScreen('auth-screen');
    }
    bindEvents();
    startClock();
}

function startClock() {
    const el = document.getElementById('topbar-time');
    if (!el) return;
    const tick = () => { el.textContent = new Date().toLocaleTimeString(); };
    tick();
    setInterval(tick, 1000);
}

// ═══════════════════════════════════════
// SCREEN MANAGEMENT
// ═══════════════════════════════════════
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${pageId}`)?.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');

    if (pageId === 'portfolio') loadPortfolioPage();
    if (pageId === 'settings') loadSettingsPage();
}

// ═══════════════════════════════════════
// AUTH
// ═══════════════════════════════════════
function bindEvents() {
    // Auth
    document.getElementById('contact-form')?.addEventListener('submit', e => { e.preventDefault(); handleLogin(); });
    document.getElementById('register-form')?.addEventListener('submit', e => { e.preventDefault(); handleRegister(); });
    document.getElementById('otp-form')?.addEventListener('submit', e => { e.preventDefault(); handleVerifyOTP(); });
    document.getElementById('otp-back-link')?.addEventListener('click', e => { e.preventDefault(); toggleAuthForms('contact'); });
    document.getElementById('show-register-link')?.addEventListener('click', e => { e.preventDefault(); toggleAuthForms('register'); });
    document.getElementById('show-login-link')?.addEventListener('click', e => { e.preventDefault(); toggleAuthForms('contact'); });

    // OTP Input auto-advance
    const otpBoxes = document.querySelectorAll('.otp-box');
    otpBoxes.forEach((box, index) => {
        box.addEventListener('input', (e) => {
            if (box.value.length === 1 && index < otpBoxes.length - 1) {
                otpBoxes[index + 1].focus();
            }
        });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && box.value.length === 0 && index > 0) {
                otpBoxes[index - 1].focus();
            }
        });
    });

    // Setup
    document.getElementById('save-gnews-key-btn')?.addEventListener('click', () => saveGnewsKey('gnews-key-input', 'gnews-status'));
    document.getElementById('setup-continue-btn')?.addEventListener('click', () => enterDashboard());
    document.getElementById('setup-skip-btn')?.addEventListener('click', () => enterDashboard());

    // Dashboard nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', e => { e.preventDefault(); showPage(item.dataset.page); });
    });
    document.getElementById('logout-btn')?.addEventListener('click', logout);

    // Search
    const searchInput = document.getElementById('instrument-search');
    const searchBtn = document.getElementById('search-btn');
    const searchSuggestions = document.getElementById('search-suggestions');

    searchBtn?.addEventListener('click', searchInstrument);
    searchInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { searchSuggestions?.classList.add('hidden'); searchInstrument(); } });

    // Search Autocomplete
    let searchTimeout;
    searchInput?.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (!query) {
            searchSuggestions?.classList.add('hidden');
            return;
        }

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`${API}/api/finance/search?q=${encodeURIComponent(query)}`, { headers: authHeaders() });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                if (searchSuggestions) {
                    searchSuggestions.innerHTML = '';
                    if (data.results && data.results.length > 0) {
                        data.results.forEach(item => {
                            const div = document.createElement('div');
                            div.className = 'suggestion-item';
                            div.innerHTML = `
                                <span class="suggestion-symbol">${item.symbol}</span>
                                <span class="suggestion-name">${item.name}</span>
                                <span class="suggestion-type">${item.type}</span>
                            `;
                            div.addEventListener('click', () => {
                                searchInput.value = item.symbol;
                                searchSuggestions.classList.add('hidden');
                                searchInstrument();
                            });
                            searchSuggestions.appendChild(div);
                        });
                        searchSuggestions.classList.remove('hidden');
                    } else {
                        searchSuggestions.classList.add('hidden');
                    }
                }
            } catch (err) {
                console.error('Search suggestion error:', err);
            }
        }, 300); // 300ms debounce
    });

    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (searchInput && searchSuggestions && !searchInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
            searchSuggestions.classList.add('hidden');
        }
    });

    // Chart periods
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (currentSymbol) loadChart(currentSymbol, btn.dataset.period);
        });
    });

    // Analytics & Indicators
    document.getElementById('add-indicator-btn')?.addEventListener('click', () => openIndicatorModal('indicator'));
    document.getElementById('add-strategy-btn')?.addEventListener('click', () => openIndicatorModal('strategy'));

    document.getElementById('export-chart-csv')?.addEventListener('click', exportChartCSV);
    document.getElementById('export-trades-csv')?.addEventListener('click', exportTradesCSV);
    document.getElementById('close-indicator-modal')?.addEventListener('click', closeIndicatorModal);
    document.getElementById('cancel-indicator-btn')?.addEventListener('click', closeIndicatorModal);
    document.getElementById('indicator-type-select')?.addEventListener('change', renderIndicatorParams);
    document.getElementById('confirm-indicator-btn')?.addEventListener('click', addIndicator);
    
    document.getElementById('run-backtest-btn')?.addEventListener('click', () => {
        savePreferences();
        const activePeriod = document.querySelector('.period-btn.active')?.dataset.period || '1mo';
        if (currentSymbol) loadChart(currentSymbol, activePeriod);
    });

    // Trading
    document.getElementById('trade-buy-btn')?.addEventListener('click', () => setTradeSide('buy'));
    document.getElementById('trade-sell-btn')?.addEventListener('click', () => setTradeSide('sell'));
    document.getElementById('trade-quantity')?.addEventListener('input', updateTradeTotal);
    document.getElementById('execute-trade-btn')?.addEventListener('click', executeTrade);

    // News search
    document.getElementById('news-search-btn')?.addEventListener('click', searchNews);
    document.getElementById('news-keyword-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchNews(); });

    // Trending refresh
    document.getElementById('refresh-trending-btn')?.addEventListener('click', loadTrending);

    // Portfolio reset
    document.getElementById('reset-portfolio-btn')?.addEventListener('click', resetPortfolio);

    // Settings
    document.getElementById('settings-save-gnews-btn')?.addEventListener('click', () => saveGnewsKey('settings-gnews-key', 'settings-gnews-status'));
}

function toggleAuthForms(show) {
    document.getElementById('contact-form').classList.toggle('hidden', show !== 'contact');
    document.getElementById('register-form').classList.toggle('hidden', show !== 'register');
    document.getElementById('otp-form').classList.toggle('hidden', show !== 'otp');
    clearMessages();
}

function clearMessages() {
    document.querySelectorAll('.msg').forEach(m => m.classList.add('hidden'));
}

async function handleLogin() {
    const contact = document.getElementById('auth-contact').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    if (!contact || !password) return showMsg('contact-error', 'Please enter your email/mobile and password', 'error');

    try {
        document.getElementById('contact-submit-btn').disabled = true;
        const res = await fetch(`${API}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        token = data.token;
        username = data.user.contact;
        const fn = data.user.firstName || '';
        const ln = data.user.lastName || '';
        
        let initial = '?';
        let displayName = username.split('@')[0];
        if (fn || ln) {
            initial = `${fn.charAt(0)}${ln.charAt(0)}`.toUpperCase();
            displayName = `${fn} ${ln}`.trim();
        } else {
            initial = username.charAt(0).toUpperCase();
        }

        localStorage.setItem('fv_token', token);
        localStorage.setItem('fv_username', username);
        localStorage.setItem('fv_initials', initial);
        localStorage.setItem('fv_display_name', displayName);
        checkProfileAndRoute();
    } catch (err) {
        showMsg('contact-error', err.message, 'error');
    } finally {
        document.getElementById('contact-submit-btn').disabled = false;
    }
}

async function handleRegister() {
    const firstName = document.getElementById('reg-first').value.trim();
    const lastName = document.getElementById('reg-last').value.trim();
    const contact = document.getElementById('reg-contact').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    if (!contact || !firstName || !lastName || !password) return showMsg('register-error', 'Please fill all fields', 'error');

    try {
        document.getElementById('register-submit-btn').disabled = true;
        const res = await fetch(`${API}/auth/register`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact, firstName, lastName, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');

        token = data.token;
        username = data.user.contact;
        const fn = data.user.firstName || '';
        const ln = data.user.lastName || '';
        
        let initial = '?';
        let displayName = username.split('@')[0];
        if (fn || ln) {
            initial = `${fn.charAt(0)}${ln.charAt(0)}`.toUpperCase();
            displayName = `${fn} ${ln}`.trim();
        } else {
            initial = username.charAt(0).toUpperCase();
        }

        localStorage.setItem('fv_token', token);
        localStorage.setItem('fv_username', username);
        localStorage.setItem('fv_initials', initial);
        localStorage.setItem('fv_display_name', displayName);
        checkProfileAndRoute();
    } catch (err) {
        showMsg('register-error', err.message, 'error');
    } finally {
        document.getElementById('register-submit-btn').disabled = false;
    }
}

async function handleVerifyOTP() {
    const contact = window.tempContact;
    const otpBoxes = document.querySelectorAll('.otp-box');
    const code = Array.from(otpBoxes).map(b => b.value).join('');

    if (code.length !== 6) return showMsg('otp-error', 'Please enter the 6-digit code', 'error');

    try {
        document.getElementById('otp-submit-btn').disabled = true;
        const res = await fetch(`${API}/auth/verify-otp`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact, code })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Verification failed');

        token = data.token;
        username = data.user.contact;
        const fn = data.user.firstName || '';
        const ln = data.user.lastName || '';
        
        let initial = '?';
        if (fn || ln) {
            initial = `${fn.charAt(0)}${ln.charAt(0)}`.toUpperCase();
        } else {
            initial = username.charAt(0).toUpperCase();
        }

        localStorage.setItem('fv_token', token);
        localStorage.setItem('fv_username', username);
        localStorage.setItem('fv_initials', initial);
        checkProfileAndRoute();
    } catch (err) {
        showMsg('otp-error', err.message, 'error');
    } finally {
        document.getElementById('otp-submit-btn').disabled = false;
    }
}

async function checkProfileAndRoute() {
    try {
        const res = await fetch(`${API}/auth/profile`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error('Session expired');

        gnewsKeyConfigured = data.api_keys_configured;

        if (!data.api_keys_configured) {
            showScreen('setup-screen');
        } else {
            enterDashboard();
        }
    } catch {
        showScreen('setup-screen');
    }
}

async function enterDashboard() {
    showScreen('dashboard-screen');
    const displayName = localStorage.getItem('fv_display_name') || username.split('@')[0];
    document.getElementById('sidebar-username').textContent = displayName;
    const initial = localStorage.getItem('fv_initials') || username.charAt(0).toUpperCase();
    document.getElementById('sidebar-avatar').textContent = initial;
    
    showPage('market');
    loadTrending();
    loadNewsFeed();
    await loadPreferences();
}

async function loadPreferences() {
    try {
        const res = await fetch(`${API}/auth/preferences`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.state && Object.keys(data.state).length > 0) {
            activeIndicators = data.state.indicators || [];
            activeStrategies = data.state.strategies || [];
            
            if (data.state.backtest) {
                if (document.getElementById('bt-val-split')) document.getElementById('bt-val-split').value = data.state.backtest.val_split;
                if (document.getElementById('bt-stop-loss')) document.getElementById('bt-stop-loss').value = data.state.backtest.stop_loss || '';
                if (document.getElementById('bt-take-profit')) document.getElementById('bt-take-profit').value = data.state.backtest.take_profit || '';
            }
            renderActiveIndicators();
        }
    } catch (err) {
        console.error('Failed to load preferences:', err);
    }
}

async function savePreferences() {
    if (!token) return;
    try {
        const state = {
            indicators: activeIndicators,
            strategies: activeStrategies,
            backtest: {
                val_split: parseFloat(document.getElementById('bt-val-split')?.value) || 20,
                stop_loss: parseFloat(document.getElementById('bt-stop-loss')?.value) || null,
                take_profit: parseFloat(document.getElementById('bt-take-profit')?.value) || null
            }
        };
        await fetch(`${API}/auth/preferences`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ state })
        });
    } catch (err) {
        console.error('Failed to save preferences:', err);
    }
}

function logout() {
    token = null; username = null;
    localStorage.removeItem('fv_token');
    localStorage.removeItem('fv_username');
    showScreen('auth-screen');
    toggleAuthForms('contact');
}

// ═══════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════
function authHeaders() {
    return { 'Authorization': `Bearer ${token}` };
}

function showMsg(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = `msg ${type}`;
    el.classList.remove('hidden');
}

// ═══════════════════════════════════════
// API KEY SETUP
// ═══════════════════════════════════════
async function saveGnewsKey(inputId, statusId) {
    const key = document.getElementById(inputId).value.trim();
    if (!key) return;

    try {
        const res = await fetch(`${API}/auth/api-keys`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'gnews', api_key: key })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        gnewsKeyConfigured = true;
        const statusEl = document.getElementById(statusId);
        if (statusEl) {
            statusEl.innerHTML = '<span class="status-dot"></span> Configured ✓';
        }
        document.getElementById(inputId).value = '';
    } catch (err) {
        alert('Failed to save API key: ' + err.message);
    }
}

// ═══════════════════════════════════════
// TRENDING / MARKET
// ═══════════════════════════════════════
async function loadTrending() {
    const grid = document.getElementById('trending-grid');
    grid.innerHTML = '<div class="loading-placeholder">Loading market data...</div>';

    try {
        const res = await fetch(`${API}/api/finance/trending`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (!data.data || data.data.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>No market data available</p></div>';
            return;
        }

        grid.innerHTML = data.data.map(t => {
            const changeClass = t.changePercent > 0 ? 'positive' : t.changePercent < 0 ? 'negative' : 'neutral';
            const arrow = t.changePercent > 0 ? '▲' : t.changePercent < 0 ? '▼' : '—';
            return `
                <div class="ticker-card" onclick="selectInstrument('${t.symbol}')">
                    <div class="ticker-symbol">${t.symbol}</div>
                    <div class="ticker-name">${t.name}</div>
                    <div class="ticker-price">$${formatNum(t.price)}</div>
                    <div class="ticker-change ${changeClass}">${arrow} ${t.changePercent > 0 ? '+' : ''}${t.changePercent}%</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        grid.innerHTML = `<div class="empty-state"><p>Failed to load market data: ${err.message}</p></div>`;
    }
}

function selectInstrument(symbol) {
    document.getElementById('instrument-search').value = symbol;
    searchInstrument();
}

async function searchInstrument() {
    const query = document.getElementById('instrument-search').value.trim();
    if (!query) return;

    const detailPanel = document.getElementById('instrument-detail');

    try {
        // Load quote
        const quoteRes = await fetch(`${API}/api/finance/quote/${encodeURIComponent(query)}`, { headers: authHeaders() });
        const quoteData = await quoteRes.json();
        if (!quoteRes.ok) throw new Error(quoteData.error);

        currentSymbol = quoteData.symbol;
        currentPrice = quoteData.price;
        currentQuote = quoteData;

        // Update UI
        document.getElementById('chart-title').textContent = `${quoteData.name} (${quoteData.symbol})`;
        document.getElementById('chart-price').textContent = `$${formatNum(quoteData.price)}`;

        const changeEl = document.getElementById('chart-change');
        const changeClass = quoteData.changePercent > 0 ? 'positive' : quoteData.changePercent < 0 ? 'negative' : '';
        changeEl.textContent = `${quoteData.change > 0 ? '+' : ''}${quoteData.change} (${quoteData.changePercent > 0 ? '+' : ''}${quoteData.changePercent}%)`;
        changeEl.className = `chart-change ${changeClass}`;

        detailPanel.classList.remove('hidden');

        // Load chart
        const activePeriod = document.querySelector('.period-btn.active')?.dataset.period || '1mo';
        loadChart(currentSymbol, activePeriod);

        // Update trade total
        updateTradeTotal();

    } catch (err) {
        alert('Could not find instrument: ' + err.message);
    }
}

// ═══════════════════════════════════════
// CHART
// ═══════════════════════════════════════
async function loadChart(symbol, period) {
    try {
        const allInds = [...activeIndicators, ...activeStrategies];
        const indsParam = encodeURIComponent(JSON.stringify(allInds));
        
        const btConfig = {
            val_split: parseFloat(document.getElementById('bt-val-split')?.value) || 20,
            stop_loss: parseFloat(document.getElementById('bt-stop-loss')?.value) || null,
            take_profit: parseFloat(document.getElementById('bt-take-profit')?.value) || null
        };
        const btParam = encodeURIComponent(JSON.stringify(btConfig));

        const res = await fetch(`${API}/api/finance/history/${encodeURIComponent(symbol)}?period=${period}&interval=1d&indicators=${indsParam}&backtest=${btParam}`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentChartData = data.data;
        currentChartMeta = data.meta;
        renderChart(currentChartData, symbol);
        renderBacktestResults(data.meta.backtest_results);
    } catch (err) {
        console.error('Chart load error:', err);
    }
}

function renderChart(data, symbol) {
    const ctx = document.getElementById('price-chart');
    if (priceChart) priceChart.destroy();

    const labels = data.map(d => {
        const date = new Date(d.date);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    });
    const prices = data.map(d => d.close);
    const isUp = prices.length > 1 && prices[prices.length - 1] >= prices[0];

    const datasets = [{
        label: symbol,
        data: prices,
        borderColor: isUp ? '#10b981' : '#ef4444',
        backgroundColor: isUp ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: isUp ? '#10b981' : '#ef4444',
        yAxisID: 'y'
    }];

    const meta = currentChartMeta || { overlays: [], oscillators: [], signals: [] };
    let needsOscillatorAxis = meta.oscillators && meta.oscillators.length > 0;
    
    const colors = ['#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9', '#14b8a6', '#f43f5e'];
    let cIdx = 0;
    const getColor = () => colors[cIdx++ % colors.length];

    meta.overlays.forEach(col => {
        datasets.push({
            label: col, data: data.map(d => d[col]), borderColor: getColor(), borderWidth: 1.5,
            pointRadius: 0, tension: 0.3, fill: false, yAxisID: 'y'
        });
    });

    meta.oscillators.forEach(col => {
        datasets.push({
            label: col, data: data.map(d => d[col]), borderColor: getColor(), borderWidth: 1.5,
            pointRadius: 0, tension: 0.3, fill: false, yAxisID: 'y_osc'
        });
    });
    
    meta.signals.forEach(col => {
        const buyData = data.map(d => d[col] === 'BUY' ? d.close : null);
        const sellData = data.map(d => d[col] === 'SELL' ? d.close : null);
        
        datasets.push({
            label: col + ' BUY', data: buyData, backgroundColor: '#10b981', borderColor: '#10b981',
            pointStyle: 'triangle', radius: 8, borderWidth: 2, yAxisID: 'y', showLine: false
        });
        datasets.push({
            label: col + ' SELL', data: sellData, backgroundColor: '#ef4444', borderColor: '#ef4444',
            pointStyle: 'triangle', rotation: 180, radius: 8, borderWidth: 2, yAxisID: 'y', showLine: false
        });
    });

    const scales = {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 11 } } },
        y: { type: 'linear', display: true, position: 'right', grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 }, callback: v => '$' + formatNum(v) } }
    };

    if (needsOscillatorAxis) {
        scales.y_osc = { type: 'linear', display: true, position: 'left', grid: { drawOnChartArea: false, color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8', font: { size: 10 } } };
    }

    priceChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { 
                    display: datasets.length > 1, 
                    labels: { color: '#94a3b8', boxWidth: 12, usePointStyle: true, pointStyle: 'line', filter: item => !item.text.includes('SELL') && !item.text.includes('BUY') } 
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)', titleColor: '#f1f5f9', bodyColor: '#94a3b8',
                    borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 12,
                    callbacks: {
                        label: function(c) {
                            let l = c.dataset.label || '';
                            if (l.includes('BUY') || l.includes('SELL')) return l;
                            if (l) l += ': ';
                            return l + (c.dataset.yAxisID === 'y' ? '$' + formatNum(c.raw) : Number(c.raw).toFixed(2));
                        }
                    }
                }
            },
            scales
        }
    });
}

// ═══════════════════════════════════════
// TRADING
// ═══════════════════════════════════════
function setTradeSide(side) {
    tradeSide = side;
    document.querySelectorAll('.trade-side-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.trade-side-btn[data-side="${side}"]`)?.classList.add('active');
}

function updateTradeTotal() {
    const qty = parseFloat(document.getElementById('trade-quantity')?.value) || 0;
    const total = qty * (currentPrice || 0);
    document.getElementById('trade-total').textContent = `$${formatNum(total)}`;
}

async function executeTrade() {
    if (!currentSymbol || !currentPrice) return alert('Please search for an instrument first.');

    const qty = parseFloat(document.getElementById('trade-quantity').value);
    if (!qty || qty <= 0) return showMsg('trade-msg', 'Enter a valid quantity', 'error');

    const tradeMsg = document.getElementById('trade-msg');

    try {
        document.getElementById('execute-trade-btn').disabled = true;
        const res = await fetch(`${API}/api/trading/trade`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol: currentSymbol,
                instrument_type: currentQuote?.type || 'stock',
                side: tradeSide,
                quantity: qty,
                price: currentPrice
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        tradeMsg.textContent = `${tradeSide.toUpperCase()} ${qty} ${currentSymbol} @ $${formatNum(currentPrice)} ✓`;
        tradeMsg.className = 'msg success';
        tradeMsg.classList.remove('hidden');
        document.getElementById('trade-quantity').value = '';
        updateTradeTotal();

        setTimeout(() => tradeMsg.classList.add('hidden'), 4000);
    } catch (err) {
        tradeMsg.textContent = err.message;
        tradeMsg.className = 'msg error';
        tradeMsg.classList.remove('hidden');
    } finally {
        document.getElementById('execute-trade-btn').disabled = false;
    }
}

// ═══════════════════════════════════════
// NEWS
// ═══════════════════════════════════════
async function loadNewsFeed() {
    const feed = document.getElementById('news-feed');
    feed.innerHTML = '<div class="loading-placeholder">Loading trending news...</div>';

    try {
        const res = await fetch(`${API}/api/news/sentiment`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        renderNews(data.articles, feed);
    } catch (err) {
        feed.innerHTML = `<div class="empty-state"><p>Failed to load news: ${err.message}</p></div>`;
    }
}

async function searchNews() {
    const query = document.getElementById('news-keyword-input').value.trim();
    if (!query) return;

    const feed = document.getElementById('news-feed');
    feed.innerHTML = '<div class="loading-placeholder">Searching news...</div>';

    try {
        // Get user's GNews API key from auth service
        let gnewsKey = '';
        try {
            const keyRes = await fetch(`${API}/auth/api-keys/gnews/decrypt`, { headers: authHeaders() });
            const keyData = await keyRes.json();
            if (keyRes.ok) gnewsKey = keyData.api_key;
        } catch { /* no key, fallback to HN */ }

        const headers = { ...authHeaders() };
        if (gnewsKey) headers['x-gnews-api-key'] = gnewsKey;

        const res = await fetch(`${API}/api/news/search?q=${encodeURIComponent(query)}`, { headers });
        const data = await res.json();

        if (!res.ok) {
            if (res.status === 400 && !gnewsKey) {
                // Fallback to HN Algolia search
                const hnRes = await fetch(`${API}/api/news/topic/${encodeURIComponent(query)}`, { headers: authHeaders() });
                const hnData = await hnRes.json();
                if (!hnRes.ok) throw new Error(hnData.error);
                renderNews(hnData.articles, feed, `Results for "${query}" (via Hacker News)`);
                return;
            }
            throw new Error(data.error);
        }

        renderNews(data.articles, feed, `Results for "${query}"`);
    } catch (err) {
        feed.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
}

function renderNews(articles, container, title) {
    if (!articles || articles.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No articles found</p></div>';
        return;
    }

    const header = title ? `<div style="margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem">${title}</div>` : '';

    container.innerHTML = header + articles.map(a => {
        const moodClass = (a.mood || 'neutral').toLowerCase();
        const timeStr = a.publishedAt || a.time ? new Date(a.publishedAt || a.time).toLocaleDateString() : '';
        return `
            <div class="news-card">
                <div class="news-card-content">
                    <div class="news-card-title"><a href="${a.url}" target="_blank">${a.title}</a></div>
                    ${a.description ? `<p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:6px">${a.description.substring(0, 120)}...</p>` : ''}
                    <div class="news-card-meta">
                        <span class="sentiment-badge ${moodClass}">${moodClass === 'positive' ? '▲' : moodClass === 'negative' ? '▼' : '—'} ${a.mood || 'Neutral'}</span>
                        ${a.source ? `<span>${a.source}</span>` : ''}
                        ${timeStr ? `<span>${timeStr}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ═══════════════════════════════════════
// PORTFOLIO PAGE
// ═══════════════════════════════════════
async function loadPortfolioPage() {
    loadHoldings();
    loadTradeHistory();
}

async function loadHoldings() {
    const container = document.getElementById('portfolio-holdings');
    container.innerHTML = '<div class="loading-placeholder">Loading portfolio...</div>';

    try {
        const res = await fetch(`${API}/api/trading/portfolio`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (!data.holdings || data.holdings.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No holdings yet. Start trading from the Market page!</p></div>';
            return;
        }

        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Symbol</th><th>Type</th><th>Quantity</th><th>Avg Buy Price</th><th>Total Cost</th></tr></thead>
                <tbody>
                    ${data.holdings.map(h => `
                        <tr>
                            <td><strong>${h.symbol}</strong></td>
                            <td>${h.instrument_type}</td>
                            <td>${parseFloat(h.quantity).toFixed(4)}</td>
                            <td>$${formatNum(h.avg_buy_price)}</td>
                            <td>$${formatNum(parseFloat(h.quantity) * parseFloat(h.avg_buy_price))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><p>Failed to load portfolio: ${err.message}</p></div>`;
    }
}

async function loadTradeHistory() {
    const container = document.getElementById('trade-history');
    container.innerHTML = '<div class="loading-placeholder">Loading trades...</div>';

    try {
        const res = await fetch(`${API}/api/trading/trades`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (!data.trades || data.trades.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No trades yet</p></div>';
            return;
        }

        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Date</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
                <tbody>
                    ${data.trades.map(t => `
                        <tr>
                            <td>${new Date(t.executed_at).toLocaleString()}</td>
                            <td><strong>${t.symbol}</strong></td>
                            <td class="side-${t.side}">${t.side.toUpperCase()}</td>
                            <td>${parseFloat(t.quantity).toFixed(4)}</td>
                            <td>$${formatNum(t.price)}</td>
                            <td>$${formatNum(t.total_value)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><p>Failed to load trades: ${err.message}</p></div>`;
    }
}

async function resetPortfolio() {
    if (!confirm('Are you sure? This will delete ALL your trades and holdings.')) return;

    try {
        const res = await fetch(`${API}/api/trading/trades`, { method: 'DELETE', headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        loadPortfolioPage();
    } catch (err) {
        alert('Failed to reset: ' + err.message);
    }
}

// ═══════════════════════════════════════
// SETTINGS PAGE
// ═══════════════════════════════════════
async function loadSettingsPage() {
    try {
        const res = await fetch(`${API}/auth/api-keys`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) return;

        const gnewsKey = data.api_keys?.find(k => k.provider === 'gnews');
        const statusEl = document.getElementById('settings-gnews-status');
        if (gnewsKey && statusEl) {
            statusEl.innerHTML = '<span class="status-dot"></span> Configured ✓';
        }
    } catch { /* ignore */ }
}

// ═══════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════
function formatNum(n) {
    const num = parseFloat(n);
    if (isNaN(num)) return '0.00';
    if (Math.abs(num) >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (Math.abs(num) < 1) return num.toFixed(6);
    return num.toFixed(2);
}

// ═══════════════════════════════════════
// DYNAMIC INDICATORS & BACKTEST UI
// ═══════════════════════════════════════
let currentModalContext = 'indicator';

function openIndicatorModal(context) {
    currentModalContext = context;
    document.getElementById('add-indicator-modal').classList.remove('hidden');
    
    // Update Modal Title
    const titleEl = document.getElementById('modal-dynamic-title');
    if (titleEl) {
        titleEl.textContent = context === 'indicator' ? 'Add Analytics' : 'Add Strategy';
    }

    // Filter options robustly
    document.querySelectorAll('.opt-indicator').forEach(el => {
        const isVisible = (context === 'indicator');
        el.style.display = isVisible ? '' : 'none';
        el.disabled = !isVisible;
        el.hidden = !isVisible;
        Array.from(el.children).forEach(opt => {
            opt.disabled = !isVisible;
            opt.hidden = !isVisible;
            opt.style.display = isVisible ? '' : 'none';
        });
    });

    document.querySelectorAll('.opt-strategy').forEach(el => {
        const isVisible = (context === 'strategy');
        el.style.display = isVisible ? '' : 'none';
        el.disabled = !isVisible;
        el.hidden = !isVisible;
        Array.from(el.children).forEach(opt => {
            opt.disabled = !isVisible;
            opt.hidden = !isVisible;
            opt.style.display = isVisible ? '' : 'none';
        });
    });
    
    // Select first visible option
    const select = document.getElementById('indicator-type-select');
    const firstVisible = Array.from(select.options).find(opt => !opt.disabled);
    if (firstVisible) {
        select.value = firstVisible.value;
    }
    
    renderIndicatorParams();
}

function closeIndicatorModal() {
    document.getElementById('add-indicator-modal').classList.add('hidden');
}

function renderIndicatorParams() {
    const type = document.getElementById('indicator-type-select').value;
    const container = document.getElementById('indicator-params');
    container.innerHTML = '';
    
    if (['SMA', 'EMA', 'BBANDS', 'MEDIAN', 'ZSCORE', 'RSI'].includes(type) || type.includes('SUPPORT') || type.includes('VOLUME') || type.includes('BB_REVERSAL')) {
        container.innerHTML += `<div class="input-group compact"><label>Period</label><input type="number" id="ind-param-period" value="20" min="2" max="200"></div>`;
    }
    if (type.includes('MACD') || type.includes('EMA_CROSS') || type.includes('SMA_CROSS')) {
        container.innerHTML += `<div class="input-group compact"><label>Fast Period</label><input type="number" id="ind-param-fast" value="12" min="2" max="100"></div>`;
        container.innerHTML += `<div class="input-group compact"><label>Slow Period</label><input type="number" id="ind-param-slow" value="26" min="2" max="200"></div>`;
    }
    if (type.includes('MACD')) {
        container.innerHTML += `<div class="input-group compact"><label>Signal Period</label><input type="number" id="ind-param-signal" value="9" min="2" max="50"></div>`;
    }
    if (type.includes('BBANDS') || type.includes('BB_REVERSAL')) {
        container.innerHTML += `<div class="input-group compact"><label>Std Dev</label><input type="number" id="ind-param-stddev" value="2" step="0.1"></div>`;
    }
    if (type === 'STRAT_GRID') {
        container.innerHTML += `<div class="input-group compact"><label>Number of Grids</label><input type="number" id="ind-param-grids" value="5" min="2" max="20"></div>`;
    }
    if (type === 'STRAT_RSI_MOMENTUM') {
        container.innerHTML += `<div class="input-group compact"><label>Upper Band</label><input type="number" id="ind-param-upper" value="70" min="50" max="99"></div>`;
        container.innerHTML += `<div class="input-group compact"><label>Lower Band</label><input type="number" id="ind-param-lower" value="30" min="1" max="50"></div>`;
    }
    if (type === 'STRAT_VOLUME_SPIKE') {
        container.innerHTML += `<div class="input-group compact"><label>Spike Multiplier (x)</label><input type="number" id="ind-param-mult" value="3.0" step="0.5"></div>`;
    }
}

function addIndicator() {
    const type = document.getElementById('indicator-type-select').value;
    const ind = { id: 'ind_' + Date.now(), type };
    
    const getVal = (id) => document.getElementById(id) ? parseFloat(document.getElementById(id).value) : undefined;
    
    if (getVal('ind-param-period')) ind.period = getVal('ind-param-period');
    if (getVal('ind-param-fast')) ind.fast = getVal('ind-param-fast');
    if (getVal('ind-param-slow')) ind.slow = getVal('ind-param-slow');
    if (getVal('ind-param-signal')) ind.signal = getVal('ind-param-signal');
    if (getVal('ind-param-stddev')) ind.stdDev = getVal('ind-param-stddev');
    if (getVal('ind-param-grids')) ind.grids = getVal('ind-param-grids');
    if (getVal('ind-param-upper')) ind.upper = getVal('ind-param-upper');
    if (getVal('ind-param-lower')) ind.lower = getVal('ind-param-lower');
    if (getVal('ind-param-mult')) ind.multiplier = getVal('ind-param-mult');

    if (currentModalContext === 'indicator') {
        activeIndicators.push(ind);
    } else {
        activeStrategies.push(ind);
    }
    
    renderActiveIndicators();
    savePreferences();
    closeIndicatorModal();
    if (currentSymbol) {
        const activePeriod = document.querySelector('.period-btn.active')?.dataset.period || '1mo';
        loadChart(currentSymbol, activePeriod);
    }
}

window.removeIndicator = function(id) {
    activeIndicators = activeIndicators.filter(i => i.id !== id);
    activeStrategies = activeStrategies.filter(i => i.id !== id);
    renderActiveIndicators();
    savePreferences();
    if (currentSymbol) {
        const activePeriod = document.querySelector('.period-btn.active')?.dataset.period || '1mo';
        loadChart(currentSymbol, activePeriod);
    }
};

function renderActiveIndicators() {
    const indContainer = document.getElementById('active-indicators');
    const stratContainer = document.getElementById('active-strategies');
    
    const renderChips = (arr) => {
        if (arr.length === 0) return '<div class="empty-chips">None active.</div>';
        return arr.map(ind => {
            const isStrat = ind.type.startsWith('STRAT_');
            let label = ind.type.replace('STRAT_', '');
            if (ind.period) label += ` (${ind.period})`;
            else if (ind.fast) label += ` (${ind.fast},${ind.slow})`;
            
            return `<div class="indicator-chip ${isStrat ? 'strategy' : ''}">
                ${label} <button onclick="removeIndicator('${ind.id}')">✕</button>
            </div>`;
        }).join('');
    };

    if (indContainer) indContainer.innerHTML = renderChips(activeIndicators);
    if (stratContainer) stratContainer.innerHTML = renderChips(activeStrategies);
}

window.toggleStrategyFilter = function(stratId) {
    if (activeStrategyFilter === stratId) activeStrategyFilter = null;
    else activeStrategyFilter = stratId;
    if (currentChartMeta && currentChartMeta.backtest_results) {
        renderBacktestResults(currentChartMeta.backtest_results);
    }
};

function renderBacktestResults(results) {
    const grid = document.getElementById('backtest-results-container');
    const logsContainer = document.getElementById('trade-logs-container');
    const tbody = document.getElementById('trade-logs-body');
    
    if (!results || Object.keys(results).length === 0) {
        grid.classList.add('hidden');
        logsContainer.classList.add('hidden');
        return;
    }
    
    grid.classList.remove('hidden');
    logsContainer.classList.remove('hidden');
    
    grid.innerHTML = '';
    tbody.innerHTML = '';
    
    for (const [stratId, data] of Object.entries(results)) {
        const strat = activeStrategies.find(s => s.id === stratId) || { type: stratId };
        const name = strat.type.replace('STRAT_', '');
        
        const isFiltered = activeStrategyFilter === stratId;
        const opacityStyle = activeStrategyFilter && !isFiltered ? 'opacity: 0.5;' : '';
        const cardClass = isFiltered ? 'backtest-card active' : 'backtest-card';
        
        // Render Card
        grid.innerHTML += `
            <div class="${cardClass}" style="${opacityStyle}" onclick="toggleStrategyFilter('${stratId}')">
                <h4>${name}</h4>
                <div class="bt-stats"><span class="label">Train PnL:</span> <span class="val ${data.train.pnl >= 0 ? 'positive' : 'negative'}">${data.train.pnl}%</span></div>
                <div class="bt-stats"><span class="label">Train Win Rate:</span> <span class="val">${data.train.win_rate}%</span></div>
                <div class="bt-stats"><span class="label">Train Max DD:</span> <span class="val negative">${data.train.max_dd}%</span></div>
                <div class="bt-stats"><span class="label">Val PnL:</span> <span class="val ${data.val.pnl >= 0 ? 'positive' : 'negative'}">${data.val.pnl}%</span></div>
                <div class="bt-stats"><span class="label">Val Win Rate:</span> <span class="val">${data.val.win_rate}%</span></div>
                <div class="bt-stats"><span class="label">Val Max DD:</span> <span class="val negative">${data.val.max_dd}%</span></div>
                <div class="bt-stats" style="margin-top:12px; border-top:1px solid rgba(255,255,255,0.05); padding-top:8px;">
                    <span class="label">Total Trades:</span> <span class="val">${data.train.trades + data.val.trades}</span>
                </div>
            </div>
        `;
        
        // Render Logs
        if (data.logs && data.logs.length > 0) {
            if (!activeStrategyFilter || activeStrategyFilter === stratId) {
                const rows = data.logs.map(t => {
                    const pnlClass = t.pnl >= 0 ? 'positive' : 'negative';
                    const rowClass = t.pnl >= 0 ? 'positive-trade' : 'negative-trade';
                    return `
                        <tr class="${rowClass}">
                            <td>${name}</td>
                            <td>${t.period}</td>
                            <td>${new Date(t.entry_date).toLocaleDateString()}</td>
                            <td>${new Date(t.exit_date).toLocaleDateString()}</td>
                            <td>$${formatNum(t.entry_price)}</td>
                            <td>$${formatNum(t.exit_price)}</td>
                            <td class="${pnlClass}">$${formatNum(t.pnl)}</td>
                            <td class="${pnlClass}">${t.pnl_pct}%</td>
                            <td>${t.reason || '-'}</td>
                        </tr>
                    `;
                }).join('');
                tbody.innerHTML += rows;
            }
        }
    }
}

// Start app
init();

// ═══════════════════════════════════════
// CSV EXPORT UTILITIES
// ═══════════════════════════════════════
function downloadCSV(filename, csvContent) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function exportChartCSV() {
    if (!currentChartData || currentChartData.length === 0) {
        return alert("No chart data available to export.");
    }
    const keys = Object.keys(currentChartData[0]);
    let csv = keys.join(',') + '\n';
    
    currentChartData.forEach(row => {
        csv += keys.map(k => {
            let val = row[k];
            if (val === null || val === undefined) val = '';
            // Quote string if it contains comma
            if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
            return val;
        }).join(',') + '\n';
    });
    
    downloadCSV(`${currentSymbol}_data.csv`, csv);
}

function exportTradesCSV() {
    if (!currentChartMeta || !currentChartMeta.backtest_results) {
        return alert("No trade logs available to export.");
    }
    
    let allTrades = [];
    Object.keys(currentChartMeta.backtest_results).forEach(strategy => {
        const stratResult = currentChartMeta.backtest_results[strategy];
        if (stratResult && stratResult.trades) {
            stratResult.trades.forEach(t => {
                t.strategy = strategy;
                allTrades.push(t);
            });
        }
    });
    
    if (allTrades.length === 0) {
        return alert("No trades found in the active strategies.");
    }
    
    // Ensure chronological order
    allTrades.sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date));
    
    const keys = ["strategy", "side", "entry_date", "entry_price", "exit_date", "exit_price", "pnl", "pnl_pct", "bars_held"];
    let csv = keys.join(',') + '\n';
    
    allTrades.forEach(row => {
        csv += keys.map(k => {
            let val = row[k];
            if (val === null || val === undefined) val = '';
            // Format percentages
            if (k === 'pnl_pct' && val !== '') val = (val * 100).toFixed(2) + '%';
            if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
            return val;
        }).join(',') + '\n';
    });
    
    downloadCSV(`${currentSymbol}_trade_logs.csv`, csv);
}
