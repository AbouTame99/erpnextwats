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
        this.service_url = 'http://localhost:3000'; // Port of our Node service
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
        try {
            const response = await fetch(`${this.service_url}/session/status/${frappe.session.user}`);
            const data = await response.json();

            if (data.status === 'ready') {
                this.show_state('connected');
            } else if (data.status === 'qr_ready') {
                this.fetch_qr();
            } else if (data.status === 'initializing' || data.status === 'connecting') {
                this.show_state('qr');
                setTimeout(() => this.check_status(), 3000);
            }
        } catch (e) {
            console.error("Service not reachable", e);
        }
    }

    async initialize_session() {
        this.show_state('qr');
        try {
            await fetch(`${this.service_url}/session/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: frappe.session.user })
            });
            this.start_polling();
        } catch (e) {
            frappe.msgprint("Node.js service is not running. Please start it.");
        }
    }

    start_polling() {
        this.poll_interval = setInterval(async () => {
            const response = await fetch(`${this.service_url}/session/status/${frappe.session.user}`);
            const data = await response.json();

            if (data.status === 'qr_ready') {
                this.fetch_qr();
            } else if (data.status === 'ready') {
                clearInterval(this.poll_interval);
                this.show_state('connected');
                frappe.show_alert({ message: __('WhatsApp Connected!'), indicator: 'green' });
            }
        }, 3000);
    }

    async fetch_qr() {
        try {
            const response = await fetch(`${this.service_url}/session/qr/${frappe.session.user}`);
            const data = await response.json();
            if (data.qr) {
                this.$container.find('#qr-image').html(`<img src="${data.qr}" style="width: 100%;">`);
                this.$container.find('.status-text').text('Scan now to connect');
            }
        } catch (e) { }
    }

    show_state(state) {
        this.$container.find('.wats-init, .wats-qr, .wats-connected').hide();
        if (state === 'init') this.$container.find('.wats-init').show();
        if (state === 'qr') this.$container.find('.wats-qr').show();
        if (state === 'connected') this.$container.find('.wats-connected').show();
    }

    async disconnect_session() {
        // Logic to tell Node service to destroy client
        this.show_state('init');
    }
}
