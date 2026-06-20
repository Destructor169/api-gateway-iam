import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { pool } from './db';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

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

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
            [username, hashedPassword]
        );
        res.status(201).json({ user: result.rows[0] });
    } catch (err: any) {
        if (err.code === '23505') { // unique_violation
            res.status(409).json({ error: 'Username already exists' });
        } else {
            console.error(err);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            privateKey,
            { algorithm: 'RS256', expiresIn: '1h' }
        );

        res.json({ token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Expose public key for API Gateway
app.get('/public-key', (req, res) => {
    res.json({ publicKey });
});

app.listen(PORT, () => {
    console.log(`Auth service running on port ${PORT}`);
});
