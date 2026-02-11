# Copyright (c) 2024, Aboubaker Tamessouct and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime, today

class WhatsAppActivityLog(Document):
    def before_insert(self):
        """Set default values before insert"""
        if not self.activity_timestamp:
            self.activity_timestamp = now_datetime()
        if not self.activity_date:
            self.activity_date = today()
        if not self.user and frappe.session.user:
            self.user = frappe.session.user
    
    def validate(self):
        """Validate log entry"""
        if not self.activity_category:
            # Auto-set category based on activity_type
            category_map = {
                'Bulk Send Started': 'Bulk',
                'Bulk Send Completed': 'Bulk',
                'Bulk Send Failed': 'Bulk',
                'Auto Send Triggered': 'Auto Send',
                'Auto Send Completed': 'Auto Send',
                'Auto Send Failed': 'Auto Send',
                'Template Created': 'Template',
                'Template Updated': 'Template',
                'Template Deleted': 'Template',
                'Session Connected': 'Session',
                'Session Disconnected': 'Session',
                'Session Expired': 'Session',
                'Session QR Generated': 'Session',
                'Session Error': 'Session',
                'Message Sent': 'Message',
                'Message Failed': 'Message',
                'Message Received': 'Message',
                'Gateway Started': 'Gateway',
                'Gateway Stopped': 'Gateway',
                'Gateway Error': 'Gateway',
                'Rate Limit Hit': 'System',
                'Retry Attempt': 'System'
            }
            self.activity_category = category_map.get(self.activity_type, 'System')
