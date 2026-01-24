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
        this.prepare_layout();
        console.log('[WhatsApp Chat] Layout prepared, checking status...');
        this.check_status();
    }

    prepare_layout() {
        this.page.main.html(`
			<div class="whatsapp-wrapper">
				<div id="wats-container">
                    <!-- Setup Screen -->
					<div class="wats-init setup-screen">
						<i class="fa fa-whatsapp main-icon"></i>
						<h3>WhatsApp Integration</h3>
						<p class="text-muted">Connect your personal WhatsApp to use it from your desk.</p>
						<button class="btn btn-primary btn-lg btn-connect">Start Connection</button>
					</div>

                    <!-- QR Screen -->
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

                    <!-- Main Chat Interface (Clone) -->
					<div class="wats-connected chat-app" style="display: none;">
                        <div class="chat-sidebar">
                            <div class="sidebar-header">
                                <div class="user-avatar"><i class="fa fa-user"></i></div>
                                <div class="header-actions">
                                    <i class="fa fa-circle-o-notch"></i>
                                    <i class="fa fa-commenting"></i>
                                    <i class="fa fa-ellipsis-v"></i>
                                </div>
                            </div>
                            <div class="sidebar-search">
                                <div class="search-input-wrapper">
                                    <i class="fa fa-search"></i>
                                    <input type="text" placeholder="Search or start new chat">
                                </div>
                            </div>
                            <div class="chat-list" id="chat-list">
                                <!-- Chats rendered here -->
                            </div>
                        </div>
                        <div class="chat-main">
                            <div class="chat-welcome">
                                <div class="welcome-content">
                                    <i class="fa fa-whatsapp"></i>
                                    <h2>WhatsApp Web Clone</h2>
                                    <p>Send and receive messages without keeping your phone online.<br>Use WhatsApp on up to 4 linked devices at the same time.</p>
                                    <div class="footer-note"><i class="fa fa-lock"></i> End-to-end encrypted</div>
                                </div>
                            </div>
                            
                            <div class="active-chat" style="display: none;">
                                <div class="chat-header">
                                    <div class="chat-info">
                                        <div class="chat-avatar"><i class="fa fa-users"></i></div>
                                        <div class="chat-details">
                                            <h5 class="chat-target-name">Contact Name</h5>
                                            <p class="chat-target-status">online</p>
                                        </div>
                                    </div>
                                    <div class="header-actions">
                                        <i class="fa fa-search"></i>
                                        <i class="fa fa-ellipsis-v"></i>
                                    </div>
                                </div>
                                <div class="message-thread" id="message-thread">
                                    <!-- Messages rendered here -->
                                </div>
                                <div class="chat-input-area">
                                    <i class="fa fa-smile-o"></i>
                                    <i class="fa fa-paperclip"></i>
                                    <div class="input-wrapper">
                                        <input type="text" id="msg-input" placeholder="Type a message">
                                    </div>
                                    <i class="fa fa-microphone" id="btn-send"></i>
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
    }

    inject_styles() {
        frappe.dom.set_style(`
            .whatsapp-wrapper {
                height: calc(100vh - 120px);
                background: #f0f2f5;
                padding: 20px;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            #wats-container {
                width: 100%;
                height: 100%;
                max-width: 1600px;
                background: white;
                box-shadow: 0 6px 18px rgba(0,0,0,0.06);
                border-radius: 4px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            .setup-screen {
                flex: 1;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                text-align: center;
                padding: 40px;
            }
            .main-icon { font-size: 80px; color: #25D366; margin-bottom: 20px; }
            #qr-image { margin: 25px auto; width: 250px; height: 250px; background: #eee; display: flex; align-items: center; justify-content: center; border: 1px solid #ddd; }
            #qr-image img { width: 100%; }
            
            /* Chat Interface Styles */
            .chat-app { display: flex; height: 100%; width: 100%; background: #fff; }
            .chat-sidebar { width: 30%; border-right: 1px solid #e9edef; display: flex; flex-direction: column; background: #fff; min-width: 300px; }
            .chat-main { flex: 1; display: flex; flex-direction: column; background: #efeae2; position: relative; }
            
            .sidebar-header { height: 60px; padding: 10px 16px; background: #f0f2f5; display: flex; justify-content: space-between; align-items: center; }
            .user-avatar { width: 40px; height: 40px; background: #dfe5e7; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #54656f; font-size: 20px; }
            .header-actions { display: flex; gap: 20px; color: #54656f; font-size: 18px; cursor: pointer; }
            
            .sidebar-search { padding: 8px 12px; background: #fff; }
            .search-input-wrapper { background: #f0f2f5; border-radius: 8px; padding: 6px 14px; display: flex; align-items: center; gap: 10px; }
            .search-input-wrapper input { border: none; background: transparent; width: 100%; outline: none; font-size: 14px; }
            .search-input-wrapper i { color: #54656f; font-size: 13px; }
            
            .chat-list { flex: 1; overflow-y: auto; }
            .chat-item { display: flex; padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f5f6f6; transition: background 0.2s; }
            .chat-item:hover { background: #f5f6f6; }
            .chat-item.active { background: #ebebeb; }
            .chat-item-avatar { width: 48px; height: 48px; background: #dfe5e7; border-radius: 50%; margin-right: 15px; display: flex; align-items: center; justify-content: center; position: relative; flex-shrink: 0; }
            .chat-item-content { flex: 1; overflow: hidden; border-bottom: 1px solid #e9edef; padding-bottom: 8px; }
            .chat-item-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
            .chat-item-name { font-weight: 500; color: #111b21; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .chat-item-time { font-size: 12px; color: #667781; }
            .chat-item-bottom { display: flex; justify-content: space-between; align-items: center; }
            .chat-item-msg { font-size: 14px; color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            
            .chat-welcome { flex: 1; display: flex; align-items: center; justify-content: center; background: #f0f2f5; border-bottom: 6px solid #25D366; }
            .welcome-content { text-align: center; max-width: 500px; color: #41525d; }
            .welcome-content i { font-size: 100px; color: #cedae0; margin-bottom: 20px; }
            .welcome-content h2 { font-weight: 300; margin-bottom: 10px; color: #41525d; }
            .welcome-content p { font-size: 14px; line-height: 20px; color: #667781; }
            .footer-note { margin-top: 40px; font-size: 13px; color: #8696a0; }
            
            .active-chat { height: 100%; display: flex; flex-direction: column; }
            .chat-header { height: 60px; padding: 10px 16px; background: #f0f2f5; display: flex; justify-content: space-between; align-items: center; border-left: 1px solid #d1d7db; }
            .chat-info { display: flex; align-items: center; gap: 12px; }
            .chat-avatar { width: 40px; height: 40px; background: #dfe5e7; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
            .chat-details h5 { margin: 0; font-size: 16px; font-weight: 500; }
            .chat-details p { margin: 0; font-size: 12px; color: #667781; }
            
            .message-thread { flex: 1; overflow-y: auto; padding: 20px 7%; display: flex; flex-direction: column; gap: 2px; }
            .message-bubble { max-width: 65%; padding: 6px 10px 8px; border-radius: 8px; font-size: 14px; position: relative; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); margin-bottom: 4px; }
            .msg-in { align-self: flex-start; background: #fff; border-top-left-radius: 0; }
            .msg-out { align-self: flex-end; background: #dcf8c6; border-top-right-radius: 0; }
            .msg-meta { display: flex; justify-content: flex-end; align-items: center; gap: 4px; margin-top: 2px; font-size: 11px; color: #667781; }
            
            .chat-input-area { padding: 5px 10px; background: #f0f2f5; display: flex; align-items: center; gap: 15px; min-height: 62px; }
            .chat-input-area i { color: #54656f; font-size: 24px; cursor: pointer; }
            .input-wrapper { flex: 1; background: #fff; border-radius: 8px; padding: 9px 12px; }
            .input-wrapper input { border: none; width: 100%; outline: none; font-size: 15px; }
        `);
    }

    bind_events() {
        this.$container.find('.btn-connect').on('click', () => this.initialize_session());
        this.$container.find('.btn-disconnect').on('click', () => this.disconnect_session());
        this.$container.find('.btn-cancel-qr').on('click', () => {
            if (this.poll_interval) clearInterval(this.poll_interval);
            if (this.timer_interval) clearInterval(this.timer_interval);
            this.show_state('init');
        });

        // Chat Input events
        this.$container.find('#msg-input').on('keypress', (e) => {
            if (e.which == 13) {
                this.send_selected_message();
            }
        });
        this.$container.find('#btn-send').on('click', () => this.send_selected_message());
    }

    async check_status() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'GET',
                path: `api/whatsapp/status/${encodeURIComponent(frappe.session.user)}`
            },
            callback: (r) => {
                const data = r.message || {};
                if (data.status === 'ready') {
                    this.show_state('connected');
                    this.fetch_chats();
                } else if (data.status === 'qr_ready') {
                    if (data.qr) this.render_qr(data.qr);
                    this.show_state('qr');
                    this.start_polling();
                } else if (data.status === 'initializing' || data.status === 'connecting' || data.status === 'authenticated') {
                    this.show_state('qr');
                    this.start_polling();
                } else {
                    this.show_state('init');
                }
            },
            error: () => this.show_state('init')
        });
    }

    async initialize_session() {
        if (this.poll_interval) clearInterval(this.poll_interval);
        this.show_state('qr');
        this.$container.find('#qr-image').html('<div class="spinner-border text-primary" role="status"></div>');

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'POST',
                path: 'api/whatsapp/init',
                data: { userId: frappe.session.user }
            },
            callback: (r) => {
                const data = r.message || {};
                if (data.status === 'initializing' || data.status === 'qr_ready') {
                    this.start_polling();
                }
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
                    path: `api/whatsapp/status/${encodeURIComponent(frappe.session.user)}`
                },
                callback: (r) => {
                    const data = r.message || {};
                    if (data.status === 'qr_ready' && data.qr) {
                        this.render_qr(data.qr);
                    } else if (data.status === 'ready') {
                        clearInterval(this.poll_interval);
                        if (this.timer_interval) clearInterval(this.timer_interval);
                        this.show_state('connected');
                        this.fetch_chats();
                    } else if (data.status === 'authenticated' || data.status === 'connecting') {
                        if (this.timer_interval) clearInterval(this.timer_interval);
                        this.$container.find('.qr-timer-wrapper').hide();
                        this.$container.find('.status-text').text('Authenticated! Syncing your chats...');
                        this.$container.find('#qr-image').html('<div class="spinner-border text-primary" role="status"></div>');
                    }
                }
            });
        }, 3000);
    }

    render_qr(qrData) {
        if (this.last_qr === qrData) return;
        this.last_qr = qrData;
        this.$container.find('#qr-image').html(`<img src="${qrData}">`);
        this.start_qr_timer();
    }

    start_qr_timer() {
        if (this.timer_interval) clearInterval(this.timer_interval);

        let timeLeft = 60; // Standard WA QR expiry is around 60s
        const $timer = this.$container.find('.qr-countdown');
        const $wrapper = this.$container.find('.qr-timer-wrapper');

        $wrapper.show();
        $timer.text(timeLeft);

        this.timer_interval = setInterval(() => {
            timeLeft--;
            $timer.text(timeLeft);

            if (timeLeft <= 0) {
                clearInterval(this.timer_interval);
                $timer.text('Refresing...');
            }
        }, 1000);
    }

    show_state(state) {
        this.$container.find('.setup-screen, .chat-app').hide();
        if (state === 'init') this.$container.find('.wats-init').show();
        if (state === 'qr') this.$container.find('.wats-qr').show();
        if (state === 'connected') this.$container.find('.wats-connected').show();
    }

    async disconnect_session() {
        frappe.confirm('Are you sure you want to disconnect?', () => {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.proxy_to_service',
                args: {
                    method: 'POST',
                    path: 'api/whatsapp/disconnect',
                    data: { userId: frappe.session.user }
                },
                callback: () => this.show_state('init')
            });
        });
    }

    async fetch_chats() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'GET',
                path: `api/whatsapp/chats/${encodeURIComponent(frappe.session.user)}`
            },
            callback: (r) => {
                const chats = r.message || [];
                this.render_chat_list(chats);
            }
        });

        // Refresh chats every 10 seconds
        if (!this.chat_refresh_interval) {
            this.chat_refresh_interval = setInterval(() => this.fetch_chats(), 10000);
        }
    }

    render_chat_list(chats) {
        const $list = this.$container.find('#chat-list');
        const activeId = this.current_chat_id;
        $list.empty();

        chats.sort((a, b) => b.timestamp - a.timestamp).forEach(chat => {
            const time = chat.timestamp ? new Date(chat.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const lastMsg = chat.lastMessage ? chat.lastMessage.body : 'No messages';
            const isActive = activeId === chat.id ? 'active' : '';

            const html = `
                <div class="chat-item ${isActive}" data-id="${chat.id}" data-name="${chat.name}">
                    <div class="chat-item-avatar"><i class="fa fa-${chat.isGroup ? 'users' : 'user'}"></i></div>
                    <div class="chat-item-content">
                        <div class="chat-item-top">
                            <span class="chat-item-name">${chat.name || chat.id.split('@')[0]}</span>
                            <span class="chat-item-time">${time}</span>
                        </div>
                        <div class="chat-item-bottom">
                            <span class="chat-item-msg">${lastMsg}</span>
                            ${chat.unreadCount > 0 ? `<span class="badge badge-pill badge-success">${chat.unreadCount}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
            const $item = $(html).appendTo($list);
            $item.on('click', () => this.open_chat(chat.id, chat.name));
        });
    }

    async open_chat(chatId, chatName) {
        this.current_chat_id = chatId;
        this.$container.find('.chat-item').removeClass('active');
        this.$container.find(`.chat-item[data-id="${chatId}"]`).addClass('active');

        this.$container.find('.chat-welcome').hide();
        this.$container.find('.active-chat').show();
        this.$container.find('.chat-target-name').text(chatName);

        this.fetch_messages(chatId);
    }

    async fetch_messages(chatId) {
        if (this.current_chat_id !== chatId) return;

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'GET',
                path: `api/whatsapp/messages/${encodeURIComponent(frappe.session.user)}/${encodeURIComponent(chatId)}`
            },
            callback: (r) => {
                const messages = r.message || [];
                this.render_messages(messages);
            }
        });

        // Polling for messages in active chat
        if (this.msg_refresh_interval) clearInterval(this.msg_refresh_interval);
        this.msg_refresh_interval = setInterval(() => {
            if (this.current_chat_id) this.fetch_messages(this.current_chat_id);
        }, 4000);
    }

    render_messages(messages) {
        const $thread = this.$container.find('#message-thread');
        const oldScrollHeight = $thread[0].scrollHeight;
        const oldScrollTop = $thread[0].scrollTop;
        const isAtBottom = oldScrollHeight - oldScrollTop <= $thread[0].clientHeight + 50;

        $thread.empty();
        messages.forEach(msg => {
            const time = new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dirClass = msg.fromMe ? 'msg-out' : 'msg-in';

            const html = `
                <div class="message-bubble ${dirClass}">
                    <div class="msg-body">${msg.body}</div>
                    <div class="msg-meta">
                        <span class="msg-time">${time}</span>
                        ${msg.fromMe ? '<i class="fa fa-check"></i>' : ''}
                    </div>
                </div>
            `;
            $thread.append(html);
        });

        if (isAtBottom) {
            $thread.scrollTop($thread[0].scrollHeight);
        }
    }

    async send_selected_message() {
        const $input = this.$container.find('#msg-input');
        const text = $input.val();
        const chatId = this.current_chat_id;
        if (!text || !chatId) return;

        $input.val('');

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: {
                method: 'POST',
                path: 'api/whatsapp/send',
                data: {
                    userId: frappe.session.user,
                    to: chatId,
                    message: text
                }
            },
            callback: (r) => {
                this.fetch_messages(chatId);
            }
        });
    }
}
