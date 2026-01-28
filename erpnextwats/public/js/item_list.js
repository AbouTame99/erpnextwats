frappe.listview_settings['Item'] = {
    onload: function (listview) {
        // Remove existing barcode search to prevent duplicates
        $('.barcode-search-container').remove();

        const $custom_search = $(`
            <div class="barcode-search-container" style="display: inline-block; margin-right: 15px; margin-bottom: 5px; vertical-align: middle;">
                <input type="text" class="form-control barcode-search-input" 
                    placeholder="${__('Barcode Search...')}" 
                    style="width: 160px; background-color: var(--control-bg); height: 28px; font-size: 11px; border: 1px solid var(--border-color); border-radius: 4px; padding: 0 8px;">
            </div>
        `);

        // Target the main filter row (beside ID, Item Name etc)
        // Image 2 shows these filters are usually in the first row of .filter-section
        const $filter_row = listview.$page.find('.filter-section .filter-list .filter-item-row:first');

        if ($filter_row.length) {
            $custom_search.prependTo($filter_row);
        } else {
            // Fallback: search for any .filter-list or .list-filters if the exact row isn't found
            const $filter_list = listview.$page.find('.filter-list, .list-filters').first();
            if ($filter_list.length) {
                $custom_search.prependTo($filter_list);
            }
        }

        const $input = $custom_search.find('.barcode-search-input');

        $input.on('change', function () {
            let val = $(this).val();

            // Clear existing 'name' filter
            listview.filter_area.remove('name');

            if (val) {
                frappe.call({
                    method: 'erpnextwats.erpnextwats.api.search_items_by_barcode',
                    args: { search_str: val },
                    callback: function (r) {
                        let item_codes = r.message || [];
                        if (item_codes.length > 0) {
                            listview.filter_area.add(listview.doctype, 'name', 'in', item_codes);

                            // --- FUNNY POPUP START ---
                            frappe.msgprint({
                                title: __('Funny Alert!'),
                                message: `
                                    <div style="text-align: center;">
                                        <h3 style="color: #d9534f; margin-bottom: 15px;">Rani Ba4i sandwich kefta</h3>
                                        <div style="width: 100%; max-height: 300px; overflow: hidden; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                                            <img src="data:image/webp;base64,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)
                                        </div>
                                    </div>
                                `,
                                indicator: 'red'
                            });
                            // --- FUNNY POPUP END ---

                        } else {
                            listview.filter_area.add(listview.doctype, 'name', '=', '_NOT_FOUND_');
                        }
                    }
                });
            } else {
                listview.refresh();
            }
        });

        // Auto-focus the input
        setTimeout(() => {
            if ($input.is(':visible')) {
                $input.focus();
            }
        }, 1000);
    }
};
