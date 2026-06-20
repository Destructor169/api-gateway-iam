const API_BASE_URL = 'http://localhost:3000'; // Points to the API Gateway

// DOM Elements
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const authError = document.getElementById('auth-error');
const registerBtn = document.getElementById('register-btn');
const userDisplay = document.getElementById('user-display');
const logoutBtn = document.getElementById('logout-btn');
const fetchDataBtn = document.getElementById('fetch-data-btn');
const dataDisplay = document.getElementById('data-display');
const dataError = document.getElementById('data-error');

// State
let token = localStorage.getItem('jwt_token');
let currentUser = localStorage.getItem('username');

// Initialize UI
function init() {
    if (token && currentUser) {
        showDashboard();
    } else {
        showAuth();
    }
}

// UI State Management
function showAuth() {
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    usernameInput.value = '';
    passwordInput.value = '';
    authError.classList.add('hidden');
}

function showDashboard() {
    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    userDisplay.textContent = currentUser;
    dataDisplay.classList.add('hidden');
    dataError.classList.add('hidden');
}

function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
}

// Authentication Handlers
async function handleAuth(action) {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        showError(authError, "Please enter both username and password");
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Authentication failed');
        }

        if (action === 'register') {
            // After successful registration, auto-login
            await handleAuth('login');
        } else if (action === 'login') {
            token = data.token;
            currentUser = username;
            localStorage.setItem('jwt_token', token);
            localStorage.setItem('username', username);
            showDashboard();
        }

    } catch (err) {
        showError(authError, err.message);
    }
}

// Event Listeners
authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAuth('login');
});

registerBtn.addEventListener('click', () => {
    handleAuth('register');
});

logoutBtn.addEventListener('click', () => {
    token = null;
    currentUser = null;
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('username');
    showAuth();
});

// Fetch Protected Data
fetchDataBtn.addEventListener('click', async () => {
    dataDisplay.classList.add('hidden');
    dataError.classList.add('hidden');

    // Button loading state
    const originalText = fetchDataBtn.textContent;
    fetchDataBtn.textContent = 'Fetching...';
    fetchDataBtn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/data`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 429) {
                throw new Error("Rate limit exceeded! Please wait before trying again.");
            } else if (response.status === 401) {
                // Token might be expired
                logoutBtn.click();
                throw new Error("Session expired. Please log in again.");
            }
            throw new Error(data.error || 'Failed to fetch data');
        }

        dataDisplay.textContent = JSON.stringify(data, null, 2);
        dataDisplay.classList.remove('hidden');
    } catch (err) {
        showError(dataError, err.message);
    } finally {
        fetchDataBtn.textContent = originalText;
        fetchDataBtn.disabled = false;
    }
});

// Run init
init();
