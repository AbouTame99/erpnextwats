frappe.provide('erpnextwats');

frappe.pages['bulk-whatsapp'].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Bulk WhatsApp Messages',
        single_column: true
    });

    new erpnextwats.BulkWhatsApp(page);
}

erpnextwats.BulkWhatsApp = class {
    constructor(page) {
        this.page = page;
        this.currentHistoryName = null;
        this.pollingInterval = null;
        this.prepare_layout();
        this.loadHistory();
        this.checkActiveJobs();
    }

    prepare_layout() {
        this.page.main.html(`
            <div class="bulk-whatsapp-wrapper" style="padding: 20px;">
                <!-- SEND FORM -->
                <div class="card" style="max-width: 1000px; margin: 0 auto; margin-bottom: 20px;">
                    <div class="card-body">
                        <h4><i class="fa fa-whatsapp" style="color: #25D366;"></i> Send Bulk WhatsApp Messages</h4>
                        <p class="text-muted">Anti-ban protected: Smart delays 10-60s, 3 retries per customer, real-time tracking</p>
                        
                        <form id="bulk-whatsapp-form">
                            <div class="form-group">
                                <label>Select Template</label>
                                <select class="form-control" id="template-select" required></select>
                            </div>
                            
                            <div class="form-group">
                                <label>Send To</label>
                                <select class="form-control" id="send-to-type" required>
                                    <option value="customers">Selected Customers</option>
                                    <option value="doctype">By DocType (with filters)</option>
                                </select>
                            </div>
                            
                            <div class="form-group" id="customers-selection-group">
                                <label>Select Customers</label>
                                <div class="link-selector" id="customers-selector">
                                    <button type="button" class="btn btn-sm btn-default" id="select-customers-btn">
                                        <i class="fa fa-plus"></i> Add Customers
                                    </button>
                                    <div id="selected-customers-list" class="mt-2" style="min-height: 30px;"></div>
                                </div>
                                <small class="text-muted">Click to select customers from list</small>
                            </div>
                            
                            <div class="form-group" id="doctype-selection-group" style="display: none;">
                                <label>Source DocType</label>
                                <select class="form-control" id="doctype-select">
                                    <option value="">Select...</option>
                                    <option value="Customer">Customer</option>
                                    <option value="Sales Invoice">Sales Invoice</option>
                                    <option value="Sales Order">Sales Order</option>
                                    <option value="Lead">Lead</option>
                                </select>
                            </div>
                            
                            <div class="form-group" id="filters-group" style="display: none;">
                                <label>Filters (JSON)</label>
                                <textarea class="form-control" id="filters-json" rows="4" 
                                    placeholder='{"status": "Active", "customer_group": "Individual"}'></textarea>
                                <small class="text-muted">Leave empty to send to all records</small>
                            </div>
                            
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Max Messages Per Hour</label>
                                        <input type="number" class="form-control" id="max-per-hour" value="50" min="20" max="100">
                                        <small class="text-muted">Recommended: 50 (max 1000/day)</small>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="alert alert-info">
                                <strong><i class="fa fa-shield"></i> Anti-Ban Protection:</strong>
                                <ul class="mb-0" style="padding-left: 20px;">
                                    <li><strong>Smart Delays:</strong> 10-60 second random delays (adaptive based on failure rate)</li>
                                    <li><strong>Hard Retry:</strong> 3 attempts per customer before moving to next</li>
                                    <li><strong>Phone Validation:</strong> Automatic formatting and validation</li>
                                    <li><strong>Gateway Check:</strong> Validates WhatsApp session before starting</li>
                                    <li><strong>Hourly Limit:</strong> Respects max per hour setting</li>
                                    <li><strong>Daily Limit:</strong> Max 1000 messages per day</li>
                                </ul>
                            </div>
                            
                            <button type="submit" class="btn btn-primary btn-lg" style="background: #25D366; border: none;">
                                <i class="fa fa-paper-plane"></i> Start Bulk Send
                            </button>
                        </form>
                    </div>
                </div>
                
                <!-- LIVE PROGRESS SECTION -->
                <div id="live-progress-section" class="card" style="max-width: 1000px; margin: 0 auto; margin-bottom: 20px; display: none;">
                    <div class="card-body">
                        <h5 style="display: flex; align-items: center; justify-content: space-between;">
                            <span><i class="fa fa-spinner fa-spin"></i> Live Progress</span>
                            <button id="stop-bulk-send-btn" class="btn btn-xs btn-danger" style="display: none;">
                                <i class="fa fa-stop"></i> Stop
                            </button>
                        </h5>
                        <div class="progress" style="height: 30px; margin-bottom: 15px;">
                            <div id="progress-bar" class="progress-bar progress-bar-striped active" role="progressbar" style="width: 0%; background-color: #25D366;">
                                <span id="progress-text-bar">0%</span>
                            </div>
                        </div>
                        <div class="row" style="margin-bottom: 15px;">
                            <div class="col-md-3 text-center">
                                <div class="badge badge-primary" style="font-size: 14px; padding: 8px;">
                                    Total: <span id="stat-total">0</span>
                                </div>
                            </div>
                            <div class="col-md-3 text-center">
                                <div class="badge badge-success" style="font-size: 14px; padding: 8px;">
                                    Sent: <span id="stat-sent">0</span>
                                </div>
                            </div>
                            <div class="col-md-3 text-center">
                                <div class="badge badge-danger" style="font-size: 14px; padding: 8px;">
                                    Failed: <span id="stat-failed">0</span>
                                </div>
                            </div>
                            <div class="col-md-3 text-center">
                                <div class="badge badge-warning" style="font-size: 14px; padding: 8px;">
                                    Skipped: <span id="stat-skipped">0</span>
                                </div>
                            </div>
                        </div>
                        <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                            <table class="table table-sm table-bordered">
                                <thead style="position: sticky; top: 0; background: white;">
                                    <tr>
                                        <th>#</th>
                                        <th>Customer</th>
                                        <th>Phone</th>
                                        <th>Status</th>
                                        <th>Attempts</th>
                                        <th>Error/Reason</th>
                                    </tr>
                                </thead>
                                <tbody id="progress-table-body">
                                    <!-- Filled dynamically -->
                                </tbody>
                            </table>
                        </div>
                        <p class="text-muted mt-2">
                            <i class="fa fa-info-circle"></i> 
                            Auto-updating every 3 seconds. You can close this page - the job continues in background.
                        </p>
                    </div>
                </div>
                
                <!-- HISTORY SECTION -->
                <div class="card" style="max-width: 1000px; margin: 0 auto;">
                    <div class="card-body">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <h5><i class="fa fa-history"></i> Bulk Send History</h5>
                            <button type="button" class="btn btn-sm btn-default" id="refresh-history-btn">
                                <i class="fa fa-refresh"></i> Refresh
                            </button>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm table-hover">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Template</th>
                                        <th>DocType</th>
                                        <th>Total</th>
                                        <th>Sent</th>
                                        <th>Failed</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="history-table-body">
                                    <tr>
                                        <td colspan="8" class="text-center text-muted">Loading history...</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `);

        this.bind_events();
        this.load_templates('Customer');
    }

    bind_events() {
        const self = this;
        this.selected_customers = [];
        
        // Toggle between customers and doctype selection
        this.page.main.find('#send-to-type').on('change', function() {
            if ($(this).val() === 'customers') {
                self.page.main.find('#customers-selection-group').show();
                self.page.main.find('#doctype-selection-group').hide();
                self.page.main.find('#filters-group').hide();
                self.load_all_templates();
            } else {
                self.page.main.find('#customers-selection-group').hide();
                self.page.main.find('#doctype-selection-group').show();
                self.page.main.find('#filters-group').show();
                const doctype = self.page.main.find('#doctype-select').val();
                if (doctype) {
                    self.load_templates(doctype);
                }
            }
        });
        
        // Load templates when doctype changes
        this.page.main.find('#doctype-select').on('change', function() {
            self.load_templates($(this).val());
        });
        
        // Customer selection button
        this.page.main.find('#select-customers-btn').on('click', function() {
            self.select_customers();
        });
        
        // Handle form submit
        this.page.main.find('#bulk-whatsapp-form').on('submit', function(e) {
            e.preventDefault();
            self.start_bulk_send();
        });
        
        // Refresh history button
        this.page.main.find('#refresh-history-btn').on('click', function() {
            self.loadHistory();
        });

        // Stop bulk send button
        this.page.main.find('#stop-bulk-send-btn').on('click', function() {
            self.stopBulkSend(self.currentHistoryName);
        });
    }
    
    select_customers() {
        const self = this;
        let all_customers = [];
        let filtered_customers = [];
        let selected_in_dialog = [...this.selected_customers];
        
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Customer',
                filters: {'disabled': 0},
                fields: ['name', 'customer_name'],
                limit_page_length: 0
            },
            callback: function(r) {
                all_customers = r.message || [];
                filtered_customers = all_customers;
                show_customer_dialog();
            }
        });
        
        function show_customer_dialog() {
            const dialog = new frappe.ui.Dialog({
                title: __('Select Customers'),
                fields: [
                    {
                        fieldname: 'search_customer',
                        fieldtype: 'Data',
                        label: __('Search'),
                        placeholder: __('Type to search customers...')
                    },
                    {
                        fieldname: 'customers_list',
                        fieldtype: 'HTML',
                        options: ''
                    }
                ],
                primary_action_label: __('Add Selected'),
                primary_action: function() {
                    selected_in_dialog.forEach(cust => {
                        if (!self.selected_customers.includes(cust)) {
                            self.selected_customers.push(cust);
                        }
                    });
                    self.update_customers_display();
                    dialog.hide();
                }
            });
            
            function render_customer_list(customers) {
                let html = `
                    <div style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; margin-top: 10px;">
                        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
                            <button type="button" class="btn btn-sm btn-default select-all-btn" style="margin-right: 5px;">
                                <i class="fa fa-check-square"></i> Select All
                            </button>
                            <button type="button" class="btn btn-sm btn-default unselect-all-btn">
                                <i class="fa fa-square"></i> Unselect All
                            </button>
                            <span class="text-muted" style="margin-left: 10px;">
                                ${customers.length} customers
                            </span>
                        </div>
                        <div class="customer-checkbox-list">
                `;
                
                customers.forEach(cust => {
                    const is_checked = selected_in_dialog.includes(cust.name) ? 'checked' : '';
                    html += `
                        <div class="customer-item" style="padding: 8px; border-bottom: 1px solid #f0f0f0;">
                            <label style="margin: 0; cursor: pointer; display: flex; align-items: center;">
                                <input type="checkbox" class="customer-checkbox" 
                                    value="${cust.name}" ${is_checked} 
                                    style="margin-right: 10px;">
                                <div>
                                    <strong>${cust.customer_name || cust.name}</strong>
                                    <br><small class="text-muted">${cust.name}</small>
                                </div>
                            </label>
                        </div>
                    `;
                });
                
                html += `
                        </div>
                    </div>
                `;
                
                dialog.fields_dict.customers_list.$wrapper.html(html);
                
                dialog.$wrapper.find('.customer-checkbox').on('change', function() {
                    const customer = $(this).val();
                    if ($(this).is(':checked')) {
                        if (!selected_in_dialog.includes(customer)) {
                            selected_in_dialog.push(customer);
                        }
                    } else {
                        selected_in_dialog = selected_in_dialog.filter(c => c !== customer);
                    }
                    update_selection_count();
                });
                
                dialog.$wrapper.find('.select-all-btn').on('click', function() {
                    filtered_customers.forEach(cust => {
                        if (!selected_in_dialog.includes(cust.name)) {
                            selected_in_dialog.push(cust.name);
                        }
                    });
                    dialog.$wrapper.find('.customer-checkbox').prop('checked', true);
                    update_selection_count();
                });
                
                dialog.$wrapper.find('.unselect-all-btn').on('click', function() {
                    filtered_customers.forEach(cust => {
                        selected_in_dialog = selected_in_dialog.filter(c => c !== cust.name);
                    });
                    dialog.$wrapper.find('.customer-checkbox').prop('checked', false);
                    update_selection_count();
                });
                
                function update_selection_count() {
                    const count = selected_in_dialog.length;
                    dialog.$wrapper.find('.select-all-btn').next().next().text(`${count} selected`);
                }
                
                update_selection_count();
            }
            
            render_customer_list(filtered_customers);
            
            dialog.fields_dict.search_customer.$input.on('input', function() {
                const search_term = $(this).val().toLowerCase();
                if (search_term) {
                    filtered_customers = all_customers.filter(cust => {
                        const name = (cust.customer_name || '').toLowerCase();
                        const code = (cust.name || '').toLowerCase();
                        return name.includes(search_term) || code.includes(search_term);
                    });
                } else {
                    filtered_customers = all_customers;
                }
                render_customer_list(filtered_customers);
            });
            
            dialog.show();
        }
    }
    
    update_customers_display() {
        const container = this.page.main.find('#selected-customers-list');
        container.empty();
        
        if (this.selected_customers.length === 0) {
            container.html('<span class="text-muted">No customers selected</span>');
            return;
        }
        
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Customer',
                filters: {'name': ['in', this.selected_customers]},
                fields: ['name', 'customer_name']
            },
            callback: (r) => {
                const customers = r.message || [];
                let html = '<div class="selected-items">';
                customers.forEach(cust => {
                    html += `
                        <span class="badge badge-primary" style="margin: 2px; padding: 5px 10px; font-size: 12px;">
                            ${cust.customer_name || cust.name}
                            <button type="button" class="btn-remove-customer" data-customer="${cust.name}" 
                                style="background: none; border: none; color: white; margin-left: 5px; cursor: pointer;">×</button>
                        </span>
                    `;
                });
                html += '</div>';
                container.html(html);
                
                container.find('.btn-remove-customer').on('click', function() {
                    const customer = $(this).data('customer');
                    self.selected_customers = self.selected_customers.filter(c => c !== customer);
                    self.update_customers_display();
                });
            }
        });
    }

    load_templates(doctype = null) {
        if (!doctype) {
            doctype = this.page.main.find('#doctype-select').val();
        }
        
        if (!doctype) return;

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.get_templates',
            args: { doctype: doctype },
            callback: (r) => {
                const templates = r.message || [];
                const select = this.page.main.find('#template-select');
                select.empty();
                
                if (templates.length === 0) {
                    select.append('<option value="">No templates found</option>');
                } else {
                    select.append('<option value="">Select template...</option>');
                    templates.forEach(t => {
                        const display_name = t.template_name || t.name;
                        select.append(`<option value="${t.name}" data-doctype="${t.doctype || ''}">${display_name}</option>`);
                    });
                }
            }
        });
    }
    
    load_all_templates() {
        const common_doctypes = ['Customer', 'Sales Invoice', 'Sales Order'];
        const all_templates = [];
        let loaded = 0;
        
        common_doctypes.forEach(doctype => {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.get_templates',
                args: { doctype: doctype },
                callback: (r) => {
                    const templates = r.message || [];
                    templates.forEach(t => {
                        t.doctype = doctype;
                        all_templates.push(t);
                    });
                    loaded++;
                    
                    if (loaded === common_doctypes.length) {
                        const select = this.page.main.find('#template-select');
                        select.empty();
                        
                        if (all_templates.length === 0) {
                            select.append('<option value="">No templates found</option>');
                        } else {
                            select.append('<option value="">Select template...</option>');
                            all_templates.forEach(t => {
                                const display_name = t.template_name || t.name;
                                select.append(`<option value="${t.name}" data-doctype="${t.doctype}">${display_name} (${t.doctype})</option>`);
                            });
                        }
                    }
                }
            });
        });
    }

    start_bulk_send() {
        const template_id = this.page.main.find('#template-select').val();
        const send_to_type = this.page.main.find('#send-to-type').val();
        const max_per_hour = parseInt(this.page.main.find('#max-per-hour').val()) || 50;

        if (!template_id) {
            frappe.msgprint('Please select a template');
            return;
        }

        let filters = {};
        let doctype = null;

        if (send_to_type === 'customers') {
            if (!this.selected_customers || this.selected_customers.length === 0) {
                frappe.msgprint('Please select at least one customer');
                return;
            }
            const selected_option = this.page.main.find('#template-select option:selected');
            doctype = selected_option.data('doctype') || 'Customer';
        } else {
            doctype = this.page.main.find('#doctype-select').val();
            if (!doctype) {
                frappe.msgprint('Please select a doctype');
                return;
            }
            
            const filters_json = this.page.main.find('#filters-json').val();
            if (filters_json) {
                try {
                    filters = frappe.parse_json(filters_json);
                } catch (e) {
                    frappe.msgprint('Invalid JSON in filters');
                    return;
                }
            }
        }

        frappe.show_alert({
            message: 'Validating WhatsApp session and starting bulk send...',
            indicator: 'blue'
        });

        const args = {
            template_id: template_id,
            doctype: doctype,
            max_per_hour: max_per_hour
        };
        
        if (send_to_type === 'customers') {
            args.customer_list = this.selected_customers;
        } else {
            args.filters = filters;
        }

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.send_bulk_messages',
            args: args,
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert({
                        message: r.message.message,
                        indicator: 'green'
                    });
                    
                    // Start monitoring this job
                    this.currentHistoryName = r.message.history_name;
                    this.showLiveProgress();
                    this.startPolling();
                    this.loadHistory();
                } else {
                    frappe.msgprint({
                        title: 'Error',
                        message: r.message ? r.message.message : 'Unknown error',
                        indicator: 'red'
                    });
                }
            }
        });
    }

    showLiveProgress() {
        this.page.main.find('#live-progress-section').show();
        $('html, body').animate({
            scrollTop: this.page.main.find('#live-progress-section').offset().top - 100
        }, 500);
    }

    startPolling() {
        // Clear any existing interval
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
        
        // Poll every 3 seconds
        this.pollingInterval = setInterval(() => {
            this.updateProgress();
        }, 3000);
        
        // Initial update
        this.updateProgress();
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    updateProgress() {
        if (!this.currentHistoryName) return;
        
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.get_bulk_progress',
            args: { history_name: this.currentHistoryName },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    this.renderProgress(r.message);

                    // If completed/failed/stalled/cancelled, stop polling
                    if (['Completed', 'Failed', 'Stalled', 'Cancelled'].includes(r.message.job_status)) {
                        this.stopPolling();
                        this.loadHistory();
                    }
                }
            }
        });
    }

    renderProgress(data) {
        const total = data.total || 0;
        const sent = data.sent || 0;
        const failed = data.failed || 0;
        const skipped = data.skipped || 0;
        const processed = sent + failed + skipped;
        const jobStatus = data.job_status || 'Processing';
        
        // Update stats
        this.page.main.find('#stat-total').text(total);
        this.page.main.find('#stat-sent').text(sent);
        this.page.main.find('#stat-failed').text(failed);
        this.page.main.find('#stat-skipped').text(skipped);
        
        // Update progress bar
        const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
        this.page.main.find('#progress-bar').css('width', percent + '%');
        this.page.main.find('#progress-text-bar').text(percent + '%');

        // Stop button only makes sense while the job can still be interrupted
        this.page.main.find('#stop-bulk-send-btn').toggle(['Processing', 'Paused'].includes(jobStatus));

        // Handle PAUSED status
        if (jobStatus === 'Paused') {
            this.page.main.find('#live-progress-section .card-body h5 span').html(
                `<i class="fa fa-pause-circle" style="color: #f0ad4e;"></i> PAUSED - Hourly Limit Reached`
            );
            
            // Show resume time if available
            const resumesAt = data.resumes_at || data.completed_at;
            if (resumesAt) {
                const resumeTime = frappe.datetime.str_to_user(resumesAt);
                const remaining = data.remaining || (total - processed);
                
                let pauseMsg = `
                    <div class="alert alert-warning" style="margin-top: 10px;">
                        <i class="fa fa-clock-o"></i> 
                        <strong>Hourly limit reached!</strong><br>
                        Resume at: <strong>${resumeTime}</strong><br>
                        Remaining customers: <strong>${remaining}</strong><br>
                        <small>This job will automatically continue. You can close this page.</small>
                    </div>
                `;
                
                // Add pause message if not already there
                if (this.page.main.find('#pause-message').length === 0) {
                    this.page.main.find('#live-progress-section .card-body').append(
                        `<div id="pause-message">${pauseMsg}</div>`
                    );
                }
            }
            
            // Stop polling but keep checking every 30 seconds
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = setInterval(() => {
                    this.updateProgress();
                }, 30000); // Check every 30 seconds while paused
            }
        } else if (jobStatus === 'Stalled') {
            this.page.main.find('#live-progress-section .card-body h5 span').html(
                `<i class="fa fa-exclamation-triangle" style="color: #d9534f;"></i> STALLED - No Progress Detected`
            );

            if (this.page.main.find('#pause-message').length === 0) {
                const self = this;
                const rawMsg = data.error_message || 'The background worker appears to have crashed or restarted mid-job.';
                const errMsg = $('<div>').text(rawMsg).html();
                const $msg = $(`
                    <div id="pause-message" class="alert alert-danger" style="margin-top: 10px;">
                        <i class="fa fa-exclamation-triangle"></i>
                        <strong>Job stalled!</strong><br>
                        ${errMsg}<br>
                        <button type="button" class="btn btn-sm btn-warning" id="resume-stalled-btn" style="margin-top: 8px;">
                            <i class="fa fa-play"></i> Resume Stalled Job
                        </button>
                    </div>
                `);
                this.page.main.find('#live-progress-section .card-body').append($msg);
                $msg.find('#resume-stalled-btn').on('click', function() {
                    self.resumeStalledJob(self.currentHistoryName);
                });
            }

            this.stopPolling();
        } else if (jobStatus === 'Cancelled') {
            this.page.main.find('#live-progress-section .card-body h5 span').html(
                `<i class="fa fa-stop-circle" style="color: #777;"></i> STOPPED BY USER`
            );

            if (this.page.main.find('#pause-message').length === 0) {
                const rawMsg = data.error_message || 'This bulk send was stopped before all customers were contacted.';
                const errMsg = $('<div>').text(rawMsg).html();
                this.page.main.find('#live-progress-section .card-body').append(`
                    <div id="pause-message" class="alert alert-secondary" style="margin-top: 10px;">
                        <i class="fa fa-stop-circle"></i>
                        <strong>Job stopped.</strong><br>
                        ${errMsg}
                    </div>
                `);
            }

            this.stopPolling();
        } else if (jobStatus === 'Processing') {
            // Reset to normal processing view
            const lastUpdate = data.seconds_since_update;
            let heartbeatNote = '';
            if (lastUpdate !== null && lastUpdate !== undefined) {
                heartbeatNote = lastUpdate > 120
                    ? ` <small style="color:#f0ad4e;">(last update ${lastUpdate}s ago - may be in an anti-ban delay)</small>`
                    : ` <small class="text-muted">(updated ${lastUpdate}s ago)</small>`;
            }
            this.page.main.find('#live-progress-section .card-body h5 span').html(
                `<i class="fa fa-spinner fa-spin"></i> Live Progress${heartbeatNote}`
            );
            this.page.main.find('#pause-message').remove();

            // Reset to normal polling speed
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = setInterval(() => {
                    this.updateProgress();
                }, 3000);
            }
        }

        // Update table
        const details = data.details || [];
        let html = '';
        
        details.forEach((item, index) => {
            const statusClass = {
                'Sent': 'success',
                'Failed': 'danger',
                'Skipped': 'warning',
                'Pending': 'info'
            }[item.status] || 'default';
            
            const statusIcon = {
                'Sent': '<i class="fa fa-check"></i>',
                'Failed': '<i class="fa fa-times"></i>',
                'Skipped': '<i class="fa fa-ban"></i>',
                'Pending': '<i class="fa fa-clock-o"></i>'
            }[item.status] || '';
            
            html += `
                <tr class="${item.status === 'Failed' ? 'danger' : ''}">
                    <td>${index + 1}</td>
                    <td>${item.customer_name || item.doc_name}</td>
                    <td>${item.phone || '-'}</td>
                    <td>
                        <span class="label label-${statusClass}">
                            ${statusIcon} ${item.status}
                        </span>
                    </td>
                    <td>${item.attempts || 0}/3</td>
                    <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">
                        ${item.error || '-'}
                    </td>
                </tr>
            `;
        });
        
        if (details.length === 0) {
            html = '<tr><td colspan="6" class="text-center text-muted">Waiting for first update...</td></tr>';
        }
        
        this.page.main.find('#progress-table-body').html(html);
    }

    stopBulkSend(historyName) {
        if (!historyName) return;

        frappe.confirm(
            __('Stop this bulk send? Messages already sent will not be undone, but no further customers will be contacted.'),
            () => {
                const self = this;
                this.page.main.find('#stop-bulk-send-btn').prop('disabled', true).text(__('Stopping...'));
                frappe.call({
                    method: 'erpnextwats.erpnextwats.api.stop_bulk_send',
                    args: { history_name: historyName },
                    callback: (r) => {
                        this.page.main.find('#stop-bulk-send-btn').prop('disabled', false).html('<i class="fa fa-stop"></i> Stop');
                        if (r.message && r.message.status === 'success') {
                            frappe.show_alert({ message: r.message.message, indicator: 'orange' });
                            self.updateProgress();
                            self.loadHistory();
                        } else {
                            frappe.msgprint({
                                title: __('Error'),
                                message: r.message ? r.message.message : __('Unknown error'),
                                indicator: 'red'
                            });
                        }
                    }
                });
            }
        );
    }

    resumeStalledJob(historyName) {
        frappe.show_alert({ message: 'Resuming stalled job...', indicator: 'blue' });
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.resume_stalled_bulk_job',
            args: { history_name: historyName },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    frappe.show_alert({ message: r.message.message, indicator: 'green' });
                    this.page.main.find('#pause-message').remove();
                    this.startPolling();
                    this.loadHistory();
                } else {
                    frappe.msgprint({
                        title: 'Error',
                        message: r.message ? r.message.message : 'Unknown error',
                        indicator: 'red'
                    });
                }
            }
        });
    }

    loadHistory() {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.get_bulk_history',
            args: { limit: 50 },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    this.renderHistory(r.message.history);
                }
            }
        });
    }

    renderHistory(historyList) {
        let html = '';
        
        if (historyList.length === 0) {
            html = '<tr><td colspan="8" class="text-center text-muted">No bulk sends yet</td></tr>';
        } else {
            historyList.forEach(item => {
                const statusClass = {
                    'Queued': 'default',
                    'Processing': 'primary',
                    'Paused': 'warning',
                    'Stalled': 'danger',
                    'Completed': 'success',
                    'Failed': 'danger',
                    'Cancelled': 'default'
                }[item.status] || 'default';

                const statusIcon = {
                    'Queued': '',
                    'Processing': '<i class="fa fa-spinner fa-spin"></i> ',
                    'Paused': '<i class="fa fa-pause"></i> ',
                    'Stalled': '<i class="fa fa-exclamation-triangle"></i> ',
                    'Completed': '',
                    'Failed': '',
                    'Cancelled': '<i class="fa fa-stop-circle"></i> '
                }[item.status] || '';

                const date = item.started_at ? frappe.datetime.str_to_user(item.started_at) : '-';
                const progress = item.total_recipients > 0
                    ? Math.round(((item.sent_count + item.failed_count + item.skipped_count) / item.total_recipients) * 100)
                    : 0;

                // For paused/stalled jobs, show progress
                let statusText = item.status;
                if (item.status === 'Paused') {
                    statusText = `Paused (${progress}%)`;
                } else if (item.status === 'Processing') {
                    statusText = `Processing (${progress}%)`;
                } else if (item.status === 'Stalled') {
                    statusText = `Stalled (${progress}%)`;
                }

                const resumeBtn = (item.status === 'Stalled' || item.status === 'Failed')
                    ? `<button class="btn btn-xs btn-warning resume-stalled-history-btn" data-name="${item.name}" style="margin-left: 4px;">
                            <i class="fa fa-play"></i> Resume
                        </button>`
                    : '';

                html += `
                    <tr class="${item.status === 'Paused' ? 'warning' : (item.status === 'Stalled' ? 'danger' : '')}">
                        <td>${date}</td>
                        <td>${item.template}</td>
                        <td>${item.target_doctype}</td>
                        <td>${item.total_recipients}</td>
                        <td><span class="text-success">${item.sent_count}</span></td>
                        <td><span class="text-danger">${item.failed_count}</span></td>
                        <td>
                            <span class="label label-${statusClass}">
                                ${statusIcon}${statusText}
                            </span>
                        </td>
                        <td>
                            <button class="btn btn-xs btn-default view-details-btn" data-name="${item.name}">
                                <i class="fa fa-eye"></i> Details
                            </button>
                            ${resumeBtn}
                        </td>
                    </tr>
                `;
            });
        }
        
        this.page.main.find('#history-table-body').html(html);
        
        // Bind detail buttons
        const self = this;
        this.page.main.find('.view-details-btn').on('click', function() {
            const historyName = $(this).data('name');
            self.viewHistoryDetails(historyName);
        });

        this.page.main.find('.resume-stalled-history-btn').on('click', function() {
            const historyName = $(this).data('name');
            self.currentHistoryName = historyName;
            self.showLiveProgress();
            self.resumeStalledJob(historyName);
        });
    }

    viewHistoryDetails(historyName) {
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.get_bulk_progress',
            args: { history_name: historyName },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    this.showDetailsDialog(historyName, r.message);
                }
            }
        });
    }

    showDetailsDialog(historyName, data) {
        const details = data.details || [];
        
        let html = `
            <div style="max-height: 500px; overflow-y: auto;">
                <div style="margin-bottom: 15px;">
                    <strong>Status:</strong> <span class="label label-${data.job_status === 'Completed' ? 'success' : data.job_status === 'Failed' ? 'danger' : 'primary'}">${data.job_status}</span>
                    <br><strong>Total:</strong> ${data.total} | <strong>Sent:</strong> ${data.sent} | <strong>Failed:</strong> ${data.failed} | <strong>Skipped:</strong> ${data.skipped}
                </div>
                <table class="table table-sm table-bordered">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Customer</th>
                            <th>Phone</th>
                            <th>Status</th>
                            <th>Attempts</th>
                            <th>Error</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        details.forEach((item, index) => {
            const statusClass = {
                'Sent': 'success',
                'Failed': 'danger',
                'Skipped': 'warning'
            }[item.status] || 'default';
            
            html += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${item.customer_name || item.doc_name}</td>
                    <td>${item.phone || '-'}</td>
                    <td><span class="label label-${statusClass}">${item.status}</span></td>
                    <td>${item.attempts || 0}/3</td>
                    <td>${item.error || '-'}</td>
                </tr>
            `;
        });
        
        if (details.length === 0) {
            html += '<tr><td colspan="6" class="text-center text-muted">No details available</td></tr>';
        }
        
        html += '</tbody></table></div>';
        
        const dialog = new frappe.ui.Dialog({
            title: __('Bulk Send Details: ') + historyName,
            fields: [
                {
                    fieldname: 'details_html',
                    fieldtype: 'HTML',
                    options: html
                }
            ],
            primary_action_label: __('Close'),
            primary_action: function() {
                dialog.hide();
            }
        });
        
        dialog.show();
    }

    checkActiveJobs() {
        // Check if there are any Processing jobs and start monitoring them
        frappe.call({
            method: 'erpnextwats.erpnextwats.api.get_bulk_history',
            args: { limit: 5 },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    const activeJob = r.message.history.find(h => h.status === 'Processing');
                    if (activeJob) {
                        this.currentHistoryName = activeJob.name;
                        this.showLiveProgress();
                        this.startPolling();
                        frappe.show_alert({
                            message: `Resuming monitoring of active job: ${activeJob.name}`,
                            indicator: 'blue'
                        });
                    }
                }
            }
        });
    }
}
