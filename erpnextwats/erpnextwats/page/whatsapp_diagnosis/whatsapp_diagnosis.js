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
        this.setup_ui();
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
            '</div>'
        ].join('');

        this.page.main.html(shell);
        document.getElementById('diag-run-btn').addEventListener('click', () => this.run_all());
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
            },
            error: (err) => {
                btn.disabled = false;
                btn.textContent = 'Run Full Diagnosis';
                let errText = 'Unknown error';
                try {
                    errText = (err && err.responseJSON && err.responseJSON.exc) || JSON.stringify(err);
                } catch (_) {}
                this.show_api_error(errText);
            }
        });
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
