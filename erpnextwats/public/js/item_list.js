frappe.listview_settings['Item'] = {
    onload: function (listview) {
        // Add a primary search input for barcode directly in the header
        listview.barcode_search_field = listview.page.add_field({
            fieldname: 'barcode_search',
            label: __('Barcode'),
            fieldtype: 'Data',
            placeholder: __('Scan Barcode (e.g. LS200)...'),
            onchange: function () {
                let val = this.get_value();

                // Clear any existing barcode-driven filter on 'name'
                listview.filter_area.remove('name');

                if (val) {
                    frappe.call({
                        method: 'erpnextwats.erpnextwats.api.search_items_by_barcode',
                        args: { search_str: val },
                        callback: function (r) {
                            let item_codes = r.message || [];
                            if (item_codes.length > 0) {
                                // Apply filter to show matching items
                                listview.filter_area.add(listview.doctype, 'name', 'in', item_codes);
                            } else {
                                // Show nothing if no match
                                listview.filter_area.add(listview.doctype, 'name', '=', '_NOT_FOUND_');
                            }
                        }
                    });
                } else {
                    // Refresh to show all if cleared
                    listview.refresh();
                }
            }
        });

        // Styling for better placement in the header
        $(listview.barcode_search_field.$wrapper).css({
            'min-width': '220px',
            'margin-right': '10px',
            'margin-bottom': '0'
        });

        // Optional: Auto-focus if it's the first load
        setTimeout(() => {
            if (listview.barcode_search_field) {
                listview.barcode_search_field.$input.focus();
            }
        }, 1000);
    }
};
