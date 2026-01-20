const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

const clients = new Map();

async function initClient(userId) {
    if (clients.has(userId)) {
        return clients.get(userId);
    }

    console.log(`Initializing client for user: ${userId}`);

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: userId
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    });

    client.userId = userId;
    client.qr = null;
    client.status = 'initializing';

    client.on('qr', (qr) => {
        console.log(`QR received for ${userId}`);
        client.qr = qr;
        client.status = 'qr_ready';
    });

    client.on('ready', () => {
        console.log(`Client is ready for ${userId}`);
        client.status = 'ready';
        client.qr = null;
    });

    client.on('authenticated', () => {
        console.log(`Client authenticated for ${userId}`);
    });

    client.on('auth_failure', (msg) => {
        console.error(`Auth failure for ${userId}:`, msg);
        client.status = 'error';
    });

    client.on('disconnected', (reason) => {
        console.log(`Client disconnected for ${userId}:`, reason);
        client.status = 'disconnected';
        clients.delete(userId);
    });

    client.initialize().catch(err => {
        console.error(`Error initializing client for ${userId}:`, err);
        client.status = 'error';
    });

    clients.set(userId, client);
    return client;
}

// API Endpoints
app.post('/session/init', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).send('userId is required');

    try {
        const client = await initClient(userId);
        res.json({ status: client.status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/session/status/:userId', (req, res) => {
    const { userId } = req.params;
    const client = clients.get(userId);
    if (!client) return res.json({ status: 'disconnected' });
    res.json({ status: client.status });
});

app.get('/session/qr/:userId', async (req, res) => {
    const { userId } = req.params;
    const client = clients.get(userId);

    if (!client || !client.qr) {
        return res.status(404).json({ error: 'QR not available' });
    }

    try {
        const qrImage = await qrcode.toDataURL(client.qr);
        res.json({ qr: qrImage });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/message/send', async (req, res) => {
    const { userId, to, message } = req.body;
    const client = clients.get(userId);

    if (!client || client.status !== 'ready') {
        return res.status(400).json({ error: 'Client not ready' });
    }

    try {
        const jid = to.includes('@') ? to : `${to}@c.us`;
        await client.sendMessage(jid, message);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`WhatsApp Multi-Session Service listening at http://127.0.0.1:${port}`);
});

// Prevent service from crashing on unhandled errors
process.on('uncaughtException', (err) => {
    console.error('There was an uncaught error', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
