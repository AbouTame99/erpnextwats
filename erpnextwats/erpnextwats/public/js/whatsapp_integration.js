frappe.ui.form.on('Sales Invoice', {
    refresh: function (frm) {
        if (!frm.is_new() && frm.doc.docstatus === 1) {
            frm.add_custom_button(__('Send via WhatsApp'), function () {
                frappe.call({
                    method: 'erpnextwats.erpnextwats.api.send_whatsapp_on_invoice',
                    args: {
                        docname: frm.doc.name
                    },
                    callback: function (r) {
                        if (r.message && r.message.status === 'success') {
                            frappe.show_alert({
                                message: __('Invoice sent via WhatsApp successfully!'),
                                indicator: 'green'
                            });
                        } else {
                            frappe.msgprint({
                                title: __('WhatsApp Error'),
                                message: r.message ? r.message.message : __('Unknown gateway error'),
                                indicator: 'red'
                            });
                        }
                    }
                });
            }, __('Actions'));
        }
    }
});
