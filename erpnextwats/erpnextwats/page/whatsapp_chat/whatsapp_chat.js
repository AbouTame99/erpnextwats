console.log('[WhatsApp Setup] Initialized');

frappe.provide('erpnextwats');

frappe.pages['whatsapp-chat'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'WhatsApp Setup',
        single_column: true
    });
    new erpnextwats.WhatsAppSetup(page);
}

erpnextwats.WhatsAppSetup = class {
    constructor(page) {
        this.page = page;
        this.refresh();
    }

    refresh() {
        this.page.clear_primary_action();
        this.page.clear_secondary_action();
        this.prepare_layout();
        this.check_status();
    }

    prepare_layout() {
        this.page.main.html(`
            <div class="wa-setup-container" style="max-width: 600px; margin: 40px auto; text-align: center; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
                <div id="wa-status-header" style="margin-bottom: 30px;">
                    <i class="fa fa-whatsapp" style="font-size: 60px; color: #25d366; margin-bottom: 20px;"></i>
                    <h2 id="wa-status-text">Connecting...</h2>
                    <p class="text-muted" id="wa-status-desc">Initializing WhatsApp Gateway</p>
                </div>

                <div id="wa-qr-container" style="display: none; border: 1px solid #eee; padding: 20px; border-radius: 8px; background: #f9f9f9;">
                    <h4>Scan QR Code</h4>
                    <p class="text-muted small">Open WhatsApp on your phone > Linked Devices > Link a Device</p>
                    <div id="qr-image" style="margin: 20px auto; width: 250px; height: 250px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #ddd;">
                        <div class="spinner-border text-primary"></div>
                    </div>
                    <div class="qr-expiry" style="color: #d63031; font-size: 13px; margin-top: 10px;">
                        QR expires in: <span id="qr-timer">60</span>s
                    </div>
                </div>

                <div id="wa-connected-container" style="display: none; background: #e8f5e9; padding: 30px; border-radius: 8px; border: 1px solid #c8e6c9;">
                    <i class="fa fa-check-circle" style="font-size: 50px; color: #4caf50; margin-bottom: 15px;"></i>
                    <h4 style="color: #2e7d32;">WhatsApp Connected</h4>
                    <p class="text-muted">Background sending service is active.</p>
                    <button class="btn btn-outline-danger btn-sm mt-3 btn-disconnect">Disconnect Session</button>
                </div>

                <div id="wa-init-container" style="display: none;">
                    <button class="btn btn-primary btn-lg btn-connect">Start Desktop Connection</button>
                </div>
            </div>
        `);

        this.$container = this.page.main;

        this.$container.find('.btn-connect').on('click', () => this.initialize_session());
        this.$container.find('.btn-disconnect').on('click', () => this.disconnect_session());
    }

    check_status() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'GET', path: `api/whatsapp/status/${encodeURIComponent(frappe.session.user)}` },
            callback: (r) => {
                const d = r.message || {};
                this.update_ui(d.status, d.qr);
                if (['initializing', 'connecting', 'authenticated', 'qr_ready'].includes(d.status) || !d.status) {
                    this.start_polling();
                }
            }
        });
    }

    start_polling() {
        if (this.poll_int) clearInterval(this.poll_int);
        this.poll_int = setInterval(() => {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.proxy_to_service',
                args: { method: 'GET', path: `api/whatsapp/status/${encodeURIComponent(frappe.session.user)}` },
                callback: (r) => {
                    const d = r.message || {};
                    this.update_ui(d.status, d.qr);
                    if (d.status === 'ready') clearInterval(this.poll_int);
                }
            });
        }, 3000);
    }

    update_ui(status, qr) {
        const h = this.$container.find('#wa-status-text');
        const desc = this.$container.find('#wa-status-desc');
        const qrCont = this.$container.find('#wa-qr-container');
        const connCont = this.$container.find('#wa-connected-container');
        const initCont = this.$container.find('#wa-init-container');

        qrCont.hide(); connCont.hide(); initCont.hide();

        if (status === 'ready') {
            h.text('Connected'); desc.text('Everything is ready for background sending.');
            connCont.show();
        } else if (status === 'qr_ready' || qr) {
            h.text('Waiting for Scan'); desc.text('Link your device to start.');
            qrCont.show();
            if (qr && this.last_qr !== qr) {
                this.last_qr = qr;
                this.$container.find('#qr-image').html(`<img src="${qr}" style="width:100%;">`);
                this.start_qr_timer();
            }
        } else if (status === 'authenticated' || status === 'connecting') {
            h.text('Authenticating...'); desc.text('Finishing setup, please wait.');
        } else {
            h.text('Not Connected'); desc.text('Disconnected from WhatsApp Gateway.');
            initCont.show();
        }
    }

    start_qr_timer() {
        let time = 60;
        const $t = this.$container.find('#qr-timer');
        if (this.qr_int) clearInterval(this.qr_int);
        this.qr_int = setInterval(() => {
            time--;
            $t.text(time);
            if (time <= 0) clearInterval(this.qr_int);
        }, 1000);
    }

    async initialize_session() {
        this.update_ui('initializing');
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'POST', path: 'api/whatsapp/init', data: { userId: frappe.session.user } },
            callback: () => this.start_polling()
        });
    }

    async disconnect_session() {
        frappe.confirm('Stop the WhatsApp background service and disconnect?', () => {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.proxy_to_service',
                args: { method: 'POST', path: 'api/whatsapp/disconnect', data: { userId: frappe.session.user } },
                callback: () => { frappe.show_alert('Disconnected'); this.check_status(); }
            });
        });
    }
}
