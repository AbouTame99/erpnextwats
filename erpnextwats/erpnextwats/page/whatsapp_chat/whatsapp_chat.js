console.log('[WhatsApp Chat] Script loaded!');

frappe.provide('erpnextwats');

frappe.pages['whatsapp-chat'].on_page_load = function (wrapper) {
    console.log('[WhatsApp Chat] Page load event triggered!');
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'WhatsApp Office Workspace',
        single_column: true
    });

    console.log('[WhatsApp Chat] Creating WhatsAppChat instance...');
    new erpnextwats.WhatsAppChat(page);
}

erpnextwats.WhatsAppChat = class {
    constructor(page) {
        console.log('[WhatsApp Chat] Constructor called');
        this.page = page;
        this.service_url = `${window.location.protocol}//${window.location.hostname}:3000`;
        console.log('[WhatsApp Chat] Service URL:', this.service_url);
        this.prepare_layout();
        console.log('[WhatsApp Chat] Layout prepared, checking status...');
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
                console.log('[Frontend] Initial status check:', data.status);
                
                if (data.status === 'ready') {
                    this.show_state('connected');
                } else if (data.status === 'qr_ready') {
                    this.fetch_qr();
                    this.show_state('qr');
                    this.start_polling(); // Start polling to check when ready
                } else if (data.status === 'initializing' || data.status === 'connecting') {
                    this.show_state('qr');
                    this.$container.find('.status-text').text('Initializing... Please wait');
                    this.start_polling(); // Start polling to get QR code
                } else {
                    // Disconnected or error - auto-initialize to show QR
                    console.log('[Frontend] Status is disconnected, auto-initializing...');
                    this.initialize_session();
                }
            },
            error: (e) => {
                console.error("[Frontend] Service not reachable", e);
                this.show_state('init');
            }
        });
    }

    async initialize_session() {
        console.log('[Frontend] Initializing session...');
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
                console.log('[Frontend] Init response:', r);
                const data = r.message || {};
                console.log('[Frontend] Init status:', data.status);
                this.start_polling();
            },
            error: (e) => {
                console.error('[Frontend] Init error:', e);
                frappe.msgprint("Error initializing session. Please check server logs.");
                this.show_state('init');
            }
        });
    }

    start_polling() {
        console.log('[Frontend] Starting polling...');
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
                    console.log('[Frontend] Polling status:', data.status);
                    
                    if (data.status === 'qr_ready') {
                        console.log('[Frontend] QR ready, fetching QR code...');
                        this.fetch_qr();
                        this.show_state('qr');
                    } else if (data.status === 'ready') {
                        console.log('[Frontend] Connected!');
                        clearInterval(this.poll_interval);
                        this.show_state('connected');
                        frappe.show_alert({ message: __('WhatsApp Connected!'), indicator: 'green' });
                    } else if (data.status === 'initializing' || data.status === 'connecting') {
                        console.log('[Frontend] Still initializing/connecting...');
                        this.show_state('qr');
                        this.$container.find('.status-text').text('Initializing... Please wait');
                    } else if (data.status === 'error' || data.status === 'auth_failure') {
                        console.error('[Frontend] Error status:', data.status);
                        clearInterval(this.poll_interval);
                        frappe.msgprint(`Connection error: ${data.status}. Please try again.`);
                        this.show_state('init');
                    } else if (data.status === 'disconnected') {
                        console.log('[Frontend] Status is disconnected during polling, re-initializing...');
                        clearInterval(this.poll_interval);
                        this.initialize_session();
                    } else if (data.status === 'initializing' || data.status === 'connecting') {
                        console.log('[Frontend] Still initializing/connecting...');
                        this.show_state('qr');
                        this.$container.find('.status-text').text('Initializing... Please wait');
                    }
                },
                error: (e) => {
                    console.error('[Frontend] Polling error:', e);
                }
            });
        }, 2000); // Poll every 2 seconds for faster response
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
                if (data.qr) {
                    this.show_state('qr');
                    this.$container.find('#qr-image').html(`<img src="${data.qr}" style="width: 100%;">`);
                    this.$container.find('.status-text').text('Scan now to connect');
                }
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
