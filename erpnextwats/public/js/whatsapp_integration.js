frappe.provide('erpnextwats');

// Global WhatsApp Integration for ERPNext
frappe.ui.form.on('*', {
    refresh: function(frm) {
        // Skip for new documents or specific excluded doctypes
        if (frm.is_new() || !frm.doc.name) return;
        
        const excluded_doctypes = ['WhatsApp Template', 'WhatsApp Activity Log', 'WhatsApp Bulk History'];
        if (excluded_doctypes.includes(frm.doctype)) return;

        // Add the WhatsApp button if templates exist for this doctype
        erpnextwats.add_whatsapp_button(frm);
    }
});

erpnextwats.add_whatsapp_button = function(frm) {
    // Prevent duplicate buttons
    if (frm.custom_buttons && frm.custom_buttons['WhatsApp']) return;

    // Check if templates exist for this doctype
    frappe.call({
        method: 'erpnextwats.erpnextwats.api.get_templates_for_doctype',
        args: { doctype: frm.doctype },
        callback: function(r) {
            if (r.message && r.message.length > 0) {
                // Add to the main toolbar for visibility
                frm.add_custom_button(__('WhatsApp'), function() {
                    erpnextwats.show_template_selector(frm, r.message);
                }, __('Actions'));
                
                // Also add as a primary button icon if it's a critical doctype
                if (['Sales Invoice', 'Payment Entry', 'Quotation'].includes(frm.doctype)) {
                    frm.page.set_inner_btn_group_help(__('WhatsApp'), __('Quick Send'));
                }
            }
        }
    });
};

erpnextwats.show_template_selector = function(frm, templates) {
    const dialog = new frappe.ui.Dialog({
        title: __('Select WhatsApp Template'),
        fields: [
            {
                label: __('Select Template'),
                fieldname: 'template',
                fieldtype: 'Select',
                options: templates.map(t => ({ label: t.template_name, value: t.name })),
                reqd: 1,
                default: templates.length === 1 ? templates[0].name : null
            },
            {
                label: __('Preview'),
                fieldname: 'preview_html',
                fieldtype: 'HTML'
            }
        ],
        primary_action_label: __('🚀 Send via WhatsApp'),
        primary_action: function(values) {
            const btn = dialog.get_primary_btn();
            btn.prop('disabled', true).text(__('Sending...'));
            
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.send_via_template',
                args: {
                    docname: frm.doc.name,
                    doctype: frm.doctype,
                    template_id: values.template
                },
                callback: function(r) {
                    dialog.hide();
                    if (r.message && r.message.status === 'success') {
                        frappe.show_alert({ 
                            message: __('Message sent successfully!'), 
                            indicator: 'green' 
                        });
                    } else {
                        // Handle errors or missing phone numbers
                        const msg = r.message ? r.message.message : __('Unknown error');
                        frappe.msgprint({
                            title: __('WhatsApp Status'),
                            message: msg,
                            indicator: r.message && r.message.status === 'missing_phone' ? 'orange' : 'red'
                        });
                    }
                },
                error: function() {
                    btn.prop('disabled', false).text(__('🚀 Send via WhatsApp'));
                }
            });
        }
    });

    // Update preview when template changes
    dialog.fields_dict.template.$input.on('change', function() {
        const template_id = dialog.get_value('template');
        const template_doc = templates.find(t => t.name === template_id);
        if (template_doc && template_doc.message) {
            frappe.call({
                method: 'erpnextwats.erpnextwats.api.render_template_preview',
                args: {
                    doctype_name: frm.doctype,
                    message: template_doc.message,
                    docname: frm.doc.name
                },
                callback: function(r) {
                    dialog.set_df_property('preview_html', 'options', `
                        <div class="well mt-2" style="background: #e9f7ef; border-radius: 8px; padding: 12px; font-family: sans-serif; white-space: pre-wrap;">
                            ${r.message}
                        </div>
                    `);
                }
            });
        }
    });

    dialog.show();
    // Trigger initial preview
    dialog.fields_dict.template.$input.trigger('change');
};
