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
let LOG_DIR = '/cloudclusters/erpnext/frappe-bench/logs/whatsapp_gateway';
if (!fs.existsSync(LOG_DIR)) {
    // Dynamic fallback: look for frappe-bench/logs/whatsapp_gateway or create under app directory
    const relativeLogs = path.resolve(__dirname, '../../../logs/whatsapp_gateway');
    if (fs.existsSync(path.dirname(relativeLogs)) || fs.existsSync(relativeLogs)) {
        LOG_DIR = relativeLogs;
    } else {
        LOG_DIR = path.resolve(__dirname, '../logs');
    }
}
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
    // Don't log status checks to keep logs clean
    if (req.url === '/api/whatsapp/status') {
        return next();
    }
    
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

// Single shared session auth dir
let BASE_AUTH_DIR = '/cloudclusters/erpnext/frappe-bench/whatsapp_auth';
if (!fs.existsSync(BASE_AUTH_DIR)) {
    // Dynamic fallback: look for frappe-bench/whatsapp_auth or create under app directory
    const relativeAuth = path.resolve(__dirname, '../../../whatsapp_auth');
    if (fs.existsSync(path.dirname(relativeAuth)) || fs.existsSync(relativeAuth)) {
        BASE_AUTH_DIR = relativeAuth;
    } else {
        BASE_AUTH_DIR = path.resolve(__dirname, '../whatsapp_auth');
    }
}
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
        
        // AUTO-CLEANUP: Kill zombie processes and remove stale lock files
        try {
            const { execSync } = require('child_process');
            const sessionDir = path.join(BASE_AUTH_DIR, `session-${this.sessionId}`);
            
            // 1. Kill any existing chrome processes using our session directory
            if (process.platform === 'linux') {
                execSync(`pkill -f "${sessionDir}" || true`);
                console.log(`[SHARED SESSION] Killed zombie chrome processes`);
            }

            // 2. Remove stale browser lock files
            const lockFiles = [
                path.join(sessionDir, 'Default', 'SingletonLock'),
                path.join(sessionDir, 'SingletonLock'),
                path.join(sessionDir, 'Default', 'SingletonCookie'),
                path.join(sessionDir, 'SingletonCookie'),
                path.join(sessionDir, 'Default', 'SingletonSocket'),
                path.join(sessionDir, 'SingletonSocket')
            ];
            
            lockFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    console.log(`[SHARED SESSION] Cleaned up stale lock file: ${path.basename(file)}`);
                }
            });
        } catch (err) {
            console.warn(`[SHARED SESSION] Cleanup warning: ${err.message}`);
        }

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
                protocolTimeout: 0, // Disable protocol timeout to prevent crashes during slow loads
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
            // Step 1: Check if the number is registered on WhatsApp
            let isRegistered = false;
            let finalId = chatId;
            try {
                isRegistered = await this.client.isRegisteredUser(chatId);
            } catch (regErr) {
                console.warn(`[SHARED SESSION] Registration check failed for ${chatId}: ${regErr.message}`);
                // Assume registered and try anyway
                isRegistered = true;
            }

            if (!isRegistered) {
                const errMsg = `Number ${chatId} is NOT registered on WhatsApp. Message cannot be delivered.`;
                console.warn(`[SHARED SESSION] ${errMsg}`);
                logEvent('Message', 'Not Registered', {
                    sessionId: this.sessionId,
                    to: chatId,
                    hasMedia: !!hasMedia
                });
                throw new Error(errMsg);
            }

            // Step 2: Resolve the official WhatsApp ID to prevent "No LID" errors
            try {
                const resolvedId = await this.client.getNumberId(chatId);
                if (resolvedId) {
                    finalId = resolvedId._serialized;
                    console.log(`[SHARED SESSION] Resolved ${chatId} to ${finalId}`);
                }
            } catch (resolveErr) {
                console.warn(`[SHARED SESSION] ID resolution failed for ${chatId}, using original.`);
            }

            // Step 3: Send the message
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
                hasMedia: !!hasMedia,
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
                hasMedia: !!hasMedia,
                durationMs: duration,
                messagePreview: message ? message.substring(0, 50) + '...' : ''
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
        sharedSession.initialize().catch(e => {
            console.error('[SHARED SESSION] Background init failed:', e.message);
            logError('Session', e, { step: 'background_init' });
        });
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

// Get recent logs
app.get('/api/whatsapp/logs', (req, res) => {
    try {
        const logFile = getLogFile();
        if (!fs.existsSync(logFile)) {
            return res.json({ status: 'success', logs: [], file: path.basename(logFile) });
        }
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean).map(line => {
            try {
                return JSON.parse(line);
            } catch (e) {
                return { raw: line };
            }
        });
        const limit = parseInt(req.query.limit) || 100;
        res.json({ 
            status: 'success', 
            logs: lines.slice(-limit),
            file: path.basename(logFile)
        });
    } catch (error) {
        logError('API', error, { endpoint: '/api/whatsapp/logs' });
        res.status(500).json({ status: 'error', message: error.message });
    }
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

// Global Error Handler — MUST be registered BEFORE app.listen()
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

app.listen(port, '0.0.0.0', () => {
    console.log(`WhatsApp Gateway running on port ${port}`);
    console.log(`Using SHARED SESSION mode - all users share one WhatsApp connection`);
    boot();
});

// Graceful shutdown to prevent Zombie Chrome processes
function cleanupAndExit() {
    console.log('[SYSTEM] Initiating graceful shutdown...');
    if (sharedSession && sharedSession.client) {
        try {
            console.log('[SYSTEM] Destroying WhatsApp client to release Chrome lock...');
            sharedSession.client.destroy().then(() => {
                console.log('[SYSTEM] Client destroyed successfully.');
                process.exit(0);
            }).catch(err => {
                console.error('[SYSTEM] Error destroying client:', err.message);
                process.exit(1);
            });
        } catch (err) {
            process.exit(1);
        }
    } else {
        process.exit(0);
    }
}

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);
process.on('uncaughtException', (err) => {
    logError('System', err, { context: 'Uncaught Exception' });
    console.error('UNCAUGHT EXCEPTION:', err);
    cleanupAndExit();
});
