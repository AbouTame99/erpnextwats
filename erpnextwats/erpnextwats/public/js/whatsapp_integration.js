frappe.provide('erpnextwats');

const add_whatsapp_button = (frm) => {
    if (!frm.is_new() && frm.doc.docstatus === 1) {
        frm.add_custom_button(__('Send via WhatsApp'), () => {
            // 1. Fetch available templates for this DocType
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.get_templates',
                args: { doctype: frm.doctype },
                callback: (r) => {
                    const templates = r.message || [];
                    if (!templates.length) {
                        frappe.msgprint({
                            title: __('No Templates'),
                            message: __('Please create a WhatsApp Template for {0} first.', [frm.doctype]),
                            indicator: 'orange'
                        });
                        return;
                    }

                    // 2. Open dialog to select template and verify phone
                    const dialog = new frappe.ui.Dialog({
                        title: __('Send {0} via WhatsApp', [frm.doctype]),
                        fields: [
                            {
                                label: __('Select Template'),
                                fieldname: 'template_id',
                                fieldtype: 'Select',
                                options: templates.map(t => ({ label: t.template_name, value: t.name })),
                                reqd: 1
                            },
                            {
                                label: __('Phone Number'),
                                fieldname: 'phone',
                                fieldtype: 'Data',
                                description: __('Enter number if missing (with country code, e.g. 2126...)'),
                                default: frm.doc.mobile_no || frm.doc.phone || ''
                            }
                        ],
                        primary_action_label: __('Send Now'),
                        primary_action(data) {
                            frappe.show_alert({ message: __('Sending WhatsApp...'), indicator: 'blue' });
                            frappe.call({
                                method: 'erpnextwats.erpnextwats.api.send_via_template',
                                args: {
                                    docname: frm.doc.name,
                                    doctype: frm.doctype,
                                    template_id: data.template_id,
                                    phone: data.phone
                                },
                                callback: (r) => {
                                    if (r.message && r.message.status === 'success') {
                                        frappe.show_alert({ message: __('Message sent!'), indicator: 'green' });
                                        dialog.hide();
                                    } else if (r.message && r.message.status === 'missing_phone') {
                                        frappe.msgprint({
                                            title: __('Missing Phone'),
                                            message: __('Please enter a valid phone number in the dialog.'),
                                            indicator: 'red'
                                        });
                                    } else {
                                        frappe.msgprint({
                                            title: __('Gateway Error'),
                                            message: r.message ? r.message.message : __('Unknown error'),
                                            indicator: 'red'
                                        });
                                    }
                                }
                            });
                        }
                    });

                    dialog.show();
                }
            });
        }, __('Actions'));
    }
};

// Generic trigger for common DocTypes
frappe.ui.form.on('Sales Invoice', { refresh: add_whatsapp_button });
frappe.ui.form.on('Purchase Invoice', { refresh: add_whatsapp_button });
frappe.ui.form.on('Sales Order', { refresh: add_whatsapp_button });
frappe.ui.form.on('Purchase Order', { refresh: add_whatsapp_button });
