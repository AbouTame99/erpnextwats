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
def send_whatsapp_on_invoice(docname):
    """Generates a PDF for a Sales Invoice and sends it via WhatsApp."""
    doc = frappe.get_doc("Sales Invoice", docname)
    
    # Get Customer Phone
    customer = frappe.get_doc("Customer", doc.customer)
    phone = customer.mobile_no or customer.phone
    
    if not phone:
        frappe.throw(f"Customer {doc.customer} does not have a mobile number.")

    # Generate PDF
    pdf_content = frappe.get_print("Sales Invoice", docname, as_pdf=True)
    b64_pdf = base64.b64encode(pdf_content).decode('utf-8')

    # Prepare Payload
    message = f"Hello {doc.customer}, please find attached your invoice {docname}. Thank you for your business!"
    
    data = {
        "userId": frappe.session.user,
        "to": phone,
        "message": message,
        "media": {
            "mimetype": "application/pdf",
            "data": b64_pdf,
            "filename": f"Invoice_{docname}.pdf"
        }
    }

    return proxy_to_service("POST", "api/whatsapp/send", data)
