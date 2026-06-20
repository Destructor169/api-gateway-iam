import express from 'express';
import dotenv from 'dotenv';
import proxy from 'express-http-proxy';
import { verifyJWT } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimiter';

dotenv.config();

const app = express();

import cors from 'cors';
app.use(cors());

const PORT = process.env.PORT || 3000;

const DEMO_SERVICE_URL = process.env.DEMO_SERVICE_URL || 'http://localhost:3002';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

// Public endpoints proxy (Auth)
// express-http-proxy automatically forwards the remaining path.
// For example, if a request comes to /auth/login, it strips /auth and sends /login to the target.
app.use('/auth', proxy(AUTH_SERVICE_URL));

// Protected endpoints proxy (Demo)
// Apply JWT verification and rate limiting
app.use('/api', verifyJWT, rateLimiter, proxy(DEMO_SERVICE_URL));

app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
