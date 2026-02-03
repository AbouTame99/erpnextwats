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
            });
        } else {
            frm.get_field('preview_html').$wrapper.html('<div class="text-muted p-3 text-center">Select a Reference Document to see preview</div>');
        }
    }
});
