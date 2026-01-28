frappe.listview_settings['Item'] = {
    onload: function (listview) {
        // Remove existing barcode search to prevent duplicates on navigation/refresh
        $('.barcode-search-container').remove();

        const $custom_search = $(`
            <div class="barcode-search-container" style="display: inline-block; margin-right: 12px; vertical-align: middle;">
                <input type="text" class="form-control barcode-search-input" 
                    placeholder="${__('Barcode Search...')}" 
                    style="width: 200px; background-color: var(--control-bg); height: 30px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 4px; padding: 0 10px;">
            </div>
        `);

        // Inject into the page actions area (top right)
        if (listview.page && listview.page.page_actions) {
            $custom_search.prependTo(listview.page.page_actions);
        }

        const $input = $custom_search.find('.barcode-search-input');

        $input.on('change', function () {
            let val = $(this).val();

            // Clear any existing barcode filter on 'name'
            listview.filter_area.remove('name');

            if (val) {
                frappe.call({
                    method: 'erpnextwats.erpnextwats.api.search_items_by_barcode',
                    args: { search_str: val },
                    callback: function (r) {
                        let item_codes = r.message || [];
                        if (item_codes.length > 0) {
                            // Apply filter
                            listview.filter_area.add(listview.doctype, 'name', 'in', item_codes);
                        } else {
                            // Apply filter that returns nothing
                            listview.filter_area.add(listview.doctype, 'name', '=', '_NOT_FOUND_');
                        }
                    }
                });
            } else {
                listview.refresh();
            }
        });

        // Focus the input
        setTimeout(() => {
            if ($input.is(':visible')) {
                $input.focus();
            }
        }, 800);
    }
};
