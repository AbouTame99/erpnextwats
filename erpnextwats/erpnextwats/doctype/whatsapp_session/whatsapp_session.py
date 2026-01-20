import frappe
from frappe.model.document import Document

class WhatsAppSession(Document):
	def before_insert(self):
		if not self.session_id:
			self.session_id = self.user
