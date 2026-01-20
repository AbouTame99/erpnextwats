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
            
        if response.status_code == 200 and response.text:
            return response.json()
        return {"status": "error", "message": f"Service returned {response.status_code}"}
    except Exception as e:
        return {"status": "error", "message": "WhatsApp service is not responding. Please ensure it is started."}
