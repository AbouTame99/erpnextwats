import frappe
import requests

@frappe.whitelist()
def proxy_to_service(method, path, data=None):
    """Proxies requests from the Frappe frontend to the Node.js WhatsApp service."""
    service_url = f"http://localhost:3000/{path}"
    
    try:
        if method.upper() == "GET":
            response = requests.get(service_url)
        else:
            response = requests.post(service_url, json=data)
            
        return response.json()
    except Exception as e:
        frappe.throw(f"WhatsApp Service error: {str(e)}")
