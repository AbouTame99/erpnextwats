const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

app.use(express.json());

// Global state to track sessions
const sessions = {};

class WhatsAppSession {
    constructor(userId) {
        this.userId = userId;
        this.status = 'init';
        this.qrCode = null;
        this.client = null;
        this.authDir = path.join(__dirname, 'wwebjs_auth');
    }

    async initialize() {
        console.log(`[${this.userId}] Starting initialization...`);
        this.status = 'initializing';

        try {
            // Sanitize userId for clientId (only alphanumeric, _, - allowed)
            const safeClientId = this.userId.replace(/[^a-zA-Z0-9_-]/g, '_');

            // Create client with LocalAuth
            this.client = new Client({
                authStrategy: new LocalAuth({
                    clientId: safeClientId,
                    dataPath: this.authDir
                }),
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
                }
            });

            this.bindEvents();

            console.log(`[${this.userId}] Initializing client...`);
            await this.client.initialize();

        } catch (error) {
            console.error(`[${this.userId}] Error during initialization:`, error);
            this.status = 'error';
        }
    }

    bindEvents() {
        this.client.on('qr', (qr) => {
            console.log(`[${this.userId}] QR code received`);
            qrcode.toDataURL(qr).then(qrImage => {
                this.qrCode = qrImage;
                this.status = 'qr_ready';
                console.log(`[${this.userId}] QR code ready! Status: ${this.status}`);
            }).catch(err => {
                console.error(`[${this.userId}] Error generating QR code:`, err);
                this.status = 'error';
            });
        });

        this.client.on('ready', () => {
            console.log(`[${this.userId}] Client is ready!`);
            this.status = 'ready';
            this.qrCode = null;
        });

        this.client.on('authenticated', () => {
            console.log(`[${this.userId}] Authenticated successfully!`);
            this.status = 'connecting';
        });

        this.client.on('auth_failure', (msg) => {
            console.error(`[${this.userId}] Auth failure:`, msg);
            this.status = 'auth_failure';
            // Clean up could happen here, or let the user trigger re-init
        });

        this.client.on('disconnected', (reason) => {
            console.log(`[${this.userId}] Client was disconnected:`, reason);
            this.status = 'disconnected';
            // Optional: destroy client to free resources
            this.client.destroy().catch(e => console.error("Error destroying client:", e));
            this.client = null;
        });
    }

    async sendMessage(to, message) {
        if (!this.client || this.status !== 'ready') {
            throw new Error('Session not ready');
        }

        // Format phone number
        let phoneNumber = to.replace(/[^0-9]/g, '');
        if (!phoneNumber.endsWith('@c.us')) {
            phoneNumber = `${phoneNumber}@c.us`;
        }

        console.log(`[${this.userId}] Sending message to ${phoneNumber}`);
        await this.client.sendMessage(phoneNumber, message);
    }

    async disconnect() {
        if (this.client) {
            console.log(`[${this.userId}] Disconnecting...`);
            await this.client.destroy();
            this.client = null;
            this.status = 'disconnected';
        }
    }
}

// Initialize session
app.post('/api/whatsapp/init', async (req, res) => {
    const userId = req.body.userId;
    console.log(`[API] POST /api/whatsapp/init - userId: ${userId}`);

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    // If session exists, check status
    if (sessions[userId]) {
        console.log(`[API] Session exists for ${userId}, status: ${sessions[userId].status}`);
        if (sessions[userId].status === 'ready') {
            return res.json({ status: 'ready' });
        }

        // If disconnected or error, clean up and restart
        if (sessions[userId].status === 'disconnected' || sessions[userId].status === 'error') {
            console.log(`[API] Session exists but is in ${sessions[userId].status} state, recreating...`);
            if (sessions[userId].client) {
                try { await sessions[userId].client.destroy(); } catch (e) { }
            }
            delete sessions[userId];
        } else {
            // If initializing or qr_ready, just return status
            return res.json({ status: sessions[userId].status });
        }
    }

    // Create new session
    console.log(`[API] Creating new session for ${userId}`);
    const session = new WhatsAppSession(userId);
    sessions[userId] = session;

    // Initialize asynchronously
    session.initialize().catch(err => console.error(`[API] init error:`, err));

    res.json({ status: 'initializing' });
});

// Get session status
app.get('/api/whatsapp/status/:userId', (req, res) => {
    const userId = req.params.userId;

    if (!sessions[userId]) {
        return res.json({ status: 'disconnected' });
    }

    const session = sessions[userId];
    res.json({
        status: session.status,
        qr: session.qrCode
    });
});

// Send message
app.post('/api/whatsapp/send', async (req, res) => {
    const { userId, to, message } = req.body;

    if (!sessions[userId] || sessions[userId].status !== 'ready') {
        return res.status(400).json({ error: 'Session not ready' });
    }

    try {
        await sessions[userId].sendMessage(to, message);
        res.json({ status: 'success' });
    } catch (error) {
        console.error(`[API] Failed to send message:`, error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Disconnect session
app.post('/api/whatsapp/disconnect', async (req, res) => {
    const userId = req.body.userId;

    if (sessions[userId]) {
        await sessions[userId].disconnect();
        delete sessions[userId];
        res.json({ status: 'disconnected' });
    } else {
        res.json({ status: 'not_found' });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(port, '0.0.0.0', () => {
    console.log(`WhatsApp Gateway running on port ${port} (using whatsapp-web.js)`);
});
