frappe.provide('erpnextwats');

/**
 * Visual Condition Builder for WhatsApp Templates
 * Allows users to build conditions without writing JSON
 */
erpnextwats.VisualConditionBuilder = class {
    constructor(wrapper, fieldname) {
        this.wrapper = wrapper;
        this.fieldname = fieldname;
        this.conditions = {operator: 'AND', rules: []};
        this.init();
    }

    init() {
        this.make();
        this.bind_events();
    }

    make() {
        this.wrapper.html(`
            <div class="visual-condition-builder">
                <div class="vcb-rules-container">
                    <!-- Rules will be added here -->
                </div>
                <div class="vcb-toolbar">
                    <button class="btn btn-xs btn-default vcb-add-rule">
                        <i class="fa fa-plus"></i> Add Condition
                    </button>
                    <button class="btn btn-xs btn-default vcb-add-group" style="display:none;">
                        <i class="fa fa-folder"></i> Add Group
                    </button>
                </div>
                <div class="vcb-preview mt-3" style="display:none;">
                    <div class="alert alert-info">
                        <strong>Preview:</strong> <span class="vcb-match-count">0</span> documents match
                        <button class="btn btn-xs btn-primary vcb-preview-btn pull-right">Preview Documents</button>
                    </div>
                </div>
            </div>
        `);

        this.$container = this.wrapper.find('.vcb-rules-container');
        this.$preview = this.wrapper.find('.vcb-preview');
    }

    bind_events() {
        const self = this;

        // Add rule
        this.wrapper.find('.vcb-add-rule').on('click', () => {
            this.add_rule();
        });

        // Preview
        this.wrapper.find('.vcb-preview-btn').on('click', () => {
            this.preview_matching_docs();
        });

        // Remove rule
        this.wrapper.on('click', '.vcb-remove-rule', function() {
            $(this).closest('.vcb-rule').remove();
            self.update_json();
        });

        // Field/operator/value change
        this.wrapper.on('change', '.vcb-field, .vcb-operator, .vcb-value', () => {
            this.update_json();
        });
    }

    add_rule(data = {}) {
        const rule_html = `
            <div class="vcb-rule form-inline" style="margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                <select class="form-control vcb-field input-sm" style="width: 150px; margin-right: 5px;">
                    <option value="">Select Field...</option>
                    ${this.get_field_options()}
                </select>
                
                <select class="form-control vcb-operator input-sm" style="width: 100px; margin-right: 5px;">
                    <option value="=">=</option>
                    <option value="!=">!=</option>
                    <option value=">">></option>
                    <option value="<"><</option>
                    <option value=">=">>=</option>
                    <option value="<="><=</option>
                </select>
                
                <input type="text" class="form-control vcb-value input-sm" style="width: 150px; margin-right: 5px;" 
                    placeholder="Value">
                
                <button class="btn btn-xs btn-danger vcb-remove-rule" title="Remove">
                    <i class="fa fa-times"></i>
                </button>
            </div>
        `;

        this.$container.append(rule_html);
        
        if (data.field) {
            const $rule = this.$container.find('.vcb-rule').last();
            $rule.find('.vcb-field').val(data.field);
            $rule.find('.vcb-operator').val(data.operator || '=');
            $rule.find('.vcb-value').val(data.value);
        }

        this.update_json();
    }

    get_field_options() {
        // Common fields for most doctypes
        const common_fields = [
            {value: 'status', label: 'Status'},
            {value: 'docstatus', label: 'Document Status'},
            {value: 'creation', label: 'Created Date'},
            {value: 'modified', label: 'Modified Date'},
            {value: 'owner', label: 'Owner'},
            // Sales Invoice specific
            {value: 'outstanding_amount', label: 'Outstanding Amount'},
            {value: 'grand_total', label: 'Grand Total'},
            {value: 'due_date', label: 'Due Date'},
            {value: 'is_paid', label: 'Is Paid'},
            {value: 'customer', label: 'Customer'},
            // Customer specific
            {value: 'customer_group', label: 'Customer Group'},
            {value: 'territory', label: 'Territory'},
            {value: 'disabled', label: 'Disabled'}
        ];

        return common_fields.map(f => `<option value="${f.value}">${f.label}</option>`).join('');
    }

    update_json() {
        const rules = [];
        
        this.$container.find('.vcb-rule').each(function() {
            const $rule = $(this);
            const field = $rule.find('.vcb-field').val();
            const operator = $rule.find('.vcb-operator').val();
            const value = $rule.find('.vcb-value').val();
            
            if (field && value) {
                rules.push({field, operator, value});
            }
        });

        this.conditions.rules = rules;
        
        // Update the actual field value
        if (this.fieldname) {
            const json_value = JSON.stringify(this.conditions);
            frappe.model.set_value(this.fieldname, json_value);
        }

        // Show preview button if we have rules
        if (rules.length > 0) {
            this.$preview.show();
        } else {
            this.$preview.hide();
        }
    }

    preview_matching_docs() {
        const template_name = cur_frm.doc.name;
        const conditions_json = JSON.stringify(this.conditions);

        frappe.call({
            method: 'erpnextwats.erpnextwats.api.preview_matching_documents',
            args: {
                template_name: template_name,
                conditions_json: conditions_json
            },
            callback: (r) => {
                if (r.message && r.message.status === 'success') {
                    this.show_preview_dialog(r.message);
                } else {
                    frappe.msgprint({
                        title: 'Error',
                        message: r.message ? r.message.message : 'Failed to preview',
                        indicator: 'red'
                    });
                }
            }
        });
    }

    show_preview_dialog(data) {
        let html = `
            <div style="max-height: 300px; overflow-y: auto;">
                <p><strong>${data.count} documents match your conditions:</strong></p>
                <ul style="list-style: none; padding-left: 0;">
        `;

        if (data.documents && data.documents.length > 0) {
            data.documents.forEach(doc => {
                html += `<li style="padding: 5px; border-bottom: 1px solid #eee;"><i class="fa fa-file-text-o"></i> ${doc}</li>`;
            });
        } else {
            html += '<li class="text-muted">No documents match</li>';
        }

        html += '</ul></div>';

        const dialog = new frappe.ui.Dialog({
            title: 'Preview Matching Documents',
            fields: [
                {
                    fieldname: 'preview_html',
                    fieldtype: 'HTML',
                    options: html
                }
            ],
            primary_action_label: 'Close',
            primary_action: function() {
                dialog.hide();
            }
        });

        dialog.show();
    }

    load_conditions(json_string) {
        try {
            const conditions = JSON.parse(json_string);
            if (conditions && conditions.rules) {
                this.$container.empty();
                conditions.rules.forEach(rule => {
                    this.add_rule(rule);
                });
            }
        } catch (e) {
            // Invalid JSON, start fresh
        }
    }
};

// Initialize visual builder on WhatsApp Template form
frappe.ui.form.on('WhatsApp Template', {
    refresh: function(frm) {
        // Initialize visual condition builder
        if (frm.fields_dict.visual_conditions) {
            const $wrapper = frm.fields_dict.visual_conditions.$wrapper;
            
            // Check if already initialized
            if (!$wrapper.find('.visual-condition-builder').length) {
                const builder = new erpnextwats.VisualConditionBuilder($wrapper, 'visual_conditions');
                
                // Load existing conditions
                if (frm.doc.visual_conditions) {
                    builder.load_conditions(frm.doc.visual_conditions);
                }
            }
        }

        // Add custom button to test conditions
        if (frm.doc.enable_auto_send && frm.doc.auto_send_mode === 'On Document Create') {
            frm.add_custom_button('Test Conditions', () => {
                frappe.call({
                    method: 'erpnextwats.erpnextwats.api.preview_matching_documents',
                    args: {
                        template_name: frm.doc.name,
                        conditions_json: frm.doc.visual_conditions || '{}'
                    },
                    callback: (r) => {
                        if (r.message && r.message.status === 'success') {
                            frappe.msgprint({
                                title: 'Condition Test Results',
                                message: `${r.message.count} documents would match these conditions`,
                                indicator: 'green'
                            });
                        }
                    }
                });
            });
        }
    },

    visual_conditions: function(frm) {
        // Triggered when field value changes
    }
});
