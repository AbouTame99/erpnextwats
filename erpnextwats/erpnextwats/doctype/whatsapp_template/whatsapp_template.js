frappe.ui.form.on('WhatsApp Template', {
    refresh: function (frm) {
        frm.trigger('render_preview');
    },
    message: function (frm) {
        frm.trigger('render_preview');
    },
    preview_doc: function (frm) {
        frm.trigger('render_preview');
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
    preview_dead_stock_btn: function (frm) {
        if (frm.doc.enable_auto_send && frm.doc.auto_send_mode === 'Dead Stock Marketing') {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.preview_dead_stock_items',
                args: {
                    template_name: frm.doc.name
                },
                callback: function (r) {
                    if (r.message && r.message.status === 'success') {
                        const html = `
                            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; font-family: sans-serif;">
                                <h4>Dead Stock Items Preview</h4>
                                <div style="background: #fff; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
                                    <p><strong>Total Items:</strong> ${r.message.total_items}</p>
                                    <p><strong>Total Customers:</strong> ${r.message.total_customers}</p>
                                    <p><strong>Items Per Day:</strong> ${r.message.items_per_day}</p>
                                    <p><strong>Last Sent Index:</strong> ${r.message.last_sent_index || 0}</p>
                                    <p><strong>Cycle Count:</strong> ${r.message.cycle_count || 0}</p>
                                </div>
                                
                                <div style="margin-bottom: 20px;">
                                    <h5>Today's Batch (${r.message.today_batch.length} items)</h5>
                                    <div style="background: #f8f9fa; padding: 10px; border-radius: 3px; max-height: 300px; overflow-y: auto;">
                                        ${r.message.today_batch.map(item => `
                                            <div style="padding: 8px; border-bottom: 1px solid #dee2e6;">
                                                <strong>${item.item_code}</strong> - ${item.item_name}<br>
                                                <small>Qty: ${item.qty}, Days Stagnant: ${item.days_stagnant}, Value: ${item.value}</small>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                                
                                <div style="margin-bottom: 20px;">
                                    <h5>Tomorrow's Batch (${r.message.tomorrow_batch.length} items)</h5>
                                    <div style="background: #f8f9fa; padding: 10px; border-radius: 3px; max-height: 300px; overflow-y: auto;">
                                        ${r.message.tomorrow_batch.map(item => `
                                            <div style="padding: 8px; border-bottom: 1px solid #dee2e6;">
                                                <strong>${item.item_code}</strong> - ${item.item_name}<br>
                                                <small>Qty: ${item.qty}, Days Stagnant: ${item.days_stagnant}, Value: ${item.value}</small>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        `;
                        frm.get_field('dead_stock_preview_html').$wrapper.html(html);
                    } else {
                        frm.get_field('dead_stock_preview_html').$wrapper.html(
                            `<div class="text-danger p-3 text-center">Error: ${r.message.message || 'Failed to load preview'}</div>`
                        );
                    }
                }
            });
        }
    },
        } else {
            frm.get_field('preview_html').$wrapper.html('<div class="text-muted p-3 text-center">Select a Reference Document to see preview</div>');
        }
    }
});
