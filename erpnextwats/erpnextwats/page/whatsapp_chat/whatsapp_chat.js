frappe.provide('erpnextwats');

frappe.pages['whatsapp-chat'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'WhatsApp Office Workspace',
        single_column: true
    });

    new erpnextwats.WhatsAppChat(page);
}

erpnextwats.WhatsAppChat = class {
    constructor(page) {
        this.page = page;
        this.service_url = `${window.location.protocol}//${window.location.hostname}:3000`;
        this.prepare_layout();
        this.check_status();
    }

    prepare_layout() {
        this.page.main.html(`
			<div class="whatsapp-wrapper" style="height: calc(100vh - 150px); display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f0f2f5; border-radius: 12px; overflow: hidden;">
				<div id="wats-container" style="text-align: center; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 500px; width: 90%;">
					<div class="wats-init">
						<i class="fa fa-whatsapp" style="font-size: 80px; color: #25D366; margin-bottom: 20px;"></i>
						<h3>WhatsApp Integration</h3>
						<p class="text-muted">Connect your personal WhatsApp to use it from your desk.</p>
						<button class="btn btn-primary btn-lg btn-connect" style="background: #25D366; border: none; margin-top: 20px;">
							Start Connection
						</button>
					</div>
					<div class="wats-qr" style="display: none;">
						<h4>Scan with your phone</h4>
						<p class="text-muted">Open WhatsApp > Settings > Linked Devices > Link a Device</p>
						<div id="qr-image" style="margin: 25px auto; width: 250px; height: 250px; background: #eee; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center;">
							<div class="spinner-border text-primary" role="status"></div>
						</div>
						<p class="text-info status-text">Generating QR Code...</p>
						<button class="btn btn-sm btn-outline-primary mt-2 btn-refresh-status" style="display: none;">Check Connection Status</button>
					</div>
					<div class="wats-connected" style="display: none;">
						<div style="color: #25D366; font-size: 50px; margin-bottom: 10px;">
							<i class="fa fa-check-circle"></i>
						</div>
						<h4>Connected Successfully!</h4>
						<p>Your WhatsApp is active in your office workspace.</p>
						<button class="btn btn-outline-danger btn-sm mt-3 btn-disconnect">Disconnect</button>
					</div>
				</div>
			</div>
		`);

        this.$container = this.page.main.find('#wats-container');
        this.bind_events();
    }

    bind_events() {
        this.$container.find('.btn-connect').on('click', () => this.initialize_session());
        this.$container.find('.btn-disconnect').on('click', () => this.disconnect_session());
        this.$container.find('.btn-refresh-status').on('click', () => {
            this.check_status();
            frappe.show_alert({ message: __('Checking connection status...'), indicator: 'blue' });
        });
    }

    async check_status() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'GET',
                path: `api/whatsapp/status/${frappe.session.user}`
            },
            callback: (r) => {
                const data = r.message || {};
                console.log('Status check:', data); // Debug log
                if (data.status === 'ready') {
                    if (this.poll_interval) clearInterval(this.poll_interval);
                    this.show_state('connected');
                } else if (data.status === 'qr_ready') {
                    this.fetch_qr();
                    this.show_state('qr');
                    // Start polling if not already polling
                    if (!this.poll_interval) {
                        this.start_polling();
                    }
                } else if (data.status === 'initializing' || data.status === 'connecting') {
                    this.show_state('qr');
                    // Start polling if not already polling
                    if (!this.poll_interval) {
                        this.start_polling();
                    }
                } else {
                    this.show_state('init');
                }
            },
            error: (e) => {
                console.error("Service not reachable", e);
                this.show_state('init');
            }
        });
    }

    async initialize_session() {
        if (this.poll_interval) clearInterval(this.poll_interval);
        this.show_state('qr');
        this.$container.find('#qr-image').html('<div class="spinner-border text-primary" role="status"></div>');
        this.$container.find('.status-text').text('Requesting session...');

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'POST',
                path: 'api/whatsapp/init',
                data: { userId: frappe.session.user }
            },
            callback: (r) => {
                this.start_polling();
            },
            error: (e) => {
                frappe.msgprint("Node.js service error. Please check server logs.");
                this.show_state('init');
            }
        });
    }

    start_polling() {
        if (this.poll_interval) clearInterval(this.poll_interval);
        this.poll_interval = setInterval(() => {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.proxy_to_service',
                args: {
                    method: 'GET',
                    path: `api/whatsapp/status/${frappe.session.user}`
                },
                callback: (r) => {
                    const data = r.message || {};
                    console.log('Polling status:', data); // Debug log
                    if (data.status === 'ready') {
                        clearInterval(this.poll_interval);
                        this.poll_interval = null;
                        this.show_state('connected');
                        frappe.show_alert({ message: __('WhatsApp Connected!'), indicator: 'green' });
                    } else if (data.status === 'qr_ready') {
                        this.fetch_qr();
                        this.show_state('qr');
                    } else if (data.status === 'auth_failure') {
                        clearInterval(this.poll_interval);
                        this.poll_interval = null;
                        this.$container.find('.status-text').text('Authentication failed. Please try again.');
                        frappe.show_alert({ message: __('Authentication failed. Please try again.'), indicator: 'red' });
                        setTimeout(() => this.show_state('init'), 3000);
                    } else if (data.status === 'error' || data.status === 'disconnected') {
                        this.$container.find('.status-text').text('Connection error. Please try again.');
                    } else if (data.status === 'initializing' || data.status === 'connecting') {
                        this.$container.find('.status-text').text('Initializing connection...');
                    }
                },
                error: (e) => {
                    console.error('Status check error:', e);
                }
            });
        }, 2000); // Poll every 2 seconds for faster QR refresh
    }

    async fetch_qr() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'GET',
                path: `api/whatsapp/status/${frappe.session.user}`
            },
            callback: (r) => {
                const data = r.message || {};
                // Check if already connected first
                if (data.status === 'ready') {
                    if (this.poll_interval) clearInterval(this.poll_interval);
                    this.poll_interval = null;
                    this.show_state('connected');
                    frappe.show_alert({ message: __('WhatsApp Connected!'), indicator: 'green' });
                    return;
                }
                if (data.qr) {
                    this.show_state('qr');
                    this.$container.find('#qr-image').html(`<img src="${data.qr}" style="width: 100%; border: 2px solid #25D366;">`);
                    this.$container.find('.status-text').html('Scan with your phone:<br><small class="text-muted">Open WhatsApp > Settings > Linked Devices > Link a Device<br>QR code refreshes automatically if it expires</small>');
                    this.$container.find('.btn-refresh-status').show();
                } else if (data.status === 'qr_ready') {
                    // QR is ready but not yet generated, wait a bit
                    setTimeout(() => this.fetch_qr(), 1000);
                }
            },
            error: (e) => {
                this.$container.find('.status-text').text('Error fetching QR code. Please try again.');
            }
        });
    }

    show_state(state) {
        this.$container.find('.wats-init, .wats-qr, .wats-connected').hide();
        if (state === 'init') this.$container.find('.wats-init').show();
        if (state === 'qr') this.$container.find('.wats-qr').show();
        if (state === 'connected') this.$container.find('.wats-connected').show();
    }

    async disconnect_session() {
        this.show_state('init');
    }
}
