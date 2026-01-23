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
        console.log(`[${this.userId}] Starting initialization...`);
        this.status = 'initializing';
        
        // Create client with LocalAuth (stores session per user)
        console.log(`[${this.userId}] Creating WhatsApp client...`);
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: `user_${this.userId}`
            }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        // Loading event
        this.client.on('loading_screen', (percent, message) => {
            console.log(`[${this.userId}] Loading: ${percent}% - ${message}`);
        });

        // QR code event
        this.client.on('qr', async (qr) => {
            console.log(`[${this.userId}] QR code received, converting to image...`);
            try {
                this.qrCode = await qrcode.toDataURL(qr);
                this.status = 'qr_ready';
                console.log(`[${this.userId}] QR code ready! Status: ${this.status}, QR length: ${this.qrCode ? this.qrCode.length : 0}`);
            } catch (err) {
                console.error(`[${this.userId}] Error generating QR code:`, err);
                this.status = 'error';
            }
        });

        // Ready event
        this.client.on('ready', () => {
            console.log(`[${this.userId}] Client ready!`);
            this.status = 'ready';
            this.qrCode = null;
        });

        // Authentication failure
        this.client.on('auth_failure', (msg) => {
            console.error(`[${this.userId}] Auth failure:`, msg);
            this.status = 'auth_failure';
        });

        // Disconnected
        this.client.on('disconnected', (reason) => {
            console.log(`[${this.userId}] Disconnected:`, reason);
            this.status = 'disconnected';
        });

        // Error event
        this.client.on('error', (error) => {
            console.error(`[${this.userId}] Client error:`, error);
        });

        // Initialize client with timeout
        try {
            console.log(`[${this.userId}] Initializing client...`);
            
            // Set a timeout for initialization (30 seconds)
            const initPromise = this.client.initialize();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Initialization timeout after 30 seconds')), 30000);
            });
            
            await Promise.race([initPromise, timeoutPromise]);
            console.log(`[${this.userId}] Client initialization completed`);
        } catch (error) {
            console.error(`[${this.userId}] Error during initialization:`, error);
            console.error(`[${this.userId}] Error stack:`, error.stack);
            this.status = 'error';
            // Don't throw, let the session stay in error state
        }
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
    console.log(`[API] POST /api/whatsapp/init - userId: ${userId}`);
    console.log(`[API] Request body:`, JSON.stringify(req.body));
    
    if (!userId) {
        console.log(`[API] Error: userId is required`);
        return res.status(400).json({ error: 'userId is required' });
    }

    // If session exists, check status
    if (sessions[userId]) {
        console.log(`[API] Session exists for ${userId}, status: ${sessions[userId].status}`);
        if (sessions[userId].status === 'ready') {
            return res.json({ status: 'ready' });
        }
        // If stuck in initializing for too long, recreate
        if (sessions[userId].status === 'initializing') {
            console.log(`[API] Session stuck in initializing, cleaning up and recreating...`);
            try {
                if (sessions[userId].client) {
                    await sessions[userId].client.destroy();
                }
            } catch (e) {
                console.error(`[API] Error destroying old client:`, e);
            }
            delete sessions[userId];
        } else {
            return res.json({ status: sessions[userId].status });
        }
    }

    // Create new session
    console.log(`[API] Creating new session for ${userId}`);
    const session = new WhatsAppSession(userId);
    sessions[userId] = session;
    
    // Initialize asynchronously (don't wait for it)
    console.log(`[API] Starting async initialization for ${userId}`);
    session.initialize().catch(error => {
        console.error(`[API] Async initialization error for ${userId}:`, error);
    });
    
    // Return immediately
    console.log(`[API] Returning initializing status for ${userId}`);
    res.json({ status: 'initializing' });
});

// Get session status
app.get('/api/whatsapp/status/:userId', (req, res) => {
    const userId = req.params.userId;
    console.log(`[API] GET /api/whatsapp/status/${userId}`);
    
    if (!sessions[userId]) {
        console.log(`[API] No session found for ${userId}`);
        return res.json({ status: 'disconnected' });
    }

    const session = sessions[userId];
    const response = {
        status: session.status,
        qr: session.qrCode
    };
    console.log(`[API] Status for ${userId}: ${session.status}, has QR: ${!!session.qrCode}`);
    res.json(response);
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


