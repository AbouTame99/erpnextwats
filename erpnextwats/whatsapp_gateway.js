const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
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
    }

    async initialize() {
        this.status = 'initializing';
        
        // Create client with LocalAuth (stores session per user)
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: `user_${this.userId}`
            }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        // QR code event
        this.client.on('qr', async (qr) => {
            console.log(`QR Ready for ${this.userId}`);
            try {
                this.qrCode = await qrcode.toDataURL(qr);
                this.status = 'qr_ready';
            } catch (err) {
                console.error('Error generating QR code:', err);
            }
        });

        // Ready event
        this.client.on('ready', () => {
            console.log(`Ready for ${this.userId}`);
            this.status = 'ready';
            this.qrCode = null;
        });

        // Authentication failure
        this.client.on('auth_failure', (msg) => {
            console.error(`Auth failure for ${this.userId}:`, msg);
            this.status = 'auth_failure';
        });

        // Disconnected
        this.client.on('disconnected', (reason) => {
            console.log(`Disconnected for ${this.userId}:`, reason);
            this.status = 'disconnected';
        });

        // Initialize client
        await this.client.initialize();
    }

    async sendMessage(to, message) {
        if (!this.client || this.status !== 'ready') {
            throw new Error('Session not ready');
        }
        
        // Format phone number (remove + and ensure it's international format)
        const chatId = to.includes('@') ? to : `${to}@c.us`;
        await this.client.sendMessage(chatId, message);
    }

    async disconnect() {
        if (this.client) {
            await this.client.destroy();
            this.status = 'disconnected';
        }
    }
}

// Initialize session
app.post('/api/whatsapp/init', async (req, res) => {
    const userId = req.body.userId;
    
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    // If session exists and is ready, return status
    if (sessions[userId]) {
        if (sessions[userId].status === 'ready') {
            return res.json({ status: 'ready' });
        }
        return res.json({ status: sessions[userId].status });
    }

    // Create new session
    const session = new WhatsAppSession(userId);
    sessions[userId] = session;
    
    try {
        await session.initialize();
        res.json({ status: 'initializing' });
    } catch (error) {
        console.error('Error initializing session:', error);
        res.status(500).json({ error: error.message });
    }
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
        console.error('Failed to send message:', error);
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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`WhatsApp Gateway running on port ${port}`);
});


