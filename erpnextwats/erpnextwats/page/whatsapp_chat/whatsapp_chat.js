console.log('[WhatsApp Chat] Premium Edition v2.1');

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
        this.socket = null;
        this.all_chats_ref = [];
        this.current_search_query = '';
        this.archived_expanded = false;
        this.refresh();
    }

    refresh() {
        this.page.clear_primary_action();
        this.page.clear_secondary_action();
        if (!window.io) frappe.require('https://cdn.socket.io/4.7.2/socket.io.min.js');
        this.prepare_layout();
        this.check_status();
    }

    prepare_layout() {
        try {
            this.id = frappe.session.user;
            this.notif_sound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
            this.notif_sound.load();

            this.page.main.html(`
                <div class="whatsapp-wrapper">
                    <div id="wats-container">
                        <!-- Loading State (Original) -->
                        <div class="wats-loading" style="text-align: center; padding: 100px;">
                            <div class="spinner-border text-primary" role="status"></div>
                            <p class="text-muted mt-3">Connecting to WhatsApp Gateway...</p>
                        </div>

                        <!-- Setup Screen (Original) -->
                        <div class="wats-init setup-screen" style="display:none;">
                            <i class="fa fa-whatsapp main-icon"></i>
                            <h3>WhatsApp Integration</h3>
                            <p class="text-muted">Connect your personal WhatsApp to use it from your desk.</p>
                            <button class="btn btn-primary btn-lg btn-connect">Start Connection</button>
                        </div>

                        <!-- QR Screen (Original) -->
                        <div class="wats-qr setup-screen" style="display: none;">
                            <h4>Scan with your phone</h4>
                            <p class="text-muted">Open WhatsApp > Settings > Linked Devices > Link a Device</p>
                            <div id="qr-image">
                                <div class="spinner-border text-primary" role="status"></div>
                            </div>
                            <p class="text-info status-text">Generating QR Code...</p>
                            <div class="qr-timer-wrapper" style="display: none;">
                                <span class="text-muted">QR expires in: </span>
                                <span class="qr-countdown">60</span>s
                            </div>
                            <button class="btn btn-sm btn-secondary btn-cancel-qr">Cancel</button>
                        </div>

                        <!-- PREMIUM Main Chat Interface -->
                        <div class="wats-connected chat-app" style="display: none;">
                            <!-- Premium Sidebar -->
                            <div class="wa-sidebar">
                                <div class="wa-sidebar-header">
                                    <div class="wa-user-avatar" id="my-avatar"><i class="fa fa-user"></i></div>
                                    <div class="wa-header-actions">
                                        <button class="wa-icon-btn" title="New Chat" id="btn-new-chat"><i class="fa fa-comment"></i></button>
                                        <button class="wa-icon-btn" title="Settings" id="btn-settings"><i class="fa fa-ellipsis-v"></i></button>
                                    </div>
                                </div>
                                <div class="wa-search-bar">
                                    <i class="fa fa-search"></i>
                                    <input type="text" id="sidebar-search" placeholder="Search or type passcode...">
                                </div>
                                <div class="wa-chat-list" id="chat-list"></div>
                            </div>

                            <!-- Premium Main Panel -->
                            <div class="wa-main-panel">
                                <!-- Welcome Screen -->
                                <div class="wa-welcome" id="welcome-screen">
                                    <div class="wa-welcome-content">
                                        <i class="fa fa-whatsapp"></i>
                                        <h2>WhatsApp Web</h2>
                                        <p>Send and receive messages without keeping your phone online.<br>
                                        Use WhatsApp on up to 4 linked devices at the same time.</p>
                                        <div class="wa-welcome-footer">
                                            <i class="fa fa-lock"></i> End-to-end encrypted
                                        </div>
                                    </div>
                                </div>

                                <!-- Active Chat -->
                                <div class="wa-chat-panel" id="chat-panel" style="display:none;">
                                    <div class="wa-chat-header">
                                        <div class="wa-chat-header-left">
                                            <div class="wa-chat-avatar" id="active-avatar"><i class="fa fa-user"></i></div>
                                            <div class="wa-chat-info">
                                                <h4 id="chat-name">Contact Name</h4>
                                                <span id="chat-status">online</span>
                                            </div>
                                        </div>
                                        <div class="wa-chat-header-right">
                                            <button class="wa-icon-btn" title="Search Messages" id="btn-search-msg"><i class="fa fa-search"></i></button>
                                            <button class="wa-icon-btn" title="Chat Options" id="btn-chat-options"><i class="fa fa-ellipsis-v"></i></button>
                                        </div>
                                    </div>
                                    <div class="wa-messages" id="message-thread"></div>
                                    <div class="wa-input-area">
                                        <button class="wa-icon-btn" title="Emoji" id="btn-emoji"><i class="fa fa-smile-o"></i></button>
                                        <button class="wa-icon-btn" title="Attach File" id="btn-attach"><i class="fa fa-paperclip"></i></button>
                                        <input type="file" id="attachment-input" style="display:none;">
                                        <div class="wa-input-box">
                                            <input type="text" id="msg-input" placeholder="Type a message">
                                        </div>
                                        <button class="wa-icon-btn wa-send-btn" title="Send" id="btn-send"><i class="fa fa-paper-plane"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Settings Modal -->
                    <div class="wa-modal" id="settings-modal" style="display:none;">
                        <div class="wa-modal-content">
                            <div class="wa-modal-header">
                                <h3>Settings</h3>
                                <button class="wa-icon-btn modal-close"><i class="fa fa-times"></i></button>
                            </div>
                            <div class="wa-modal-body">
                                <div class="wa-setting-item" id="btn-disconnect">
                                    <i class="fa fa-sign-out text-danger"></i>
                                    <div>
                                        <strong class="text-danger">Disconnect</strong>
                                        <p>Log out from this device</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `);

            this.inject_styles();
            this.$container = this.page.main.find('#wats-container');
            this.bind_events();
        } catch (e) { console.error(e); }
    }

    inject_styles() {
        frappe.dom.set_style(`
            /* ========== Original Setup Styles ========== */
            .whatsapp-wrapper { height: calc(100vh - 120px); background: #f0f2f5; padding: 20px; display: flex; justify-content: center; align-items: center; }
            #wats-container { width: 100%; height: 100%; max-width: 1600px; background: white; box-shadow: 0 6px 18px rgba(0,0,0,0.06); border-radius: 4px; overflow: hidden; display: flex; flex-direction: column; }
            .setup-screen { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 40px; }
            .main-icon { font-size: 80px; color: #25D366; margin-bottom: 20px; }
            #qr-image { margin: 25px auto; width: 250px; height: 250px; background: #eee; display: flex; align-items: center; justify-content: center; border: 1px solid #ddd; }
            #qr-image img { width: 100%; }

            /* ========== PREMIUM Chat Interface ========== */
            .chat-app { display: flex; height: 100%; width: 100%; }
            
            /* Sidebar */
            .wa-sidebar { width: 400px; border-right: 1px solid #e9edef; display: flex; flex-direction: column; background: #fff; }
            .wa-sidebar-header { height: 60px; padding: 10px 16px; background: #f0f2f5; display: flex; justify-content: space-between; align-items: center; }
            .wa-user-avatar { width: 40px; height: 40px; background: linear-gradient(135deg, #00a884, #25d366); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px; overflow: hidden; }
            .wa-user-avatar img { width: 100%; height: 100%; object-fit: cover; }
            .wa-header-actions { display: flex; gap: 8px; }
            .wa-icon-btn { width: 40px; height: 40px; border: none; background: transparent; border-radius: 50%; cursor: pointer; color: #54656f; font-size: 18px; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
            .wa-icon-btn:hover { background: rgba(0,0,0,0.05); }
            .wa-search-bar { padding: 8px 12px; background: #fff; border-bottom: 1px solid #e9edef; display: flex; align-items: center; gap: 12px; }
            .wa-search-bar input { flex: 1; border: none; outline: none; background: #f0f2f5; padding: 10px 14px; border-radius: 8px; font-size: 14px; }
            .wa-search-bar i { color: #54656f; position: relative; left: 36px; z-index: 1; }
            .wa-search-bar input { padding-left: 40px; margin-left: -36px; }
            .wa-chat-list { flex: 1; overflow-y: auto; }
            
            /* Chat Items */
            .wa-chat-item { display: flex; padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f5f6f6; transition: background 0.15s; align-items: center; gap: 12px; }
            .wa-chat-item:hover { background: #f5f6f6; }
            .wa-chat-item.active { background: #f0f2f5; }
            .wa-chat-avatar { width: 50px; height: 50px; background: linear-gradient(135deg, #dfe5e7, #c8d0d3); border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #8696a0; font-size: 20px; overflow: hidden; }
            .wa-chat-avatar img { width: 100%; height: 100%; object-fit: cover; }
            .wa-chat-content { flex: 1; min-width: 0; }
            .wa-chat-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
            .wa-chat-name { font-weight: 500; color: #111b21; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .wa-chat-time { font-size: 12px; color: #667781; flex-shrink: 0; }
            .wa-chat-msg { font-size: 14px; color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .wa-chat-badge { background: #25d366; color: #fff; font-size: 11px; padding: 2px 7px; border-radius: 12px; font-weight: 500; }
            .wa-archived-header { padding: 15px 16px; color: #25d366; font-weight: 500; display: flex; align-items: center; gap: 15px; cursor: pointer; border-bottom: 1px solid #f5f6f6; }
            .wa-archived-header:hover { background: #f5f6f6; }

            /* Main Panel */
            .wa-main-panel { flex: 1; display: flex; flex-direction: column; background: #efeae2; position: relative; }
            .wa-welcome { flex: 1; display: flex; align-items: center; justify-content: center; background: #f0f2f5; border-bottom: 6px solid #25d366; }
            .wa-welcome-content { text-align: center; max-width: 500px; padding: 40px; }
            .wa-welcome-content i { font-size: 100px; color: #c8d0d3; margin-bottom: 30px; display: block; }
            .wa-welcome-content h2 { font-weight: 300; color: #41525d; margin-bottom: 15px; font-size: 28px; }
            .wa-welcome-content p { color: #667781; line-height: 1.6; font-size: 14px; }
            .wa-welcome-footer { margin-top: 40px; color: #8696a0; font-size: 13px; }

            /* Chat Panel */
            .wa-chat-panel { flex: 1; display: flex; flex-direction: column; position: relative; z-index: 1; }
            .wa-chat-header { height: 60px; padding: 10px 16px; background: #f0f2f5; display: flex; justify-content: space-between; align-items: center; border-left: 1px solid #e9edef; }
            .wa-chat-header-left { display: flex; align-items: center; gap: 12px; }
            .wa-chat-header-right { display: flex; gap: 8px; }
            .wa-chat-info h4 { margin: 0; font-size: 16px; font-weight: 500; color: #111b21; }
            .wa-chat-info span { font-size: 13px; color: #667781; }
            .wa-messages { flex: 1; overflow-y: auto; padding: 20px 60px; display: flex; flex-direction: column; gap: 4px; }
            .wa-msg { max-width: 65%; padding: 8px 12px; border-radius: 8px; font-size: 14px; position: relative; box-shadow: 0 1px 1px rgba(0,0,0,0.08); line-height: 1.4; }
            .wa-msg-in { align-self: flex-start; background: #fff; border-top-left-radius: 0; }
            .wa-msg-out { align-self: flex-end; background: #d9fdd3; border-top-right-radius: 0; }
            .wa-msg-meta { text-align: right; font-size: 11px; color: #667781; margin-top: 4px; }
            .wa-msg-meta i { margin-left: 4px; color: #53bdeb; }
            .wa-input-area { padding: 10px 16px; background: #f0f2f5; display: flex; align-items: center; gap: 10px; border-left: 1px solid #e9edef; }
            .wa-input-box { flex: 1; background: #fff; border-radius: 8px; padding: 10px 14px; }
            .wa-input-box input { border: none; width: 100%; outline: none; font-size: 15px; }
            .wa-send-btn { background: #25d366 !important; color: #fff !important; }
            .wa-send-btn:hover { background: #1fa855 !important; }

            /* Modal */
            .wa-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; }
            .wa-modal-content { background: #fff; border-radius: 12px; width: 400px; overflow: hidden; box-shadow: 0 10px 50px rgba(0,0,0,0.3); }
            .wa-modal-header { padding: 16px 20px; background: #f0f2f5; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e9edef; }
            .wa-modal-header h3 { margin: 0; font-size: 18px; color: #111b21; }
            .wa-modal-body { padding: 10px 0; }
            .wa-setting-item { display: flex; align-items: center; gap: 16px; padding: 14px 20px; cursor: pointer; transition: background 0.15s; }
            .wa-setting-item:hover { background: #f5f6f6; }
            .wa-setting-item i { font-size: 20px; color: #54656f; width: 24px; text-align: center; }
            .wa-setting-item strong { font-weight: 500; color: #111b21; display: block; }
            .wa-setting-item p { margin: 2px 0 0; font-size: 13px; color: #667781; }

            /* Spinner */
            .wa-spinner { width: 50px; height: 50px; border: 4px solid #e8e8e8; border-top: 4px solid #25d366; border-radius: 50%; animation: spin 1s linear infinite; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `);
    }

    bind_events() {
        // Original setup events
        this.$container.find('.btn-connect').on('click', () => this.initialize_session());
        this.$container.find('.btn-cancel-qr').on('click', () => this.show_state('init'));
        
        // Chat Input
        this.$container.find('#msg-input').on('keypress', (e) => { if (e.which == 13) this.send_message(); });
        this.$container.find('#btn-send').on('click', () => this.send_message());
        this.$container.find('#btn-attach').on('click', () => this.$container.find('#attachment-input').click());
        this.$container.find('#attachment-input').on('change', (e) => this.handle_attachment(e));
        
        // Emoji placeholder
        this.$container.find('#btn-emoji').on('click', () => frappe.show_alert({ message: 'Emoji picker coming soon!', indicator: 'blue' }));
        
        // Search
        this.$container.find('#sidebar-search').on('input', (e) => {
            this.current_search_query = $(e.target).val().toLowerCase();
            this.render_chat_list(this.all_chats_ref);
        });
        
        // Settings Modal
        this.$container.find('#btn-settings').on('click', () => this.page.main.find('#settings-modal').show());
        this.page.main.find('.modal-close').on('click', () => this.page.main.find('#settings-modal').hide());
        this.page.main.find('#btn-disconnect').on('click', () => this.disconnect_session());
        
        // New Chat
        this.$container.find('#btn-new-chat').on('click', () => {
            frappe.prompt('Enter phone number (with country code):', ({ value }) => {
                if (value) {
                    const chatId = value.replace(/[^0-9]/g, '') + '@c.us';
                    this.open_chat(chatId, value);
                }
            }, 'New Chat', 'text');
        });
        
        // Chat item click
        this.$container.on('click', '.wa-chat-item', (e) => {
            const $item = $(e.currentTarget);
            this.open_chat($item.data('id'), $item.data('name'));
        });
        
        // Context menu
        this.$container.on('contextmenu', '.wa-chat-item', (e) => {
            e.preventDefault();
            const chatId = $(e.currentTarget).data('id');
            const chat = this.all_chats_ref.find(c => c.id === chatId);
            if (!chat) return;
            const menu = [
                { label: chat.archived ? 'Unarchive' : 'Archive', action: () => this.archive_chat(chatId, !chat.archived) },
                { label: chat.lockedPassword ? 'Unlock' : 'Lock with Password', action: () => {
                    if (chat.lockedPassword) this.lock_chat(chatId, null);
                    else frappe.prompt('Enter passcode:', ({ value }) => { if (value) this.lock_chat(chatId, value); }, 'Lock Chat', 'password');
                }}
            ];
            frappe.ui.form.make_menu_from_items(menu, e);
        });
    }

    show_state(state) {
        this.$container.find('.setup-screen, .chat-app, .wats-loading').hide();
        if (state === 'init') this.$container.find('.wats-init').show();
        if (state === 'qr') this.$container.find('.wats-qr').show();
        if (state === 'connected') { this.$container.find('.wats-connected').show(); this.init_socket(); }
    }

    async check_status() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'GET', path: `api/whatsapp/status/${encodeURIComponent(frappe.session.user)}` },
            callback: (r) => {
                const d = r.message || {};
                if (d.status === 'ready') { this.show_state('connected'); this.fetch_chats(); }
                else if (d.status === 'qr_ready') { this.render_qr(d.qr); this.show_state('qr'); this.start_polling(); }
                else if (['initializing','connecting','authenticated'].includes(d.status)) { this.show_state('qr'); this.start_polling(); }
                else { this.show_state('init'); }
            },
            error: () => this.show_state('init')
        });
    }

    async initialize_session() {
        this.show_state('qr');
        this.$container.find('#qr-image').html('<div class="spinner-border text-primary" role="status"></div>');
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'POST', path: 'api/whatsapp/init', data: { userId: frappe.session.user } },
            callback: () => this.start_polling()
        });
    }

    async disconnect_session() {
        frappe.confirm('Are you sure you want to disconnect?', () => {
            this.page.main.find('#settings-modal').hide();
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.proxy_to_service',
                args: { method: 'POST', path: 'api/whatsapp/disconnect', data: { userId: frappe.session.user } },
                callback: () => { frappe.show_alert({ message: 'Disconnected', indicator: 'green' }); this.show_state('init'); }
            });
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
                    if (d.status === 'ready') { clearInterval(this.poll_int); this.show_state('connected'); this.fetch_chats(); }
                    else if (d.qr) this.render_qr(d.qr);
                }
            });
        }, 3000);
    }

    render_qr(qr) {
        if (!qr || this.last_qr === qr) return;
        this.last_qr = qr;
        this.$container.find('#qr-image').html(`<img src="${qr}">`);
    }

    init_socket() {
        if (this.socket || !window.io) return;
        this.socket = io(window.location.protocol + '//' + window.location.hostname + ':3000', { transports: ['websocket','polling'] });
        this.socket.on(`new_message:${this.id}`, (d) => {
            this.notif_sound.play().catch(()=>{});
            if (this.current_chat_id === d.chatId) this.fetch_messages(d.chatId);
            this.fetch_chats();
        });
    }

    async fetch_chats() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'GET', path: `api/whatsapp/chats/${encodeURIComponent(frappe.session.user)}` },
            callback: (r) => { this.all_chats_ref = r.message || []; this.render_chat_list(this.all_chats_ref); }
        });
        if (!this.chat_ref_int) this.chat_ref_int = setInterval(() => this.fetch_chats(), 15000);
    }

    render_chat_list(chats) {
        const $list = this.$container.find('#chat-list').empty();
        const search = (this.current_search_query || '').toLowerCase();
        const normal = [], arch = [], locked_match = [];

        chats.forEach(c => {
            const isLocked = c.lockedPassword && c.lockedPassword !== '';
            if (isLocked) { if (search && search === c.lockedPassword.toLowerCase()) locked_match.push(c); return; }
            const match = (c.name || '').toLowerCase().includes(search) || c.id.toLowerCase().includes(search);
            if (search && !match) return;
            if (c.archived) arch.push(c);
            else normal.push(c);
        });

        if (locked_match.length) {
            $list.append('<div class="wa-archived-header"><i class="fa fa-unlock"></i> Unlocked Private Chats</div>');
            locked_match.forEach(c => this.render_chat_item(c, $list));
        }

        normal.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(c => this.render_chat_item(c, $list));

        if (arch.length) {
            const $h = $(`<div class="wa-archived-header"><i class="fa fa-archive"></i> Archived (${arch.length}) <i class="fa fa-chevron-${this.archived_expanded ? 'up' : 'down'}" style="margin-left:auto;"></i></div>`).appendTo($list);
            $h.on('click', () => { this.archived_expanded = !this.archived_expanded; this.render_chat_list(chats); });
            if (this.archived_expanded) arch.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(c => this.render_chat_item(c, $list));
        }
    }

    render_chat_item(c, $list) {
        const time = c.timestamp ? new Date(c.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const active = this.current_chat_id === c.id ? 'active' : '';
        const lastMsg = c.lockedPassword ? '<i class="fa fa-lock"></i> Locked' : (c.lastMessage ? c.lastMessage.body : '');
        const $el = $(`
            <div class="wa-chat-item ${active}" data-id="${c.id}" data-name="${c.name || c.id}">
                <div class="wa-chat-avatar" id="av-${c.id.replace(/[^a-zA-Z0-9]/g, '')}"><i class="fa fa-${c.isGroup ? 'users' : 'user'}"></i></div>
                <div class="wa-chat-content">
                    <div class="wa-chat-top"><span class="wa-chat-name">${c.name || c.id.split('@')[0]}</span><span class="wa-chat-time">${time}</span></div>
                    <div class="wa-chat-msg">${lastMsg}</div>
                </div>
                ${c.unreadCount > 0 ? `<span class="wa-chat-badge">${c.unreadCount}</span>` : ''}
            </div>
        `).appendTo($list);
        this.fetch_avatar(c.id, $el.find('.wa-chat-avatar'));
    }

    async open_chat(id, name) {
        this.current_chat_id = id;
        this.last_msg_fp = null;
        this.$container.find('.wa-chat-item').removeClass('active');
        this.$container.find(`.wa-chat-item[data-id="${id}"]`).addClass('active');
        this.$container.find('#welcome-screen').hide();
        this.$container.find('#chat-panel').show();
        this.$container.find('#chat-name').text(name || id.split('@')[0]);
        this.$container.find('#message-thread').empty().html('<div style="text-align:center;padding:40px;"><div class="wa-spinner"></div></div>');
        this.fetch_avatar(id, this.$container.find('#active-avatar'));
        this.fetch_messages(id);
    }

    async fetch_avatar(cid, $el) {
        if (!this.av_cache) this.av_cache = {};
        if (this.av_cache[cid]) { if (this.av_cache[cid] !== 'loading' && this.av_cache[cid] !== 'none') $el.html(`<img src="${this.av_cache[cid]}">`); return; }
        this.av_cache[cid] = 'loading';
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'GET', path: `api/whatsapp/profile-pic/${encodeURIComponent(frappe.session.user)}/${encodeURIComponent(cid)}` },
            callback: (r) => { this.av_cache[cid] = (r.message && r.message.url) ? r.message.url : 'none'; if (this.av_cache[cid] !== 'none') $el.html(`<img src="${this.av_cache[cid]}">`); }
        });
    }

    async fetch_messages(cid) {
        if (this.current_chat_id !== cid) return;
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'GET', path: `api/whatsapp/messages/${encodeURIComponent(frappe.session.user)}/${encodeURIComponent(cid)}` },
            callback: (r) => {
                const msgs = r.message || [];
                const fp = msgs.map(m => m.id).join('|');
                if (this.last_msg_fp === fp) return;
                this.last_msg_fp = fp;
                this.render_messages(msgs);
            }
        });
        if (this.msg_timeout) clearTimeout(this.msg_timeout);
        this.msg_timeout = setTimeout(() => { if (this.current_chat_id === cid) this.fetch_messages(cid); }, 5000);
    }

    render_messages(msgs) {
        const $t = this.$container.find('#message-thread');
        const scroll = $t[0].scrollHeight - $t[0].scrollTop <= $t[0].clientHeight + 50;
        $t.empty();
        msgs.forEach(m => {
            const time = new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            $t.append(`<div class="wa-msg ${m.fromMe ? 'wa-msg-out' : 'wa-msg-in'}">${m.body}<div class="wa-msg-meta">${time}${m.fromMe ? ' <i class="fa fa-check"></i>' : ''}</div></div>`);
        });
        if (scroll) $t.scrollTop($t[0].scrollHeight);
    }

    async archive_chat(chatId, archive) {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'POST', path: 'api/whatsapp/archive', data: { userId: frappe.session.user, chatId, archive } },
            callback: () => { frappe.show_alert({ message: archive ? 'Chat archived' : 'Chat unarchived', indicator: 'green' }); this.fetch_chats(); }
        });
    }

    async lock_chat(chatId, password) {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'POST', path: 'api/whatsapp/lock', data: { userId: frappe.session.user, chatId, password } },
            callback: () => { frappe.show_alert({ message: password ? 'Chat locked' : 'Chat unlocked', indicator: 'green' }); this.fetch_chats(); }
        });
    }

    async send_message() {
        const $i = this.$container.find('#msg-input');
        const text = $i.val();
        if (!text || !this.current_chat_id) return;
        $i.val('');
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'POST', path: 'api/whatsapp/send', data: { userId: frappe.session.user, to: this.current_chat_id, message: text } },
            callback: (r) => {
                if (r.message && r.message.status === 'error') frappe.show_alert({ message: 'Failed to send', indicator: 'red' });
                else this.fetch_messages(this.current_chat_id);
            },
            error: () => frappe.show_alert({ message: 'Failed to send message', indicator: 'red' })
        });
    }

    async handle_attachment(e) {
        const file = e.target.files[0];
        if (!file || !this.current_chat_id) return;
        frappe.show_alert({ message: 'Sending file...', indicator: 'blue' });
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.proxy_to_service',
                args: { method: 'POST', path: 'api/whatsapp/send', data: { userId: frappe.session.user, to: this.current_chat_id, message: '', media: { mimetype: file.type, data: reader.result.split(',')[1], filename: file.name } } },
                callback: () => { frappe.show_alert({ message: 'File sent!', indicator: 'green' }); this.fetch_messages(this.current_chat_id); },
                error: () => frappe.show_alert({ message: 'Failed to send file', indicator: 'red' })
            });
        };
    }
}
