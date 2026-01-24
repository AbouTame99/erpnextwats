#!/bin/bash
# WhatsApp Gateway Startup Script
# Automatically installs dependencies if node_modules doesn't exist
# This ensures dependencies are installed even after container reboot

cd /cloudclusters/erpnext/frappe-bench/apps/erpnextwats

# Check if node_modules exists, if not, install dependencies
if [ ! -d "node_modules" ]; then
    echo "node_modules not found. Installing dependencies..."
    npm install --production
    echo "Dependencies installed successfully."
else
    echo "Dependencies already installed."
fi
# Install system dependencies for Puppeteer (Chrome)
echo "Installing system dependencies..."
if [ -f /etc/debian_version ]; then
    apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0
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

# Start the gateway with exported ENVs
exec /usr/bin/node erpnextwats/whatsapp_gateway.js


