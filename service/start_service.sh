#!/bin/bash

# Navigate to the service directory
cd /cloudclusters/erpnext/frappe-bench/apps/erpnextwats/service

# Check if the service is already running on port 3000
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo "WhatsApp Service is already running."
    exit 0
fi

# Ensure logs directory exists
mkdir -p logs

# Start the Node.js server in the background
echo "Starting WhatsApp Service..."
/usr/bin/node server.js > logs/output.log 2>&1 &
