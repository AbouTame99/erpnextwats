frappe.ui.form.on('WhatsApp Template', {
    refresh: function (frm) {
        frm.trigger('render_preview');
        frm.trigger('setup_status_multiselect');

        // If it's dead stock, show preview button
        if (frm.doc.auto_send_mode === 'Dead Stock Marketing') {
            frm.trigger('preview_dead_stock_btn');
        }

        // Add Manual Run buttons
        if (frm.doc.enable_auto_send) {
            if (frm.doc.auto_send_mode === 'Monitor Documents') {
                frm.add_custom_button(__('Run Monitor Check Now'), function () {
                    frappe.call({
                        method: 'erpnextwats.erpnextwats.api.run_monitor_check_now',
                        args: { template_name: frm.doc.name },
                        callback: function (r) {
                            if (r.message && r.message.status === 'success') {
                                frappe.show_alert({
                                    message: __('Monitor check started in the background'),
                                    indicator: 'green'
                                });
                            }
                        }
                    });
                }).addClass('btn-primary');
            } else if (frm.doc.auto_send_mode === 'Dead Stock Marketing') {
                frm.add_custom_button(__('Run Dead Stock Campaign Now'), function () {
                    frappe.confirm(__('Start Dead Stock campaign now for all customers?'), function () {
                        frappe.call({
                            method: 'erpnextwats.erpnextwats.api.run_dead_stock_campaign_now',
                            args: { template_name: frm.doc.name },
                            callback: function (r) {
                                if (r.message && r.message.status === 'success') {
                                    frappe.show_alert({
                                        message: __('Dead stock campaign started in background'),
                                        indicator: 'green'
                                    });
                                }
                            }
                        });
                    });
                }).addClass('btn-primary');
            }
        }
    },

    doctype_name: function (frm) {
        frm.trigger('setup_status_multiselect');
    },

    setup_status_multiselect: function (frm) {
        if (!frm.doc.doctype_name) return;

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.get_doctype_statuses',
            args: { doctype: frm.doc.doctype_name },
            callback: function (r) {
                if (r.message) {
                    frm.set_df_property('trigger_status', 'fieldtype', 'MultiSelect');
                    frm.set_df_property('trigger_status', 'options', r.message.join('\n'));
                    frm.refresh_field('trigger_status');
                }
            }
        });
    },

    message: function (frm) {
        frm.trigger('render_preview');
    },

    preview_doc: function (frm) {
        frm.trigger('render_preview');
    },

    auto_send_mode: function (frm) {
        if (frm.doc.auto_send_mode === 'Dead Stock Marketing') {
            frm.trigger('preview_dead_stock_btn');
        }
    },

    render_preview: function (frm) {
        if (frm.doc.message && frm.doc.doctype_name && frm.doc.preview_doc) {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.render_template_preview',
                args: {
                    doctype_name: frm.doc.doctype_name,
                    message: frm.doc.message,
                    docname: frm.doc.preview_doc
                },
                callback: function (r) {
                    if (r.message) {
                        const html = `
                            <div style="background: #e5ddd5; padding: 20px; border-radius: 8px; font-family: sans-serif; position: relative;">
                                <div style="background: #fff; padding: 8px 12px; border-radius: 8px; display: inline-block; max-width: 85%; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); position: relative; margin-bottom: 2px;">
                                    <div style="font-size: 14px; color: #111b21; white-space: pre-wrap; line-height: 1.4;">${r.message}</div>
                                    <div style="font-size: 11px; color: #667781; text-align: right; margin-top: 4px;">${frappe.datetime.now_time()}</div>
                                </div>
                            </div>
                        `;
                        frm.get_field('preview_html').$wrapper.html(html);
                    }
                }
            });
        } else {
            frm.get_field('preview_html').$wrapper.html('<div class="text-muted p-3 text-center">Select a Reference Document to see preview</div>');
        }
    },

    preview_dead_stock_btn: function (frm) {
        if (frm.doc.enable_auto_send && frm.doc.auto_send_mode === 'Dead Stock Marketing') {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.preview_dead_stock_items',
                args: {
                    template_name: frm.doc.name
                },
                callback: function (r) {
                    if (r && r.message && r.message.status === 'success') {
                        const html = `
                            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; font-family: sans-serif;">
                                <h4>Dead Stock Items Preview</h4>
                                <div style="background: #fff; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
                                    <p><strong>Total Items in Pool:</strong> ${r.message.total_items}</p>
                                    <p><strong>Total Customers:</strong> ${r.message.total_customers}</p>
                                    <p><strong>Items Per Day:</strong> ${r.message.items_per_day}</p>
                                    <p><strong>Next Start Index:</strong> ${r.message.last_sent_index || 0}</p>
                                    <p><strong>Full Cycles Completed:</strong> ${r.message.cycle_count || 0}</p>
                                </div>
                                
                                <div style="margin-bottom: 20px;">
                                    <h5>Today's Batch (${r.message.today_batch.length} items)</h5>
                                    <div style="background: #fff; border: 1px solid #dee2e6; padding: 10px; border-radius: 3px; max-height: 250px; overflow-y: auto;">
                                        ${r.message.today_batch.map(item => {
                            const val = item.value || 0;
                            const val_formatted = val > 0 ? frappe.format(val, { fieldtype: 'Currency' }) : "Free/Zero Value";
                            return `
                                                <div style="padding: 8px; border-bottom: 1px solid #eee;">
                                                    <div style="font-weight: bold; color: #1a73e8;">${item.item_code}</div>
                                                    <div style="font-size: 0.9em;">${item.item_name}</div>
                                                    <div style="font-size: 0.8em; color: #666;">
                                                        Qty: ${item.qty} | Value: ${val_formatted} | Stagnant: ${item.days_stagnant} days
                                                    </div>
                                                </div>
                                            `;
                        }).join('')}
                                    </div>
                                </div>
                                
                                <div>
                                    <h5>Tomorrow's Batch (${r.message.tomorrow_batch.length} items)</h5>
                                    <div style="background: #fff; border: 1px solid #dee2e6; padding: 10px; border-radius: 3px; max-height: 250px; overflow-y: auto;">
                                        ${r.message.tomorrow_batch.map(item => `
                                            <div style="padding: 8px; border-bottom: 1px solid #eee;">
                                                <div style="font-weight: bold; color: #5f6368;">${item.item_code}</div>
                                                <div style="font-size: 0.9em;">${item.item_name}</div>
                                                <div style="font-size: 0.8em; color: #666;">
                                                    Qty: ${item.qty} | Stagnant: ${item.days_stagnant} days
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        `;
                        frm.get_field('dead_stock_preview_html').$wrapper.html(html);
                    } else {
                        const error = (r && r.message && r.message.message) || 'Failed to load preview';
                        frm.get_field('dead_stock_preview_html').$wrapper.html(
                            `<div class="text-danger p-3 text-center">Error: ${error}</div>`
                        );
                    }
                }
            });
        }
    }
});
