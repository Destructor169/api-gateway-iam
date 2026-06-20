import express from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3004;

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'iam_db',
    password: process.env.DB_PASSWORD || 'password',
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

// Helper: extract user_id from gateway-injected header
function getUserId(req: express.Request): number | null {
    const userId = req.headers['x-user-id'];
    if (!userId) return null;
    return parseInt(userId as string, 10);
}

// ──────────────────────────────────────
// POST /trade — Execute a paper trade
// ──────────────────────────────────────
app.post('/trade', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized — missing user context' });

    const { symbol, instrument_type, side, quantity, price } = req.body;

    // Validate inputs
    if (!symbol || !side || !quantity || !price) {
        return res.status(400).json({ error: 'symbol, side, quantity, and price are required' });
    }
    if (!['buy', 'sell'].includes(side)) {
        return res.status(400).json({ error: 'side must be "buy" or "sell"' });
    }
    if (quantity <= 0 || price <= 0) {
        return res.status(400).json({ error: 'quantity and price must be positive numbers' });
    }

    const totalValue = parseFloat((quantity * price).toFixed(8));
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        if (side === 'sell') {
            // Check if user has enough holdings
            const holdingResult = await client.query(
                'SELECT quantity FROM portfolio WHERE user_id = $1 AND symbol = $2',
                [userId, symbol.toUpperCase()]
            );
            if (holdingResult.rows.length === 0 || parseFloat(holdingResult.rows[0].quantity) < quantity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Insufficient holdings to sell' });
            }
        }

        // Insert trade
        const tradeResult = await client.query(
            `INSERT INTO trades (user_id, symbol, instrument_type, side, quantity, price, total_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [userId, symbol.toUpperCase(), instrument_type || 'stock', side, quantity, price, totalValue]
        );

        // Update portfolio
        if (side === 'buy') {
            const existing = await client.query(
                'SELECT quantity, avg_buy_price FROM portfolio WHERE user_id = $1 AND symbol = $2',
                [userId, symbol.toUpperCase()]
            );

            if (existing.rows.length > 0) {
                const oldQty = parseFloat(existing.rows[0].quantity);
                const oldAvg = parseFloat(existing.rows[0].avg_buy_price);
                const newQty = oldQty + quantity;
                const newAvg = ((oldQty * oldAvg) + (quantity * price)) / newQty;

                await client.query(
                    'UPDATE portfolio SET quantity = $1, avg_buy_price = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3 AND symbol = $4',
                    [newQty, parseFloat(newAvg.toFixed(8)), userId, symbol.toUpperCase()]
                );
            } else {
                await client.query(
                    'INSERT INTO portfolio (user_id, symbol, instrument_type, quantity, avg_buy_price) VALUES ($1, $2, $3, $4, $5)',
                    [userId, symbol.toUpperCase(), instrument_type || 'stock', quantity, price]
                );
            }
        } else {
            // Sell
            const existing = await client.query(
                'SELECT quantity FROM portfolio WHERE user_id = $1 AND symbol = $2',
                [userId, symbol.toUpperCase()]
            );
            const oldQty = parseFloat(existing.rows[0].quantity);
            const newQty = oldQty - quantity;

            if (newQty <= 0.000000001) {
                await client.query(
                    'DELETE FROM portfolio WHERE user_id = $1 AND symbol = $2',
                    [userId, symbol.toUpperCase()]
                );
            } else {
                await client.query(
                    'UPDATE portfolio SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND symbol = $3',
                    [newQty, userId, symbol.toUpperCase()]
                );
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ trade: tradeResult.rows[0] });

    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error('Trade execution error:', err);
        res.status(500).json({ error: 'Trade execution failed' });
    } finally {
        client.release();
    }
});

// ──────────────────────────────────────
// GET /trades — Trade history
// ──────────────────────────────────────
app.get('/trades', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const result = await pool.query(
            'SELECT * FROM trades WHERE user_id = $1 ORDER BY executed_at DESC',
            [userId]
        );
        res.json({ trades: result.rows });
    } catch (err) {
        console.error('Error fetching trades:', err);
        res.status(500).json({ error: 'Failed to fetch trades' });
    }
});

// ──────────────────────────────────────
// GET /portfolio — Current holdings
// ──────────────────────────────────────
app.get('/portfolio', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const result = await pool.query(
            'SELECT * FROM portfolio WHERE user_id = $1 ORDER BY symbol ASC',
            [userId]
        );
        res.json({ holdings: result.rows });
    } catch (err) {
        console.error('Error fetching portfolio:', err);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
});

// ──────────────────────────────────────
// DELETE /trades — Reset portfolio
// ──────────────────────────────────────
app.delete('/trades', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        await pool.query('DELETE FROM trades WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM portfolio WHERE user_id = $1', [userId]);
        res.json({ message: 'Portfolio reset successfully' });
    } catch (err) {
        console.error('Error resetting portfolio:', err);
        res.status(500).json({ error: 'Failed to reset portfolio' });
    }
});

app.listen(PORT, () => {
    console.log(`Trading service running on port ${PORT}`);
});
