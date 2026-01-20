import frappe
import requests

@frappe.whitelist()
def proxy_to_service(method, path, data=None):
    """Proxies requests from the Frappe frontend to the Node.js WhatsApp service."""
    service_url = f"http://127.0.0.1:3000/{path}"
    
    try:
        import json
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                pass

        if method.upper() == "GET":
            response = requests.get(service_url, timeout=5)
        else:
            response = requests.post(service_url, json=data, timeout=5)
            
        return response.json()
    except Exception as e:
        frappe.throw(f"WhatsApp Service error: {str(e)}")
