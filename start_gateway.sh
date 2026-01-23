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

# Start the gateway
exec /usr/bin/node erpnextwats/whatsapp_gateway.js

