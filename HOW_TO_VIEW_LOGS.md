# How to View Bulk WhatsApp Logs

## Overview
The bulk messaging system now includes comprehensive logging at every step. All logs are prefixed with `[BULK SEND]` or `[BULK PROCESS]` for easy filtering.

## Log Locations

### 1. Frappe Application Logs (Primary Location)

**Location:** `frappe-bench/logs/web.log` or `frappe-bench/logs/worker.log`

**Note:** If you're in a different directory structure (like `/cloudclusters/erpnext/frappe-bench/`), adjust the path accordingly.

**View in real-time:**
```bash
# Navigate to your frappe-bench directory first
cd /cloudclusters/erpnext/frappe-bench

# For web requests
tail -f logs/web.log | grep "BULK"

# For background jobs (bulk processing) - THIS IS WHERE BULK LOGS APPEAR
tail -f logs/worker.log | grep "BULK"

# View all bulk-related logs from all log files
tail -f logs/*.log | grep "BULK"
```

**View last 100 lines:**
```bash
# From frappe-bench directory
tail -n 100 logs/web.log | grep "BULK"
tail -n 100 logs/worker.log | grep "BULK"
```

**Search for specific job:**
```bash
# From frappe-bench directory
grep "BULK_bh262ja2dn" logs/*.log

# Or search in worker.log specifically (where bulk processing happens)
grep "BULK_bh262ja2dn" logs/worker.log
```

### 2. Supervisor Logs (If using supervisor)

**Location:** Usually in `/var/log/supervisor/` or `frappe-bench/logs/supervisor/`

**View:**
```bash
tail -f /var/log/supervisor/frappe-web-stdout.log | grep "BULK"
tail -f /var/log/supervisor/frappe-worker-stdout.log | grep "BULK"
```

### 3. System Journal (Systemd)

If running as systemd service:
```bash
journalctl -u frappe-web -f | grep "BULK"
journalctl -u frappe-worker -f | grep "BULK"
```

## Log Format

### Request Initiation (`[BULK SEND]`)
- Template ID, DocType, Filters
- Customer list (if used)
- Delay and rate limit settings
- User who initiated

### Processing (`[BULK PROCESS]`)
- Job start/end times
- Each document being processed
- Phone number lookup results
- Send attempts and results
- Rate limiting events
- Progress updates
- Final summary with statistics

## Example Log Output

```
================================================================================
[BULK SEND] Starting bulk send request
[BULK SEND] Template ID: bh262ja2dn
[BULK SEND] DocType: Customer
[BULK SEND] Customer List: ["Customer 1", "Customer 2"]
[BULK SEND] Delay: 3s, Max/Hour: 50
[BULK SEND] User: administrator@example.com
================================================================================
[BULK PROCESS] ===== Starting bulk send processing =====
[BULK PROCESS] Job Name: BULK_bh262ja2dn_20260131145643
[BULK PROCESS] Total Documents: 2
[BULK PROCESS] Processing document 1/2: CUST-001
[BULK PROCESS] Phone from document: +212661549593
[BULK PROCESS] ✓ SUCCESS: Message sent to +212661549593
[BULK PROCESS] Progress: 1 sent, 0 failed, 0 skipped out of 2
[BULK PROCESS] Waiting 3 seconds before next message...
[BULK PROCESS] ===== Bulk send processing completed =====
[BULK PROCESS] Final results:
[BULK PROCESS]   - Sent: 2
[BULK PROCESS]   - Failed: 0
[BULK PROCESS]   - Skipped: 0
```

## Quick Commands

### Watch logs in real-time
```bash
# Navigate to frappe-bench directory first
cd /cloudclusters/erpnext/frappe-bench

# All bulk logs (worker.log is most important for bulk processing)
tail -f logs/worker.log | grep --line-buffered "BULK"

# Only errors
tail -f logs/worker.log | grep --line-buffered "BULK.*ERROR\|BULK.*FAILED\|BULK.*EXCEPTION"

# Only success messages
tail -f logs/worker.log | grep --line-buffered "BULK.*SUCCESS"
```

### Search for specific information
```bash
# Navigate to frappe-bench directory first
cd /cloudclusters/erpnext/frappe-bench

# Find all bulk sends today
grep "\[BULK SEND\] Starting" logs/*.log | grep "$(date +%Y-%m-%d)"

# Find failed messages
grep "\[BULK PROCESS\].*FAILED" logs/worker.log

# Find skipped messages (no phone)
grep "\[BULK PROCESS\].*No phone number" logs/worker.log

# Find rate limiting events
grep "\[BULK PROCESS\].*Hourly limit" logs/worker.log

# Find exceptions/errors
grep "\[BULK PROCESS\].*EXCEPTION" logs/worker.log
```

### Export logs to file
```bash
# Navigate to frappe-bench directory first
cd /cloudclusters/erpnext/frappe-bench

# Export all bulk logs from today
grep "BULK" logs/worker.log | grep "$(date +%Y-%m-%d)" > bulk_logs_$(date +%Y%m%d).txt

# Export specific job
grep "BULK_bh262ja2dn_20260131145643" logs/worker.log > job_logs.txt
```

## Troubleshooting

### If logs are not appearing:
1. Check if background jobs are running: `bench doctor`
2. Check worker status: `bench restart worker`
3. Verify log file permissions
4. Check if logging level is set correctly in `site_config.json`

### Common Issues in Logs:
- **"No phone number found"** - Customer/document missing phone number
- **"Hourly limit reached"** - Rate limiting is working, waiting for next hour
- **"Failed to send"** - Check WhatsApp gateway connection
- **"Exception"** - Check full traceback in logs for details

## Log Retention

By default, Frappe rotates logs. Check log rotation settings:
```bash
ls -la frappe-bench/logs/
```

Old logs may be compressed (`.log.gz`). To view:
```bash
zcat frappe-bench/logs/web.log.1.gz | grep "BULK"
```

