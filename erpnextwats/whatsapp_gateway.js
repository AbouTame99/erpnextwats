const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

// CORS headers to allow connections
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Increased limits for media attachments
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

const BASE_AUTH_DIR = '/cloudclusters/erpnext/frappe-bench/whatsapp_auth';
if (!fs.existsSync(BASE_AUTH_DIR)) fs.mkdirSync(BASE_AUTH_DIR, { recursive: true });

const sessions = {};

function getSafeId(userId) {
    return userId ? userId.replace(/[^a-zA-Z0-9_-]/g, '_') : null;
}

class WhatsAppSession {
    constructor(userId) {
        this.userId = userId;
        this.safeId = getSafeId(userId);
        this.status = 'init';
        this.qrCode = null;
        this.client = null;
    }

    async initialize() {
        if (this.status === 'initializing' || this.status === 'ready') return;

        console.log(`[${this.userId}] Initializing...`);
        this.status = 'initializing';

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: this.safeId,
                dataPath: BASE_AUTH_DIR
            }),
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1012170943-alpha.html'
            },
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            },
            qrMaxRetries: 5,
            takeoverOnConflict: false,
            takeoverTimeoutMs: 0
        });

        this.client.on('qr', async (qr) => {
            console.log(`[${this.userId}] QR Received`);
            this.qrCode = await qrcode.toDataURL(qr);
            this.status = 'qr_ready';
        });

        this.client.on('ready', () => {
            console.log(`[${this.userId}] Ready!`);
            this.status = 'ready';
            this.qrCode = null;
            // Log connection time for tracking
            this.connectedAt = new Date();
            console.log(`[${this.userId}] Session connected at: ${this.connectedAt.toISOString()}`);
        });

        this.client.on('auth_failure', (msg) => {
            console.error(`[${this.userId}] Auth Fail:`, msg);
            this.status = 'auth_failure';
            this.qrCode = null;
        });

        this.client.on('loading_screen', (percent, message) => {
            console.log(`[${this.userId}] Loading: ${percent}% - ${message}`);
        });

        this.client.on('disconnected', (reason) => {
            console.log(`[${this.userId}] Disconnected:`, reason);
            this.status = 'disconnected';
            this.qrCode = null;
            
            // If disconnected due to logout or expiration, clean up session folder
            if (reason === 'LOGOUT' || reason === 'NAVIGATION') {
                const sessDir = path.join(BASE_AUTH_DIR, `session-${this.safeId}`);
                if (fs.existsSync(sessDir)) {
                    console.log(`[${this.userId}] Cleaning up session folder due to: ${reason}`);
                    fs.rmSync(sessDir, { recursive: true, force: true });
                }
            }
            
            delete sessions[this.safeId];
        });

        await this.client.initialize().catch(e => {
            console.error(`[${this.userId}] Init Error:`, e.message);
            this.status = 'error';
        });
    }

    async sendMessage(to, message, mediaData = null) {
        if (!this.client || this.status !== 'ready') throw new Error('Session not ready');

        const chatId = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@c.us`;

        if (mediaData && mediaData.data) {
            const media = new MessageMedia(mediaData.mimetype, mediaData.data, mediaData.filename);
            return await this.client.sendMessage(chatId, media, { caption: message });
        } else {
            return await this.client.sendMessage(chatId, message);
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.destroy();
            this.status = 'disconnected';
        }
    }
}

app.post('/api/whatsapp/init', async (req, res) => {
    const userId = req.body.userId;
    const safeId = getSafeId(userId);
    if (!safeId) return res.status(400).json({ error: 'userId required' });

    if (!sessions[safeId] || sessions[safeId].status === 'disconnected' || sessions[safeId].status === 'error') {
        sessions[safeId] = new WhatsAppSession(userId);
        sessions[safeId].initialize();
    }
    res.json({ status: sessions[safeId].status });
});

app.get('/api/whatsapp/status/:userId', (req, res) => {
    const safeId = getSafeId(req.params.userId);
    if (!sessions[safeId]) {
        // Auto-resume if folder exists
        const sessDir = path.join(BASE_AUTH_DIR, `session-${safeId}`);
        if (fs.existsSync(sessDir)) {
            sessions[safeId] = new WhatsAppSession(req.params.userId);
            sessions[safeId].initialize();
            return res.json({ status: 'initializing', message: 'Reconnecting to existing session...' });
        }
        return res.json({ status: 'disconnected', message: 'No active session. Please connect again.' });
    }
    
    const session = sessions[safeId];
    const response = { 
        status: session.status, 
        qr: session.qrCode 
    };
    
    // Add connection info if ready
    if (session.status === 'ready' && session.connectedAt) {
        const daysConnected = Math.floor((new Date() - session.connectedAt) / (1000 * 60 * 60 * 24));
        response.connectedSince = session.connectedAt.toISOString();
        response.daysConnected = daysConnected;
        response.warning = daysConnected >= 12 ? 'Session may expire soon. WhatsApp Web disconnects after 14 days of inactivity.' : null;
    }
    
    res.json(response);
});

app.post('/api/whatsapp/send', async (req, res) => {
    const { userId, to, message, media } = req.body;
    const safeId = getSafeId(userId);

    if (!sessions[safeId] || sessions[safeId].status !== 'ready') {
        return res.status(400).json({ error: 'Session not ready' });
    }

    try {
        await sessions[safeId].sendMessage(to, message, media);
        res.json({ status: 'success' });
    } catch (error) {
        console.error(`[API] Send failed:`, error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
    const safeId = getSafeId(req.body.userId);
    if (sessions[safeId]) {
        await sessions[safeId].disconnect();
        delete sessions[safeId];
    }
    res.json({ status: 'disconnected' });
});

async function boot() {
    if (!fs.existsSync(BASE_AUTH_DIR)) return;
    const items = fs.readdirSync(BASE_AUTH_DIR);
    for (const item of items) {
        if (item.startsWith('session-')) {
            const sid = item.replace('session-', '');
            // We use sid as userId for resume
            sessions[sid] = new WhatsAppSession(sid);
            sessions[sid].initialize();
        }
    }
}

app.listen(port, '0.0.0.0', () => {
    console.log(`WhatsApp Gateway running on port ${port}`);
    boot();
});
