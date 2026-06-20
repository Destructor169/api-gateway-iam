import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';
import { verifyJWT } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimiter';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const DEMO_SERVICE_URL = process.env.DEMO_SERVICE_URL || 'http://localhost:3002';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

// Public endpoints proxy (Auth)
app.use('/auth', createProxyMiddleware({ 
    target: AUTH_SERVICE_URL, 
    changeOrigin: true,
    pathRewrite: {
        '^/auth': '', // remove /auth prefix when forwarding
    },
}));

// Protected endpoints proxy (Demo)
// Apply JWT verification and rate limiting
app.use('/api', verifyJWT, rateLimiter, createProxyMiddleware({ 
    target: DEMO_SERVICE_URL, 
    changeOrigin: true,
}));

app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
