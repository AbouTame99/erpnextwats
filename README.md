### Erpnextwats

Whatsapp Web for erpnext

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch develop
bench install-app erpnextwats
```

#### Automatic Dependency Installation

**Node.js Dependencies** (whatsapp-web.js, qrcode, express) are **automatically installed** when the gateway starts if `node_modules` doesn't exist.

The startup script (`start_gateway.sh`) checks for dependencies and installs them automatically, so even after container reboots (where non-`/cloudclusters` data is reset), dependencies will be reinstalled automatically.

**Manual installation** (optional, for first-time setup or troubleshooting):

```bash
cd /cloudclusters/erpnext/frappe-bench/apps/erpnextwats
npm install
```

**Note:** 
- The WhatsApp gateway uses Node.js (`whatsapp-web.js`) instead of Python to avoid GLIBC compatibility issues
- Node.js is already available in ERPNext installations
- Dependencies are stored in `/cloudclusters/erpnext/frappe-bench/apps/erpnextwats/node_modules` which persists across reboots

#### Auto-Start WhatsApp Gateway on VPS Reboot (Supervisor)

To make the WhatsApp gateway start automatically on reboot (recommended for production):

1. **Copy the supervisor config** from `config/whatsapp_gateway.conf` to your supervisor directory:

**Note:** The supervisor config automatically sets execute permissions on the startup script, so no manual `chmod` is needed (handles CloudClusters container reboots where permissions are reset).

```bash
# On your VPS, copy to the location where supervisor reads configs
# For CloudClusters/ERPNext setups, this is usually:
cp /cloudclusters/erpnext/frappe-bench/apps/erpnextwats/config/whatsapp_gateway.conf /cloudclusters/config/supervisor/whatsapp_gateway.conf

# The config file already has the correct paths for CloudClusters setup
# If using a different setup, edit paths accordingly
```

3. **Reload and start Supervisor**:

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start whatsapp_gateway
```

4. **Verify it's running**:

```bash
sudo supervisorctl status whatsapp_gateway
```

The gateway will now start automatically on every VPS reboot, just like other ERPNext services!

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/erpnextwats
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit
"# erpnextwats" 
