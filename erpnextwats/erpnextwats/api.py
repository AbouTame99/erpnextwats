import frappe
import requests
import json
import base64
from frappe.utils.pdf import get_pdf
from frappe.utils import get_url

@frappe.whitelist()
def proxy_to_service(method, path, data=None):
    """Proxies requests to the WhatsApp Gateway."""
    gateway_url = "http://127.0.0.1:3000"
    service_url = f"{gateway_url.rstrip('/')}/{path}"
    
    try:
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                pass

        if method.upper() == "GET":
            response = requests.get(service_url, timeout=60)
        else:
            response = requests.post(service_url, json=data, timeout=60)
            
        if response.status_code == 200 and response.text:
            return response.json()
        else:
            return {"status": "error", "message": f"Gateway Error {response.status_code}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def get_templates(doctype):
    """Returns available WhatsApp templates for a given DocType."""
    return frappe.get_all("WhatsApp Template", 
        filters={"doctype_name": doctype}, 
        fields=["name", "template_name"])

@frappe.whitelist()
def send_via_template(docname, doctype, template_id, phone=None):
    """Sends a message using a specific template."""
    doc = frappe.get_doc(doctype, docname)
    template = frappe.get_doc("WhatsApp Template", template_id)

    # 1. Resolve Recipient Phone
    recipient = phone
    if not recipient:
        # Try common phone fields
        recipient = (getattr(doc, "mobile_no", None) or 
                     getattr(doc, "phone", None) or 
                     getattr(doc, "contact_mobile", None))
        
        # If it's a Customer linked doc, try customer record
        if not recipient and getattr(doc, "customer", None):
            cust = frappe.get_doc("Customer", doc.customer)
            recipient = cust.mobile_no or cust.phone

    if not recipient:
        return {"status": "missing_phone", "message": "No phone number found for this document."}

    # 2. Render Message (Jinja)
    message = frappe.render_template(template.message, {"doc": doc})

    # 3. Prepare Media
    media = None
    if template.attach_pdf:
        pdf_content = frappe.get_print(doctype, docname, as_pdf=True)
        media = {
            "mimetype": "application/pdf",
            "data": base64.b64encode(pdf_content).decode('utf-8'),
            "filename": f"{docname}.pdf"
        }
    elif template.custom_media:
        # Handle custom media file
        file_doc = frappe.get_doc("File", {"file_url": template.custom_media})
        content = file_doc.get_content()
        media = {
            "mimetype": file_doc.content_type or "application/octet-stream",
            "data": base64.b64encode(content).decode('utf-8'),
            "filename": file_doc.file_name
        }

    # 4. Push to Gateway
    data = {
        "userId": frappe.session.user,
        "to": recipient,
        "message": message,
        "media": media
    }

    return proxy_to_service("POST", "api/whatsapp/send", data)

@frappe.whitelist()
def render_template_preview(doctype_name, message, docname):
    """Renders a Jinja message using a reference document."""
    try:
        doc = frappe.get_doc(doctype_name, docname)
        return frappe.render_template(message, {"doc": doc})
    except Exception as e:
        return f"Error rendering preview: {str(e)}"
