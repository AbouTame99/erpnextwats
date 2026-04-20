#!/bin/bash
# WhatsApp Gateway Startup Script
# Automatically installs dependencies if node_modules doesn't exist
# This ensures dependencies are installed even after container reboot

cd /cloudclusters/erpnext/frappe-bench/apps/erpnextwats

AUTH_DIR="/cloudclusters/erpnext/frappe-bench/whatsapp_auth"
SESSION_DIR="$AUTH_DIR/session-shared_company_session"

# ---- Force fresh install if whatsapp-web.js source changed ----
# Check if we're using the community fork (wwebjs) or the old one (pedroslopez)
NEEDS_REINSTALL=0
if [ -d "node_modules/whatsapp-web.js" ]; then
    # Check if package.json inside the installed module mentions "wwebjs"
    if grep -q "pedroslopez" node_modules/whatsapp-web.js/package.json 2>/dev/null; then
        echo "Old whatsapp-web.js (pedroslopez) detected. Forcing reinstall with community fork..."
        NEEDS_REINSTALL=1
    fi
else
    NEEDS_REINSTALL=1
fi

if [ "$NEEDS_REINSTALL" -eq 1 ]; then
    echo "Installing/updating dependencies..."
    rm -rf node_modules package-lock.json
    npm install --production
    echo "Dependencies installed successfully."

    # Clear old session — it won't work with the new library (LID migration)
    if [ -d "$SESSION_DIR" ]; then
        echo "Clearing old WhatsApp session (incompatible with new LID format)..."
        rm -rf "$SESSION_DIR"
        echo "Old session cleared. You will need to scan the QR code again."
    fi
else
    echo "Dependencies already installed (community fork)."
fi

# Install system dependencies for Puppeteer (Chrome)
echo "Installing system dependencies..."
if [ -f /etc/debian_version ]; then
    apt-get update -qq
    apt-get install -y -qq libnspr4 libnss3 libatk1.0-0* libatk-bridge2.0-0* libcups2* libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2* libpango-1.0-0 libpangocairo-1.0-0 libxss1 2>/dev/null
fi

# Ensure Chrome is installed for Puppeteer
echo "Checking/Installing Chrome for Puppeteer..."
npx puppeteer browsers install chrome

# Auto-detect Chrome path and set environment variable
CHROME_PATH=$(find /root/.cache/puppeteer -name chrome -type f -executable | head -n 1)
if [ -z "$CHROME_PATH" ]; then
    CHROME_PATH=$(which google-chrome-stable || which google-chrome || which chromium-browser || which chromium)
fi

if [ -n "$CHROME_PATH" ]; then
    export PUPPETEER_EXECUTABLE_PATH="$CHROME_PATH"
    echo "Using Chrome at: $PUPPETEER_EXECUTABLE_PATH"
else
    echo "WARNING: Chrome executable not found!"
fi

# Start the gateway
exec /usr/bin/node erpnextwats/whatsapp_gateway.js
