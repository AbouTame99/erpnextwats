frappe.provide('erpnextwats');

frappe.pages['whatsapp-diagnosis'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'WhatsApp Full Diagnosis',
        single_column: true
    });
    new erpnextwats.WhatsAppDiagnosis(page);
};

/* All dynamic content rendered into the DOM goes through esc() before
   being placed into HTML strings, or uses textContent / createElement
   for user-originated data (phone, message, server error text). */

erpnextwats.WhatsAppDiagnosis = class {
    constructor(page) {
        this.page = page;
        this.results = {};
        this.logLimit = 100;
        this.logFilter = 'all';
        this.logSearch = '';
        this.rawLogs = [];
        this.setup_ui();
        this.load_logs();
    }

    // HTML-encode any value before placing it into markup
    esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    setup_ui() {
        // Static shell — no user data here
        const shell = [
            '<style>',
            '.diag-container{padding:20px;max-width:1000px}',
            '.diag-controls{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:28px;',
            'padding:20px;background:#f8f9fa;border-radius:8px;border:1px solid #dee2e6}',
            '.diag-controls .fg{margin:0}',
            '.diag-controls label{font-weight:600;font-size:12px;color:#555;margin-bottom:4px;display:block}',
            '.diag-controls input{border:1px solid #ccc;border-radius:4px;padding:6px 12px;font-size:14px;width:220px}',
            '.diag-run-btn{background:#25d366;color:#fff;border:none;padding:8px 24px;border-radius:4px;',
            'font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}',
            '.diag-run-btn:hover{background:#128c7e}.diag-run-btn:disabled{background:#aaa;cursor:not-allowed}',
            '.diag-summary{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}',
            '.diag-sc{flex:1;min-width:100px;padding:14px 18px;border-radius:8px;text-align:center}',
            '.diag-sc .val{font-size:28px;font-weight:700}.diag-sc .lbl{font-size:12px;color:#666;margin-top:2px}',
            '.s-pass{background:#e8f5e9}.s-fail{background:#fce4ec}.s-warn{background:#fff8e1}.s-total{background:#e3f2fd}',
            '.dsect{font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin:24px 0 10px}',
            '.dcard{border-radius:8px;border:1px solid #e0e0e0;margin-bottom:10px;overflow:hidden}',
            '.dcard-h{display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;user-select:none;background:#fff}',
            '.dcard-h:hover{background:#f5f5f5}',
            '.sdot{width:12px;height:12px;border-radius:50%;flex-shrink:0}',
            '.d-pass{background:#4caf50}.d-fail{background:#f44336}.d-warn{background:#ff9800}',
            '.d-run{background:#2196f3;animation:pulse 1s infinite}.d-pend{background:#bbb}',
            '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}',
            '.dcard-title{font-weight:600;font-size:14px;flex:1}',
            '.dcard-meta{font-size:12px;color:#888;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dchev{font-size:12px;color:#aaa;transition:transform 0.2s}',
            '.dchev.open{transform:rotate(90deg)}',
            '.dcard-b{display:none;padding:14px 16px;border-top:1px solid #f0f0f0;background:#fafafa}',
            '.dcard-b.open{display:block}',
            '.err-block{background:#fff;border:1px solid #f44336;border-radius:4px;padding:12px;margin-top:8px}',
            '.err-block pre{margin:0;font-size:12px;white-space:pre-wrap;word-break:break-all;color:#c62828;',
            'font-family:"Courier New",monospace;max-height:400px;overflow-y:auto}',
            '.inf-block{background:#f5f5f5;border-radius:4px;padding:12px;margin-top:8px}',
            '.inf-block pre{margin:0;font-size:12px;white-space:pre-wrap;word-break:break-all;color:#333;',
            'font-family:"Courier New",monospace;max-height:400px;overflow-y:auto}',
            '.dtag{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}',
            '.t-pass{background:#e8f5e9;color:#2e7d32}.t-fail{background:#fce4ec;color:#c62828}.t-warn{background:#fff3e0;color:#e65100}',
            '.spin{display:inline-block;width:14px;height:14px;border:2px solid #bbb;border-top-color:#2196f3;',
            'border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:middle;margin-right:6px}',
            '@keyframes spin{to{transform:rotate(360deg)}}',
            '.log-section-title{font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin:32px 0 10px;}',
            '.log-console{background:#1e1e1e;border-radius:8px;border:1px solid #333;overflow:hidden;font-family:"Courier New",Monaco,monospace;box-shadow:0 8px 24px rgba(0,0,0,0.15);margin-top:20px;}',
            '.log-console-header{background:#2d2d2d;padding:10px 16px;border-bottom:1px solid #3d3d3d;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;}',
            '.log-console-title{font-weight:600;font-size:13px;color:#ddd;display:flex;align-items:center;gap:8px;}',
            '.log-console-actions{display:flex;align-items:center;gap:8px;}',
            '.log-console-actions select,.log-console-actions input{background:#3a3a3a;color:#fff;border:1px solid #555;border-radius:4px;padding:4px 8px;font-size:12px;font-family:inherit;}',
            '.log-console-actions select:focus,.log-console-actions input:focus{outline:none;border-color:#2196f3;}',
            '.log-console-actions button{background:#3a3a3a;color:#fff;border:1px solid #555;border-radius:4px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;}',
            '.log-console-actions button:hover{background:#4a4a4a;}',
            '.log-console-body{max-height:450px;overflow-y:auto;padding:12px 16px;font-size:12px;line-height:1.5;color:#a9b7c6;background:#1e1e1e;text-align:left;}',
            '.log-row{margin-bottom:6px;display:flex;flex-direction:column;border-bottom:1px solid #2a2a2a;padding-bottom:6px;}',
            '.log-row:last-child{border-bottom:none;padding-bottom:0;}',
            '.log-meta-row{display:flex;align-items:flex-start;gap:8px;cursor:pointer;user-select:none;}',
            '.log-meta-row:hover{background:#252525;}',
            '.log-ts{color:#808080;flex-shrink:0;width:130px;}',
            '.log-type-tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;text-transform:uppercase;flex-shrink:0;text-align:center;min-width:65px;}',
            '.log-type-api{background:#2c3e50;color:#3498db;}',
            '.log-type-session{background:#115e59;color:#2dd4bf;}',
            '.log-type-message{background:#581c87;color:#c084fc;}',
            '.log-type-system{background:#7c2d12;color:#fb923c;}',
            '.log-type-error{background:#991b1b;color:#f87171;}',
            '.log-type-other{background:#374151;color:#d1d5db;}',
            '.log-status{color:#e0e0e0;flex-grow:1;font-weight:500;white-space:pre-wrap;word-break:break-all;}',
            '.log-chev{font-size:9px;color:#777;transition:transform 0.2s;align-self:center;margin-left:4px;}',
            '.log-chev.open{transform:rotate(90deg);}',
            '.log-detail-block{display:none;padding:8px 12px;background:#2b2b2b;border-radius:4px;margin-top:6px;border-left:3px solid #2196f3;overflow-x:auto;}',
            '.log-detail-block.open{display:block;}',
            '.log-detail-block pre{margin:0;font-size:11px;color:#a9b7c6;font-family:inherit;white-space:pre-wrap;word-break:break-all;}',
            '.log-empty{text-align:center;padding:32px;color:#666;font-style:italic;}',
            '.log-status-badge{font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600;display:inline-block;margin-left:12px;}',
            '.log-badge-online{background:#065f46;color:#34d399;}',
            '.log-badge-offline{background:#7f1d1d;color:#fca5a5;}',
            '.log-file-info{font-size:11px;color:#888;margin-left:6px;}',
            '</style>',
            '<div class="diag-container">',
            '<p style="color:#666;margin:0 0 20px;font-size:14px;">',
            'Runs every check live — gateway, WhatsApp session, database, scheduler, queues, and a real test message send.',
            ' All errors shown in full with full stack traces.',
            '</p>',
            '<div class="diag-controls">',
            '<div class="fg"><label>Test Phone (with country code)</label>',
            '<input type="text" id="diag-phone" placeholder="e.g. 966501234567" /></div>',
            '<div class="fg"><label>Test Message</label>',
            '<input type="text" id="diag-msg" style="width:280px;" value="WhatsApp Diagnosis test from ERPNext" /></div>',
            '<button class="diag-run-btn" id="diag-run-btn">Run Full Diagnosis</button>',
            '</div>',
            '<div id="diag-summary" class="diag-summary" style="display:none;"></div>',
            '<div id="diag-results"></div>',
            '<div class="log-section-title">Gateway Console Logs</div>',
            '<div class="log-console">',
            '  <div class="log-console-header">',
            '    <div class="log-console-title">',
            '      <span>💻 Gateway Output Logs</span>',
            '      <span id="log-status-badge" class="log-status-badge log-badge-offline">Offline</span>',
            '      <span id="log-file-info" class="log-file-info"></span>',
            '    </div>',
            '    <div class="log-console-actions">',
            '      <input type="text" id="log-search" placeholder="Search logs..." style="width: 150px;" />',
            '      <select id="log-filter">',
            '        <option value="all">All Logs</option>',
            '        <option value="api">API Requests</option>',
            '        <option value="session">Session Events</option>',
            '        <option value="message">Messages</option>',
            '        <option value="system">System</option>',
            '        <option value="error">Errors Only</option>',
            '      </select>',
            '      <select id="log-limit">',
            '        <option value="50">Last 50</option>',
            '        <option value="100" selected>Last 100</option>',
            '        <option value="200">Last 200</option>',
            '      </select>',
            '      <button id="log-refresh-btn">🔄 Refresh</button>',
            '    </div>',
            '  </div>',
            '  <div id="log-console-body" class="log-console-body">',
            '    <div class="log-empty">No logs loaded.</div>',
            '  </div>',
            '</div>',
            '</div>'
        ].join('');

        this.page.main.html(shell);
        document.getElementById('diag-run-btn').addEventListener('click', () => this.run_all());

        // Bind Log Console Events
        document.getElementById('log-refresh-btn').addEventListener('click', () => this.load_logs());
        document.getElementById('log-limit').addEventListener('change', (e) => {
            this.logLimit = parseInt(e.target.value) || 100;
            this.load_logs();
        });
        document.getElementById('log-filter').addEventListener('change', (e) => {
            this.logFilter = e.target.value;
            this.render_log_rows();
        });
        document.getElementById('log-search').addEventListener('input', (e) => {
            this.logSearch = e.target.value;
            this.render_log_rows();
        });

        window._diag = this;
    }

    get TESTS() {
        return [
            { key: 'frappe_db',       label: 'Frappe Database Connection',          section: 'Core Infrastructure' },
            { key: 'redis_cache',     label: 'Redis Cache',                         section: 'Core Infrastructure' },
            { key: 'worker_queue',    label: 'Background Worker / Queue',           section: 'Core Infrastructure' },
            { key: 'gateway_tcp',     label: 'Gateway TCP (localhost:3000)',         section: 'WhatsApp Gateway' },
            { key: 'gateway_health',  label: 'Gateway HTTP Health',                 section: 'WhatsApp Gateway' },
            { key: 'gateway_status',  label: 'WhatsApp Session Status',             section: 'WhatsApp Gateway' },
            { key: 'gateway_qr',      label: 'QR / Auth State',                     section: 'WhatsApp Gateway' },
            { key: 'db_tables',       label: 'Required Database Tables',            section: 'Database Checks' },
            { key: 'templates_exist', label: 'WhatsApp Templates Exist',            section: 'Database Checks' },
            { key: 'scheduler_jobs',  label: 'Scheduled Jobs Registered',           section: 'Scheduler' },
            { key: 'test_send',       label: 'End-to-End Test Message Send',        section: 'Send Test' },
        ];
    }

    run_all() {
        const btn = document.getElementById('diag-run-btn');
        btn.disabled = true;
        btn.textContent = 'Running...';

        const phoneEl = document.getElementById('diag-phone');
        const msgEl = document.getElementById('diag-msg');
        const phone = phoneEl ? phoneEl.value.trim() : '';
        const msg = (msgEl ? msgEl.value.trim() : '') || 'WhatsApp Diagnosis test from ERPNext';

        document.getElementById('diag-summary').style.display = 'none';
        document.getElementById('diag-results').textContent = '';
        this.results = {};

        // Render pending skeleton cards
        this.TESTS.forEach(t => this.render_card(t.key, t.label, t.section, 'pending', '', null));

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.run_full_diagnosis',
            args: { phone_number: phone, test_message: msg },
            callback: (r) => {
                btn.disabled = false;
                btn.textContent = 'Run Full Diagnosis';

                if (!r || !r.message) {
                    this.show_api_error('Diagnosis returned empty response. Check the Frappe error log.');
                    return;
                }
                const results = r.message;
                results.forEach(res => {
                    this.results[res.key] = res;
                    this.render_card(res.key, res.label, res.section, res.status, res.message, res.details);
                });
                this.render_summary(results);
                this.load_logs();
            },
            error: (err) => {
                btn.disabled = false;
                btn.textContent = 'Run Full Diagnosis';
                let errText = 'Unknown error';
                try {
                    errText = (err && err.responseJSON && err.responseJSON.exc) || JSON.stringify(err);
                } catch (_) {}
                this.show_api_error(errText);
                this.load_logs();
            }
        });
    }

    load_logs() {
        const bodyEl = document.getElementById('log-console-body');
        if (!bodyEl) return;

        bodyEl.textContent = '';
        const loader = document.createElement('div');
        loader.className = 'log-empty';
        loader.innerHTML = '<span class="spin"></span>Loading latest gateway logs...';
        bodyEl.appendChild(loader);

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.get_gateway_logs',
            args: { limit: this.logLimit },
            callback: (r) => {
                bodyEl.textContent = '';
                if (!r || !r.message) {
                    this.render_logs_error('Empty response from backend log API.');
                    return;
                }
                const res = r.message;
                if (res.status === 'error') {
                    this.render_logs_error(res.message);
                    return;
                }

                const statusBadge = document.getElementById('log-status-badge');
                const logFileInfo = document.getElementById('log-file-info');
                if (statusBadge) {
                    if (res.source === 'gateway_api') {
                        statusBadge.textContent = 'Gateway Online';
                        statusBadge.className = 'log-status-badge log-badge-online';
                    } else {
                        statusBadge.textContent = 'Gateway Offline';
                        statusBadge.className = 'log-status-badge log-badge-offline';
                    }
                }
                if (logFileInfo && res.file) {
                    logFileInfo.textContent = '(' + res.file + ')';
                }

                const logs = res.logs || [];
                this.rawLogs = logs;
                this.render_log_rows();
            },
            error: (err) => {
                let errText = 'Unknown error';
                try {
                    errText = (err && err.responseJSON && err.responseJSON.exc) || JSON.stringify(err);
                } catch (_) {}
                this.render_logs_error(errText);
            }
        });
    }

    render_log_rows() {
        const bodyEl = document.getElementById('log-console-body');
        if (!bodyEl) return;
        bodyEl.textContent = '';

        const filter = this.logFilter.toLowerCase();
        const search = this.logSearch.toLowerCase();

        let filtered = this.rawLogs;
        if (filter !== 'all') {
            filtered = filtered.filter(l => {
                const type = (l.type || '').toLowerCase();
                if (filter === 'error') {
                    return type === 'error' || (l.status || '').toLowerCase() === 'error';
                }
                return type === filter;
            });
        }
        if (search) {
            filtered = filtered.filter(l => {
                const type = (l.type || '').toLowerCase();
                const status = (l.status || '').toLowerCase();
                const text = typeof l === 'object' ? JSON.stringify(l).toLowerCase() : String(l).toLowerCase();
                return type.includes(search) || status.includes(search) || text.includes(search);
            });
        }

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'log-empty';
            empty.textContent = 'No matching log entries found.';
            bodyEl.appendChild(empty);
            return;
        }

        filtered.forEach((log, index) => {
            const row = document.createElement('div');
            row.className = 'log-row';

            const metaRow = document.createElement('div');
            metaRow.className = 'log-meta-row';
            metaRow.id = `log-meta-${index}`;

            const tsSpan = document.createElement('span');
            tsSpan.className = 'log-ts';
            if (log.timestamp) {
                try {
                    const t = new Date(log.timestamp);
                    tsSpan.textContent = t.toLocaleTimeString() + '.' + String(t.getMilliseconds()).padStart(3, '0');
                } catch (_) {
                    tsSpan.textContent = String(log.timestamp).substring(11, 23);
                }
            } else {
                tsSpan.textContent = '-';
            }
            metaRow.appendChild(tsSpan);

            const typeSpan = document.createElement('span');
            const type = (log.type || 'other').toLowerCase();
            typeSpan.className = `log-type-tag log-type-${type}`;
            typeSpan.textContent = log.type || 'RAW';
            if (log.status === 'Error' || type === 'error') {
                typeSpan.className = 'log-type-tag log-type-error';
                typeSpan.textContent = 'ERROR';
            }
            metaRow.appendChild(typeSpan);

            const statusSpan = document.createElement('span');
            statusSpan.className = 'log-status';
            statusSpan.textContent = log.status || log.raw || JSON.stringify(log);
            metaRow.appendChild(statusSpan);

            const details = { ...log };
            delete details.timestamp;
            delete details.type;
            delete details.status;
            delete details.raw;

            const hasDetails = Object.keys(details).length > 0;
            if (hasDetails) {
                const chev = document.createElement('span');
                chev.className = 'log-chev';
                chev.id = `log-chev-${index}`;
                chev.textContent = '▶';
                metaRow.appendChild(chev);

                const detailBlock = document.createElement('div');
                detailBlock.className = 'log-detail-block';
                detailBlock.id = `log-detail-${index}`;
                
                const pre = document.createElement('pre');
                pre.textContent = JSON.stringify(details, null, 2);
                detailBlock.appendChild(pre);

                metaRow.addEventListener('click', () => {
                    const isOpen = detailBlock.classList.contains('open');
                    if (isOpen) {
                        detailBlock.classList.remove('open');
                        chev.classList.remove('open');
                    } else {
                        detailBlock.classList.add('open');
                        chev.classList.add('open');
                    }
                });

                row.appendChild(metaRow);
                row.appendChild(detailBlock);
            } else {
                row.appendChild(metaRow);
            }

            bodyEl.appendChild(row);
        });
    }

    render_logs_error(text) {
        const bodyEl = document.getElementById('log-console-body');
        if (!bodyEl) return;
        bodyEl.textContent = '';

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'color:#ff6b6b;padding:16px;line-height:1.6;';

        const title = document.createElement('strong');
        title.textContent = 'Failed to load gateway logs:';
        
        const pre = document.createElement('pre');
        pre.style.cssText = 'margin-top:8px;font-size:11px;color:#ff6b6b;background:#311b1b;padding:10px;border-radius:4px;border:1px solid #5c1e1e;white-space:pre-wrap;word-break:break-all;';
        pre.textContent = text;

        wrapper.appendChild(title);
        wrapper.appendChild(pre);
        bodyEl.appendChild(wrapper);
    }

    show_api_error(text) {
        const container = document.getElementById('diag-results');
        container.textContent = '';

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'background:#fce4ec;border:1px solid #f44336;border-radius:8px;padding:20px;';

        const title = document.createElement('strong');
        title.style.color = '#c62828';
        title.textContent = 'Backend API call failed — could not run diagnosis.';

        const pre = document.createElement('pre');
        pre.style.cssText = 'margin-top:10px;font-size:12px;color:#c62828;white-space:pre-wrap;word-break:break-all;';
        pre.textContent = text; // textContent — safe, no HTML parsing

        wrapper.appendChild(title);
        wrapper.appendChild(pre);
        container.appendChild(wrapper);
    }

    render_card(key, label, section, status, message, details) {
        const container = document.getElementById('diag-results');

        // Create section header if it doesn't exist yet
        const sectionId = 'section-' + section.replace(/[^a-z0-9]/gi, '-');
        if (!document.getElementById(sectionId)) {
            const sectionEl = document.createElement('div');
            sectionEl.id = sectionId;
            sectionEl.className = 'dsect';
            sectionEl.textContent = section;
            container.appendChild(sectionEl);
        }

        // Remove previous card version (on re-render)
        const existing = document.getElementById('card-' + key);
        if (existing) existing.remove();

        // Build card using DOM API — no innerHTML on user data
        const card = document.createElement('div');
        card.className = 'dcard';
        card.id = 'card-' + key;

        const header = document.createElement('div');
        header.className = 'dcard-h';
        header.addEventListener('click', () => this.toggle_card(key));

        const dot = document.createElement('span');
        dot.className = 'sdot ' + this.dot_class(status);
        header.appendChild(dot);

        const titleEl = document.createElement('span');
        titleEl.className = 'dcard-title';
        titleEl.textContent = label; // user-visible label — safe textContent
        header.appendChild(titleEl);

        const tagEl = this.build_tag(status);
        if (tagEl) header.appendChild(tagEl);

        if (status === 'running') {
            const spin = document.createElement('span');
            spin.className = 'spin';
            header.appendChild(spin);
        }

        if (message && status !== 'pending') {
            const meta = document.createElement('span');
            meta.className = 'dcard-meta';
            meta.textContent = message.substring(0, 100); // truncated preview only; full in body
            header.appendChild(meta);
        }

        const chev = document.createElement('span');
        chev.className = 'dchev';
        chev.id = 'chev-' + key;
        chev.textContent = '▶';
        header.appendChild(chev);

        card.appendChild(header);

        const body = document.createElement('div');
        body.className = 'dcard-b';
        body.id = 'body-' + key;
        this.fill_body(body, status, message, details);
        card.appendChild(body);

        // Insert after section header (or after previous sibling card in same section)
        const keysInSection = this.TESTS.filter(t => t.section === section).map(t => t.key);
        const myIdx = keysInSection.indexOf(key);
        let insertAfter = document.getElementById(sectionId);
        if (myIdx > 0) {
            const prevCard = document.getElementById('card-' + keysInSection[myIdx - 1]);
            if (prevCard) insertAfter = prevCard;
        }
        insertAfter.insertAdjacentElement('afterend', card);

        // Auto-expand failures so user sees the error immediately
        if (status === 'fail') this.toggle_card(key, true);
    }

    fill_body(bodyEl, status, message, details) {
        if (!message && !details) {
            const empty = document.createElement('span');
            empty.style.cssText = 'color:#bbb;font-size:13px;';
            empty.textContent = 'No additional details.';
            bodyEl.appendChild(empty);
            return;
        }

        if (message) {
            const msgEl = document.createElement('div');
            msgEl.style.cssText = 'font-size:13px;color:#555;margin-bottom:8px;';
            msgEl.textContent = message; // textContent — never parsed as HTML
            bodyEl.appendChild(msgEl);
        }

        if (details) {
            const isError = status === 'fail';
            const block = document.createElement('div');
            block.className = isError ? 'err-block' : 'inf-block';

            const pre = document.createElement('pre');
            const detailStr = typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details);
            pre.textContent = detailStr; // textContent — safe, raw text preserved
            block.appendChild(pre);
            bodyEl.appendChild(block);
        }
    }

    toggle_card(key, force_open) {
        const body = document.getElementById('body-' + key);
        const chev = document.getElementById('chev-' + key);
        if (!body) return;
        const isOpen = body.classList.contains('open');
        if (force_open === true || !isOpen) {
            body.classList.add('open');
            if (chev) chev.classList.add('open');
        } else {
            body.classList.remove('open');
            if (chev) chev.classList.remove('open');
        }
    }

    dot_class(status) {
        return { pass: 'd-pass', fail: 'd-fail', warn: 'd-warn', running: 'd-run', pending: 'd-pend' }[status] || 'd-pend';
    }

    build_tag(status) {
        const tagMap = { pass: ['PASS', 't-pass'], fail: ['FAIL', 't-fail'], warn: ['WARN', 't-warn'] };
        if (!tagMap[status]) return null;
        const [text, cls] = tagMap[status];
        const tag = document.createElement('span');
        tag.className = 'dtag ' + cls;
        tag.textContent = text;
        return tag;
    }

    render_summary(results) {
        const pass  = results.filter(r => r.status === 'pass').length;
        const fail  = results.filter(r => r.status === 'fail').length;
        const warn  = results.filter(r => r.status === 'warn').length;
        const total = results.length;

        const el = document.getElementById('diag-summary');
        el.style.display = 'flex';
        el.textContent = '';

        [
            [total, 'Total Checks', '#1565c0', 's-total'],
            [pass,  'Passed',       '#2e7d32', 's-pass'],
            [fail,  'Failed',       '#c62828', 's-fail'],
            [warn,  'Warnings',     '#e65100', 's-warn'],
        ].forEach(([val, lbl, color, cls]) => {
            const card = document.createElement('div');
            card.className = 'diag-sc ' + cls;

            const valEl = document.createElement('div');
            valEl.className = 'val';
            valEl.style.color = color;
            valEl.textContent = String(val);

            const lblEl = document.createElement('div');
            lblEl.className = 'lbl';
            lblEl.textContent = lbl;

            card.appendChild(valEl);
            card.appendChild(lblEl);
            el.appendChild(card);
        });
    }
};
