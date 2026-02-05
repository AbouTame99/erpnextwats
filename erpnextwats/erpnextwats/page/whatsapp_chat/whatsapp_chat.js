frappe.provide('erpnextwats');

frappe.pages['whatsapp-chat'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Company WhatsApp Connection',
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
        // Auto-refresh status every 5 minutes
        setInterval(() => this.check_status(), 300000);
    }

    prepare_layout() {
        this.page.main.html(`
			<div class="whatsapp-wrapper" style="height: calc(100vh - 150px); display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f0f2f5; border-radius: 12px; overflow: hidden;">
				<div id="wats-container" style="text-align: center; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 600px; width: 90%;">
					
					<!-- Session Status Panel (Always Visible) -->
					<div class="session-status-panel" style="margin-bottom: 30px; padding: 20px; background: #f8f9fa; border-radius: 10px; border-left: 4px solid #ccc;">
						<h5 style="margin-top: 0;"><i class="fa fa-info-circle"></i> Session Status</h5>
						<div id="session-info">
							<div class="text-muted">Checking session...</div>
						</div>
						<div style="margin-top: 10px;">
							<button class="btn btn-xs btn-default btn-refresh-status">
								<i class="fa fa-refresh"></i> Refresh
							</button>
							<span class="last-check text-muted" style="font-size: 12px; margin-left: 10px;"></span>
						</div>
					</div>

					<div class="wats-init">
						<i class="fa fa-whatsapp" style="font-size: 80px; color: #25D366; margin-bottom: 20px;"></i>
						<h3>Connect Company WhatsApp</h3>
						<p class="text-muted">Scan QR code with your company phone to enable WhatsApp for all employees.</p>
						<div class="alert alert-info" style="margin: 20px 0; text-align: left; font-size: 13px;">
							<strong><i class="fa fa-users"></i> Shared Session</strong><br>
							• All employees will use this single WhatsApp connection<br>
							• Use a company phone number, not personal<br>
							• Session typically lasts 2-14 days
						</div>
						<button class="btn btn-primary btn-lg btn-connect" style="background: #25D366; border: none; margin-top: 20px;">
							<i class="fa fa-qrcode"></i> Start Connection
						</button>
					</div>
					
					<div class="wats-qr" style="display: none;">
						<h4><i class="fa fa-mobile"></i> Scan with your phone</h4>
						<p class="text-muted">Open WhatsApp → Settings → Linked Devices → Link a Device</p>
						<div id="qr-image" style="margin: 25px auto; width: 250px; height: 250px; background: #eee; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center;">
							<div class="spinner-border text-primary" role="status"></div>
						</div>
						<p class="text-info status-text">Generating QR Code...</p>
						<div class="alert alert-warning" style="margin-top: 15px; font-size: 12px;">
							<strong>Important:</strong> This connects the <strong>company's shared WhatsApp</strong>.<br>
							All employees will send messages from this number.
						</div>
					</div>
					
					<div class="wats-connected" style="display: none;">
						<div style="color: #25D366; font-size: 50px; margin-bottom: 10px;">
							<i class="fa fa-check-circle"></i>
						</div>
						<h4>Shared Session Active!</h4>
						<p>The company WhatsApp is connected and ready.</p>
						
						<div class="alert alert-success" style="margin: 20px 0; text-align: left;">
							<h5 style="margin-top: 0;"><i class="fa fa-users"></i> All Employees Can Now:</h5>
							<ul style="margin-bottom: 0; text-align: left;">
								<li>Send individual WhatsApp messages</li>
								<li>Use Bulk WhatsApp feature</li>
								<li>Send automated messages</li>
							</ul>
						</div>
						
						<button class="btn btn-outline-danger btn-sm mt-3 btn-disconnect">
							<i class="fa fa-unlink"></i> Disconnect Session
						</button>
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
            frappe.show_alert({ message: __('Checking session status...'), indicator: 'blue' });
        });
    }

    async check_status() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'GET',
                path: 'api/whatsapp/status'
            },
            callback: (r) => {
                const data = r.message || {};
                console.log('Status check:', data);
                
                // Update session info panel
                this.update_session_info(data.info, data.status);
                
                if (data.status === 'ready') {
                    if (this.poll_interval) clearInterval(this.poll_interval);
                    this.show_state('connected');
                } else if (data.status === 'qr_ready') {
                    this.fetch_qr();
                    this.show_state('qr');
                    if (!this.poll_interval) {
                        this.start_polling();
                    }
                } else if (data.status === 'initializing' || data.status === 'connecting') {
                    this.show_state('qr');
                    if (!this.poll_interval) {
                        this.start_polling();
                    }
                } else {
                    this.show_state('init');
                }
            },
            error: (e) => {
                console.error("Service not reachable", e);
                this.update_session_info(null, 'disconnected');
                this.show_state('init');
            }
        });
    }

    update_session_info(info, status) {
        const $info = this.$container.find('#session-info');
        const now = new Date();
        const timeString = now.toLocaleTimeString();
        
        this.$container.find('.last-check').text(`Last checked: ${timeString}`);
        
        if (!info && status === 'disconnected') {
            $info.html(`
                <div style="color: #dc3545;">
                    <i class="fa fa-times-circle"></i> <strong>Disconnected</strong><br>
                    <small>No active WhatsApp session</small>
                </div>
            `);
            this.$container.find('.session-status-panel').css('border-left-color', '#dc3545');
        } else if (info && status === 'ready') {
            const daysConnected = info.daysConnected || 0;
            const phoneNumber = info.phoneNumber || 'Unknown';
            let warningHtml = '';
            
            if (daysConnected >= 10) {
                warningHtml = `
                    <div class="alert alert-warning" style="margin-top: 10px; font-size: 12px; padding: 8px;">
                        <i class="fa fa-exclamation-triangle"></i> 
                        <strong>Warning:</strong> Session is ${daysConnected} days old. 
                        WhatsApp typically expires sessions after 2-14 days. 
                        Consider reconnecting soon to avoid downtime.
                    </div>
                `;
            }
            
            $info.html(`
                <div style="color: #28a745;">
                    <i class="fa fa-check-circle"></i> <strong>Connected</strong><br>
                    <small>
                        <i class="fa fa-phone"></i> ${phoneNumber}<br>
                        <i class="fa fa-calendar"></i> Connected: ${daysConnected} days ago<br>
                        <i class="fa fa-envelope"></i> Messages sent: ${info.messageCount || 0}
                    </small>
                </div>
                ${warningHtml}
            `);
            this.$container.find('.session-status-panel').css('border-left-color', '#28a745');
        } else if (status === 'qr_ready' || status === 'initializing') {
            $info.html(`
                <div style="color: #ffc107;">
                    <i class="fa fa-spinner fa-spin"></i> <strong>Connecting...</strong><br>
                    <small>Waiting for QR code scan</small>
                </div>
            `);
            this.$container.find('.session-status-panel').css('border-left-color', '#ffc107');
        } else {
            $info.html(`
                <div class="text-muted">
                    <i class="fa fa-question-circle"></i> <strong>Unknown Status</strong><br>
                    <small>Please refresh</small>
                </div>
            `);
            this.$container.find('.session-status-panel').css('border-left-color', '#6c757d');
        }
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
                data: {}
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
                    path: 'api/whatsapp/status'
                },
                callback: (r) => {
                    const data = r.message || {};
                    this.update_session_info(data.info, data.status);
                    
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
        }, 2000);
    }

    async fetch_qr() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'GET',
                path: 'api/whatsapp/status'
            },
            callback: (r) => {
                const data = r.message || {};
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
                    this.$container.find('.status-text').html('Scan with your phone:<br><small class="text-muted">QR code refreshes automatically</small>');
                } else if (data.status === 'qr_ready') {
                    setTimeout(() => this.fetch_qr(), 1000);
                }
            },
            error: (e) => {
                this.$container.find('.status-text').text('Error fetching QR code.');
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
        frappe.confirm(
            'Are you sure you want to disconnect the shared WhatsApp session? All employees will lose WhatsApp access until reconnected.',
            () => {
                frappe.call({
                    method: 'erpnextwats.erpnextwats.api.proxy_to_service',
                    args: {
                        method: 'POST',
                        path: 'api/whatsapp/disconnect'
                    },
                    callback: (r) => {
                        frappe.show_alert({ message: __('Session disconnected'), indicator: 'orange' });
                        this.show_state('init');
                        this.update_session_info(null, 'disconnected');
                    }
                });
            }
        );
    }
}
