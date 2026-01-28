frappe.listview_settings['Item'] = {
    onload: function (listview) {
        // Remove existing barcode search to prevent duplicates
        $('.barcode-search-container').remove();

        const $custom_search = $(`
            <div class="barcode-search-container" style="display: inline-block; margin-right: 15px; margin-bottom: 10px; vertical-align: bottom;">
                <input type="text" class="form-control barcode-search-input" 
                    placeholder="${__('Barcode Search...')}" 
                    style="width: 180px; background-color: var(--control-bg); height: 28px; font-size: 12px; border: 1px solid var(--border-color); border-radius: 4px; padding: 0 8px;">
            </div>
        `);

        // Target the filter area
        const $filter_area = listview.$page.find('.list-filters');
        if ($filter_area.length) {
            $custom_search.prependTo($filter_area);
        } else {
            const $filter_section = listview.$page.find('.filter-section');
            if ($filter_section.length) {
                $custom_search.prependTo($filter_section);
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
                            // Display the "Rani Ba4i sandwich kefta" popup
                            frappe.msgprint({
                                title: __('Funny Alert!'),
                                message: `
                                    <div style="text-align: center;">
                                        <h3 style="color: #d9534f; margin-bottom: 15px;">Rani Ba4i sandwich kefta</h3>
                                        <div style="width: 100%; max-height: 300px; overflow: hidden; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                                            <img src="YOUR_IMAGE_LINK_HERE" style="width: 100%; height: auto; display: block;">
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
