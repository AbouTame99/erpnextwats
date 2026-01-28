import frappe
import requests
import json
import base64
from frappe.utils.pdf import get_pdf
from frappe.utils import get_url
from erpnext.accounts.utils import get_balance_on

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
        return {"status": "error", "message": f"Gateway Error {response.status_code}"}
    except Exception as e:
        return {"status": "error", "message": f"Could not reach WhatsApp Gateway at {gateway_url}"}

def get_rendering_context(doc):
    """Prepares context for Jinja rendering, including robust custom balance logic."""
    ctx = {"doc": doc, "customer_balance": "0.00"}
    
    # 1. Robust Party Detection
    party = (getattr(doc, "customer", None) or 
             getattr(doc, "supplier", None) or 
             getattr(doc, "party", None))
             
    if not party and doc.doctype in ["Customer", "Supplier"]:
        party = doc.name
        
    frappe.logger().debug(f"[WhatsApp] Rendering Context - Doc: {doc.doctype} {doc.name}, Party: {party}")
        
    if party:
        # Use document's company if available, fallback to default
        company = getattr(doc, "company", None) or "Jiex Trading"
        try:
            # 1. Fetch RAW GL Entries with Date Range
            filters = {
                "company": company,
                "is_cancelled": 0,
                "party": party,
                "posting_date": ["between", ["2022-01-01", "2090-01-01"]]
            }
            
            raw_data = frappe.get_all("GL Entry", 
                filters=filters,
                fields=["posting_date", "voucher_type", "voucher_no", "debit", "credit"],
                order_by="posting_date asc",
                ignore_permissions=True 
            )
            
            frappe.logger().debug(f"[WhatsApp] GL Entries found: {len(raw_data)} for Company: {company}")
            
            # 2. Group by Voucher
            net_data_map = {}
            voucher_order = []
            
            for entry in raw_data:
                v_no = entry.voucher_no
                if v_no not in net_data_map:
                    net_data_map[v_no] = {
                        "debit": 0.0,
                        "credit": 0.0
                    }
                    voucher_order.append(v_no)
                
                net_data_map[v_no]["debit"] += float(entry.debit)
                net_data_map[v_no]["credit"] += float(entry.credit)

            # 3. Calculate Final Balance
            current_balance = 0.0
            for v_no in voucher_order:
                row = net_data_map[v_no]
                d = row["debit"]
                c = row["credit"]
                
                # Netting logic
                if d >= c:
                    final_d = d - c
                    final_c = 0.0
                else:
                    final_c = c - d
                    final_d = 0.0
                    
                current_balance += (final_d - final_c)
            
            from frappe.utils import fmt_money
            ctx["customer_balance"] = fmt_money(current_balance, currency=doc.get("currency") or "MAD")
            frappe.logger().debug(f"[WhatsApp] Final Balance calculated: {current_balance}")
                
        except Exception as e:
            frappe.log_error(title="WhatsApp Balance Calc Error", message=f"Doc: {doc.name}, Error: {str(e)}")
            
    return ctx

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
        recipient = (getattr(doc, "mobile_no", None) or 
                     getattr(doc, "phone", None) or 
                     getattr(doc, "contact_mobile", None))
        
        if not recipient and getattr(doc, "customer", None):
            cust = frappe.get_doc("Customer", doc.customer)
            recipient = cust.mobile_no or cust.phone

    if not recipient:
        return {"status": "missing_phone", "message": "No phone number found."}

    # 2. Render Message (Jinja) with Balance
    ctx = get_rendering_context(doc)
    message = frappe.render_template(template.message, ctx)

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
        file_doc = frappe.get_doc("File", {"file_url": template.custom_media})
        media = {
            "mimetype": file_doc.content_type or "application/octet-stream",
            "data": base64.b64encode(file_doc.get_content()).decode('utf-8'),
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

@frappe.whitelist(allow_guest=True)
def gateway_webhook(data, secret=None):
    """Internal endpoint for WhatsApp gateway to process incoming messages."""
    # Simple security check (could be improved)
    if secret != "INTERNAL_GATEWAY_SECRET":
        return {"status": "error", "message": "Unauthorized"}
        
    if isinstance(data, str):
        data = json.loads(data)
        
    msg_body = data.get("body", "").strip()
    from_me = data.get("fromMe", False)
    
    if from_me:
        return {"status": "ignored"}

    # Barcode Search Logic
    # Check if it looks like a barcode (alphanumeric, 5-15 chars)
    if msg_body and 5 <= len(msg_body) <= 20:
        # Search in Item Barcode child table
        item_code = frappe.db.get_value("Item Barcode", {"barcode": msg_body}, "parent")
        
        # Fallback to Item field
        if not item_code:
            item_code = frappe.db.get_value("Item", {"barcode": msg_body}, "name")
            
        if item_code:
            item = frappe.get_cached_doc("Item", item_code)
            
            # Get Price (Standard Selling)
            price = frappe.db.get_value("Item Price", {"item_code": item_code, "price_list": "Standard Selling"}, "price_list_rate")
            
            # Get Stock
            stock = frappe.db.get_value("Bin", {"item_code": item_code}, "actual_qty") or 0
            
            reply = f"*Item Found:*\n"
            reply += f"Name: {item.item_name}\n"
            reply += f"Description: {item.description or 'N/A'}\n"
            reply += f"Price: {frappe.fmt_money(price or 0, currency='MAD')}\n"
            reply += f"Stock: {stock} units"
            
            return {"status": "reply", "message": reply}

    return {"status": "no_match"}

@frappe.whitelist()
def render_template_preview(doctype_name, message, docname):
    """Renders a Jinja message using a reference document for preview."""
    try:
        doc = frappe.get_doc(doctype_name, docname)
        ctx = get_rendering_context(doc)
        return frappe.render_template(message, ctx)
    except Exception as e:
        return f"Error rendering preview: {str(e)}"
