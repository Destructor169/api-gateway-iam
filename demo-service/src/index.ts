import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

app.get('/api/data', (req, res) => {
    // This service trusts the gateway to have authenticated the request.
    // In a real microservice, it might decode the JWT forwarded by the gateway
    // to identify the user, if the gateway passes the decoded user context as a header.
    res.json({
        message: 'Hello from the protected Demo Service!',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`Demo service running on port ${PORT}`);
});
