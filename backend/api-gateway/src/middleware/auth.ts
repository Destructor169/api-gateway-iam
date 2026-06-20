import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import http from 'http';

// We need to fetch the public key from the auth service
let publicKey = '';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

// In a real scenario, cache this and refresh periodically. 
const fetchPublicKey = (): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (publicKey) return resolve(publicKey);
        
        http.get(`${AUTH_SERVICE_URL}/public-key`, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    publicKey = parsed.publicKey;
                    resolve(publicKey);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (err) => reject(err));
    });
};

export interface AuthRequest extends Request {
    user?: any;
}

export const verifyJWT = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const key = await fetchPublicKey();
        const decoded = jwt.verify(token, key, { algorithms: ['RS256'] });
        req.user = decoded; // pass user info to next middleware
        next();
    } catch (err: any) {
        console.error('JWT Verification Error:', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};
