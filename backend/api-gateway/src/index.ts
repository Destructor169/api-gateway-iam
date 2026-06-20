import express from 'express';
import dotenv from 'dotenv';
import proxy from 'express-http-proxy';
import cors from 'cors';
import { verifyJWT } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimiter';

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const FINANCE_SERVICE_URL = process.env.FINANCE_SERVICE_URL || 'http://localhost:3002';
const NEWS_SERVICE_URL = process.env.NEWS_SERVICE_URL || 'http://localhost:3003';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const TRADING_SERVICE_URL = process.env.TRADING_SERVICE_URL || 'http://localhost:3004';

// ──────────────────────────────────────
// Public endpoints proxy (Auth)
// ──────────────────────────────────────
app.use('/auth', proxy(AUTH_SERVICE_URL));

// ──────────────────────────────────────
// Protected endpoints — inject x-user-id from JWT
// ──────────────────────────────────────

// Finance Service
app.use('/api/finance', verifyJWT, rateLimiter, proxy(FINANCE_SERVICE_URL, {
    proxyReqOptDecorator: (proxyReqOpts: any, srcReq: any) => {
        if (srcReq.user) {
            proxyReqOpts.headers['x-user-id'] = srcReq.user.id;
            proxyReqOpts.headers['x-username'] = srcReq.user.username;
        }
        return proxyReqOpts;
    }
}));

// News Service
app.use('/api/news', verifyJWT, rateLimiter, proxy(NEWS_SERVICE_URL, {
    proxyReqOptDecorator: (proxyReqOpts: any, srcReq: any) => {
        if (srcReq.user) {
            proxyReqOpts.headers['x-user-id'] = srcReq.user.id;
            proxyReqOpts.headers['x-username'] = srcReq.user.username;
        }
        return proxyReqOpts;
    }
}));

// Trading Service
app.use('/api/trading', verifyJWT, rateLimiter, proxy(TRADING_SERVICE_URL, {
    proxyReqOptDecorator: (proxyReqOpts: any, srcReq: any) => {
        if (srcReq.user) {
            proxyReqOpts.headers['x-user-id'] = srcReq.user.id;
            proxyReqOpts.headers['x-username'] = srcReq.user.username;
        }
        return proxyReqOpts;
    }
}));

app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
