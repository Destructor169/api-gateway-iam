import { Response, NextFunction } from 'express';
import { createClient } from 'redis';
import { AuthRequest } from './auth';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || '6379';

const redisClient = createClient({
    url: `redis://${redisHost}:${redisPort}`
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect().catch(console.error);

const WINDOW_SIZE_IN_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 30;

export const rateLimiter = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        // Rate limit by user ID, or IP if user not present (should be present due to verifyJWT)
        const identifier = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
        
        const requests = await redisClient.incr(identifier);
        
        if (requests === 1) {
            await redisClient.expire(identifier, WINDOW_SIZE_IN_SECONDS);
        }

        if (requests > MAX_REQUESTS_PER_WINDOW) {
            return res.status(429).json({ error: 'Too many requests, please try again later.' });
        }

        next();
    } catch (err) {
        console.error('Redis Rate Limiting Error:', err);
        // Fail open if Redis is down
        next();
    }
};
