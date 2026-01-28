frappe.provide('erpnextwats');

// Cache for DocTypes that have WhatsApp templates
erpnextwats.enabled_doctypes = null;

const add_whatsapp_button = (frm) => {
    // Only add if document is not new and is submitted (docstatus 1)
    if (!frm.is_new() && frm.doc.docstatus === 1) {

        // Function to actually add the button
        const do_add = () => {
            if (erpnextwats.enabled_doctypes && erpnextwats.enabled_doctypes.includes(frm.doctype)) {
                // Remove existing to avoid duplicates on refresh
                frm.remove_custom_button(__('Send via WhatsApp'), __('Actions'));

                frm.add_custom_button(__('Send via WhatsApp'), () => {
                    frappe.call({
                        method: 'erpnextwats.erpnextwats.api.get_templates',
                        args: { doctype: frm.doctype },
                        callback: (r) => {
                            const templates = r.message || [];
                            if (!templates.length) return;

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
                            });
                            dialog.show();
                        }
                    });
                }, __('Actions'));
            }
        };

        // If cache is empty, fetch it first
        if (erpnextwats.enabled_doctypes === null) {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.get_template_doctypes',
                callback: (r) => {
                    erpnextwats.enabled_doctypes = r.message || [];
                    do_add();
                }
            });
        } else {
            do_add();
        }
    }
};

// Global hook for all forms
$(document).on('form_refresh', (e, frm) => {
    add_whatsapp_button(frm);
});
