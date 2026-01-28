frappe.listview_settings['Item'] = {
    onload: function (listview) {
        // Create a custom container for our barcode search to avoid interference with Frappe's filter logic
        const $custom_search = $(`
            <div class="barcode-search-container" style="display: inline-block; margin-right: 10px;">
                <input type="text" class="form-control barcode-search-input" 
                    placeholder="${__('Scan Barcode...')}" 
                    style="width: 220px; background-color: var(--control-bg); height: 30px; font-size: 13px;">
            </div>
        `);

        // Insert it before the primary button in the header
        listview.page.set_secondary_action(function () {
            // Keep existing logic if any, but we want our input early
        });

        // Find the place to inject - usually next to the filters or in the inner toolbar
        $custom_search.prependTo(listview.page.get_inner_group_button().parent());

        const $input = $custom_search.find('.barcode-search-input');

        $input.on('change', function () {
            let val = $(this).val();

            // Clear existing custom 'name' filter if it exists
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
                listview.refresh();
            }
        });

        // Auto-focus after a short delay
        setTimeout(() => {
            $input.focus();
        }, 1000);
    }
};
