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

Dependencies (neonize, fastapi, uvicorn, python-multipart) are automatically installed when you run:

```bash
bench setup requirements
```

#### Auto-Start WhatsApp Gateway on VPS Reboot (Supervisor)

To make the WhatsApp gateway start automatically on reboot (recommended for production):

1. **Copy the supervisor config** from `config/whatsapp_gateway.conf` to your supervisor directory:

```bash
# On your VPS, replace /opt/frappe-bench with your actual bench path
sudo cp /opt/frappe-bench/apps/erpnextwats/config/whatsapp_gateway.conf /etc/supervisor/conf.d/whatsapp_gateway.conf

# Edit the config file to match your bench path and user
sudo nano /etc/supervisor/conf.d/whatsapp_gateway.conf
```

2. **Update the paths** in the config file:
   - Replace `/opt/frappe-bench` with your actual bench path
   - Replace `frappe` with your bench user (usually `frappe`)

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
