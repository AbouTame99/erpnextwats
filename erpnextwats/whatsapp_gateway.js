const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});
const port = 3000;

// Increase payload limits for media attachments (base64)
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

// Global state to track sessions
const sessions = {};

// Helper to sanitize userId for safe usage in IDs and paths
function getSafeId(userId) {
    if (!userId) return null;
    return userId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

class WhatsAppSession {
    constructor(userId) {
        this.userId = userId; // Original email for logging
        this.status = 'init';
        this.qrCode = null;
        this.client = null;
        this.authDir = path.join(__dirname, 'wwebjs_auth');
        this.db = null;
        this.dbPath = null;
    }

    async initialize() {
        console.log(`[${this.userId}] Starting initialization...`);
        this.status = 'initializing';

        try {
            const safeClientId = getSafeId(this.userId);
            this.dbPath = path.join(this.authDir, `session-${safeClientId}`, 'history.db');

            // Ensure session directory exists for DB
            const sessDir = path.dirname(this.dbPath);
            if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true });

            this.db = new sqlite3.Database(this.dbPath);
            this.initDb();

            this.client = new Client({
                authStrategy: new LocalAuth({
                    clientId: safeClientId,
                    dataPath: this.authDir
                }),
                puppeteer: {
                    headless: true,
                    executablePath: puppeteer.executablePath(),
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
                }
            });

            this.client.on('qr', (qr) => {
                console.log(`[${this.userId}] QR received`);
                this.status = 'qr_ready';
                qrcode.toDataURL(qr, (err, url) => {
                    this.qrCode = url;
                });
            });

            this.client.on('authenticated', () => {
                console.log(`[${this.userId}] Authenticated successfully! Syncing...`);
                this.status = 'authenticated';
                this.qrCode = null;
            });

            this.client.on('ready', () => {
                console.log(`[${this.userId}] Client is ready!`);
                this.status = 'ready';
                this.syncHistory();
            });

            this.client.on('message', async (msg) => {
                await this.saveMessage(msg);
                io.emit(`new_message:${this.userId}`, { chatId: msg.from, messageId: msg.id._serialized });
            });

            this.client.on('message_create', async (msg) => {
                if (msg.fromMe) {
                    await this.saveMessage(msg);
                }
            });

            this.client.on('auth_failure', (msg) => {
                console.error(`[${this.userId}] Auth failure:`, msg);
                this.status = 'auth_failure';
            });

            this.client.on('disconnected', (reason) => {
                console.log(`[${this.userId}] Disconnected:`, reason);
                this.status = 'disconnected';
            });

            await this.client.initialize();
        } catch (error) {
            console.error(`[${this.userId}] Initialization failed:`, error);
            this.status = 'error';
        }
    }

    initDb() {
        this.db.serialize(() => {
            this.db.run(`CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chatId TEXT,
                body TEXT,
                sender TEXT,
                receiver TEXT,
                timestamp INTEGER,
                fromMe INTEGER,
                type TEXT,
                hasMedia INTEGER,
                fileName TEXT
            )`);
            this.db.run(`CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                name TEXT,
                unreadCount INTEGER,
                timestamp INTEGER,
                isGroup INTEGER,
                lastMsgBody TEXT
            )`);
        });
    }

    async saveMessage(msg) {
        return new Promise((resolve) => {
            this.db.run(`INSERT OR REPLACE INTO messages (id, chatId, body, sender, receiver, timestamp, fromMe, type, hasMedia, fileName) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [msg.id._serialized, msg.from, msg.body, msg.from, msg.to, msg.timestamp, msg.fromMe ? 1 : 0, msg.type, msg.hasMedia ? 1 : 0, msg.fileName || null],
                (err) => {
                    if (err) console.error(`[DB Error]`, err);
                    resolve();
                }
            );
        });
    }

    async syncHistory() {
        console.log(`[${this.userId}] Background sync started...`);
        try {
            const chats = await this.client.getChats();
            for (const chat of chats) {
                this.db.run(`INSERT OR REPLACE INTO chats (id, name, unreadCount, timestamp, isGroup, lastMsgBody)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [chat.id._serialized, chat.name, chat.unreadCount, chat.timestamp, chat.isGroup ? 1 : 0, chat.lastMessage ? chat.lastMessage.body : '']);
            }
        } catch (e) {
            console.warn(`[Sync Error]`, e);
        }
    }

    async sendMessage(to, message, mediaData = null) {
        if (!this.client || this.status !== 'ready') {
            throw new Error('Session not ready');
        }

        let chatId = to;
        if (!chatId.includes('@')) {
            chatId = `${chatId.replace(/[^0-9]/g, '')}@c.us`;
        }

        try {
            let sentMsg;
            if (mediaData) {
                const media = new MessageMedia(mediaData.mimetype, mediaData.data, mediaData.filename);
                sentMsg = await this.client.sendMessage(chatId, media, { caption: message });
            } else {
                console.log(`[${this.userId}] Sending message to ${chatId}`);
                sentMsg = await this.client.sendMessage(chatId, message);
            }

            // If the message was sent, save it to our local DB
            if (sentMsg) await this.saveMessage(sentMsg);
            return sentMsg;
        } catch (e) {
            console.error(`[${this.userId}] sendMessage error catch:`, e.message);
            // Some "markedUnread" errors are non-fatal internal puppeteer errors, 
            // the message might actually have been sent.
            if (e.message.includes('markedUnread')) {
                console.warn(`[${this.userId}] Ignored internal library error 'markedUnread'`);
                return { status: 'maybe_sent', warning: e.message };
            }
            throw e;
        }
    }

    async getChats() {
        return new Promise((resolve) => {
            this.db.all(`SELECT * FROM chats ORDER BY timestamp DESC`, (err, rows) => {
                if (err) return resolve([]);
                resolve(rows.map(r => ({
                    id: r.id,
                    name: r.name,
                    unreadCount: r.unreadCount,
                    timestamp: r.timestamp,
                    isGroup: !!r.isGroup,
                    lastMessage: { body: r.lastMsgBody }
                })));
            });
        });
    }

    async getMessages(chatId, limit = 50) {
        return new Promise((resolve) => {
            this.db.all(`SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp DESC LIMIT ?`, [chatId, limit], (err, rows) => {
                if (err) return resolve([]);
                resolve(rows.reverse().map(m => ({
                    id: m.id,
                    body: m.body,
                    from: m.sender,
                    to: m.receiver,
                    timestamp: m.timestamp,
                    fromMe: !!m.fromMe,
                    type: m.type,
                    hasMedia: !!m.hasMedia,
                    fileName: m.fileName
                })));
            });
        });
    }

    async getMedia(messageId) {
        if (!this.client || this.status !== 'ready') return null;
        const msg = await this.client.getMessageById(messageId);
        if (msg && msg.hasMedia) {
            const media = await msg.downloadMedia();
            return media; // returns {mimetype, data, filename}
        }
        return null;
    }

    async getProfilePic(contactId) {
        if (!this.client || this.status !== 'ready') return null;
        try {
            const url = await this.client.getProfilePicUrl(contactId);
            return url;
        } catch (e) {
            return null;
        }
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
    const rawUserId = req.body.userId;
    const userId = getSafeId(rawUserId);
    console.log(`[API] POST /api/whatsapp/init - userId: ${rawUserId} (safe: ${userId})`);

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
        if (sessions[userId].status === 'disconnected' || sessions[userId].status === 'error' || sessions[userId].status === 'auth_failure') {
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
    const rawUserId = req.params.userId;
    const userId = getSafeId(rawUserId);

    if (!sessions[userId]) {
        // Self-healing: check if file exists on disk
        const authDir = path.join(__dirname, 'wwebjs_auth', `session-${userId}`);
        if (fs.existsSync(authDir)) {
            console.log(`[API] Session ${userId} found on disk but not in memory. Auto-initializing...`);
            const session = new WhatsAppSession(rawUserId); // Use raw email for logging
            sessions[userId] = session;
            session.initialize().catch(err => console.error(`[API] Auto-init failed:`, err));
            return res.json({ status: 'initializing' });
        }
        return res.json({ status: 'disconnected' });
    }

    const session = sessions[userId];
    res.json({
        status: session.status,
        qr: session.qrCode
    });
});

// Get all chats
app.get('/api/whatsapp/chats/:userId', async (req, res) => {
    const userId = getSafeId(req.params.userId);
    if (!sessions[userId]) return res.status(404).json({ error: 'No session' });

    try {
        const chats = await sessions[userId].getChats();
        res.json(chats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a chat
app.get('/api/whatsapp/messages/:userId/:chatId', async (req, res) => {
    const userId = getSafeId(req.params.userId);
    const { chatId } = req.params;
    if (!sessions[userId]) return res.status(404).json({ error: 'No session' });

    try {
        const messages = await sessions[userId].getMessages(chatId);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get media for a message
app.get('/api/whatsapp/media/:userId/:messageId', async (req, res) => {
    const userId = getSafeId(req.params.userId);
    const { messageId } = req.params;
    if (!sessions[userId]) return res.status(404).json({ error: 'No session' });

    try {
        const media = await sessions[userId].getMedia(messageId);
        if (media) {
            res.json(media);
        } else {
            res.status(404).json({ error: 'Media not found or message has no media' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send message (updated for media)
app.post('/api/whatsapp/send', async (req, res) => {
    const { to, message, media } = req.body;
    const userId = getSafeId(req.body.userId);

    if (!sessions[userId] || sessions[userId].status !== 'ready') {
        return res.status(400).json({ error: 'Session not ready' });
    }

    try {
        await sessions[userId].sendMessage(to, message, media);
        res.json({ status: 'success' });
    } catch (error) {
        console.error(`[API] Failed to send message:`, error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Disconnect session
app.post('/api/whatsapp/disconnect', async (req, res) => {
    const userId = getSafeId(req.body.userId);

    if (sessions[userId]) {
        await sessions[userId].disconnect();
        delete sessions[userId];
        res.json({ status: 'disconnected' });
    } else {
        res.json({ status: 'not_found' });
    }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Function to resume sessions from disk on startup
async function resumeSessions() {
    const authDir = path.join(__dirname, 'wwebjs_auth');
    if (!fs.existsSync(authDir)) return;

    const dirs = fs.readdirSync(authDir);
    console.log(`[BOOT] Found ${dirs.length} potential session(s) on disk.`);

    for (const dir of dirs) {
        if (dir.startsWith('session-')) {
            const safeId = dir.replace('session-', '');
            // We need the original userId to map back, but since we sanitized it,
            // we'll assume the safeId is what the frontend will use for mapping
            // or we'll allow the status check to "claim" the session by its original ID.

            // For now, let's just initialize it so the client stays alive.
            // When the user opens their dashboard, the frontend sends the original email.
            // We'll update the status check to match sanitized IDs.
            console.log(`[BOOT] Resuming session for sanitized ID: ${safeId}`);

            // Note: We don't have the original 'userId' (email) here, only the sanitized one.
            // But WhatsAppSession uses userId for logging and clientId for auth.
            // Let's create a "System" session for now, it will be replaced/mapped correctly 
            // once the user performs a status check or init call with their email.
            const session = new WhatsAppSession(safeId);
            sessions[safeId] = session;
            session.initialize().catch(err => console.error(`[BOOT] Failed to resume ${safeId}:`, err));
        }
    }
}

server.listen(port, '0.0.0.0', () => {
    console.log(`WhatsApp Gateway running on port ${port} (Real-time with SQLite)`);
    resumeSessions();
});
