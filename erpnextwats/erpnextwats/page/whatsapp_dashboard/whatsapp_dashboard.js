frappe.provide('erpnextwats');

frappe.pages['whatsapp-dashboard'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'WhatsApp Dashboard',
        single_column: false
    });

    new erpnextwats.WhatsAppDashboard(page);
}

erpnextwats.WhatsAppDashboard = class {
    constructor(page) {
        this.page = page;
        this.setup_page();
        this.load_stats();
        this.load_recent_logs();
        this.start_auto_refresh();
    }

    setup_page() {
        // Add refresh button
        this.page.add_button('Refresh', () => {
            this.load_stats();
            this.load_recent_logs();
        }, { icon: 'refresh' });

        // Add filters
        this.page.add_field({
            fieldtype: 'Select',
            fieldname: 'category_filter',
            label: 'Category',
            options: ['All', 'Bulk', 'Auto Send', 'Template', 'Session', 'Message', 'Gateway', 'System'],
            change: () => {
                this.load_recent_logs();
            }
        });

        this.page.add_field({
            fieldtype: 'Select',
            fieldname: 'status_filter',
            label: 'Status',
            options: ['All', 'Success', 'Failed', 'Warning', 'Error', 'Info'],
            change: () => {
                this.load_recent_logs();
            }
        });

        // Main layout
        this.page.main.html(`
            <div class="whatsapp-dashboard" style="padding: 20px;">
                <!-- Stats Cards -->
                <div class="row" style="margin-bottom: 20px;">
                    <div class="col-md-2 col-sm-6">
                        <div class="card" style="background: #e8f5e9; border-left: 4px solid #4caf50;">
                            <div class="card-body" style="padding: 15px;">
                                <h6 style="margin: 0; color: #666; font-size: 12px;">Today's Messages</h6>
                                <h3 style="margin: 5px 0; color: #4caf50;" id="stat-total">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-2 col-sm-6">
                        <div class="card" style="background: #e3f2fd; border-left: 4px solid #2196f3;">
                            <div class="card-body" style="padding: 15px;">
                                <h6 style="margin: 0; color: #666; font-size: 12px;">Success Rate</h6>
                                <h3 style="margin: 5px 0; color: #2196f3;" id="stat-success-rate">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-2 col-sm-6">
                        <div class="card" style="background: #fff3e0; border-left: 4px solid #ff9800;">
                            <div class="card-body" style="padding: 15px;">
                                <h6 style="margin: 0; color: #666; font-size: 12px;">Failed</h6>
                                <h3 style="margin: 5px 0; color: #ff9800;" id="stat-failed">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-2 col-sm-6">
                        <div class="card" style="background: #fce4ec; border-left: 4px solid #f44336;">
                            <div class="card-body" style="padding: 15px;">
                                <h6 style="margin: 0; color: #666; font-size: 12px;">Errors</h6>
                                <h3 style="margin: 5px 0; color: #f44336;" id="stat-errors">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-2 col-sm-6">
                        <div class="card" style="background: #f3e5f5; border-left: 4px solid #9c27b0;">
                            <div class="card-body" style="padding: 15px;">
                                <h6 style="margin: 0; color: #666; font-size: 12px;">Bulk Sends</h6>
                                <h3 style="margin: 5px 0; color: #9c27b0;" id="stat-bulk">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-2 col-sm-6">
                        <div class="card" style="background: #e0f2f1; border-left: 4px solid #009688;">
                            <div class="card-body" style="padding: 15px;">
                                <h6 style="margin: 0; color: #666; font-size: 12px;">Session Status</h6>
                                <h3 style="margin: 5px 0; color: #009688;" id="stat-session">-</h3>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Recent Errors Alert -->
                <div id="errors-alert" style="display: none;" class="alert alert-danger">
                    <strong><i class="fa fa-exclamation-triangle"></i> Recent Errors:</strong>
                    <span id="errors-count"></span> errors in the last 24 hours.
                    <a href="#" onclick="frappe.set_route('List', 'WhatsApp Activity Log', {'status': 'Error'}); return false;">View all errors</a>
                </div>

                <!-- Activity Table -->
                <div class="card">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h5 style="margin: 0;"><i class="fa fa-list"></i> Recent Activity</h5>
                        <span class="text-muted" style="font-size: 12px;">Auto-refreshes every 30 seconds</span>
                    </div>
                    <div class="card-body" style="padding: 0;">
                        <div class="table-responsive">
                            <table class="table table-hover" style="margin: 0;">
                                <thead style="background: #f5f5f5;">
                                    <tr>
                                        <th style="width: 150px;">Time</th>
                                        <th style="width: 120px;">Type</th>
                                        <th style="width: 100px;">Status</th>
                                        <th style="width: 150px;">User</th>
                                        <th>Details</th>
                                        <th style="width: 100px;">Duration</th>
                                    </tr>
                                </thead>
                                <tbody id="activity-table-body">
                                    <tr>
                                        <td colspan="6" class="text-center text-muted" style="padding: 30px;">
                                            <i class="fa fa-spinner fa-spin"></i> Loading...
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- View All Link -->
                <div style="margin-top: 15px; text-align: center;">
                    <a href="/app/whatsapp-activity-log" class="btn btn-default">
                        <i class="fa fa-external-link"></i> View All Logs
                    </a>
                </div>
            </div>
        `);
    }

    load_stats() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.get_whatsapp_dashboard_stats',
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    const data = r.message;
                    
                    // Update stats
                    $('#stat-total').text(data.today.messages || 0);
                    $('#stat-failed').text(data.today.failed || 0);
                    $('#stat-errors').text(data.today.errors || 0);
                    $('#stat-bulk').text(data.today.bulk_sends || 0);
                    
                    // Success rate
                    const total = data.today.total || 0;
                    const success = data.today.success || 0;
                    const rate = total > 0 ? Math.round((success / total) * 100) : 0;
                    $('#stat-success-rate').text(rate + '%');
                    
                    // Session status
                    const session = data.latest_session;
                    if (session) {
                        const status = session.status === 'ready' ? 'Connected' : 
                                      session.status === 'disconnected' ? 'Disconnected' : session.status;
                        $('#stat-session').text(status);
                    } else {
                        $('#stat-session').text('Unknown');
                    }
                    
                    // Show errors alert if there are recent errors
                    if (data.recent_errors && data.recent_errors.length > 0) {
                        $('#errors-alert').show();
                        $('#errors-count').text(data.recent_errors.length);
                    } else {
                        $('#errors-alert').hide();
                    }
                }
            }
        });
    }

    load_recent_logs() {
        const category = this.page.fields_dict.category_filter.get_value();
        const status = this.page.fields_dict.status_filter.get_value();
        
        const filters = {};
        if (category && category !== 'All') {
            filters.activity_category = category;
        }
        if (status && status !== 'All') {
            filters.status = status;
        }
        
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.get_whatsapp_logs',
            args: {
                limit: 50,
                ...filters
            },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    this.render_logs(r.message.logs);
                }
            }
        });
    }

    render_logs(logs) {
        const $tbody = $('#activity-table-body');
        
        if (!logs || logs.length === 0) {
            $tbody.html('<tr><td colspan="6" class="text-center text-muted" style="padding: 30px;">No activity found</td></tr>');
            return;
        }
        
        let html = '';
        logs.forEach(log => {
            const statusClass = {
                'Success': 'success',
                'Failed': 'danger',
                'Warning': 'warning',
                'Error': 'danger',
                'Info': 'info'
            }[log.status] || 'default';
            
            const time = frappe.datetime.str_to_user(log.activity_timestamp);
            const duration = log.duration_ms ? `${log.duration_ms}ms` : '-';
            const details = log.customer || log.template || log.reference_name || '-';
            
            html += `
                <tr>
                    <td style="font-size: 12px;">${time}</td>
                    <td><span class="badge badge-${statusClass}">${log.activity_type}</span></td>
                    <td><span class="label label-${statusClass}">${log.status}</span></td>
                    <td style="font-size: 12px;">${log.user_name || log.user || '-'}</td>
                    <td style="font-size: 12px;">${details}</td>
                    <td style="font-size: 12px;">${duration}</td>
                </tr>
            `;
        });
        
        $tbody.html(html);
    }

    start_auto_refresh() {
        // Refresh every 30 seconds
        setInterval(() => {
            this.load_stats();
            this.load_recent_logs();
        }, 30000);
    }
}
