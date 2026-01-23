const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('"@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const pino = require('pino');
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
        this.sock = null;
        this.authDir = path.join(__dirname, 'auth', `user_${userId}`);
    }

    async initialize() {
        console.log(`[${this.userId}] Starting initialization...`);
        this.status = 'initializing';
        
        try {
            // Ensure auth directory exists
            if (!fs.existsSync(this.authDir)) {
                fs.mkdirSync(this.authDir, { recursive: true });
            }

            // Load auth state
            console.log(`[${this.userId}] Loading auth state from ${this.authDir}...`);
            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

            // Create socket
            console.log(`[${this.userId}] Creating WhatsApp socket...`);
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }), // Suppress Baileys logs
            });

            // Save credentials when updated
            this.sock.ev.on('creds.update', saveCreds);

            // Connection update event (handles QR, connection, etc.)
            this.sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    console.log(`[${this.userId}] QR code received, converting to image...`);
                    qrcode.toDataURL(qr).then(qrImage => {
                        this.qrCode = qrImage;
                        this.status = 'qr_ready';
                        console.log(`[${this.userId}] QR code ready! Status: ${this.status}`);
                    }).catch(err => {
                        console.error(`[${this.userId}] Error generating QR code:`, err);
                        this.status = 'error';
                    });
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                    console.log(`[${this.userId}] Connection closed. Should reconnect: ${shouldReconnect}`);
                    
                    if (shouldReconnect) {
                        this.status = 'disconnected';
                        // Auto-reconnect logic could go here
                    } else {
                        this.status = 'logged_out';
                        // Clean up auth files
                        if (fs.existsSync(this.authDir)) {
                            fs.rmSync(this.authDir, { recursive: true, force: true });
                        }
                    }
                } else if (connection === 'open') {
                    console.log(`[${this.userId}] Connected and ready!`);
                    this.status = 'ready';
                    this.qrCode = null;
                } else if (connection === 'connecting') {
                    console.log(`[${this.userId}] Connecting...`);
                    this.status = 'connecting';
                }
            });

            // Handle errors
            this.sock.ev.on('error', (error) => {
                console.error(`[${this.userId}] Socket error:`, error);
                this.status = 'error';
            });

            console.log(`[${this.userId}] Socket created successfully`);
        } catch (error) {
            console.error(`[${this.userId}] Error during initialization:`, error);
            console.error(`[${this.userId}] Error stack:`, error.stack);
            this.status = 'error';
            throw error;
        }
    }

    async sendMessage(to, message) {
        if (!this.sock || this.status !== 'ready') {
            throw new Error('Session not ready');
        }
        
        // Format phone number (remove + and ensure it's in international format)
        let phoneNumber = to.replace(/[^0-9]/g, ''); // Remove all non-digits
        if (!phoneNumber.endsWith('@s.whatsapp.net')) {
            phoneNumber = `${phoneNumber}@s.whatsapp.net`;
        }
        
        console.log(`[${this.userId}] Sending message to ${phoneNumber}`);
        await this.sock.sendMessage(phoneNumber, { text: message });
    }

    async disconnect() {
        if (this.sock) {
            console.log(`[${this.userId}] Disconnecting...`);
            await this.sock.end();
            this.sock = null;
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
        if (sessions[userId].status === 'initializing' || sessions[userId].status === 'connecting') {
            console.log(`[API] Session stuck, cleaning up and recreating...`);
            try {
                if (sessions[userId].sock) {
                    await sessions[userId].sock.end();
                }
            } catch (e) {
                console.error(`[API] Error destroying old socket:`, e);
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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`WhatsApp Gateway running on port ${port} (using Baileys)`);
});
