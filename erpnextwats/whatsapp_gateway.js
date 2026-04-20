const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

// SHARED SESSION ID - All users share this single session
const SHARED_SESSION_ID = 'shared_company_session';

// Logging setup
const LOG_DIR = '/cloudclusters/erpnext/frappe-bench/logs/whatsapp_gateway';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
    return path.join(LOG_DIR, `gateway_${new Date().toISOString().split('T')[0]}.log`);
}

function logEvent(type, status, details = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        type,
        status,
        ...details
    };
    
    // Write to log file
    try {
        fs.appendFileSync(getLogFile(), JSON.stringify(logEntry) + '\n');
    } catch (e) {
        console.error(`[LOG ERROR] Failed to write log: ${e.message}`);
    }
    
    // Also console log
    const detailStr = Object.keys(details).length > 0 ? JSON.stringify(details) : '';
    console.log(`[${type}] ${status}${detailStr ? ' - ' + detailStr : ''}`);
    
    return logEntry;
}

function logError(type, error, details = {}) {
    const errorDetails = {
        message: error.message || String(error),
        stack: error.stack,
        ...details
    };
    logEvent(type, 'Error', errorDetails);
}

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

// Request logging middleware
app.use((req, res, next) => {
    logEvent('API', 'Incoming Request', {
        method: req.method,
        url: req.url,
        ip: req.ip
    });
    next();
});

// Increased limits for media attachments
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

const BASE_AUTH_DIR = '/cloudclusters/erpnext/frappe-bench/whatsapp_auth';
if (!fs.existsSync(BASE_AUTH_DIR)) fs.mkdirSync(BASE_AUTH_DIR, { recursive: true });

// Single shared session
let sharedSession = null;
let lastActivityTime = null;
let messageCount = 0;

class WhatsAppSession {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.status = 'init';
        this.qrCode = null;
        this.client = null;
        this.connectedAt = null;
        this.info = null;
    }

    async initialize() {
        if (this.status === 'initializing' || this.status === 'ready') return;

        console.log(`[SHARED SESSION] Initializing...`);
        logEvent('Session', 'Initializing', {
            sessionId: this.sessionId,
            timestamp: new Date().toISOString()
        });
        this.status = 'initializing';

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: this.sessionId,
                dataPath: BASE_AUTH_DIR
            }),
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
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
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-web-security'
                ]
            },
            qrMaxRetries: 5,
            takeoverOnConflict: false,
            takeoverTimeoutMs: 0
        });

        this.client.on('qr', async (qr) => {
            console.log(`[SHARED SESSION] QR Received`);
            this.qrCode = await qrcode.toDataURL(qr);
            this.status = 'qr_ready';
            logEvent('Session', 'QR Generated', {
                sessionId: this.sessionId,
                timestamp: new Date().toISOString()
            });
        });

        this.client.on('ready', async () => {
            console.log(`[SHARED SESSION] Ready!`);
            this.status = 'ready';
            this.qrCode = null;
            this.connectedAt = new Date();
            lastActivityTime = new Date();
            messageCount = 0;
            
            // Get connected number info
            let phoneNumber = null;
            try {
                this.info = await this.client.info;
                phoneNumber = this.info.wid.user;
                console.log(`[SHARED SESSION] Connected as: ${phoneNumber}`);
            } catch (e) {
                console.log(`[SHARED SESSION] Could not get info: ${e.message}`);
            }
            
            console.log(`[SHARED SESSION] Session connected at: ${this.connectedAt.toISOString()}`);
            
            logEvent('Session', 'Connected', {
                sessionId: this.sessionId,
                phoneNumber: phoneNumber,
                connectedAt: this.connectedAt.toISOString()
            });
        });

        this.client.on('auth_failure', (msg) => {
            console.error(`[SHARED SESSION] Auth Fail:`, msg);
            this.status = 'auth_failure';
            this.qrCode = null;
            logEvent('Session', 'Auth Failure', {
                sessionId: this.sessionId,
                error: msg
            });
        });

        this.client.on('loading_screen', (percent, message) => {
            console.log(`[SHARED SESSION] Loading: ${percent}% - ${message}`);
        });

        this.client.on('disconnected', (reason) => {
            console.log(`[SHARED SESSION] Disconnected:`, reason);
            this.status = 'disconnected';
            this.qrCode = null;
            
            logEvent('Session', 'Disconnected', {
                sessionId: this.sessionId,
                reason: reason,
                duration: this.connectedAt ? Math.floor((new Date() - this.connectedAt) / (1000 * 60 * 60)) + ' hours' : 'N/A',
                totalMessages: messageCount
            });
            
            // If disconnected due to logout or expiration, clean up session folder
            if (reason === 'LOGOUT' || reason === 'NAVIGATION') {
                const sessDir = path.join(BASE_AUTH_DIR, `session-${this.sessionId}`);
                if (fs.existsSync(sessDir)) {
                    console.log(`[SHARED SESSION] Cleaning up session folder due to: ${reason}`);
                    fs.rmSync(sessDir, { recursive: true, force: true });
                    logEvent('Session', 'Folder Cleaned', {
                        sessionId: this.sessionId,
                        reason: reason
                    });
                }
            }
            
            sharedSession = null;
        });

        this.client.on('change_state', (state) => {
            console.log(`[SHARED SESSION] State changed: ${state}`);
        });

        await this.client.initialize().catch(e => {
            console.error(`[SHARED SESSION] Init Error:`, e.message);
            logError('Session', e, {
                sessionId: this.sessionId,
                step: 'initialize'
            });
            this.status = 'error';
        });
    }

    async sendMessage(to, message, mediaData = null) {
        if (!this.client || this.status !== 'ready') throw new Error('Session not ready');

        const chatId = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@c.us`;
        const startTime = Date.now();
        
        let result;
        let hasMedia = mediaData && mediaData.data;

        try {
            // Resolve the official WhatsApp ID to prevent "No LID" errors
            let finalId = chatId;
            try {
                const resolvedId = await this.client.getNumberId(chatId);
                if (resolvedId) {
                    finalId = resolvedId._serialized;
                    console.log(`[SHARED SESSION] Resolved ${chatId} to ${finalId}`);
                }
            } catch (resolveErr) {
                console.warn(`[SHARED SESSION] ID resolution failed for ${chatId}, attempting with original.`);
            }

            if (hasMedia) {
                const media = new MessageMedia(mediaData.mimetype, mediaData.data, mediaData.filename);
                result = await this.client.sendMessage(finalId, media, { caption: message });
            } else {
                result = await this.client.sendMessage(finalId, message);
            }
            
            // Update activity tracking
            lastActivityTime = new Date();
            messageCount++;
            
            const duration = Date.now() - startTime;
            
            logEvent('Message', 'Sent', {
                sessionId: this.sessionId,
                to: chatId,
                hasMedia: hasMedia,
                durationMs: duration,
                messageCount: messageCount,
                messageId: result ? result.id._serialized : null
            });
            
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            logError('Message', error, {
                sessionId: this.sessionId,
                to: chatId,
                hasMedia: hasMedia,
                durationMs: duration,
                messagePreview: message.substring(0, 50) + '...'
            });
            throw error;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.destroy();
            this.status = 'disconnected';
        }
    }

    getSessionInfo() {
        const now = new Date();
        const daysConnected = this.connectedAt ? Math.floor((now - this.connectedAt) / (1000 * 60 * 60 * 24)) : 0;
        const hoursSinceActivity = lastActivityTime ? Math.floor((now - lastActivityTime) / (1000 * 60 * 60)) : null;
        
        return {
            status: this.status,
            connectedAt: this.connectedAt ? this.connectedAt.toISOString() : null,
            daysConnected: daysConnected,
            lastActivity: lastActivityTime ? lastActivityTime.toISOString() : null,
            hoursSinceActivity: hoursSinceActivity,
            messageCount: messageCount,
            phoneNumber: this.info ? this.info.wid.user : null,
            warning: daysConnected >= 10 ? 'Session approaching typical expiry (10+ days). Consider reconnecting soon.' : null
        };
    }
}

// Initialize or get shared session
function getSharedSession() {
    if (!sharedSession || sharedSession.status === 'disconnected' || sharedSession.status === 'error') {
        sharedSession = new WhatsAppSession(SHARED_SESSION_ID);
        sharedSession.initialize();
    }
    return sharedSession;
}

// Initialize session
app.post('/api/whatsapp/init', async (req, res) => {
    logEvent('API', 'Init Request', { timestamp: new Date().toISOString() });
    try {
        const session = getSharedSession();
        res.json({ 
            status: session.status, 
            message: 'Using shared company session',
            info: session.getSessionInfo()
        });
    } catch (error) {
        logError('API', error, { endpoint: '/api/whatsapp/init' });
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Get status (no userId needed)
app.get('/api/whatsapp/status', (req, res) => {
    if (!sharedSession) {
        // Auto-resume if folder exists
        const sessDir = path.join(BASE_AUTH_DIR, `session-${SHARED_SESSION_ID}`);
        if (fs.existsSync(sessDir)) {
            getSharedSession();
            return res.json({ 
                status: 'initializing', 
                message: 'Reconnecting to shared session...',
                info: null
            });
        }
        return res.json({ 
            status: 'disconnected', 
            message: 'No active shared session. Please connect.',
            info: null
        });
    }
    
    const info = sharedSession.getSessionInfo();
    const response = { 
        status: sharedSession.status, 
        qr: sharedSession.qrCode,
        message: 'Shared company session',
        info: info
    };
    
    res.json(response);
});

// Send message
app.post('/api/whatsapp/send', async (req, res) => {
    const { to, message, media } = req.body;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logEvent('API', 'Send Request', {
        requestId,
        to: to ? to.replace(/[^0-9]/g, '').substr(-4) : 'N/A', // Log last 4 digits only for privacy
        hasMedia: !!media,
        sessionStatus: sharedSession ? sharedSession.status : 'disconnected'
    });

    if (!sharedSession || sharedSession.status !== 'ready') {
        logEvent('API', 'Send Failed', {
            requestId,
            reason: 'Session not ready',
            sessionStatus: sharedSession ? sharedSession.status : 'disconnected'
        });
        return res.status(400).json({ 
            error: 'Shared session not ready',
            status: sharedSession ? sharedSession.status : 'disconnected'
        });
    }

    try {
        await sharedSession.sendMessage(to, message, media);
        logEvent('API', 'Send Success', {
            requestId,
            duration: 'completed'
        });
        res.json({ status: 'success' });
    } catch (error) {
        logError('API', error, {
            requestId,
            endpoint: '/api/whatsapp/send'
        });
        console.error(`[API] Send failed:`, error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Disconnect
app.post('/api/whatsapp/disconnect', async (req, res) => {
    logEvent('API', 'Disconnect Request', {
        sessionStatus: sharedSession ? sharedSession.status : 'disconnected',
        connectedSince: sharedSession ? sharedSession.connectedAt : null
    });
    
    if (sharedSession) {
        await sharedSession.disconnect();
        sharedSession = null;
    }
    
    logEvent('Session', 'Manual Disconnect', {
        timestamp: new Date().toISOString()
    });
    
    res.json({ status: 'disconnected', message: 'Shared session disconnected' });
});

// Check connection health
app.get('/api/whatsapp/health', (req, res) => {
    if (!sharedSession) {
        return res.json({ 
            healthy: false, 
            status: 'disconnected',
            message: 'No active session'
        });
    }
    
    const info = sharedSession.getSessionInfo();
    const isHealthy = sharedSession.status === 'ready' && info.daysConnected < 12;
    
    res.json({
        healthy: isHealthy,
        status: sharedSession.status,
        info: info,
        message: isHealthy ? 'Session healthy' : 'Session needs attention'
    });
});

async function boot() {
    if (!fs.existsSync(BASE_AUTH_DIR)) return;
    
    // Check for shared session folder
    const sharedSessionDir = path.join(BASE_AUTH_DIR, `session-${SHARED_SESSION_ID}`);
    if (fs.existsSync(sharedSessionDir)) {
        console.log('[BOOT] Found existing shared session, resuming...');
        getSharedSession();
    } else {
        console.log('[BOOT] No shared session found. Waiting for initialization.');
    }
}

app.listen(port, '0.0.0.0', () => {
    console.log(`WhatsApp Gateway running on port ${port}`);
    console.log(`Using SHARED SESSION mode - all users share one WhatsApp connection`);
    boot();
});

// Global Error Handler
app.use((err, req, res, next) => {
    logError('System', err, {
        method: req.method,
        url: req.url,
        ip: req.ip,
        body: req.body
    });
    
    // Handle specific Express errors
    if (err.status === 400 && 'body' in err) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Invalid JSON payload. Check your request formatting.',
            details: err.message
        });
    }
    
    res.status(err.status || 500).json({
        status: 'error',
        message: err.message || 'Internal Server Error'
    });
});
