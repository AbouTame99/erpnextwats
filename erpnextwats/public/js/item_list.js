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

        // Target the Page Header Form area (where search and filters live)
        const $filter_section = listview.$page.find('.page-form .standard-filter-section');

        if ($filter_section.length) {
            $custom_search.prependTo($filter_section);
        } else {
            // Fallback: search for list-filters or page-head-content
            const $page_head = listview.$page.find('.page-head-content').first();
            if ($page_head.length) {
                $custom_search.appendTo($page_head);
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
