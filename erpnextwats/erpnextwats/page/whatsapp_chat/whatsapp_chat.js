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
			<div class="whatsapp-wrapper" style="padding: 20px; background: #f5f5f5; min-height: calc(100vh - 60px);">
				<div class="container-fluid" style="max-width: 800px; margin: 0 auto;">
					
					<!-- Header -->
					<div style="text-align: center; margin-bottom: 20px;">
						<i class="fa fa-whatsapp" style="font-size: 40px; color: #25D366;"></i>
						<h4 style="margin: 10px 0 5px 0;">Company WhatsApp</h4>
						<p class="text-muted" style="font-size: 13px; margin: 0;">Shared session for all employees</p>
					</div>

					<!-- Session Status Panel (Always Visible) -->
					<div class="session-status-panel" style="margin-bottom: 15px; padding: 15px; background: white; border-radius: 8px; border-left: 3px solid #ccc; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
							<h6 style="margin: 0; font-size: 14px;"><i class="fa fa-info-circle"></i> Session Status</h6>
							<button class="btn btn-xs btn-default btn-refresh-status" style="padding: 2px 8px; font-size: 11px;">
								<i class="fa fa-refresh"></i> Refresh
							</button>
						</div>
						<div id="session-info" style="font-size: 13px;">
							<div class="text-muted">Checking session...</div>
						</div>
						<div class="last-check text-muted" style="font-size: 11px; margin-top: 8px; text-align: right;"></div>
					</div>

					<!-- Main Content Card -->
					<div id="wats-container" style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center;">
						
						<div class="wats-init">
							<div class="alert alert-info" style="margin-bottom: 20px; padding: 12px; font-size: 12px; text-align: left;">
								<strong><i class="fa fa-users"></i> Shared Session</strong><br>
								<small>
								• All employees use this single connection<br>
								• Use a company phone number<br>
								• Session lasts 2-14 days typically
								</small>
							</div>
							<button class="btn btn-primary btn-connect" style="background: #25D366; border: none; padding: 10px 25px;">
								<i class="fa fa-qrcode"></i> Connect WhatsApp
							</button>
						</div>
						
						<div class="wats-qr" style="display: none;">
							<h5 style="margin-bottom: 15px;"><i class="fa fa-mobile"></i> Scan QR Code</h5>
							<p class="text-muted" style="font-size: 12px; margin-bottom: 15px;">
								WhatsApp → Settings → Linked Devices → Link Device
							</p>
							<div id="qr-image" style="margin: 0 auto 15px auto; width: 200px; height: 200px; background: #f5f5f5; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
								<div class="spinner-border text-primary" style="width: 30px; height: 30px;" role="status"></div>
							</div>
							<p class="text-info status-text" style="font-size: 13px; margin-bottom: 15px;">Generating QR Code...</p>
							<div class="alert alert-warning" style="padding: 10px; font-size: 11px; margin: 0;">
								<strong>Important:</strong> This connects your <strong>company's WhatsApp</strong>. 
								All employees will use this number.
							</div>
						</div>
						
						<div class="wats-connected" style="display: none;">
							<div style="color: #25D366; font-size: 40px; margin-bottom: 10px;">
								<i class="fa fa-check-circle"></i>
							</div>
							<h5 style="margin-bottom: 10px;">Connected!</h5>
							<p style="font-size: 13px; color: #666; margin-bottom: 20px;">
								All employees can now send WhatsApp messages
							</p>
							
							<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; text-align: center;">
								<div style="padding: 10px; background: #f8f9fa; border-radius: 6px;">
									<i class="fa fa-user" style="color: #25D366; font-size: 20px;"></i>
									<div style="font-size: 11px; margin-top: 5px;">Individual</div>
								</div>
								<div style="padding: 10px; background: #f8f9fa; border-radius: 6px;">
									<i class="fa fa-users" style="color: #25D366; font-size: 20px;"></i>
									<div style="font-size: 11px; margin-top: 5px;">Bulk</div>
								</div>
								<div style="padding: 10px; background: #f8f9fa; border-radius: 6px;">
									<i class="fa fa-clock-o" style="color: #25D366; font-size: 20px;"></i>
									<div style="font-size: 11px; margin-top: 5px;">Auto</div>
								</div>
							</div>
							
							<button class="btn btn-outline-danger btn-sm btn-disconnect" style="font-size: 12px;">
								<i class="fa fa-unlink"></i> Disconnect
							</button>
						</div>
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
        const timeString = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        this.$container.find('.last-check').text(`Updated: ${timeString}`);
        
        if (!info && status === 'disconnected') {
            $info.html(`
                <div style="display: flex; align-items: center; gap: 8px; color: #dc3545;">
                    <i class="fa fa-times-circle"></i>
                    <div>
                        <strong>Disconnected</strong><br>
                        <small style="color: #666;">No active session</small>
                    </div>
                </div>
            `);
            this.$container.find('.session-status-panel').css('border-left-color', '#dc3545');
        } else if (info && status === 'ready') {
            const daysConnected = info.daysConnected || 0;
            const phoneNumber = info.phoneNumber || 'Unknown';
            let warningBadge = '';
            
            if (daysConnected >= 10) {
                warningBadge = `<span class="badge badge-warning" style="margin-left: 8px; font-size: 10px;">Expires soon</span>`;
            }
            
            $info.html(`
                <div style="display: flex; align-items: center; gap: 10px; color: #28a745;">
                    <i class="fa fa-check-circle" style="font-size: 18px;"></i>
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 5px;">
                            <strong>Active</strong> ${warningBadge}
                        </div>
                        <small style="color: #666; display: block; margin-top: 3px;">
                            <i class="fa fa-phone" style="width: 14px;"></i> ${phoneNumber} • 
                            <i class="fa fa-calendar" style="width: 14px;"></i> ${daysConnected} days • 
                            <i class="fa fa-envelope" style="width: 14px;"></i> ${info.messageCount || 0} msgs
                        </small>
                    </div>
                </div>
            `);
            this.$container.find('.session-status-panel').css('border-left-color', '#28a745');
        } else if (status === 'qr_ready' || status === 'initializing') {
            $info.html(`
                <div style="display: flex; align-items: center; gap: 8px; color: #ffc107;">
                    <i class="fa fa-spinner fa-spin"></i>
                    <div>
                        <strong>Connecting...</strong><br>
                        <small style="color: #666;">Scan QR code</small>
                    </div>
                </div>
            `);
            this.$container.find('.session-status-panel').css('border-left-color', '#ffc107');
        } else {
            $info.html(`
                <div style="display: flex; align-items: center; gap: 8px; color: #6c757d;">
                    <i class="fa fa-question-circle"></i>
                    <div>
                        <strong>Unknown</strong><br>
                        <small>Click refresh</small>
                    </div>
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
