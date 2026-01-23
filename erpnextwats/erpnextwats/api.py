import frappe
import requests

@frappe.whitelist()
def proxy_to_service(method, path, data=None):
    """Proxies requests to the WhatsApp Gateway."""
    # Default gateway URL - runs on same server on port 3000
    gateway_url = "http://127.0.0.1:3000"
    service_url = f"{gateway_url.rstrip('/')}/{path}"
    
    try:
        import json
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                pass

        if method.upper() == "GET":
            response = requests.get(service_url, timeout=10)
        else:
            response = requests.post(service_url, json=data, timeout=10)
            
        if response.status_code == 200 and response.text:
            return response.json()
        return {"status": "error", "message": f"Gateway returned {response.status_code}: {response.text[:100]}"}
    except Exception as e:
        return {"status": "error", "message": f"Could not reach WhatsApp Gateway at {gateway_url}. Ensure whatsapp_gateway.js is running."}
