const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

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
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
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
        });

        this.client.on('auth_failure', (msg) => {
            console.error(`[${this.userId}] Auth Fail:`, msg);
            this.status = 'auth_failure';
        });

        this.client.on('disconnected', (reason) => {
            console.log(`[${this.userId}] Disconnected:`, reason);
            this.status = 'disconnected';
            delete sessions[this.safeId];
        });

        this.client.on('message', async (msg) => {
            console.log(`[${this.userId}] Incoming: ${msg.body} from ${msg.from}`);

            // Call ERPNext webhook
            try {
                // We use localhost since they are on the same server
                // We need to know the port. Defaulting to 8000 or 80.
                // For production, it might be 80.
                const erpnextUrl = 'http://127.0.0.1:8000'; // Bench default

                const response = await fetch(`${erpnextUrl}/api/method/erpnextwats.erpnextwats.api.gateway_webhook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        secret: "INTERNAL_GATEWAY_SECRET",
                        data: {
                            body: msg.body,
                            from: msg.from,
                            fromMe: msg.fromMe
                        }
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.message && result.message.status === 'reply') {
                        await this.client.sendMessage(msg.from, result.message.message);
                    }
                }
            } catch (error) {
                console.error(`[${this.userId}] Webhook failed:`, error.message);
            }
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
            return res.json({ status: 'initializing' });
        }
        return res.json({ status: 'disconnected' });
    }
    res.json({ status: sessions[safeId].status, qr: sessions[safeId].qrCode });
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
