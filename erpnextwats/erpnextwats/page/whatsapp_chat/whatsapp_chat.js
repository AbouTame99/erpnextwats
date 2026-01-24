console.log('[WhatsApp Chat] Script loaded!');

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
                        <div class="wats-loading" style="text-align: center; padding: 100px;">
                            <div class="spinner-border text-primary" role="status"></div>
                            <p class="text-muted mt-3">Connecting to WhatsApp Gateway...</p>
                        </div>
                        <div class="wats-init setup-screen" style="display:none;">
                            <i class="fa fa-whatsapp main-icon"></i>
                            <h3>WhatsApp Integration</h3>
                            <button class="btn btn-primary btn-lg btn-connect">Start Connection</button>
                        </div>
                        <div class="wats-qr setup-screen" style="display: none;">
                            <h4>Scan with your phone</h4>
                            <div id="qr-image"><div class="spinner-border text-primary"></div></div>
                            <button class="btn btn-sm btn-secondary btn-cancel-qr">Cancel</button>
                        </div>
                        <div class="wats-connected chat-app" style="display: none;">
                            <div class="chat-sidebar">
                                <div class="sidebar-header">
                                    <div class="user-avatar"><i class="fa fa-user"></i></div>
                                    <div class="header-actions"><i class="fa fa-ellipsis-v"></i></div>
                                </div>
                                <div class="sidebar-search">
                                    <div class="search-input-wrapper">
                                        <i class="fa fa-search"></i>
                                        <input type="text" id="sidebar-search-input" placeholder="Search chats or Enter Passcode">
                                    </div>
                                </div>
                                <div class="chat-list" id="chat-list"></div>
                            </div>
                            <div class="chat-main">
                                <div class="chat-welcome">
                                    <div class="welcome-content">
                                        <i class="fa fa-whatsapp"></i>
                                        <h2>Ready to Chat</h2>
                                        <p>Your messages are synced in real-time.</p>
                                    </div>
                                </div>
                                <div class="active-chat" style="display: none;">
                                    <div class="chat-header">
                                        <div class="chat-info">
                                            <div class="chat-avatar"><i class="fa fa-users"></i></div>
                                            <div class="chat-details"><h5 class="chat-target-name"></h5><p>online</p></div>
                                        </div>
                                    </div>
                                    <div class="message-thread" id="message-thread"></div>
                                    <div class="chat-input-area">
                                        <input type="file" id="attachment-input" style="display: none;">
                                        <i class="fa fa-paperclip" id="btn-attach"></i>
                                        <div class="input-wrapper"><input type="text" id="msg-input" placeholder="Type a message"></div>
                                        <i class="fa fa-paper-plane" id="btn-send"></i>
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
            .whatsapp-wrapper { height: calc(100vh - 120px); background: #f0f2f5; padding: 20px; display: flex; justify-content: center; }
            #wats-container { width: 100%; height: 100%; max-width: 1600px; background: white; border-radius: 4px; overflow: hidden; display: flex; flex-direction: column; }
            .setup-screen { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; }
            .main-icon { font-size: 80px; color: #25D366; margin-bottom: 20px; }
            #qr-image { margin: 25px auto; width: 250px; height: 250px; display: flex; align-items: center; justify-content: center; border: 1px solid #ddd; }
            .chat-app { display: flex; height: 100%; width: 100%; }
            .chat-sidebar { width: 30%; border-right: 1px solid #e9edef; display: flex; flex-direction: column; min-width: 300px; }
            .chat-main { flex: 1; display: flex; flex-direction: column; background: #efeae2; }
            .sidebar-header { height: 60px; padding: 10px 16px; background: #f0f2f5; display: flex; justify-content: space-between; align-items: center; }
            .user-avatar { width: 40px; height: 40px; background: #dfe5e7; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
            .sidebar-search { padding: 8px 12px; }
            .search-input-wrapper { background: #f0f2f5; border-radius: 8px; padding: 6px 14px; display: flex; align-items: center; gap: 10px; }
            .search-input-wrapper input { border: none; background: transparent; width: 100%; outline: none; }
            .chat-list { flex: 1; overflow-y: auto; }
            .chat-item { display: flex; padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f5f6f6; }
            .chat-item.active { background: #ebebeb; }
            .chat-item-avatar { width: 48px; height: 48px; background: #dfe5e7; border-radius: 50%; margin-right: 15px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
            .chat-item-content { flex: 1; overflow: hidden; }
            .chat-item-name { font-weight: 500; }
            .chat-item-time { font-size: 11px; color: #667781; float: right; }
            .chat-item-msg { font-size: 13px; color: #667781; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
            .archived-header { padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f5f6f6; display: flex; align-items: center; gap: 10px; font-weight: 500; }
            .active-chat { height: 100%; display: flex; flex-direction: column; }
            .chat-header { height: 60px; padding: 10px 16px; background: #f0f2f5; display: flex; align-items: center; border-left: 1px solid #d1d7db; }
            .chat-info { display: flex; align-items: center; gap: 12px; }
            .message-thread { flex: 1; overflow-y: auto; padding: 20px 7%; display: flex; flex-direction: column; gap: 5px; }
            .message-bubble { max-width: 65%; padding: 8px 12px; border-radius: 8px; font-size: 14px; position: relative; box-shadow: 0 1px 0.5px rgba(0,0,0,0.1); }
            .msg-in { align-self: flex-start; background: #fff; }
            .msg-out { align-self: flex-end; background: #dcf8c6; }
            .msg-meta { font-size: 10px; color: #667781; margin-top: 4px; text-align: right; }
            .chat-input-area { padding: 10px; background: #f0f2f5; display: flex; align-items: center; gap: 10px; }
            .input-wrapper { flex: 1; background: #fff; border-radius: 8px; padding: 8px 12px; }
            .input-wrapper input { border: none; width: 100%; outline: none; }
            .lock-icon { color: #8696a0; margin-right: 5px; }
        `);
    }

    bind_events() {
        this.$container.find('.btn-connect').on('click', () => this.initialize_session());
        this.$container.find('.btn-cancel-qr').on('click', () => this.show_state('init'));
        this.$container.find('#msg-input').on('keypress', (e) => { if (e.which == 13) this.send_selected_message(); });
        this.$container.find('#btn-send').on('click', () => this.send_selected_message());
        this.$container.find('#btn-attach').on('click', () => this.$container.find('#attachment-input').click());
        this.$container.find('#attachment-input').on('change', (e) => this.handle_attachment(e));
        this.$container.find('.sidebar-search input').on('input', (e) => {
            this.current_search_query = $(e.target).val().toLowerCase();
            this.render_chat_list(this.all_chats_ref);
        });

        this.$container.on('click', '.chat-item', (e) => {
            const $item = $(e.currentTarget);
            this.open_chat($item.data('id'), $item.data('name'));
        });

        this.$container.on('contextmenu', '.chat-item', (e) => {
            e.preventDefault();
            const chatId = $(e.currentTarget).data('id');
            const chat = this.all_chats_ref.find(c => c.id === chatId);
            if (!chat) return;
            const menu = [
                { label: chat.archived ? 'Unarchive' : 'Archive', action: () => this.archive_chat(chatId, !chat.archived) },
                { label: chat.lockedPassword ? 'Unlock' : 'Lock with Password', action: () => {
                    if (chat.lockedPassword) this.lock_chat(chatId, null);
                    else {
                        frappe.prompt('Enter passcode to lock:', ({ value }) => {
                            if (value) this.lock_chat(chatId, value);
                        }, 'Privacy Lock', 'password');
                    }
                }}
            ];
            frappe.ui.form.make_menu_from_items(menu, e);
        });
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
            }
        });
    }

    async initialize_session() {
        this.show_state('qr');
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'POST', path: 'api/whatsapp/init', data: { userId: frappe.session.user } },
            callback: () => this.start_polling()
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
        this.$container.find('#qr-image').html(`<img src="${qr}" style="width:100%;">`);
    }

    show_state(s) {
        this.$container.find('.setup-screen, .chat-app, .wats-loading').hide();
        if (s === 'init') this.$container.find('.wats-init').show();
        if (s === 'qr') this.$container.find('.wats-qr').show();
        if (s === 'connected') { this.$container.find('.wats-connected').show(); this.init_socket(); }
    }

    init_socket() {
        if (this.socket || !window.io) return;
        this.socket = io(window.location.protocol+'//'+window.location.hostname+':3000', { transports: ['websocket','polling'] });
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
            callback: (r) => {
                const chats = r.message || [];
                this.all_chats_ref = chats;
                const fp = chats.map(c => `${c.id}:${c.timestamp}:${c.archived}:${c.lockedPassword?'L':''}`).join('|') + `|${this.current_chat_id}|${this.current_search_query}`;
                if (this.last_chats_fp === fp) return;
                this.last_chats_fp = fp;
                this.render_chat_list(chats);
            }
        });
        if (!this.chat_ref_int) this.chat_ref_int = setInterval(() => this.fetch_chats(), 10000);
    }

    render_chat_list(chats) {
        const $list = this.$container.find('#chat-list').empty();
        const search = (this.current_search_query || '').toLowerCase();
        const normal = [], arch = [], locked_match = [];

        chats.forEach(c => {
            const isLocked = c.lockedPassword && c.lockedPassword !== '';
            if (isLocked) {
                if (search && search === c.lockedPassword.toLowerCase()) locked_match.push(c);
                return;
            }
            const match = (c.name||'').toLowerCase().includes(search) || c.id.toLowerCase().includes(search);
            if (search && !match) return;
            if (c.archived) arch.push(c);
            else normal.push(c);
        });

        if (locked_match.length) {
            $list.append('<div class="p-2 text-primary small font-weight-bold" style="background:#f0f2f5;"><i class="fa fa-unlock"></i> Unlocked Secret Chats</div>');
            locked_match.forEach(c => this.render_single_chat(c, $list));
        }

        normal.sort((a,b) => (b.timestamp||0)-(a.timestamp||0)).forEach(c => this.render_single_chat(c, $list));

        if (arch.length) {
            const $h = $(`<div class="archived-header"><i class="fa fa-archive"></i> <span style="flex:1">Archived (${arch.length})</span><i class="fa fa-chevron-${this.archived_expanded?'up':'down'}"></i></div>`).appendTo($list);
            $h.on('click', () => { this.archived_expanded = !this.archived_expanded; this.render_chat_list(chats); });
            if (this.archived_expanded) arch.sort((a,b)=>(b.timestamp||0)-(a.timestamp||0)).forEach(c => this.render_single_chat(c, $list));
        }
    }

    render_single_chat(c, $list) {
        const time = c.timestamp ? new Date(c.timestamp * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
        const active = this.current_chat_id === c.id ? 'active' : '';
        const html = `
            <div class="chat-item ${active}" data-id="${c.id}" data-name="${c.name || c.id}">
                <div class="chat-item-avatar" id="av-${c.id.replace(/[^a-zA-Z0-9]/g,'')}"><i class="fa fa-${c.isGroup?'users':'user'}"></i></div>
                <div class="chat-item-content">
                    <div class="chat-item-top"><span class="chat-item-name">${c.name || c.id.split('@')[0]}</span><span class="chat-item-time">${time}</span></div>
                    <div class="chat-item-bottom"><span class="chat-item-msg">${c.lockedPassword ? '<i class="fa fa-lock lock-icon"></i> Locked' : (c.lastMessage?c.lastMessage.body:'')}</span></div>
                </div>
            </div>
        `;
        const $el = $(html).appendTo($list);
        this.fetch_avatar(c.id, $el.find('.chat-item-avatar'));
    }

    async open_chat(id, name) {
        this.current_chat_id = id;
        this.last_msg_fp = null;
        this.$container.find('.chat-item').removeClass('active');
        this.$container.find(`.chat-item[data-id="${id}"]`).addClass('active');
        this.$container.find('.chat-welcome, .wats-loading').hide();
        this.$container.find('.active-chat').show();
        this.$container.find('.chat-target-name').text(name);
        this.$container.find('#message-thread').empty().html('<div class="text-center p-5"><div class="spinner-border text-muted"></div></div>');
        this.fetch_avatar(id, this.$container.find('.chat-header .chat-avatar'));
        this.fetch_messages(id);
    }

    async fetch_avatar(cid, $el) {
        if (!this.av_cache) this.av_cache = {};
        if (this.av_cache[cid]) { if (this.av_cache[cid]!=='loading' && this.av_cache[cid]!=='none') $el.html(`<img src="${this.av_cache[cid]}" style="width:100%;">`); return; }
        this.av_cache[cid] = 'loading';
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'GET', path: `api/whatsapp/profile-pic/${encodeURIComponent(frappe.session.user)}/${encodeURIComponent(cid)}` },
            callback: (r) => { this.av_cache[cid] = (r.message && r.message.url) ? r.message.url : 'none'; if (this.av_cache[cid]!=='none') $el.html(`<img src="${this.av_cache[cid]}" style="width:100%;">`); }
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
        if (this.msg_ref_timeout) clearTimeout(this.msg_ref_timeout);
        this.msg_ref_timeout = setTimeout(() => { if (this.current_chat_id === cid) this.fetch_messages(cid); }, 5000);
    }

    render_messages(msgs) {
        const $t = this.$container.find('#message-thread');
        const scroll = $t[0].scrollHeight - $t[0].scrollTop <= $t[0].clientHeight + 50;
        $t.empty();
        msgs.forEach(m => {
            const time = new Date(m.timestamp * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            $t.append(`<div class="message-bubble ${m.fromMe?'msg-out':'msg-in'}">${m.body}<div class="msg-meta">${time}</div></div>`);
        });
        if (scroll) $t.scrollTop($t[0].scrollHeight);
    }

    async archive_chat(chatId, archive) {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'POST', path: 'api/whatsapp/archive', data: { userId: frappe.session.user, chatId, archive } },
            callback: () => { frappe.show_alert(archive ? 'Chat Archived' : 'Chat Unarchived'); this.fetch_chats(); }
        });
    }

    async lock_chat(chatId, password) {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'POST', path: 'api/whatsapp/lock', data: { userId: frappe.session.user, chatId, password } },
            callback: () => { frappe.show_alert(password ? 'Chat Locked' : 'Chat Unlocked'); this.fetch_chats(); }
        });
    }

    async send_selected_message() {
        const $i = this.$container.find('#msg-input');
        const text = $i.val();
        if (!text || !this.current_chat_id) return;
        $i.val('');
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.proxy_to_service',
            args: { method: 'POST', path: 'api/whatsapp/send', data: { userId: frappe.session.user, to: this.current_chat_id, message: text } },
            callback: () => this.fetch_messages(this.current_chat_id)
        });
    }

    async handle_attachment(e) {
        const file = e.target.files[0];
        if (!file || !this.current_chat_id) return;
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.proxy_to_service',
                args: { method: 'POST', path: 'api/whatsapp/send', data: { userId: frappe.session.user, to: this.current_chat_id, message: '', media: { mimetype: file.type, data: reader.result.split(',')[1], filename: file.name } } },
                callback: () => this.fetch_messages(this.current_chat_id)
            });
        };
    }
}
