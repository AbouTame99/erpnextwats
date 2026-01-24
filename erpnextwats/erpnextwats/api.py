import frappe
import requests
import json

@frappe.whitelist()
def proxy_to_service(method, path, data=None):
    """Proxies requests to the WhatsApp Gateway."""
    
    # Default gateway URL - runs on same server on port 3000
    gateway_url = "http://127.0.0.1:3000"
    service_url = f"{gateway_url.rstrip('/')}/{path}"
    
    frappe.logger().info(f"[WhatsApp API] {method} {path} - Data: {data}")
    
    try:
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                pass

        frappe.logger().info(f"[WhatsApp API] Requesting: {service_url}")
        
        if method.upper() == "GET":
            response = requests.get(service_url, timeout=60)
        else:
            response = requests.post(service_url, json=data, timeout=60)
        
        frappe.logger().info(f"[WhatsApp API] Response status: {response.status_code}")
            
        if response.status_code == 200 and response.text:
            result = response.json()
            frappe.logger().info(f"[WhatsApp API] Response: {json.dumps(result)[:200]}")
            return result
        else:
            error_msg = f"Gateway returned {response.status_code}: {response.text[:100]}"
            frappe.logger().error(f"[WhatsApp API] {error_msg}")
            return {"status": "error", "message": error_msg}
    except requests.exceptions.ConnectionError as e:
        error_msg = f"Could not reach WhatsApp Gateway at {gateway_url}. Ensure whatsapp_gateway.js is running."
        frappe.logger().error(f"[WhatsApp API] Connection error: {str(e)}")
        return {"status": "error", "message": error_msg}
    except Exception as e:
        error_msg = f"Error connecting to gateway: {str(e)}"
        frappe.logger().error(f"[WhatsApp API] {error_msg}")
        return {"status": "error", "message": error_msg}
