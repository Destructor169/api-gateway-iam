import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import CryptoJS from 'crypto-js';
import nodemailer from 'nodemailer';
import { pool } from './db';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production';

// Load keys
const privateKeyPath = path.join(__dirname, '../keys/private.pem');
const publicKeyPath = path.join(__dirname, '../keys/public.pem');

let privateKey = '';
let publicKey = '';

try {
    privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    publicKey = fs.readFileSync(publicKeyPath, 'utf8');
} catch (e) {
    console.error('Error reading keys. Make sure they are generated in the keys/ directory.');
    process.exit(1);
}

// Helper: encrypt/decrypt API keys
function encryptApiKey(key: string): string {
    return CryptoJS.AES.encrypt(key, ENCRYPTION_KEY).toString();
}

function decryptApiKey(encrypted: string): string {
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}

// Helper: extract user from JWT (for protected auth-service routes)
function extractUser(req: express.Request): { id: number; username: string } | null {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as any;
        return { id: decoded.id, username: decoded.username };
    } catch {
        return null;
    }
}

// ──────────────────────────────────────
// AUTH ENDPOINTS (public)
// ──────────────────────────────────────

let transporter: any;
nodemailer.createTestAccount().then(account => {
    transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass }
    });
    console.log('Ethereal Email Transporter Ready');
});
app.post('/register', async (req, res) => {
    const { contact, firstName, lastName, password } = req.body;
    if (!contact || !password) return res.status(400).json({ error: 'Contact and password required' });

    const isEmail = contact.includes('@');
    try {
        const userRes = await pool.query(`SELECT id FROM users WHERE ${isEmail ? 'email' : 'mobile_number'} = $1`, [contact]);
        if (userRes.rows.length > 0) return res.status(400).json({ error: 'User already exists' });

        const hash = await bcrypt.hash(password, 10);
        const insertRes = await pool.query(
            `INSERT INTO users (${isEmail ? 'email' : 'mobile_number'}, first_name, last_name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
            [contact, firstName || null, lastName || null, hash]
        );
        const userId = insertRes.rows[0].id;

        const token = jwt.sign(
            { id: userId, username: contact, first_name: firstName, last_name: lastName },
            privateKey,
            { algorithm: 'RS256', expiresIn: '12h' }
        );
        res.json({ token, user: { id: userId, contact, firstName, lastName } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/login', async (req, res) => {
    const { contact, password } = req.body;
    if (!contact || !password) return res.status(400).json({ error: 'Contact and password required' });
    const isEmail = contact.includes('@');

    try {
        const userRes = await pool.query(`SELECT id, first_name, last_name, password_hash FROM users WHERE ${isEmail ? 'email' : 'mobile_number'} = $1`, [contact]);
        if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = userRes.rows[0];

        if (!user.password_hash) {
            return res.status(401).json({ error: 'Please use OTP to login and set a password' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { id: user.id, username: contact, first_name: user.first_name, last_name: user.last_name },
            privateKey,
            { algorithm: 'RS256', expiresIn: '12h' }
        );
        res.json({ token, user: { id: user.id, contact, firstName: user.first_name, lastName: user.last_name } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/request-otp', async (req, res) => {
    const { contact, firstName, lastName } = req.body;
    if (!contact) return res.status(400).json({ error: 'Contact method required' });

    const isEmail = contact.includes('@');
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 mins

    try {
        let userId;
        const userRes = await pool.query(`SELECT id FROM users WHERE ${isEmail ? 'email' : 'mobile_number'} = $1`, [contact]);
        if (userRes.rows.length === 0) {
            const insertRes = await pool.query(
                `INSERT INTO users (${isEmail ? 'email' : 'mobile_number'}, first_name, last_name) VALUES ($1, $2, $3) RETURNING id`,
                [contact, firstName || null, lastName || null]
            );
            userId = insertRes.rows[0].id;
        } else {
            userId = userRes.rows[0].id;
            if (firstName || lastName) {
                await pool.query(
                    `UPDATE users SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name) WHERE id = $3`,
                    [firstName || null, lastName || null, userId]
                );
            }
        }

        await pool.query('DELETE FROM otp_codes WHERE user_id = $1', [userId]);
        await pool.query('INSERT INTO otp_codes (user_id, code, expires_at) VALUES ($1, $2, $3)', [userId, code, expiresAt]);

        if (isEmail) {
            if (transporter) {
                const info = await transporter.sendMail({
                    from: '"FinVault" <noreply@finvault.io>',
                    to: contact,
                    subject: "Your FinVault Login Code",
                    html: `<h2>Welcome to FinVault</h2><p>Your one-time login code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
                });
                console.log("OTP Email Sent! Preview URL: %s", nodemailer.getTestMessageUrl(info));
            }
        } else {
            console.log(`\n\n[MOBILE OTP SIMULATOR] SMS Sent to ${contact}: Your FinVault code is ${code}\n\n`);
        }

        res.json({ success: true, message: 'OTP sent' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/verify-otp', async (req, res) => {
    const { contact, code } = req.body;
    if (!contact || !code) return res.status(400).json({ error: 'Contact and code required' });

    const isEmail = contact.includes('@');

    try {
        const userRes = await pool.query(`SELECT id, first_name, last_name FROM users WHERE ${isEmail ? 'email' : 'mobile_number'} = $1`, [contact]);
        if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid code or contact' });
        const user = userRes.rows[0];

        const codeRes = await pool.query('SELECT * FROM otp_codes WHERE user_id = $1 AND code = $2 AND expires_at > NOW()', [user.id, code]);
        if (codeRes.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired code' });

        await pool.query('DELETE FROM otp_codes WHERE user_id = $1', [user.id]);

        const token = jwt.sign(
            { id: user.id, username: contact, first_name: user.first_name, last_name: user.last_name },
            privateKey,
            { algorithm: 'RS256', expiresIn: '12h' }
        );

        res.json({ token, user: { id: user.id, contact, firstName: user.first_name, lastName: user.last_name } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Expose public key for API Gateway
app.get('/public-key', (req, res) => {
    res.json({ publicKey });
});

// ──────────────────────────────────────
// PROFILE ENDPOINT (protected)
// ──────────────────────────────────────

app.get('/profile', async (req, res) => {
    const user = extractUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const keysResult = await pool.query(
            'SELECT id, provider, created_at FROM user_api_keys WHERE user_id = $1',
            [user.id]
        );

        res.json({
            id: user.id,
            username: user.username,
            api_keys_configured: keysResult.rows.length > 0,
            api_keys: keysResult.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ──────────────────────────────────────
// API KEY MANAGEMENT (protected)
// ──────────────────────────────────────

// Save an API key
app.post('/api-keys', async (req, res) => {
    const user = extractUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { provider, api_key } = req.body;
    if (!provider || !api_key) {
        return res.status(400).json({ error: 'Provider and api_key are required' });
    }

    const allowedProviders = ['gnews', 'newsapi', 'alpha_vantage'];
    if (!allowedProviders.includes(provider)) {
        return res.status(400).json({ error: `Invalid provider. Allowed: ${allowedProviders.join(', ')}` });
    }

    try {
        const encrypted = encryptApiKey(api_key);
        const result = await pool.query(
            `INSERT INTO user_api_keys (user_id, provider, api_key_encrypted)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, provider) DO UPDATE SET api_key_encrypted = $3, created_at = CURRENT_TIMESTAMP
             RETURNING id, provider, created_at`,
            [user.id, provider, encrypted]
        );
        res.status(201).json({ api_key: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all API keys for the user (masked)
app.get('/api-keys', async (req, res) => {
    const user = extractUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const result = await pool.query(
            'SELECT id, provider, created_at FROM user_api_keys WHERE user_id = $1',
            [user.id]
        );
        res.json({ api_keys: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get a decrypted API key (used internally by gateway)
app.get('/api-keys/:provider/decrypt', async (req, res) => {
    const user = extractUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const result = await pool.query(
            'SELECT api_key_encrypted FROM user_api_keys WHERE user_id = $1 AND provider = $2',
            [user.id, req.params.provider]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'API key not found for this provider' });
        }
        const decrypted = decryptApiKey(result.rows[0].api_key_encrypted);
        res.json({ api_key: decrypted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete an API key
app.delete('/api-keys/:id', async (req, res) => {
    const user = extractUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const result = await pool.query(
            'DELETE FROM user_api_keys WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'API key not found' });
        }
        res.json({ message: 'API key deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ──────────────────────────────────────
// PREFERENCES (protected)
// ──────────────────────────────────────

app.get('/preferences', async (req, res) => {
    const user = extractUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const result = await pool.query(
            'SELECT dashboard_state FROM user_preferences WHERE user_id = $1',
            [user.id]
        );
        if (result.rows.length > 0) {
            res.json({ state: result.rows[0].dashboard_state });
        } else {
            res.json({ state: {} });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/preferences', async (req, res) => {
    const user = extractUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { state } = req.body;
    if (!state) return res.status(400).json({ error: 'State payload required' });

    try {
        await pool.query(
            `INSERT INTO user_preferences (user_id, dashboard_state, updated_at) 
             VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id) DO UPDATE SET dashboard_state = $2, updated_at = CURRENT_TIMESTAMP`,
            [user.id, state]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Auth service running on port ${PORT}`);
});
