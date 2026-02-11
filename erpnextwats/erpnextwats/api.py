import frappe
import requests
import json
import base64
import random
import re
import time
import urllib.parse
import traceback
from frappe.utils.pdf import get_pdf
from frappe.utils import get_url, now_datetime, today
from erpnext.accounts.utils import get_balance_on

# ===== COMPREHENSIVE LOGGING SYSTEM =====

def log_whatsapp_activity(
    activity_type,
    status="Info",
    user=None,
    session_id=None,
    phone_number=None,
    reference_doctype=None,
    reference_name=None,
    template=None,
    customer=None,
    customer_phone=None,
    message_content=None,
    error_details=None,
    duration_ms=None,
    retry_count=None,
    metadata=None
):
    """
    Comprehensive logging utility for all WhatsApp activities.
    
    Args:
        activity_type: Type of activity (e.g., 'Bulk Send Started', 'Message Sent')
        status: Success/Failed/Warning/Info/Error
        user: User who performed the action
        session_id: WhatsApp session ID
        phone_number: Connected phone number
        reference_doctype: Related DocType
        reference_name: Related document name
        template: WhatsApp Template used
        customer: Customer name/code
        customer_phone: Customer phone number
        message_content: Message content (truncated for privacy)
        error_details: Error message or details
        duration_ms: Duration in milliseconds
        retry_count: Number of retry attempts
        metadata: Additional JSON metadata
    """
    try:
        log_entry = frappe.get_doc({
            "doctype": "WhatsApp Activity Log",
            "activity_type": activity_type,
            "status": status,
            "user": user or frappe.session.user,
            "user_name": frappe.get_value("User", user or frappe.session.user, "full_name") if frappe.session.user else None,
            "session_id": session_id or "shared_company_session",
            "phone_number": phone_number,
            "reference_doctype": reference_doctype,
            "reference_name": reference_name,
            "template": template,
            "customer": customer,
            "customer_phone": customer_phone,
            "message_content": (message_content[:1000] + "...") if message_content and len(message_content) > 1000 else message_content,
            "error_details": error_details,
            "duration_ms": duration_ms,
            "retry_count": retry_count,
            "metadata_json": json.dumps(metadata) if metadata else None,
            "ip_address": frappe.request.environ.get("REMOTE_ADDR") if frappe.request else None,
            "user_agent": frappe.request.environ.get("HTTP_USER_AGENT")[:200] if frappe.request and frappe.request.environ.get("HTTP_USER_AGENT") else None
        })
        log_entry.insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception as e:
        # If logging fails, at least log to console
        print(f"[LOGGING ERROR] Failed to create log entry: {str(e)}")
        frappe.logger().error(f"Failed to create WhatsApp activity log: {str(e)}")

def log_error(activity_type, error, user=None, **kwargs):
    """Convenience function for logging errors with stack trace"""
    error_msg = str(error)
    stack = traceback.format_exc()
    log_whatsapp_activity(
        activity_type=activity_type,
        status="Error",
        user=user,
        error_details=error_msg,
        stack_trace=stack,
        **kwargs
    )

def log_success(activity_type, user=None, **kwargs):
    """Convenience function for logging successful operations"""
    log_whatsapp_activity(
        activity_type=activity_type,
        status="Success",
        user=user,
        **kwargs
    )

def log_warning(activity_type, warning_msg, user=None, **kwargs):
    """Convenience function for logging warnings"""
    log_whatsapp_activity(
        activity_type=activity_type,
        status="Warning",
        user=user,
        error_details=warning_msg,
        **kwargs
    )

def log_info(activity_type, user=None, **kwargs):
    """Convenience function for logging info"""
    log_whatsapp_activity(
        activity_type=activity_type,
        status="Info",
        user=user,
        **kwargs
    )

@frappe.whitelist()
def get_whatsapp_logs(
    activity_type=None,
    category=None,
    status=None,
    user=None,
    customer=None,
    template=None,
    date_from=None,
    date_to=None,
    limit=100,
    offset=0
):
    """
    Query WhatsApp activity logs with filters.
    
    Returns filtered logs for dashboard/reports.
    """
    try:
        filters = {}
        
        if activity_type:
            filters["activity_type"] = activity_type
        if category:
            filters["activity_category"] = category
        if status:
            filters["status"] = status
        if user:
            filters["user"] = user
        if customer:
            filters["customer"] = customer
        if template:
            filters["template"] = template
        if date_from:
            filters["activity_date"] = [">=", date_from]
        if date_to:
            filters["activity_date"] = ["<=", date_to]
        
        logs = frappe.get_all(
            "WhatsApp Activity Log",
            filters=filters,
            fields=[
                "name", "activity_timestamp", "activity_date", "activity_type",
                "activity_category", "status", "user", "user_name", "customer",
                "customer_phone", "template", "duration_ms", "retry_count"
            ],
            order_by="activity_timestamp desc",
            limit=limit,
            limit_start=offset
        )
        
        # Get total count
        total = frappe.db.count("WhatsApp Activity Log", filters=filters)
        
        return {
            "status": "success",
            "logs": logs,
            "total": total,
            "limit": limit,
            "offset": offset
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def get_whatsapp_dashboard_stats():
    """
    Get real-time dashboard statistics.
    
    Returns summary metrics for the dashboard.
    """
    try:
        today_date = today()
        
        # Today's stats
        today_stats = frappe.db.sql("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'Success' THEN 1 ELSE 0 END) as success,
                SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'Error' THEN 1 ELSE 0 END) as errors,
                SUM(CASE WHEN activity_category = 'Message' THEN 1 ELSE 0 END) as messages,
                SUM(CASE WHEN activity_category = 'Bulk' THEN 1 ELSE 0 END) as bulk_sends
            FROM `tabWhatsApp Activity Log`
            WHERE activity_date = %s
        """, (today_date,), as_dict=True)[0]
        
        # Last 7 days trend
        weekly_stats = frappe.db.sql("""
            SELECT 
                activity_date,
                COUNT(*) as count,
                SUM(CASE WHEN status = 'Success' THEN 1 ELSE 0 END) as success
            FROM `tabWhatsApp Activity Log`
            WHERE activity_date >= DATE_SUB(%s, INTERVAL 7 DAY)
            GROUP BY activity_date
            ORDER BY activity_date DESC
        """, (today_date,), as_dict=True)
        
        # Recent errors (last 24 hours)
        recent_errors = frappe.db.sql("""
            SELECT activity_type, error_details, activity_timestamp, user
            FROM `tabWhatsApp Activity Log`
            WHERE status = 'Error'
            AND activity_timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY activity_timestamp DESC
            LIMIT 10
        """, as_dict=True)
        
        # Session status (latest)
        latest_session = frappe.db.sql("""
            SELECT activity_type, status, activity_timestamp
            FROM `tabWhatsApp Activity Log`
            WHERE activity_category = 'Session'
            ORDER BY activity_timestamp DESC
            LIMIT 1
        """, as_dict=True)
        
        return {
            "status": "success",
            "today": {
                "total": today_stats.total or 0,
                "success": today_stats.success or 0,
                "failed": today_stats.failed or 0,
                "errors": today_stats.errors or 0,
                "messages": today_stats.messages or 0,
                "bulk_sends": today_stats.bulk_sends or 0
            },
            "weekly_trend": weekly_stats,
            "recent_errors": recent_errors,
            "latest_session": latest_session[0] if latest_session else None
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ===== END LOGGING SYSTEM =====

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
        
        error_detail = response.text if response.text else "No details provided"
        return {"status": "error", "message": f"Gateway Error {response.status_code}: {error_detail}"}
    except Exception as e:
        return {"status": "error", "message": f"Could not reach WhatsApp Gateway at {gateway_url}"}

def get_rendering_context(doc):
    """Prepares context for Jinja rendering, including robust custom balance logic."""
    ctx = {"doc": doc, "customer_balance": "0.00", "customer_statement_link": ""}
    
    # 1. Robust Party Detection
    party = (getattr(doc, "customer", None) or 
             getattr(doc, "supplier", None) or 
             getattr(doc, "party", None))
             
    if not party and doc.doctype in ["Customer", "Supplier"]:
        party = doc.name
        
    frappe.logger().debug(f"[WhatsApp] Rendering Context - Doc: {doc.doctype} {doc.name}, Party: {party}")
        
    if party:
        # Generate customer statement link with URL encoding
        # This handles spaces, special characters, unicode, etc.
        encoded_party = urllib.parse.quote(str(party), safe='')
        ctx["customer_statement_link"] = f"https://erp.jiextrading.com/statement?party={encoded_party}"
        
        company = getattr(doc, "company", None) or "Jiex Trading"
        try:
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
            
            net_data_map = {}
            voucher_order = []
            
            for entry in raw_data:
                v_no = entry.voucher_no
                if v_no not in net_data_map:
                    net_data_map[v_no] = {"debit": 0.0, "credit": 0.0}
                    voucher_order.append(v_no)
                
                net_data_map[v_no]["debit"] += float(entry.debit)
                net_data_map[v_no]["credit"] += float(entry.credit)

            current_balance = 0.0
            for v_no in voucher_order:
                row = net_data_map[v_no]
                d, c = row["debit"], row["credit"]
                current_balance += (d - c)
            
            from frappe.utils import fmt_money
            ctx["customer_balance"] = fmt_money(current_balance, currency=doc.get("currency") or "MAD")
                
        except Exception as e:
            frappe.log_error(title="WhatsApp Balance Calc Error", message=f"Doc: {doc.name}, Error: {str(e)}")
            
    return ctx

# ===== NEW BULK SEND HELPERS =====

def smart_delay(sent_count, failed_count):
    """
    AI-like smart delay algorithm with adaptive timing.
    Base: 10-60 seconds random jitter
    Adaptive: Increases delay if failure rate is high (>20%)
    """
    # Base delay: 10-60 seconds with random jitter
    base = random.randint(10, 60)
    
    # Adaptive: If failure rate is high, add extra delay
    if sent_count > 0:
        total = sent_count + failed_count
        if total > 0:
            failure_rate = failed_count / total
            if failure_rate > 0.2:  # More than 20% failing
                extra = random.randint(10, 20)
                base += extra
                frappe.logger().info(f"[SMART DELAY] High failure rate detected ({failure_rate:.1%}), adding {extra}s extra delay")
    
    # Add slight randomness (-2 to +5 seconds) to avoid patterns
    jitter = random.randint(-2, 5)
    final_delay = max(10, base + jitter)  # Ensure minimum 10 seconds
    
    frappe.logger().info(f"[SMART DELAY] Waiting {final_delay} seconds (base: {base}, jitter: {jitter})")
    return final_delay

def validate_gateway_and_session():
    """Validate that WhatsApp gateway is running and session is active."""
    gateway_url = "http://127.0.0.1:3000"
    
    try:
        # Check A: Ping gateway health
        response = requests.get(f"{gateway_url}/api/whatsapp/status", timeout=10)
        if response.status_code != 200:
            return {"valid": False, "error": f"Gateway returned status {response.status_code}"}
        
        gateway_data = response.json()
        
        # Check B: Validate WhatsApp session is connected
        if not gateway_data.get("connected", False):
            return {"valid": False, "error": "WhatsApp session not connected. Please scan QR code."}
        
        return {"valid": True, "gateway_data": gateway_data}
    
    except requests.exceptions.ConnectionError:
        return {"valid": False, "error": f"Cannot connect to WhatsApp Gateway at {gateway_url}. Is it running?"}
    except Exception as e:
        return {"valid": False, "error": f"Gateway validation error: {str(e)}"}

def validate_phone_medium(phone):
    """
    Medium phone validation:
    - Remove spaces, dashes, parentheses
    - Ensure starts with +
    - Standardize format (remove leading 0 after country code)
    """
    if not phone:
        return None
    
    # Remove all non-numeric except + at start
    cleaned = re.sub(r'[\s\-\(\)\.]','', str(phone))
    
    # Ensure starts with +
    if not cleaned.startswith('+'):
        # If it starts with 0, assume it's a local number without country code
        # You might want to add default country code here
        cleaned = '+' + cleaned.lstrip('0')
    
    # Remove leading 0 after country code (e.g., +212 0612 -> +212612)
    # Match pattern like +XX0... and remove the 0
    cleaned = re.sub(r'^(\+\d{1,3})0', r'\1', cleaned)
    
    # Validate format: + followed by 10-15 digits
    if not re.match(r'^\+\d{10,15}$', cleaned):
        return None
    
    return cleaned

@frappe.whitelist()
def get_bulk_progress(history_name):
    """Get real-time progress of a bulk send job."""
    try:
        history = frappe.get_doc("WhatsApp Bulk History", history_name)
        details = []
        if history.details:
            try:
                details = json.loads(history.details)
            except:
                pass
        
        # Calculate remaining customers
        processed = history.sent_count + history.failed_count + history.skipped_count
        remaining = history.total_recipients - processed if history.total_recipients else 0
        
        # For paused jobs, extract resume time from error_message
        resumes_at = None
        if history.status == "Paused" and history.error_message:
            # Parse "Resuming at HH:MM" from error message
            import re
            match = re.search(r'Resuming at (\d{2}:\d{2})', history.error_message)
            if match:
                time_str = match.group(1)
                # Create datetime for today with that time
                from datetime import datetime, timedelta
                now = now_datetime()
                hour, minute = map(int, time_str.split(':'))
                resume_time = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                # If that time has already passed today, it's tomorrow
                if resume_time < now:
                    resume_time += timedelta(days=1)
                resumes_at = str(resume_time)
        
        return {
            "status": "success",
            "job_status": history.status,
            "total": history.total_recipients,
            "sent": history.sent_count,
            "failed": history.failed_count,
            "skipped": history.skipped_count,
            "remaining": remaining,
            "details": details,
            "started_at": str(history.started_at) if history.started_at else None,
            "completed_at": str(history.completed_at) if history.completed_at else None,
            "resumes_at": resumes_at
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def get_bulk_history(limit=50):
    """Get all bulk send history."""
    try:
        history = frappe.get_all(
            "WhatsApp Bulk History",
            fields=["name", "template", "target_doctype", "status", "total_recipients", 
                    "sent_count", "failed_count", "skipped_count", "started_at", "completed_at"],
            order_by="started_at desc",
            limit=limit
        )
        return {"status": "success", "history": history}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ===================================

@frappe.whitelist()
def get_templates(doctype):
    """Returns available WhatsApp templates for a given DocType."""
    templates = frappe.get_all("WhatsApp Template", 
        filters={"doctype_name": doctype}, 
        fields=["name", "template_name", "message"],
        order_by="template_name asc")
    # Return with template_name as the display value
    return [{"name": t.name, "template_name": t.template_name, "message": t.message} for t in templates]

@frappe.whitelist()
def send_via_template(docname, doctype, template_id, phone=None):
    """Sends a message using a specific template."""
    doc = frappe.get_doc(doctype, docname)
    template = frappe.get_doc("WhatsApp Template", template_id)

    recipient = phone
    if not recipient:
        recipient = (getattr(doc, "mobile_no", None) or 
                    getattr(doc, "phone", None) or 
                    getattr(doc, "contact_mobile", None))
        
        if not recipient and getattr(doc, "customer", None):
            try:
                cust = frappe.get_doc("Customer", doc.customer)
                recipient = cust.mobile_no or cust.phone
            except:
                pass

    if not recipient:
        return {"status": "missing_phone", "message": "No phone number found. Please add a phone number to the customer or document."}

    ctx = get_rendering_context(doc)
    message = frappe.render_template(template.message, ctx)

    media = None
    if template.attach_pdf:
        pdf_content = frappe.get_print(doctype, docname, as_pdf=True)
        media = {
            "mimetype": "application/pdf",
            "data": base64.b64encode(pdf_content).decode('utf-8'),
            "filename": f"{docname}.pdf"
        }
    elif template.custom_media:
        try:
            # Get file by URL - try multiple methods
            file_url = template.custom_media.strip()
            file_doc = None
            
            # Normalize URL - remove leading slash
            normalized_url = file_url.lstrip('/')
            
            # Try different URL variations
            url_variations = [
                file_url,  # Original
                normalized_url,  # Without leading slash
                f"/{normalized_url}",  # With leading slash
            ]
            
            # If it starts with 'files/', also try 'private/files/'
            if normalized_url.startswith('files/'):
                url_variations.append(normalized_url.replace('files/', 'private/files/', 1))
                url_variations.append(f"/{normalized_url.replace('files/', 'private/files/', 1)}")
            
            # If it starts with 'private/files/', also try 'files/'
            if normalized_url.startswith('private/files/'):
                url_variations.append(normalized_url.replace('private/files/', 'files/', 1))
                url_variations.append(f"/{normalized_url.replace('private/files/', 'files/', 1)}")
            
            # Method 1: Try direct lookup with all variations
            for url_var in url_variations:
                if not file_doc:
                    try:
                        file_doc = frappe.get_doc("File", {"file_url": url_var})
                        break
                    except:
                        pass
            
            # Method 2: Try SQL query with LIKE to find file
            import os
            filename = os.path.basename(normalized_url)
            
            if not file_doc:
                try:
                    files = frappe.db.sql("""
                        SELECT name FROM `tabFile` 
                        WHERE file_name = %s OR file_url LIKE %s OR file_url LIKE %s
                        LIMIT 1
                    """, (filename, f"%{filename}", f"%{normalized_url}"), as_dict=True)
                    if files:
                        file_doc = frappe.get_doc("File", files[0].name)
                except Exception as e:
                    frappe.logger().error(f"SQL file lookup error: {str(e)}")
            
            # Method 3: Try to find by filename only
            if not file_doc:
                try:
                    file_doc = frappe.get_doc("File", {"file_name": filename})
                except:
                    pass
            
            # Method 4: Try to find by partial filename match
            if not file_doc:
                try:
                    all_files = frappe.get_all("File", 
                        filters={"file_name": ["like", f"%{filename}%"]},
                        fields=["name", "file_url"],
                        limit=50)
                    for f in all_files:
                        if filename in f.file_url or normalized_url in f.file_url or file_url in f.file_url:
                            file_doc = frappe.get_doc("File", f.name)
                            break
                except Exception as e:
                    frappe.logger().error(f"File search error: {str(e)}")
            
            if not file_doc:
                raise Exception(f"File not found: {file_url}. Tried variations: {', '.join(url_variations[:5])}")
            
            # Get mimetype from file extension or file_type
            import mimetypes
            import os
            
            # Get filename with extension
            original_filename = file_doc.file_name or "attachment"
            file_ext = os.path.splitext(original_filename)[1].lower()
            
            # Determine mimetype
            mimetype = "application/octet-stream"
            
            # Image types
            image_types = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.bmp': 'image/bmp',
                '.svg': 'image/svg+xml'
            }
            
            # Document types
            doc_types = {
                '.pdf': 'application/pdf',
                '.doc': 'application/msword',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                '.xls': 'application/vnd.ms-excel',
                '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                '.txt': 'text/plain',
                '.csv': 'text/csv'
            }
            
            # Check extension first
            if file_ext in image_types:
                mimetype = image_types[file_ext]
            elif file_ext in doc_types:
                mimetype = doc_types[file_ext]
            elif hasattr(file_doc, 'file_type') and file_doc.file_type:
                mimetype = file_doc.file_type
            elif original_filename:
                guessed_mime, _ = mimetypes.guess_type(original_filename)
                if guessed_mime:
                    mimetype = guessed_mime
            
            # Ensure filename has extension
            if not file_ext and mimetype.startswith('image/'):
                # Add extension based on mimetype
                ext_map = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'image/gif': '.gif',
                    'image/webp': '.webp'
                }
                file_ext = ext_map.get(mimetype, '.jpg')
                original_filename = original_filename + file_ext
            elif not file_ext and mimetype == 'application/pdf':
                original_filename = original_filename + '.pdf'
            
            # Get file content
            file_content = file_doc.get_content()
            if isinstance(file_content, str):
                file_content = file_content.encode('utf-8')
            
            media = {
                "mimetype": mimetype,
                "data": base64.b64encode(file_content).decode('utf-8'),
                "filename": original_filename
            }
        except Exception as e:
            frappe.logger().error(f"Error processing custom media: {str(e)}")
            frappe.logger().error(f"File URL: {template.custom_media}")
            media = None

    data = {
        "userId": "shared_company_session",
        "to": recipient,
        "message": message,
        "media": media
    }

    # Send message and log result
    start_time = time.time()
    result = proxy_to_service("POST", "api/whatsapp/send", data)
    duration_ms = int((time.time() - start_time) * 1000)
    
    # Log the message send attempt
    if result.get("status") == "success":
        log_success(
            activity_type="Message Sent",
            template=template_id,
            customer=doc.customer if hasattr(doc, 'customer') else doc.name,
            customer_phone=recipient,
            message_content=message[:200],
            duration_ms=duration_ms,
            reference_doctype=doctype,
            reference_name=docname
        )
    else:
        log_error(
            activity_type="Message Failed",
            error=result.get("message", "Unknown error"),
            template=template_id,
            customer=doc.customer if hasattr(doc, 'customer') else doc.name,
            customer_phone=recipient,
            message_content=message[:200],
            duration_ms=duration_ms,
            reference_doctype=doctype,
            reference_name=docname
        )
    
    return result

@frappe.whitelist()
def send_bulk_messages(template_id, filters=None, doctype=None, customer_list=None, delay_seconds=3, max_per_hour=50):
    """
    Safely send bulk WhatsApp messages with smart anti-ban protection.
    
    Features:
    - Validates gateway and WhatsApp session before starting
    - Smart delay 10-60s with adaptive algorithm
    - Hard retry 3 times per customer before moving to next
    - Real-time progress tracking via WhatsApp Bulk History
    - Medium phone validation
    
    Args:
        template_id: WhatsApp Template name
        filters: JSON filters for doctype (optional)
        doctype: Source doctype (optional, uses template's doctype if not provided)
        customer_list: List of customer names to send to (optional, for customer selection)
        delay_seconds: Not used (smart delay takes over)
        max_per_hour: Max messages per hour (default 50)
    """
    frappe.logger().info("=" * 80)
    frappe.logger().info(f"[BULK SEND] Starting bulk send request")
    frappe.logger().info(f"[BULK SEND] Template ID: {template_id}")
    frappe.logger().info(f"[BULK SEND] DocType: {doctype}")
    frappe.logger().info(f"[BULK SEND] Customer List: {customer_list}")
    frappe.logger().info(f"[BULK SEND] User: {frappe.session.user}")
    
    # Log bulk send start
    log_info(
        activity_type="Bulk Send Started",
        template=template_id,
        reference_doctype=doctype,
        metadata={
            "customer_list": customer_list,
            "filters": filters,
            "max_per_hour": max_per_hour
        }
    )
    
    # STEP 1: Validate gateway and WhatsApp session
    frappe.logger().info("[BULK SEND] Validating gateway and session...")
    validation = validate_gateway_and_session()
    if not validation["valid"]:
        frappe.logger().error(f"[BULK SEND] Validation failed: {validation['error']}")
        return {"status": "error", "message": validation["error"]}
    frappe.logger().info("[BULK SEND] Gateway and session validated successfully")
    
    # STEP 2: Get template and determine doctype
    template = frappe.get_doc("WhatsApp Template", template_id)
    frappe.logger().info(f"[BULK SEND] Template found: {template.template_name}")
    
    if not doctype:
        doctype = template.doctype_name
        frappe.logger().info(f"[BULK SEND] Using template's doctype: {doctype}")
    
    # STEP 3: Build filters
    if customer_list:
        frappe.logger().info(f"[BULK SEND] Processing customer list mode")
        if isinstance(customer_list, str):
            customer_list = frappe.parse_json(customer_list)
        
        if doctype == "Customer":
            filters = {"name": ["in", customer_list], "disabled": 0}
        else:
            if isinstance(filters, str):
                filters = frappe.parse_json(filters) if filters else {}
            elif not filters:
                filters = {}
            
            if doctype in ["Sales Invoice", "Sales Order", "Quotation"]:
                filters["customer"] = ["in", customer_list]
            elif doctype == "Lead":
                filters["name"] = ["in", customer_list]
            else:
                # Try to find customer field
                customer_field = None
                meta = frappe.get_meta(doctype)
                for field in meta.fields:
                    if field.fieldtype == "Link" and field.options == "Customer":
                        customer_field = field.fieldname
                        break
                
                if customer_field:
                    filters[customer_field] = ["in", customer_list]
                else:
                    return {"status": "error", "message": f"Cannot filter {doctype} by customer."}
    else:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters) if filters else {}
        elif not filters:
            filters = {}
    
    # STEP 4: Get documents
    frappe.logger().info(f"[BULK SEND] Fetching documents from {doctype}")
    docs = frappe.get_all(doctype, filters=filters, fields=["name"], limit=1000)
    frappe.logger().info(f"[BULK SEND] Found {len(docs)} documents to process")
    
    if not docs:
        return {"status": "error", "message": "No documents found matching the filters"}
    
    # STEP 5: Check daily limit via history
    try:
        today = now_datetime().date()
        sent_today = frappe.db.sql("""
            SELECT SUM(sent_count) as count
            FROM `tabWhatsApp Bulk History`
            WHERE DATE(creation) = %s AND status IN ('Processing', 'Completed')
        """, (today,), as_dict=True)
        sent_count_today = sent_today[0].count or 0 if sent_today else 0
        
        if sent_count_today + len(docs) > 1000:
            return {"status": "error", "message": f"Daily limit exceeded. Already sent {sent_count_today} today. Max 1000."}
    except Exception as e:
        frappe.logger().warning(f"[BULK SEND] Could not check daily limit: {str(e)}")
    
    # STEP 6: Create WhatsApp Bulk History record
    frappe.logger().info("[BULK SEND] Creating WhatsApp Bulk History record...")
    try:
        history = frappe.get_doc({
            "doctype": "WhatsApp Bulk History",
            "template": template_id,
            "target_doctype": doctype,
            "status": "Queued",
            "total_recipients": len(docs),
            "sent_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "filters_used": json.dumps(filters) if filters else customer_list,
            "details": json.dumps([]),
            "started_at": now_datetime()
        })
        history.insert(ignore_permissions=True)
        history_name = history.name
        frappe.logger().info(f"[BULK SEND] History record created: {history_name}")
    except Exception as e:
        frappe.logger().error(f"[BULK SEND] Failed to create history: {str(e)}")
        return {"status": "error", "message": f"Could not create history record: {str(e)}"}
    
    # STEP 7: Update status and queue the job
    try:
        history.status = "Processing"
        history.save(ignore_permissions=True)
    except:
        pass
    
    # Queue for processing
    frappe.enqueue(
        'erpnextwats.erpnextwats.api.process_bulk_send',
        history_name=history_name,
        template_id=template_id,
        doctype=doctype,
        doc_names=[d.name for d in docs],
        max_per_hour=max_per_hour,
        queue='long',
        job_name=f"whatsapp_bulk_{history_name}",
        timeout=7200  # 2 hour timeout
    )
    
    # Log successful queue
    log_success(
        activity_type="Bulk Send Queued",
        template=template_id,
        reference_doctype=doctype,
        reference_name=history_name,
        metadata={
            "total_recipients": len(docs),
            "history_name": history_name
        }
    )
    
    return {
        "status": "success",
        "message": f"Bulk send started for {len(docs)} recipients. Processing with smart delays...",
        "history_name": history_name
    }

def process_bulk_send(history_name, template_id, doctype, doc_names, max_per_hour=50):
    """
    Process bulk send with hard retry logic and smart anti-ban delays.
    
    Features:
    - Hard retry: 3 attempts per customer before moving to next
    - Smart delay: 10-60s with adaptive algorithm based on failure rate
    - Real-time updates to WhatsApp Bulk History after each customer
    - Medium phone validation (clean/format numbers)
    """
    import sys
    from datetime import timedelta
    
    # Initialize counters
    sent_count = 0
    failed_count = 0
    skipped_count = 0
    details = []  # Individual results
    
    def log_message(msg):
        """Log to both Frappe logger and stdout"""
        try:
            frappe.logger().info(msg)
        except:
            pass
        print(f"[BULK PROCESS] {msg}", flush=True)
        sys.stdout.flush()
    
    # Get history record
    try:
        history = frappe.get_doc("WhatsApp Bulk History", history_name)
        history.status = "Processing"
        history.save(ignore_permissions=True)
        log_message(f"History record loaded: {history_name}")
    except Exception as e:
        log_message(f"ERROR: Could not load history record {history_name}: {str(e)}")
        return {"status": "error", "message": f"History record not found: {history_name}"}
    
    # Get template
    try:
        template = frappe.get_doc("WhatsApp Template", template_id)
        log_message(f"Template loaded: {template.template_name}")
    except Exception as e:
        log_message(f"ERROR: Could not get template {template_id}: {str(e)}")
        history.status = "Failed"
        history.error_message = f"Template not found: {template_id}"
        history.save(ignore_permissions=True)
        return {"status": "error", "message": f"Template not found: {template_id}"}
    
    log_message("=" * 80)
    log_message("===== Starting bulk send processing =====")
    log_message(f"History: {history_name}")
    log_message(f"Template: {template_id}")
    log_message(f"DocType: {doctype}")
    log_message(f"Total: {len(doc_names)} customers")
    log_message(f"Max per hour: {max_per_hour}")
    log_message(f"Smart delay: 10-60s (adaptive)")
    log_message(f"Retries: 3 attempts per customer")
    log_message("=" * 80)
    
    # Track hourly sends
    hour_start = now_datetime().replace(minute=0, second=0, microsecond=0)
    hourly_sent = 0
    
    # Process each customer
    for idx, doc_name in enumerate(doc_names):
        log_message("-" * 80)
        log_message(f"Customer {idx+1}/{len(doc_names)}: {doc_name}")
        
        customer_result = {
            "doc_name": doc_name,
            "customer_name": None,
            "phone": None,
            "status": "Pending",
            "attempts": 0,
            "error": None
        }
        
        try:
            # Check hourly limit
            current_time = now_datetime()
            if current_time >= hour_start + timedelta(hours=1):
                log_message("New hour - resetting counter")
                hour_start = current_time.replace(minute=0, second=0, microsecond=0)
                hourly_sent = 0
            
            if hourly_sent >= max_per_hour:
                # HOURLY LIMIT REACHED - PAUSE AND AUTO-RESUME
                next_hour = hour_start + timedelta(hours=1)
                wait_seconds = int((next_hour - current_time).total_seconds())
                
                log_message(f"⚠️ HOURLY LIMIT REACHED: {hourly_sent}/{max_per_hour}")
                log_message(f"⏸️ PAUSING JOB - Will resume at {next_hour.strftime('%H:%M')}")
                log_message(f"📊 Progress so far: {idx}/{len(doc_names)} customers processed")
                
                # Save current state
                remaining_customers = doc_names[idx:]  # Customers not yet processed
                history.status = "Paused"
                history.error_message = f"Hourly limit reached ({hourly_sent}/{max_per_hour}). Resuming at {next_hour.strftime('%H:%M')}."
                history.details = json.dumps(details)
                history.sent_count = sent_count
                history.failed_count = failed_count
                history.skipped_count = skipped_count
                
                # Store remaining customers in a way we can retrieve them
                history.flags.remaining_customers = remaining_customers
                history.save(ignore_permissions=True)
                frappe.db.commit()
                
                # Schedule continuation job for next hour
                log_message(f"📅 Scheduling resume job in {wait_seconds} seconds...")
                frappe.enqueue(
                    'erpnextwats.erpnextwats.api.resume_bulk_send',
                    history_name=history_name,
                    template_id=template_id,
                    doctype=doctype,
                    remaining_doc_names=remaining_customers,
                    max_per_hour=max_per_hour,
                    queue='long',
                    job_name=f"whatsapp_bulk_resume_{history_name}",
                    timeout=7200,
                    delay=wait_seconds  # This schedules it with delay
                )
                
                log_message("✅ Job paused successfully. Will auto-resume.")
                return {
                    "status": "paused",
                    "history_name": history_name,
                    "sent": sent_count,
                    "failed": failed_count,
                    "skipped": skipped_count,
                    "resumes_at": str(next_hour),
                    "remaining": len(remaining_customers)
                }
            
            # Load document and get details
            doc = frappe.get_doc(doctype, doc_name)
            customer_result["customer_name"] = getattr(doc, "customer_name", None) or doc_name
            
            # Get phone number
            phone = (getattr(doc, "mobile_no", None) or 
                    getattr(doc, "phone", None) or 
                    getattr(doc, "contact_mobile", None))
            
            if not phone and getattr(doc, "customer", None):
                try:
                    cust = frappe.get_doc("Customer", doc.customer)
                    phone = cust.mobile_no or cust.phone
                except:
                    pass
            
            # Validate phone
            validated_phone = validate_phone_medium(phone)
            customer_result["phone"] = validated_phone or phone
            
            if not validated_phone:
                log_message(f"✗ Invalid phone for {doc_name}: {phone}")
                customer_result["status"] = "Skipped"
                customer_result["error"] = "Invalid or missing phone number"
                skipped_count += 1
                details.append(customer_result)
                continue
            
            log_message(f"Phone: {validated_phone}")
            
            # HARD RETRY LOGIC: Try 3 times before giving up on this customer
            success = False
            final_error = None
            
            for attempt in range(1, 4):  # 3 attempts
                customer_result["attempts"] = attempt
                log_message(f"Attempt {attempt}/3 for {validated_phone}...")
                
                try:
                    result = send_via_template(doc_name, doctype, template_id, validated_phone)
                    
                    if result.get("status") == "success":
                        log_message(f"✓ SUCCESS on attempt {attempt}")
                        success = True
                        customer_result["status"] = "Sent"
                        sent_count += 1
                        hourly_sent += 1
                        break  # Success! Move to next customer
                    else:
                        error_msg = result.get("message", "Unknown error")
                        log_message(f"✗ Failed attempt {attempt}: {error_msg}")
                        final_error = error_msg
                        customer_result["error"] = error_msg
                        
                        # Wait with smart delay before retrying SAME customer
                        if attempt < 3:
                            delay = smart_delay(sent_count, failed_count)
                            log_message(f"Waiting {delay}s before retry...")
                            time.sleep(delay)
                
                except Exception as e:
                    import traceback
                    error_msg = str(e)
                    log_message(f"✗ Exception on attempt {attempt}: {error_msg}")
                    final_error = error_msg
                    customer_result["error"] = error_msg
                    
                    if attempt < 3:
                        delay = smart_delay(sent_count, failed_count)
                        log_message(f"Waiting {delay}s before retry...")
                        time.sleep(delay)
            
            # After 3 attempts
            if not success:
                log_message(f"✗ FAILED after 3 attempts: {validated_phone}")
                customer_result["status"] = "Failed"
                customer_result["error"] = final_error or "Failed after 3 attempts"
                failed_count += 1
            
            # Update progress in real-time
            details.append(customer_result)
            history.sent_count = sent_count
            history.failed_count = failed_count
            history.skipped_count = skipped_count
            history.details = json.dumps(details)
            history.save(ignore_permissions=True)
            frappe.db.commit()
            
            log_message(f"Progress: {sent_count} sent, {failed_count} failed, {skipped_count} skipped")
            
            # Smart delay before next customer (if not last)
            if idx < len(doc_names) - 1:
                delay = smart_delay(sent_count, failed_count)
                log_message(f"Waiting {delay}s before next customer...")
                time.sleep(delay)
        
        except Exception as e:
            import traceback
            log_message(f"✗ EXCEPTION processing {doc_name}: {str(e)}")
            customer_result["status"] = "Failed"
            customer_result["error"] = str(e)
            failed_count += 1
            details.append(customer_result)
            
            # Save progress even on exception
            history.sent_count = sent_count
            history.failed_count = failed_count
            history.skipped_count = skipped_count
            history.details = json.dumps(details)
            history.save(ignore_permissions=True)
            frappe.db.commit()
            continue
    
    # Final update
    end_time = now_datetime()
    history.status = "Completed"
    history.sent_count = sent_count
    history.failed_count = failed_count
    history.skipped_count = skipped_count
    history.details = json.dumps(details)
    history.completed_at = end_time
    history.save(ignore_permissions=True)
    frappe.db.commit()
    
    log_message("=" * 80)
    log_message("===== Bulk send completed =====")
    log_message(f"Sent: {sent_count}")
    log_message(f"Failed: {failed_count}")
    log_message(f"Skipped: {skipped_count}")
    log_message(f"Duration: {(end_time - history.started_at).total_seconds() // 60} minutes")
    log_message("=" * 80)
    
    # Log completion to activity log
    duration_seconds = (end_time - history.started_at).total_seconds()
    log_success(
        activity_type="Bulk Send Completed",
        template=template_id,
        reference_doctype=doctype,
        reference_name=history_name,
        duration_ms=int(duration_seconds * 1000),
        metadata={
            "sent": sent_count,
            "failed": failed_count,
            "skipped": skipped_count,
            "total": len(doc_names),
            "success_rate": round((sent_count / len(doc_names) * 100), 2) if doc_names else 0
        }
    )
    
    return {
        "status": "completed",
        "history_name": history_name,
        "sent": sent_count,
        "failed": failed_count,
        "skipped": skipped_count
    }

@frappe.whitelist()
def render_template_preview(doctype_name, message, docname):
    """Renders a Jinja message using a reference document for preview."""
    try:
        doc = frappe.get_doc(doctype_name, docname)
        ctx = get_rendering_context(doc)
        return frappe.render_template(message, ctx)
    except Exception as e:
        return f"Error rendering preview: {str(e)}"

def resume_bulk_send(history_name, template_id, doctype, remaining_doc_names, max_per_hour=50):
    """
    Resume a bulk send job that was paused due to hourly limit.
    This is called automatically after the delay period.
    """
    import sys
    from datetime import timedelta
    
    # Initialize counters - will be loaded from history
    sent_count = 0
    failed_count = 0
    skipped_count = 0
    details = []
    
    def log_message(msg):
        """Log to both Frappe logger and stdout"""
        try:
            frappe.logger().info(msg)
        except:
            pass
        print(f"[BULK RESUME] {msg}", flush=True)
        sys.stdout.flush()
    
    # Get history record
    try:
        history = frappe.get_doc("WhatsApp Bulk History", history_name)
        
        # Load previous progress
        sent_count = history.sent_count or 0
        failed_count = history.failed_count or 0
        skipped_count = history.skipped_count or 0
        
        if history.details:
            try:
                details = json.loads(history.details)
            except:
                details = []
        
        # Update status back to Processing
        history.status = "Processing"
        history.error_message = None  # Clear the pause message
        history.save(ignore_permissions=True)
        
        log_message(f"Resuming job: {history_name}")
        log_message(f"Previous progress: {sent_count} sent, {failed_count} failed, {skipped_count} skipped")
        log_message(f"Remaining customers: {len(remaining_doc_names)}")
    except Exception as e:
        log_message(f"ERROR: Could not load history record {history_name}: {str(e)}")
        return {"status": "error", "message": f"History record not found: {history_name}"}
    
    # Get template
    try:
        template = frappe.get_doc("WhatsApp Template", template_id)
        log_message(f"Template loaded: {template.template_name}")
    except Exception as e:
        log_message(f"ERROR: Could not get template {template_id}: {str(e)}")
        history.status = "Failed"
        history.error_message = f"Template not found: {template_id}"
        history.save(ignore_permissions=True)
        return {"status": "error", "message": f"Template not found: {template_id}"}
    
    log_message("=" * 80)
    log_message("===== RESUMING bulk send processing =====")
    log_message(f"History: {history_name}")
    log_message(f"Template: {template_id}")
    log_message(f"Remaining: {len(remaining_doc_names)} customers")
    log_message(f"Max per hour: {max_per_hour}")
    log_message("=" * 80)
    
    # Reset hourly counter for new hour
    hour_start = now_datetime().replace(minute=0, second=0, microsecond=0)
    hourly_sent = 0
    
    # Process remaining customers
    for idx, doc_name in enumerate(remaining_doc_names):
        log_message("-" * 80)
        log_message(f"Customer {idx+1}/{len(remaining_doc_names)} (Total: {len(details) + idx + 1}): {doc_name}")
        
        customer_result = {
            "doc_name": doc_name,
            "customer_name": None,
            "phone": None,
            "status": "Pending",
            "attempts": 0,
            "error": None
        }
        
        try:
            # Check hourly limit (will pause again if needed)
            current_time = now_datetime()
            if current_time >= hour_start + timedelta(hours=1):
                log_message("New hour - resetting counter")
                hour_start = current_time.replace(minute=0, second=0, microsecond=0)
                hourly_sent = 0
            
            if hourly_sent >= max_per_hour:
                # ANOTHER HOURLY LIMIT HIT - Pause again
                next_hour = hour_start + timedelta(hours=1)
                wait_seconds = int((next_hour - current_time).total_seconds())
                
                log_message(f"⚠️ HOURLY LIMIT REACHED AGAIN: {hourly_sent}/{max_per_hour}")
                log_message(f"⏸️ PAUSING AGAIN - Will resume at {next_hour.strftime('%H:%M')}")
                
                remaining = remaining_doc_names[idx:]
                history.status = "Paused"
                history.error_message = f"Hourly limit reached again ({hourly_sent}/{max_per_hour}). Resuming at {next_hour.strftime('%H:%M')}."
                history.details = json.dumps(details)
                history.sent_count = sent_count
                history.failed_count = failed_count
                history.skipped_count = skipped_count
                history.save(ignore_permissions=True)
                frappe.db.commit()
                
                # Schedule another resume
                frappe.enqueue(
                    'erpnextwats.erpnextwats.api.resume_bulk_send',
                    history_name=history_name,
                    template_id=template_id,
                    doctype=doctype,
                    remaining_doc_names=remaining,
                    max_per_hour=max_per_hour,
                    queue='long',
                    job_name=f"whatsapp_bulk_resume_{history_name}_2",
                    timeout=7200,
                    delay=wait_seconds
                )
                
                return {
                    "status": "paused",
                    "history_name": history_name,
                    "sent": sent_count,
                    "failed": failed_count,
                    "skipped": skipped_count,
                    "resumes_at": str(next_hour),
                    "remaining": len(remaining)
                }
            
            # Load document and get details
            doc = frappe.get_doc(doctype, doc_name)
            customer_result["customer_name"] = getattr(doc, "customer_name", None) or doc_name
            
            # Get phone number
            phone = (getattr(doc, "mobile_no", None) or 
                    getattr(doc, "phone", None) or 
                    getattr(doc, "contact_mobile", None))
            
            if not phone and getattr(doc, "customer", None):
                try:
                    cust = frappe.get_doc("Customer", doc.customer)
                    phone = cust.mobile_no or cust.phone
                except:
                    pass
            
            # Validate phone
            validated_phone = validate_phone_medium(phone)
            customer_result["phone"] = validated_phone or phone
            
            if not validated_phone:
                log_message(f"✗ Invalid phone for {doc_name}: {phone}")
                customer_result["status"] = "Skipped"
                customer_result["error"] = "Invalid or missing phone number"
                skipped_count += 1
                details.append(customer_result)
                continue
            
            log_message(f"Phone: {validated_phone}")
            
            # HARD RETRY LOGIC
            success = False
            final_error = None
            
            for attempt in range(1, 4):
                customer_result["attempts"] = attempt
                log_message(f"Attempt {attempt}/3 for {validated_phone}...")
                
                try:
                    result = send_via_template(doc_name, doctype, template_id, validated_phone)
                    
                    if result.get("status") == "success":
                        log_message(f"✓ SUCCESS on attempt {attempt}")
                        success = True
                        customer_result["status"] = "Sent"
                        sent_count += 1
                        hourly_sent += 1
                        break
                    else:
                        error_msg = result.get("message", "Unknown error")
                        log_message(f"✗ Failed attempt {attempt}: {error_msg}")
                        final_error = error_msg
                        customer_result["error"] = error_msg
                        
                        if attempt < 3:
                            delay = smart_delay(sent_count, failed_count)
                            log_message(f"Waiting {delay}s before retry...")
                            time.sleep(delay)
                
                except Exception as e:
                    error_msg = str(e)
                    log_message(f"✗ Exception on attempt {attempt}: {error_msg}")
                    final_error = error_msg
                    customer_result["error"] = error_msg
                    
                    if attempt < 3:
                        delay = smart_delay(sent_count, failed_count)
                        log_message(f"Waiting {delay}s before retry...")
                        time.sleep(delay)
            
            if not success:
                log_message(f"✗ FAILED after 3 attempts: {validated_phone}")
                customer_result["status"] = "Failed"
                customer_result["error"] = final_error or "Failed after 3 attempts"
                failed_count += 1
            
            # Update progress
            details.append(customer_result)
            history.sent_count = sent_count
            history.failed_count = failed_count
            history.skipped_count = skipped_count
            history.details = json.dumps(details)
            history.save(ignore_permissions=True)
            frappe.db.commit()
            
            log_message(f"Progress: {sent_count} sent, {failed_count} failed, {skipped_count} skipped (Total: {len(details)})")
            
            # Smart delay before next customer
            if idx < len(remaining_doc_names) - 1:
                delay = smart_delay(sent_count, failed_count)
                log_message(f"Waiting {delay}s before next customer...")
                time.sleep(delay)
        
        except Exception as e:
            log_message(f"✗ EXCEPTION processing {doc_name}: {str(e)}")
            customer_result["status"] = "Failed"
            customer_result["error"] = str(e)
            failed_count += 1
            details.append(customer_result)
            
            history.sent_count = sent_count
            history.failed_count = failed_count
            history.skipped_count = skipped_count
            history.details = json.dumps(details)
            history.save(ignore_permissions=True)
            frappe.db.commit()
            continue
    
    # Final update
    end_time = now_datetime()
    history.status = "Completed"
    history.sent_count = sent_count
    history.failed_count = failed_count
    history.skipped_count = skipped_count
    history.details = json.dumps(details)
    history.completed_at = end_time
    history.save(ignore_permissions=True)
    frappe.db.commit()
    
    log_message("=" * 80)
    log_message("===== Bulk send RESUMED and COMPLETED =====")
    log_message(f"Final: {sent_count} sent, {failed_count} failed, {skipped_count} skipped")
    log_message(f"Total duration: {(end_time - history.started_at).total_seconds() // 60} minutes")
    log_message("=" * 80)
    
    return {
        "status": "completed",
        "history_name": history_name,
        "sent": sent_count,
        "failed": failed_count,
        "skipped": skipped_count
    }

def handle_auto_send(doc, method):
    """Handles automatic sending of WhatsApp messages based on template settings."""
    # Only process on_submit events - ignore on_update/on_save
    if method != "on_submit":
        return
    
    if not doc or not hasattr(doc, 'doctype'):
        return
    
    # Skip if we're in a migration context
    if getattr(frappe.flags, 'in_migrate', False) or getattr(frappe.flags, 'in_install', False):
        return
    
    # Skip during migration or if fields don't exist yet
    try:
        # Check if the new fields exist in the database schema
        columns = frappe.db.get_table_columns("WhatsApp Template")
        if 'enable_auto_send' not in columns:
            # Fields don't exist yet, skip auto-send
            return
    except:
        # If we can't check, skip to be safe
        return
    
    # Get all templates for this doctype with auto-send enabled
    try:
        templates = frappe.get_all("WhatsApp Template",
            filters={
                "doctype_name": doc.doctype,
                "enable_auto_send": 1
            },
            fields=["name", "auto_send_timing", "auto_send_delay", "auto_send_status", "auto_send_conditions", "recurring_send_time"]
        )
    except Exception as e:
        # If fields don't exist, just return silently
        frappe.logger().debug(f"Auto-send fields not available yet: {str(e)}")
        return
    
    if not templates:
        return
    
    # Log auto-send triggered (only on_submit)
    log_info(
        activity_type="Auto Send Triggered",
        status="Info",
        reference_doctype=doc.doctype,
        reference_name=doc.name,
        metadata={
            "trigger_method": "on_submit",
            "template_count": len(templates),
            "doc_status": doc.status if hasattr(doc, 'status') else None,
            "docstatus": doc.docstatus if hasattr(doc, 'docstatus') else None
        }
    )
    
    for template_data in templates:
        try:
            template = frappe.get_doc("WhatsApp Template", template_data.name)
            
            # Check conditions if specified
            if not check_document_conditions(doc, template):
                log_info(
                    activity_type="Auto Send Skipped",
                    status="Info",
                    template=template.name,
                    reference_doctype=doc.doctype,
                    reference_name=doc.name,
                    metadata={"reason": "conditions_not_met"}
                )
                continue
            
            # Handle different timing options
            if template.auto_send_timing == "Immediate":
                # Send immediately
                log_info(
                    activity_type="Auto Send Immediate",
                    status="Info",
                    template=template.name,
                    reference_doctype=doc.doctype,
                    reference_name=doc.name
                )
                send_auto_message(doc, template.name)
                
            elif template.auto_send_timing == "On Status Change":
                # Check if current status matches trigger status
                if template.auto_send_status:
                    if check_status_condition(doc, template.auto_send_status):
                        log_info(
                            activity_type="Auto Send Status Change",
                            status="Info",
                            template=template.name,
                            reference_doctype=doc.doctype,
                            reference_name=doc.name,
                            metadata={"trigger_status": template.auto_send_status}
                        )
                        send_auto_message(doc, template.name)
            
            elif template.auto_send_timing in ["After Minutes", "After Hours", "After Days"]:
                # Schedule delayed send
                if template.auto_send_delay:
                    log_info(
                        activity_type="Auto Send Scheduled",
                        status="Info",
                        template=template.name,
                        reference_doctype=doc.doctype,
                        reference_name=doc.name,
                        metadata={
                            "timing": template.auto_send_timing,
                            "delay": template.auto_send_delay
                        }
                    )
                    schedule_delayed_send(doc, template.name, template.auto_send_timing, template.auto_send_delay)
            
            elif template.auto_send_timing in ["Every Minute", "Every Hour", "Every Day", "Every Week", "Every Month"]:
                # Recurring sends are handled by scheduler, but we can trigger on document creation/update
                # Check if conditions are met for immediate send
                if check_document_conditions(doc, template):
                    log_info(
                        activity_type="Auto Send Recurring",
                        status="Info",
                        template=template.name,
                        reference_doctype=doc.doctype,
                        reference_name=doc.name,
                        metadata={"frequency": template.auto_send_timing}
                    )
                    send_auto_message(doc, template.name)
        except Exception as e:
            # Log error with details
            log_error(
                activity_type="Auto Send Error",
                error=e,
                template=template_data.name,
                reference_doctype=doc.doctype,
                reference_name=doc.name
            )
            continue

def check_status_condition(doc, status_condition):
    """Check if document status matches the condition."""
    # Handle special statuses
    if status_condition == "Paid":
        # Check if invoice/order is fully paid
        if doc.doctype in ["Sales Invoice", "Purchase Invoice"]:
            outstanding = frappe.utils.flt(getattr(doc, 'outstanding_amount', 0))
            return outstanding == 0 and doc.docstatus == 1
        elif doc.doctype == "Sales Order":
            # Check if order is fully paid (if payment tracking exists)
            return getattr(doc, 'status', '') == 'Completed'
    
    elif status_condition == "Unpaid":
        if doc.doctype in ["Sales Invoice", "Purchase Invoice"]:
            outstanding = frappe.utils.flt(getattr(doc, 'outstanding_amount', 0))
            return outstanding > 0 and doc.docstatus == 1
    
    elif status_condition == "Overdue":
        if doc.doctype in ["Sales Invoice", "Purchase Invoice"]:
            from frappe.utils import getdate, today
            due_date = getattr(doc, 'due_date', None)
            if due_date:
                return getdate(due_date) < getdate(today()) and frappe.utils.flt(getattr(doc, 'outstanding_amount', 0)) > 0
    
    elif status_condition == "Submitted":
        return doc.docstatus == 1
    
    elif status_condition == "Draft":
        return doc.docstatus == 0
    
    elif status_condition == "Cancelled":
        return doc.docstatus == 2
    
    # Fallback to direct status match
    current_status = getattr(doc, 'status', None) or getattr(doc, 'docstatus', None)
    return str(current_status) == str(status_condition)

def check_conditions(doc, conditions):
    """Check if document meets the specified conditions."""
    if not conditions:
        return True
    
    # Handle special conditions
    if isinstance(conditions, dict):
        for field, value in conditions.items():
            # Special handling for payment status
            if field == "is_paid":
                if doc.doctype in ["Sales Invoice", "Purchase Invoice"]:
                    outstanding = frappe.utils.flt(getattr(doc, 'outstanding_amount', 0))
                    is_paid = outstanding == 0 and doc.docstatus == 1
                    if bool(value) != is_paid:
                        return False
                continue
            
            if field == "outstanding_amount":
                outstanding = frappe.utils.flt(getattr(doc, 'outstanding_amount', 0))
                if isinstance(value, str):
                    if value.startswith(('>', '<', '>=', '<=')):
                        operator = value.split()[0]
                        compare_value = frappe.utils.flt(value.split()[1]) if len(value.split()) > 1 else 0
                        
                        if operator == '>' and not (outstanding > compare_value):
                            return False
                        elif operator == '<' and not (outstanding < compare_value):
                            return False
                        elif operator == '>=' and not (outstanding >= compare_value):
                            return False
                        elif operator == '<=' and not (outstanding <= compare_value):
                            return False
                    elif value.startswith('='):
                        compare_value = frappe.utils.flt(value.replace('=', '').strip())
                        if outstanding != compare_value:
                            return False
                else:
                    if outstanding != frappe.utils.flt(value):
                        return False
                continue
            
            doc_value = getattr(doc, field, None)
            if isinstance(value, str) and value.startswith(('>', '<', '>=', '<=')):
                # Handle comparison operators
                operator = value.split()[0]
                compare_value = frappe.utils.flt(value.split()[1]) if len(value.split()) > 1 else 0
                doc_value = frappe.utils.flt(doc_value) if doc_value else 0
                
                if operator == '>' and not (doc_value > compare_value):
                    return False
                elif operator == '<' and not (doc_value < compare_value):
                    return False
                elif operator == '>=' and not (doc_value >= compare_value):
                    return False
                elif operator == '<=' and not (doc_value <= compare_value):
                    return False
            elif isinstance(value, str) and value.startswith('='):
                compare_value = value.replace('=', '').strip()
                if str(doc_value) != str(compare_value):
                    return False
            else:
                if str(doc_value) != str(value):
                    return False
    return True

def check_document_conditions(doc, template):
    """Check if document meets template conditions for recurring sends."""
    # Check additional conditions
    if template.auto_send_conditions:
        try:
            conditions = frappe.parse_json(template.auto_send_conditions)
            if not check_conditions(doc, conditions):
                return False
        except:
            pass
    
    # Check status condition if set
    if template.auto_send_status:
        if not check_status_condition(doc, template.auto_send_status):
            return False
    
    return True

def send_auto_message(doc, template_name):
    """Send WhatsApp message automatically."""
    start_time = time.time()
    try:
        result = send_via_template(doc.name, doc.doctype, template_name)
        duration_ms = int((time.time() - start_time) * 1000)
        
        if result.get('status') == 'success':
            log_success(
                activity_type="Auto Send Completed",
                template=template_name,
                reference_doctype=doc.doctype,
                reference_name=doc.name,
                customer=doc.customer if hasattr(doc, 'customer') else doc.name,
                duration_ms=duration_ms,
                metadata={
                    "message_status": "sent",
                    "auto_send": True
                }
            )
        else:
            log_error(
                activity_type="Auto Send Failed",
                error=result.get('message', 'Unknown error'),
                template=template_name,
                reference_doctype=doc.doctype,
                reference_name=doc.name,
                customer=doc.customer if hasattr(doc, 'customer') else doc.name,
                duration_ms=duration_ms
            )
    except Exception as e:
        log_error(
            activity_type="Auto Send Exception",
            error=e,
            template=template_name,
            reference_doctype=doc.doctype,
            reference_name=doc.name
        )

def schedule_delayed_send(doc, template_name, timing, delay):
    """Schedule a delayed WhatsApp message send."""
    from frappe.utils import add_to_date, now_datetime
    
    # Calculate send time
    if timing == "After Minutes":
        send_time = add_to_date(now_datetime(), minutes=delay)
    elif timing == "After Hours":
        send_time = add_to_date(now_datetime(), hours=delay)
    elif timing == "After Days":
        send_time = add_to_date(now_datetime(), days=delay)
    else:
        return
    
    # Store scheduled send in a custom doctype or use frappe's scheduler
    # For now, we'll use a simple approach: store in a JSON field or create a Scheduled Job Type
    # Create a scheduled job entry
    job_name = f"whatsapp_auto_send_{doc.doctype}_{doc.name}_{template_name}"
    
    # Use frappe's background job scheduler
    frappe.enqueue(
        'erpnextwats.erpnextwats.api.send_auto_message',
        doc=doc,
        template_name=template_name,
        queue='long',
        job_name=job_name,
        at_front=False
    )
    
    # Note: For true delayed execution, you'd need to use a Scheduled Job Type
    # or check in the hourly scheduler. For simplicity, we'll send immediately
    # but log the intended delay. For production, implement proper job scheduling.
    
    frappe.logger().info(f"Scheduled WhatsApp message for {doc.doctype} {doc.name} (intended time: {send_time}) using template {template_name}")
    
    # For actual delayed sending, we'll check in process_delayed_messages
    # Store the schedule info
    if not hasattr(frappe.local, 'whatsapp_scheduled_messages'):
        frappe.local.whatsapp_scheduled_messages = []
    
    frappe.local.whatsapp_scheduled_messages.append({
        'doc_type': doc.doctype,
        'doc_name': doc.name,
        'template_name': template_name,
        'send_time': send_time.isoformat()
    })

def process_delayed_messages():
    """Process any pending delayed WhatsApp messages (runs hourly)."""
    # Delayed messages are handled by frappe.enqueue with timing
    pass

def process_recurring_messages():
    """Process recurring messages - runs every minute."""
    try:
        # Check if auto-send fields exist
        columns = frappe.db.get_table_columns("WhatsApp Template")
        if 'enable_auto_send' not in columns:
            return
    except:
        return
    
    templates = frappe.get_all("WhatsApp Template",
        filters={
            "enable_auto_send": 1,
            "auto_send_timing": "Every Minute"
        },
        fields=["name", "doctype_name", "auto_send_status", "auto_send_conditions"]
    )
    
    for template_data in templates:
        try:
            template = frappe.get_doc("WhatsApp Template", template_data.name)
            process_recurring_template(template)
        except:
            pass

def process_daily_recurring():
    """Process daily recurring messages."""
    try:
        columns = frappe.db.get_table_columns("WhatsApp Template")
        if 'enable_auto_send' not in columns:
            return
    except:
        return
    
    templates = frappe.get_all("WhatsApp Template",
        filters={
            "enable_auto_send": 1,
            "auto_send_timing": "Every Day"
        },
        fields=["name", "doctype_name", "auto_send_status", "auto_send_conditions", "recurring_send_time"]
    )
    
    for template_data in templates:
        try:
            template = frappe.get_doc("WhatsApp Template", template_data.name)
            process_recurring_template(template)
        except:
            pass

def process_monthly_recurring():
    """Process monthly recurring messages."""
    try:
        columns = frappe.db.get_table_columns("WhatsApp Template")
        if 'enable_auto_send' not in columns:
            return
    except:
        return
    
    templates = frappe.get_all("WhatsApp Template",
        filters={
            "enable_auto_send": 1,
            "auto_send_timing": "Every Month"
        },
        fields=["name", "doctype_name", "auto_send_status", "auto_send_conditions", "recurring_send_time"]
    )
    
    for template_data in templates:
        try:
            template = frappe.get_doc("WhatsApp Template", template_data.name)
            process_recurring_template(template)
        except:
            pass

def process_recurring_template(template):
    """Process a recurring template - find matching documents and send."""
    doctype = template.doctype_name
    
    try:
        # Get documents that match conditions
        filters = {"docstatus": ["!=", 2]}  # Not cancelled
        
        # Add status filters if specified
        if template.auto_send_status:
            if template.auto_send_status == "Paid":
                filters["outstanding_amount"] = 0
            elif template.auto_send_status == "Unpaid":
                filters["outstanding_amount"] = [">", 0]
            elif template.auto_send_status == "Submitted":
                filters["docstatus"] = 1
        
        docs = frappe.get_all(doctype, filters=filters, fields=["name"], limit=50)
        
        for doc_data in docs:
            try:
                doc = frappe.get_doc(doctype, doc_data.name)
                if check_document_conditions(doc, template):
                    send_auto_message(doc, template.name)
            except:
                pass
    except:
        pass
# ===== ENHANCED AUTO-SEND WITH CUSTOMER SELECTION =====

def process_recurring_to_selected_customers(template_name):
    """
    Process recurring auto-send to manually selected customers.
    Runs via scheduler (weekly/monthly).
    """
    start_time = time.time()
    
    try:
        template = frappe.get_doc("WhatsApp Template", template_name)
        
        if not template.enable_auto_send or template.auto_send_mode != "Recurring":
            log_info(
                activity_type="Recurring Send Skipped",
                template=template_name,
                metadata={"reason": "auto_send_not_enabled_or_wrong_mode"}
            )
            return
        
        # Get selected customers
        selected_customers = template.selected_customers or []
        if not selected_customers:
            log_warning(
                activity_type="Recurring Send Skipped",
                template=template_name,
                metadata={"reason": "no_customers_selected"}
            )
            return
        
        log_info(
            activity_type="Recurring Send Started",
            template=template_name,
            metadata={
                "customer_count": len(selected_customers),
                "frequency": template.auto_send_frequency,
                "cooldown_hours": template.cooldown_hours,
                "max_per_customer": template.max_per_customer
            }
        )
        
        # Track counts for anti-ban
        sent_count = 0
        failed_count = 0
        customer_results = []
        
        # Process each selected customer with anti-ban delays
        for idx, customer_row in enumerate(selected_customers):
            customer_result = {
                "customer": customer_row.customer,
                "status": "Pending",
                "phone": None,
                "error": None,
                "attempts": 0
            }
            
            try:
                customer = frappe.get_doc("Customer", customer_row.customer)
                phone = validate_phone_medium(customer.mobile_no or customer.phone)
                customer_result["phone"] = phone
                
                if not phone:
                    log_warning(
                        activity_type="Recurring Send Customer Skipped",
                        template=template_name,
                        customer=customer.name,
                        error_details="No valid phone number",
                        metadata={"step": "phone_validation"}
                    )
                    failed_count += 1
                    customer_result["status"] = "Skipped"
                    customer_result["error"] = "No valid phone"
                    customer_results.append(customer_result)
                    continue
                
                # Check customer cooldown
                if not check_customer_cooldown(customer.name, template.name, template.cooldown_hours):
                    log_info(
                        activity_type="Recurring Send Customer Skipped",
                        template=template_name,
                        customer=customer.name,
                        metadata={"reason": "in_cooldown_period", "cooldown_hours": template.cooldown_hours}
                    )
                    customer_result["status"] = "Skipped"
                    customer_result["error"] = "In cooldown period"
                    customer_results.append(customer_result)
                    continue
                
                # Check per-customer daily limit
                if not check_customer_daily_limit(customer.name, template.name, template.max_per_customer):
                    log_info(
                        activity_type="Recurring Send Customer Skipped",
                        template=template_name,
                        customer=customer.name,
                        metadata={"reason": "daily_limit_reached", "max_per_customer": template.max_per_customer}
                    )
                    customer_result["status"] = "Skipped"
                    customer_result["error"] = "Daily limit reached"
                    customer_results.append(customer_result)
                    continue
                
                # Render message with customer context
                message = frappe.render_template(template.message, {"doc": customer})
                
                # Send with retry logic
                success = False
                final_error = None
                
                for attempt in range(1, 4):  # 3 attempts
                    customer_result["attempts"] = attempt
                    
                    try:
                        result = send_message_direct(phone, message, template)
                        
                        if result.get("status") == "success":
                            log_success(
                                activity_type="Recurring Send Customer Success",
                                template=template_name,
                                customer=customer.name,
                                customer_phone=phone,
                                message_content=message[:200],
                                retry_count=attempt,
                                metadata={"attempts_used": attempt}
                            )
                            success = True
                            sent_count += 1
                            customer_result["status"] = "Sent"
                            break
                        else:
                            final_error = result.get("message", "Unknown error")
                            log_warning(
                                activity_type="Recurring Send Customer Retry",
                                warning_msg=f"Attempt {attempt} failed",
                                template=template_name,
                                customer=customer.name,
                                customer_phone=phone,
                                error_details=final_error,
                                retry_count=attempt,
                                metadata={"attempt": attempt}
                            )
                            
                            if attempt < 3:
                                delay = smart_delay(sent_count, failed_count)
                                time.sleep(delay)
                    
                    except Exception as e:
                        final_error = str(e)
                        log_error(
                            activity_type="Recurring Send Customer Exception",
                            error=e,
                            template=template_name,
                            customer=customer.name,
                            customer_phone=phone,
                            retry_count=attempt,
                            metadata={"attempt": attempt}
                        )
                        if attempt < 3:
                            delay = smart_delay(sent_count, failed_count)
                            time.sleep(delay)
                
                if not success:
                    failed_count += 1
                    customer_result["status"] = "Failed"
                    customer_result["error"] = final_error or "Failed after 3 attempts"
                    log_error(
                        activity_type="Recurring Send Customer Failed",
                        error=final_error or "Failed after 3 attempts",
                        template=template_name,
                        customer=customer.name,
                        customer_phone=phone,
                        retry_count=3,
                        metadata={"total_attempts": 3}
                    )
                
                customer_results.append(customer_result)
                
                # Smart delay before next customer (anti-ban)
                if idx < len(selected_customers) - 1:
                    delay = smart_delay(sent_count, failed_count)
                    log_info(
                        activity_type="Recurring Send Delay",
                        template=template_name,
                        metadata={"delay_seconds": delay, "customer_index": idx + 1, "total": len(selected_customers)}
                    )
                    time.sleep(delay)
                    
            except Exception as e:
                failed_count += 1
                customer_result["status"] = "Failed"
                customer_result["error"] = str(e)
                customer_results.append(customer_result)
                log_error(
                    activity_type="Recurring Send Customer Error",
                    error=e,
                    template=template_name,
                    customer=customer_row.customer,
                    metadata={"step": "processing"}
                )
                continue
        
        duration_ms = int((time.time() - start_time) * 1000)
        
        log_success(
            activity_type="Recurring Send Completed",
            template=template_name,
            duration_ms=duration_ms,
            metadata={
                "sent": sent_count,
                "failed": failed_count,
                "total": len(selected_customers),
                "success_rate": round((sent_count / len(selected_customers) * 100), 2) if selected_customers else 0,
                "customer_results": customer_results[:10]  # Log first 10 for detail
            }
        )
        
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        log_error(
            activity_type="Recurring Send Failed",
            error=e,
            template=template_name,
            duration_ms=duration_ms,
            metadata={"step": "process_recurring_to_selected_customers"}
        )


def process_weekly_recurring():
    """Process all weekly recurring templates. Runs every week."""
    try:
        templates = frappe.get_all("WhatsApp Template",
            filters={
                "enable_auto_send": 1,
                "auto_send_mode": "Recurring",
                "auto_send_frequency": "Weekly"
            },
            fields=["name"]
        )
        
        for template_data in templates:
            frappe.enqueue(
                'erpnextwats.erpnextwats.api.process_recurring_to_selected_customers',
                template_name=template_data.name,
                queue='long',
                timeout=7200
            )
    except Exception as e:
        frappe.logger().error(f"[AUTO-SEND] Error in process_weekly_recurring: {str(e)}")


def process_monthly_recurring_enhanced():
    """Process all monthly recurring templates. Runs every month."""
    try:
        templates = frappe.get_all("WhatsApp Template",
            filters={
                "enable_auto_send": 1,
                "auto_send_mode": "Recurring",
                "auto_send_frequency": "Monthly"
            },
            fields=["name"]
        )
        
        for template_data in templates:
            frappe.enqueue(
                'erpnextwats.erpnextwats.api.process_recurring_to_selected_customers',
                template_name=template_data.name,
                queue='long',
                timeout=7200
            )
    except Exception as e:
        frappe.logger().error(f"[AUTO-SEND] Error in process_monthly_recurring_enhanced: {str(e)}")


def check_customer_cooldown(customer, template_name, cooldown_hours):
    """Check if customer is in cooldown period for this template."""
    try:
        if not cooldown_hours:
            return True
        
        from frappe.utils import add_to_date, now_datetime
        
        # Find last sent time
        last_sent = frappe.db.get_value("WhatsApp Bulk History",
            {
                "template": template_name,
                "status": ["in", ["Processing", "Completed"]]
            },
            "completed_at",
            order_by="completed_at desc"
        )
        
        if not last_sent:
            return True
        
        # Check if cooldown passed
        next_allowed = add_to_date(last_sent, hours=cooldown_hours)
        return now_datetime() >= next_allowed
        
    except Exception as e:
        frappe.logger().error(f"[AUTO-SEND] Error checking cooldown: {str(e)}")
        return True


def check_customer_daily_limit(customer, template_name, max_per_day):
    """Check if customer has exceeded daily limit."""
    try:
        if not max_per_day:
            return True
        
        today = now_datetime().date()
        
        # Count sends today
        sent_today = frappe.db.count("WhatsApp Bulk History",
            {
                "template": template_name,
                "status": ["in", ["Processing", "Completed"]],
                "creation": ["between", [f"{today} 00:00:00", f"{today} 23:59:59"]]
            }
        )
        
        return sent_today < max_per_day
        
    except Exception as e:
        frappe.logger().error(f"[AUTO-SEND] Error checking daily limit: {str(e)}")
        return True


def send_message_direct(phone, message, template):
    """Send WhatsApp message directly without document."""
    try:
        # Use the existing send_via_template logic but with direct message
        data = {
            "userId": "shared_company_session",
            "to": phone,
            "message": message,
            "media": None
        }
        
        result = proxy_to_service("POST", "api/whatsapp/send", data)
        return result
        
    except Exception as e:
        return {"status": "error", "message": str(e)}


def log_auto_send(template_name, customer, status, error):
    """Log auto-send attempt."""
    try:
        frappe.logger().info(f"[AUTO-SEND] {template_name} -> {customer}: {status}")
        if error:
            frappe.logger().error(f"[AUTO-SEND] Error: {error}")
    except:
        pass


@frappe.whitelist()
def preview_matching_documents(template_name, conditions_json):
    """
    Preview which documents match the visual conditions.
    Returns list of matching documents for user review.
    """
    try:
        template = frappe.get_doc("WhatsApp Template", template_name)
        doctype = template.doctype_name
        
        if not conditions_json:
            # Return first 10 documents of this type
            docs = frappe.get_all(doctype, fields=["name"], limit=10)
            return {"status": "success", "count": len(docs), "documents": [d.name for d in docs]}
        
        # Parse visual conditions
        conditions = json.loads(conditions_json)
        
        # Build frappe filters from visual conditions
        filters = build_filters_from_visual_conditions(conditions)
        
        # Get matching documents
        docs = frappe.get_all(doctype, filters=filters, fields=["name"], limit=50)
        
        return {
            "status": "success",
            "count": len(docs),
            "documents": [d.name for d in docs],
            "filters_applied": filters
        }
        
    except Exception as e:
        return {"status": "error", "message": str(e)}


def build_filters_from_visual_conditions(conditions):
    """Convert visual builder conditions to frappe filters."""
    try:
        filters = {}
        
        if not conditions or not isinstance(conditions, dict):
            return filters
        
        rules = conditions.get("rules", [])
        
        for rule in rules:
            if isinstance(rule, dict):
                field = rule.get("field")
                op = rule.get("operator", "=")
                value = rule.get("value")
                
                if field and value is not None:
                    if op == "=":
                        filters[field] = value
                    elif op == ">":
                        filters[field] = [">", value]
                    elif op == "<":
                        filters[field] = ["<", value]
                    elif op == ">=":
                        filters[field] = [">=", value]
                    elif op == "<=":
                        filters[field] = ["<=", value]
                    elif op == "!=":
                        filters[field] = ["!=", value]
        
        return filters
        
    except Exception as e:
        frappe.logger().error(f"[AUTO-SEND] Error building filters: {str(e)}")
        return {}


