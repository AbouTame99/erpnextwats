import frappe
import requests
import json
import base64
import random
import re
import time
import urllib.parse
import traceback
import os
import sys
import mimetypes
from datetime import datetime, timedelta
from frappe.utils.pdf import get_pdf
from frappe.utils import get_url, now_datetime, today
from erpnext.accounts.utils import get_balance_on

# ===== CORE INFRASTRUCTURE =====

def proxy_to_service(method, endpoint, data=None):
    """Proxies request to the Node.js WhatsApp gateway."""
    url = f"http://localhost:3000/{endpoint.lstrip('/')}"
    try:
        if method.upper() == "POST":
            response = requests.post(url, json=data, timeout=60)
        else:
            response = requests.get(url, timeout=30)
        
        response.raise_for_status()
        return response.json()
    except Exception as e:
        frappe.logger().error(f"Gateway connection error: {str(e)}")
        return {"status": "error", "message": f"Gateway error: {str(e)}"}

def get_rendering_context(doc):
    """Provides context for Jinja templates."""
    from frappe.utils import format_date, format_datetime, flt
    
    # format_currency might move between versions, use a resilient import
    try:
        from frappe.utils import format_currency
    except ImportError:
        try:
            from frappe.utils.data import format_currency
        except ImportError:
            # Fallback to frappe.format
            def format_currency(amount, currency=None, precision=None):
                return frappe.format(amount, "Currency", {"currency": currency})
    
    ctx = {
        "doc": doc,
        "frappe": frappe,
        "format_date": format_date,
        "format_datetime": format_datetime,
        "format_currency": format_currency,
        "flt": flt,
        "today": frappe.utils.today(),
        "now": frappe.utils.now()
    }
    
    # Add Item-specific aliases for better template experience
    if doc.doctype == "Item":
        ctx["Rate"] = getattr(doc, "valuation_rate", 0) or getattr(doc, "standard_rate", 0)
        
    return ctx

# Adaptive delay to prevent WhatsApp account ban.
def smart_delay(sent_count=0, failed_count=0, is_mass_campaign=True):
    # Total sent today across all modes (for global quota tracking)
    # We use frappe.cache to store transient hourly count
    current_hour = now_datetime().strftime("%Y-%m-%d-%H")
    cache_key = f"whatsapp_sent_hour_{current_hour}"
    
    # Increment global counter
    frappe.cache().incrby(cache_key, 1)
    
    if not is_mass_campaign:
        # Transactional messages get fast lanes
        return random.randint(3, 7) + random.random()

    # Base delay for mass campaigns (20-45 seconds)
    base = random.randint(20, 45)
    
    # "Human Breaks" every 30 messages in a batch
    if sent_count > 0 and sent_count % 30 == 0:
        # Long break 10-20 minutes
        break_duration = random.randint(600, 1200)
        log_info(
            activity_type="Retry Attempt",
            metadata={"action": "stealth_human_break", "duration_seconds": break_duration, "sent_in_batch": sent_count}
        )
        time.sleep(break_duration)
    
    # Random 10% chance of a "mini break" (2-3 minutes)
    if random.random() < 0.1:
        time.sleep(random.randint(120, 180))
            
    return base + random.random()

def validate_gateway_and_session():
    """Checks if gateway is up and WhatsApp is connected."""
    try:
        status_res = proxy_to_service("GET", "api/whatsapp/status")
        if status_res.get("status") != "ready":
            return {"valid": False, "error": status_res.get("message", "WhatsApp session not connected")}
        return {"valid": True, "error": None}
    except Exception as e:
        return {"valid": False, "error": f"Could not connect to WhatsApp gateway: {str(e)}"}

def check_status_condition(doc, status_condition):
    """Check if document status matches the condition."""
    # Handle special statuses
    if status_condition == "Paid":
        # Check if invoice/order is fully paid
        if doc.doctype in ["Sales Invoice", "Purchase Invoice"]:
            outstanding = frappe.utils.flt(getattr(doc, 'outstanding_amount', 0))
            return outstanding == 0 and getattr(doc, 'docstatus', 0) == 1
        elif doc.doctype == "Sales Order":
            # Check if order is fully paid (if payment tracking exists)
            return getattr(doc, 'status', '') == 'Completed'
    
    elif status_condition == "Unpaid":
        if doc.doctype in ["Sales Invoice", "Purchase Invoice"]:
            outstanding = frappe.utils.flt(getattr(doc, 'outstanding_amount', 0))
            return outstanding > 0 and getattr(doc, 'docstatus', 0) == 1
    
    elif status_condition == "Overdue":
        if doc.doctype in ["Sales Invoice", "Purchase Invoice"]:
            # Check if invoice is overdue (due date in past and not paid)
            due_date = getattr(doc, 'due_date', None)
            if due_date:
                from datetime import datetime
                today_date = now_datetime().date()
                if isinstance(due_date, str):
                    due_date_obj = datetime.strptime(due_date, '%Y-%m-%d').date()
                else:
                    due_date_obj = due_date
                return due_date_obj < today_date and frappe.utils.flt(getattr(doc, 'outstanding_amount', 0)) > 0
    
    # For other statuses, direct comparison
    return getattr(doc, 'status', '') == status_condition

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
    # Determine category based on activity_type
    activity_category = "Message"
    if "Bulk Send" in activity_type:
        activity_category = "Bulk"
    elif "Auto Send" in activity_type:
        activity_category = "Auto Send"
    elif "Template" in activity_type:
        activity_category = "Template"
    elif "Session" in activity_type:
        activity_category = "Session"
    elif "Gateway" in activity_type:
        activity_category = "Gateway"
    elif "System" in activity_type or not activity_type:
        activity_category = "System"
        
    # Ensure activity_type is not empty for mandatory field
    if not activity_type:
        activity_type = "System Info"

    try:
        log_entry = frappe.get_doc({
            "doctype": "WhatsApp Activity Log",
            "activity_type": activity_type,
            "activity_category": activity_category,
            "status": status,
            "activity_date": today(),
            "activity_timestamp": now_datetime(),
            "user": user or frappe.session.user,
            "user_name": frappe.get_value("User", user or frappe.session.user, "full_name") if frappe.session.user else None,
            "session_id": session_id or "shared_company_session",
            "phone_number": phone_number,
            "reference_doctype": reference_doctype,
            "reference_name": reference_name,
            "template": template,
            "customer": customer,
            "customer_phone": customer_phone,
            "message_content": message_content[:1000] if message_content else None,  # Truncate for privacy
            "error_details": error_details,
            "duration_ms": duration_ms,
            "retry_count": retry_count,
            "metadata_json": json.dumps(metadata) if metadata else "{}"
        })
        log_entry.insert(ignore_permissions=True)
        return log_entry
    except Exception as e:
        frappe.logger().error(f"Failed to log WhatsApp activity: {str(e)}")
        return None

@frappe.whitelist()
def get_whatsapp_dashboard_stats():
    """Returns statistics for the WhatsApp Dashboard."""
    try:
        from frappe.utils import today, add_to_date
        
        # Today's stats
        today_date = today()
        
        # Message counts
        today_total = frappe.db.count("WhatsApp Activity Log", {
            "activity_date": today_date,
            "activity_category": "Message"
        })
        
        today_success = frappe.db.count("WhatsApp Activity Log", {
            "activity_date": today_date,
            "activity_category": "Message",
            "status": "Success"
        })
        
        today_failed = frappe.db.count("WhatsApp Activity Log", {
            "activity_date": today_date,
            "activity_category": "Message",
            "status": ["in", ["Failed", "Error"]]
        })
        
        # Error counts (from all categories)
        today_errors = frappe.db.count("WhatsApp Activity Log", {
            "activity_date": today_date,
            "status": "Error"
        })
        
        # Bulk sends started today
        today_bulk = frappe.db.count("WhatsApp Activity Log", {
            "activity_date": today_date,
            "activity_type": "Bulk Send Started"
        })
        
        # Get latest session status
        latest_session = None
        try:
            status_res = proxy_to_service("GET", "api/whatsapp/status")
            latest_session = {"status": status_res.get("status", "unknown")}
        except:
            latest_session = {"status": "error"}
            
        # Recent errors (last 24h)
        recent_errors = frappe.get_all("WhatsApp Activity Log",
            filters={
                "status": "Error",
                "activity_timestamp": [">", add_to_date(now_datetime(), hours=-24)]
            },
            limit=10,
            order_by="activity_timestamp desc"
        )
        
        return {
            "status": "success",
            "today": {
                "messages": today_total,
                "total": today_total,
                "success": today_success,
                "failed": today_failed,
                "errors": today_errors,
                "bulk_sends": today_bulk
            },
            "latest_session": latest_session,
            "recent_errors": recent_errors
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def get_whatsapp_logs(limit=50, activity_category=None, status=None):
    """Returns recent WhatsApp logs with filtering."""
    try:
        filters = {}
        if activity_category:
            filters["activity_category"] = activity_category
        if status:
            filters["status"] = status
            
        logs = frappe.get_all("WhatsApp Activity Log",
            filters=filters,
            fields=["name", "activity_timestamp", "activity_type", "status", "user", "user_name", "customer", "template", "reference_name", "duration_ms"],
            limit=limit,
            order_by="activity_timestamp desc"
        )
        
        return {
            "status": "success",
            "logs": logs
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

def check_global_quota(is_mass_campaign=True):
    """Checks if we are exceeding the safe hourly quota (150/hr)."""
    current_hour = now_datetime().strftime("%Y-%m-%d-%H")
    cache_key = f"whatsapp_sent_hour_{current_hour}"
    sent_this_hour = frappe.utils.cint(frappe.cache().get(cache_key))
    
    max_quota = 150
    if is_mass_campaign:
        max_quota = 120 # Save 30 slots for transactional
        
    return sent_this_hour < max_quota

def is_campaign_type_allowed_today(mode):
    """Interleaving logic: alternate campaigns by day of year."""
    from datetime import datetime
    day_of_year = datetime.now().timetuple().tm_yday
    
    if mode == "Dead Stock Marketing":
        return day_of_year % 2 == 0
    if mode == "Monitor Documents":
        return day_of_year % 2 != 0
        
    return True # Transactional/Recurring always allowed or handled elsewhere

def validate_phone_medium(phone):
    """Simple phone validation for bulk sending."""
    if not phone:
        return None
        
    # Remove all non-numeric except + at start
    cleaned = re.sub(r'[\s\-\(\)\.]','', str(phone))
    
    # Ensure starts with +
    if not cleaned.startswith('+'):
        # If it starts with 0, assume it's a local number without country code
        cleaned = '+' + cleaned.lstrip('0')
    
    # Remove leading 0 after country code (e.g., +212 0612 -> +212612)
    cleaned = re.sub(r'^(\+\d{1,3})0', r'\1', cleaned)
    
    # Validate format: + followed by 10-15 digits
    if not re.match(r'^\+\d{10,15}$', cleaned):
        return None
    
    return cleaned

def _log_wrapper(log_status, *args, **kwargs):
    # args[0] can be activity_type, args[1] can be message
    # Priority: keyword args > positional args > default
    status = kwargs.pop('status', log_status)
    activity_type = kwargs.pop('activity_type', None)
    if not activity_type and len(args) > 0:
        activity_type = args[0]
    if not activity_type:
        activity_type = ""
        
    message = kwargs.pop('message', None)
    if not message and len(args) > 1:
        message = args[1]
    
    kwargs['status'] = status
    if message:
        kwargs['message_content'] = message
        
    return log_whatsapp_activity(activity_type, **kwargs)

def log_info(*args, **kwargs):
    return _log_wrapper('Info', *args, **kwargs)

def log_success(*args, **kwargs):
    return _log_wrapper('Success', *args, **kwargs)

def log_error(*args, **kwargs):
    # Special handling for 'error' keyword
    if 'error' in kwargs:
        kwargs['error_details'] = str(kwargs.pop('error'))
    return _log_wrapper('Error', *args, **kwargs)

def log_warning(*args, **kwargs):
    return _log_wrapper('Warning', *args, **kwargs)

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
            match = re.search(r'Resuming at (\d{2}:\d{2})', history.error_message)
            if match:
                time_str = match.group(1)
                # Create datetime for today with that time
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
def get_bulk_history():
    """Get all bulk send history."""
    try:
        history = frappe.get_all(
            "WhatsApp Bulk History",
            fields=["name", "template", "target_doctype", "status", "total_recipients", 
                    "sent_count", "failed_count", "skipped_count", "started_at", "completed_at"],
            order_by="started_at desc"
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
    docs = frappe.get_all(doctype, filters=filters, fields=["name"])
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
        activity_type="Bulk Send Started",
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
    """
    
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
                            delay = smart_delay(sent_count, failed_count, is_mass_campaign=True)
                            log_message(f"Waiting {delay}s before retry...")
                            time.sleep(delay)
                
                except Exception as e:
                    error_msg = str(e)
                    log_message(f"✗ Exception on attempt {attempt}: {error_msg}")
                    final_error = error_msg
                    customer_result["error"] = error_msg
                    
                    if attempt < 3:
                        delay = smart_delay(sent_count, failed_count, is_mass_campaign=True)
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
                delay = smart_delay(sent_count, failed_count, is_mass_campaign=True)
                log_message(f"Waiting {delay}s before next customer...")
                time.sleep(delay)
        
        except Exception as e:
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
            fields=["name", "auto_send_mode", "trigger_status", "visual_conditions"]
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
            
            # Get auto send mode (handle both old and new field names)
            auto_send_mode = getattr(template, 'auto_send_mode', None)
            if not auto_send_mode:
                # Fallback for backward compatibility
                auto_send_mode = getattr(template, 'auto_send_timing', 'On Submit')
            
            # Only process On Submit and On Status Change modes here
            # Recurring and Monitor Documents modes are handled by schedulers
            if auto_send_mode in ["Recurring", "Monitor Documents"]:
                continue
            
            # For On Status Change mode, check if we need to process
            if auto_send_mode == "On Status Change":
                trigger_status = getattr(template, 'trigger_status', None)
                if trigger_status:
                    # Check if current document status matches trigger status
                    current_status = getattr(doc, 'status', None)
                    if current_status != trigger_status:
                        log_info(
                            activity_type="Auto Send Triggered",
                            status="Info",
                            template=template.name,
                            reference_doctype=doc.doctype,
                            reference_name=doc.name,
                            metadata={
                                "action": "skipped",
                                "reason": "status_mismatch",
                                "current_status": current_status,
                                "trigger_status": trigger_status
                            }
                        )
                        continue
            
            # Check visual conditions/filters if specified
            visual_conditions = getattr(template, 'visual_conditions', None)
            if visual_conditions:
                if not check_visual_conditions(doc, visual_conditions):
                    log_info(
                        activity_type="Auto Send Triggered",
                        status="Info",
                        template=template.name,
                        reference_doctype=doc.doctype,
                        reference_name=doc.name,
                        metadata={
                            "action": "skipped",
                            "reason": "conditions_not_met",
                            "conditions": visual_conditions
                        }
                    )
                    continue
            
            # All checks passed - send the message
            log_info(
                activity_type="Auto Send Triggered",
                status="Info",
                template=template.name,
                reference_doctype=doc.doctype,
                reference_name=doc.name,
                metadata={
                    "action": "processing",
                    "auto_send_mode": auto_send_mode,
                    "trigger_status": getattr(template, 'trigger_status', None),
                    "conditions_applied": bool(visual_conditions)
                }
            )
            send_auto_message(doc, template.name)
        except Exception as e:
            # Log error with details
            log_error(
                activity_type="Auto Send Failed",
                error=e,
                template=template_data.name,
                reference_doctype=doc.doctype,
                reference_name=doc.name
            )
            continue

@frappe.whitelist()
def preview_conditions(doctype, conditions):
    """
    Preview documents that match the visual conditions.
    
    Used for testing conditions in WhatsApp Template form.
    """
    try:
        # Build filters from conditions
        filters = build_filters_from_visual_conditions(conditions)
        
        # Get all matching documents
        docs = frappe.get_all(doctype, filters=filters, fields=["name", "status", "customer", "grand_total", "outstanding_amount"])
        
        return {
            "status": "success",
            "total": len(docs),
            "docs": docs
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }

def build_filters_from_visual_conditions(conditions):
    """
    Convert visual conditions JSON to Frappe filters.
    
    Args:
        conditions: List of condition objects from visual_conditions field
    
    Returns:
        List of filters compatible with frappe.get_all()
    """
    filters = []
    
    if not conditions:
        return filters
    
    # Handle both string and list/dict conditions
    if isinstance(conditions, str):
        try:
            conditions_data = json.loads(conditions)
        except:
            return filters
    else:
        conditions_data = conditions

    rules = conditions_data.get("rules", []) if isinstance(conditions_data, dict) else conditions_data
    
    if not rules or not isinstance(rules, list):
        return filters

    for rule in rules:
        if not isinstance(rule, dict):
            continue
            
        field = rule.get("field")
        operator = rule.get("operator")
        value = rule.get("value")
        
        if not field or not operator:
            continue

        # Convert operator to Frappe format
        operator_map = {
            "=": "=",
            "!=": "!=",
            ">": ">",
            "<": "<",
            ">=": ">=",
            "<=": "<=",
            "contains": "like",
            "starts_with": "like",
            "ends_with": "like"
        }
        
        frappe_operator = operator_map.get(operator)
        
        if not frappe_operator:
            continue
        
        # Handle like operators
        if operator in ["contains", "starts_with", "ends_with"]:
            if operator == "contains":
                value = f"%{value}%"
            elif operator == "starts_with":
                value = f"{value}%"
            elif operator == "ends_with":
                value = f"%{value}"
        
        filters.append([field, frappe_operator, value])
    
    return filters

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

def check_visual_conditions(doc, conditions_json):
    """
    Check if document meets the visual conditions/filter JSON.
    
    Expected format:
    {
        "rules": [
            {"field": "outstanding_amount", "operator": ">", "value": 0},
            {"field": "grand_total", "operator": ">=", "value": 1000},
            {"field": "status", "operator": "=", "value": "Unpaid"}
        ]
    }
    
    Returns True if all rules are satisfied, False otherwise.
    """
    if not conditions_json:
        return True
    
    try:
        if isinstance(conditions_json, str):
            conditions = json.loads(conditions_json)
        else:
            conditions = conditions_json
        
        rules = conditions.get("rules", [])
        
        if not rules:
            return True
        
        for rule in rules:
            field = rule.get("field")
            operator = rule.get("operator", "=")
            value = rule.get("value")
            
            if not field:
                continue
            
            # Get field value from document
            doc_value = getattr(doc, field, None)
            
            # Handle None values
            if doc_value is None:
                # If checking for empty/null
                if operator == "=" and (value is None or value == ""):
                    continue
                elif operator == "!=" and value is not None:
                    continue
                else:
                    return False
            
            # Convert values for comparison
            try:
                # Try numeric comparison
                doc_value_num = float(doc_value)
                value_num = float(value)
                
                if operator == ">":
                    if not (doc_value_num > value_num):
                        return False
                elif operator == "<":
                    if not (doc_value_num < value_num):
                        return False
                elif operator == ">=":
                    if not (doc_value_num >= value_num):
                        return False
                elif operator == "<=":
                    if not (doc_value_num <= value_num):
                        return False
                elif operator == "=":
                    if doc_value_num != value_num:
                        return False
                elif operator == "!=":
                    if doc_value_num == value_num:
                        return False
                
            except (ValueError, TypeError):
                # String comparison
                doc_value_str = str(doc_value).strip()
                value_str = str(value).strip() if value is not None else ""
                
                if operator == "=":
                    if doc_value_str != value_str:
                        return False
                elif operator == "!=":
                    if doc_value_str == value_str:
                        return False
                elif operator == "contains":
                    if value_str.lower() not in doc_value_str.lower():
                        return False
                elif operator == "not_contains":
                    if value_str.lower() in doc_value_str.lower():
                        return False
                elif operator == "starts_with":
                    if not doc_value_str.lower().startswith(value_str.lower()):
                        return False
                elif operator == "ends_with":
                    if not doc_value_str.lower().endswith(value_str.lower()):
                        return False
        
        return True
        
    except Exception as e:
        frappe.logger().warning(f"[CHECK CONDITIONS] Error evaluating conditions: {str(e)}")
        # If conditions can't be evaluated, allow the send (fail open)
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
            # Transactional messages get fast lanes but still increment quota
            time.sleep(smart_delay(is_mass_campaign=False))
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
            activity_type="Auto Send Failed",
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
                activity_type="Auto Send Triggered",
                template=template_name,
                metadata={"action": "skipped", "reason": "auto_send_not_enabled_or_wrong_mode"}
            )
            return
        
        # Get selected customers
        selected_customers = template.selected_customers or []
        if not selected_customers:
            log_warning(
                "",
                "No customers selected for this template",
                template=template_name,
                metadata={"reason": "no_customers_selected"}
            )
            return
        
        log_info(
            activity_type="Bulk Send Started",
            template=template_name,
            metadata={
                "action": "recurring_send_start",
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
                        "Retry Attempt",
                        "No valid phone number",
                        template=template_name,
                        customer=customer.name,
                        metadata={"step": "phone_validation", "action": "skipped"}
                    )
                    failed_count += 1
                    customer_result["status"] = "Skipped"
                    customer_result["error"] = "No valid phone"
                    customer_results.append(customer_result)
                    continue
                
                # Check customer cooldown
                if not check_customer_cooldown(customer.name, template.name, template.cooldown_hours):
                    log_info(
                        activity_type="Auto Send Triggered",
                        template=template_name,
                        customer=customer.name,
                        metadata={"action": "skipped", "reason": "in_cooldown_period", "cooldown_hours": template.cooldown_hours}
                    )
                    customer_result["status"] = "Skipped"
                    customer_result["error"] = "In cooldown period"
                    customer_results.append(customer_result)
                    continue
                
                # Check per-customer daily limit
                if not check_customer_daily_limit(customer.name, template.name, template.max_per_customer):
                    log_info(
                        activity_type="Auto Send Triggered",
                        template=template_name,
                        customer=customer.name,
                        metadata={"action": "skipped", "reason": "daily_limit_reached", "max_per_customer": template.max_per_customer}
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
                                activity_type="Message Sent",
                                template=template_name,
                                customer=customer.name,
                                customer_phone=phone,
                                message_content=message[:200],
                                retry_count=attempt,
                                metadata={"attempts_used": attempt, "send_type": "recurring"}
                            )
                            success = True
                            sent_count += 1
                            customer_result["status"] = "Sent"
                            break
                        else:
                            final_error = result.get("message", "Unknown error")
                            log_warning(
                                "Retry Attempt",
                                f"Attempt {attempt} failed: {final_error}",
                                retry_count=attempt,
                                metadata={"attempt": attempt, "send_type": "recurring"}
                            )
                            
                            if attempt < 3:
                                delay = smart_delay(sent_count, failed_count)
                                time.sleep(delay)
                    
                    except Exception as e:
                        final_error = str(e)
                        log_error(
                            activity_type="Message Failed",
                            error=e,
                            template=template_name,
                            customer=customer.name,
                            customer_phone=phone,
                            retry_count=attempt,
                            metadata={"attempt": attempt, "send_type": "recurring"}
                        )
                        if attempt < 3:
                            delay = smart_delay(sent_count, failed_count)
                            time.sleep(delay)
                
                if not success:
                    failed_count += 1
                    customer_result["status"] = "Failed"
                    customer_result["error"] = final_error or "Failed after 3 attempts"
                    log_error(
                        activity_type="Message Failed",
                        error=final_error or "Failed after 3 attempts",
                        template=template_name,
                        customer=customer.name,
                        customer_phone=phone,
                        retry_count=3,
                        metadata={"total_attempts": 3, "send_type": "recurring"}
                    )
                
                customer_results.append(customer_result)
                
                # Smart delay before next customer (anti-ban)
                if idx < len(selected_customers) - 1:
                    delay = smart_delay(sent_count, failed_count)
                    log_info(
                        activity_type="Retry Attempt",
                        template=template_name,
                        metadata={"delay_seconds": delay, "customer_index": idx + 1, "total": len(selected_customers), "action": "recurring_delay"}
                    )
                    time.sleep(delay)
                    
            except Exception as e:
                failed_count += 1
                customer_result["status"] = "Failed"
                customer_result["error"] = str(e)
                customer_results.append(customer_result)
                log_error(
                    activity_type="Message Failed",
                    error=e,
                    template=template_name,
                    customer=customer_row.customer,
                    metadata={"step": "processing", "error_type": "Recurring Processing Error"}
                )
                continue
        
        duration_ms = int((time.time() - start_time) * 1000)
        
        log_success(
            activity_type="Bulk Send Completed",
            template=template_name,
            duration_ms=duration_ms,
            metadata={
                "action": "recurring_send_complete",
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
            activity_type="Bulk Send Failed",
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
                timeout=72000
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
                timeout=72000
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


@frappe.whitelist()
def get_doctype_statuses(doctype):
    """Returns a list of unique status values for a given DocType."""
    try:
        if not doctype:
            return []
            
        # Get status field options from DocType
        meta = frappe.get_meta(doctype)
        status_field = meta.get_field('status')
        
        if status_field and status_field.fieldtype == 'Select' and status_field.options:
            options = status_field.options.split('\n')
            return [o.strip() for o in options if o.strip()]
            
        # Fallback: get unique statuses from database (limited to last 1000 docs for speed)
        statuses = frappe.get_all(doctype, fields=['status'], distinct=True, limit=1000)
        return sorted([s.status for s in statuses if s.get('status')])
    except Exception:
        return []

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
        
        # Build frappe filters from visual conditions using the unified builder
        filters = build_filters_from_visual_conditions(conditions_json)
        
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


# ===== AUTO-SEND FILTER EXAMPLES =====
# These are example JSON filters for common use cases
# Use these in the visual_conditions field of WhatsApp Template

AUTO_SEND_FILTER_EXAMPLES = {
    "unpaid_invoices": {
        "description": "Send only for unpaid Sales Invoices",
        "json": {
            "rules": [
                {"field": "outstanding_amount", "operator": ">", "value": 0}
            ]
        }
    },
    
    "high_value_orders": {
        "description": "Send only for orders over 5000",
        "json": {
            "rules": [
                {"field": "grand_total", "operator": ">=", "value": 5000}
            ]
        }
    },
    
    "corporate_customers": {
        "description": "Send only for Corporate customer group",
        "json": {
            "rules": [
                {"field": "customer_group", "operator": "=", "value": "Corporate"}
            ]
        }
    },
    
    "overdue_invoices": {
        "description": "Send for invoices with Overdue status (perfect for Monitor Documents mode)",
        "json": {
            "rules": [
                {"field": "status", "operator": "=", "value": "Overdue"}
            ]
        }
    },
    
    "overdue_and_unpaid": {
        "description": "Send for overdue invoices that still have outstanding amount (Monitor Documents mode)",
        "json": {
            "rules": [
                {"field": "status", "operator": "=", "value": "Overdue"},
                {"field": "outstanding_amount", "operator": ">", "value": 0}
            ]
        }
    },
    
    "unpaid_high_value": {
        "description": "Send for unpaid invoices over 1000",
        "json": {
            "rules": [
                {"field": "outstanding_amount", "operator": ">", "value": 0},
                {"field": "grand_total", "operator": ">=", "value": 1000}
            ]
        }
    },
    
    "specific_customer": {
        "description": "Send only for specific customer",
        "json": {
            "rules": [
                {"field": "customer", "operator": "=", "value": "CUST-00001"}
            ]
        }
    },
    
    "new_customers_only": {
        "description": "Send only for Individual customer type",
        "json": {
            "rules": [
                {"field": "customer_type", "operator": "=", "value": "Individual"}
            ]
        }
    },
    
    "not_fully_delivered": {
        "description": "Send for orders not fully delivered",
        "json": {
            "rules": [
                {"field": "per_delivered", "operator": "<", "value": 100}
            ]
        }
    },
    
    "partially_billed": {
        "description": "Send for orders partially billed",
        "json": {
            "rules": [
                {"field": "per_billed", "operator": ">", "value": 0},
                {"field": "per_billed", "operator": "<", "value": 100}
            ]
        }
    },
    
    "active_customers_only": {
        "description": "Send only for active (not disabled) customers",
        "json": {
            "rules": [
                {"field": "disabled", "operator": "=", "value": 0}
            ]
        }
    }
}


@frappe.whitelist()
def get_auto_send_filter_examples():
    """
    Returns example JSON filters for auto-send conditions.
    
    Use these examples in the visual_conditions field.
    """
    examples_list = []
    for key, data in AUTO_SEND_FILTER_EXAMPLES.items():
        examples_list.append({
            "name": key,
            "description": data["description"],
            "json": json.dumps(data["json"], indent=2)
        })
    
    return {
        "status": "success",
        "examples": examples_list
    }


# ===== MONITOR DOCUMENTS MODE =====
# These functions run via scheduler to check already-submitted documents
# and send WhatsApp when conditions are met (e.g., invoice becomes overdue)

def process_monitored_documents(frequency):
    """
    Process templates with 'Monitor Documents' mode.
    
    Args:
        frequency: 'Hourly', 'Daily', or 'Weekly'
    """
    try:
        # Get all templates with Monitor Documents mode
        templates = frappe.get_all("WhatsApp Template",
            filters={
                "enable_auto_send": 1,
                "auto_send_mode": "Monitor Documents"
            },
            fields=["name", "monitoring_frequency", "custom_monitoring_interval", "last_monitoring_run", "send_time"]
        )
        
        if not templates:
            return
            
        current_time = now_datetime().time()
            
        # Filter templates by frequency
        run_templates = []
        for t in templates:
            # Check for specific send time if frequency is Daily
            if frequency == "Daily" and t.send_time:
                scheduled_time = frappe.utils.get_time(t.send_time)
                # 1 hour window for daily tasks if triggered by daily/hourly scheduler
                # If moved to 'all' scheduler, we could use a tighter window
                if not (scheduled_time.hour == current_time.hour):
                    continue

            if t.monitoring_frequency == frequency:
                run_templates.append(t)
            elif t.monitoring_frequency == "Customize" and frequency == "Daily":
                # Handle custom interval (checked daily)
                if not t.last_monitoring_run:
                    run_templates.append(t)
                else:
                    days_passed = (now_datetime() - t.last_monitoring_run).days
                    if days_passed >= (t.custom_monitoring_interval or 1):
                        run_templates.append(t)
        
        if not run_templates:
            return
            
        frappe.logger().info(f"[MONITOR] Processing {len(run_templates)} templates for {frequency} monitoring")
        
        for template_data in run_templates:
            try:
                template = frappe.get_doc("WhatsApp Template", template_data.name)
                # Enqueue single template check to handle high volume customers
                frappe.enqueue(
                    'erpnextwats.erpnextwats.api.process_single_monitored_template',
                    template=template,
                    queue='long',
                    timeout=72000
                )
                
                # Update last run
                template.last_monitoring_run = now_datetime()
                template.save(ignore_permissions=True)
                frappe.db.commit()
            except Exception as e:
                log_error(
                    activity_type="Auto Send Failed",
                    error=e,
                    template=template_data.name,
                    metadata={"frequency": frequency, "error_type": "Monitored Template Processing Failure"}
                )
                continue
                
    except Exception as e:
        frappe.logger().error(f"[MONITOR] Error in process_monitored_documents: {str(e)}")


def process_single_monitored_template(template):
    """
    Process a single template in Monitor Documents mode.
    Finds submitted documents that match conditions and sends WhatsApp.
    """
    doctype = template.doctype_name
    
    log_info(
        activity_type="Auto Send Triggered",
        template=template.name,
        metadata={
            "action": "monitor_check_start",
            "doctype": doctype,
            "frequency": template.monitoring_frequency,
            "trigger_status": template.trigger_status
        }
    )
    
    # Build filters for submitted documents
    filters = {
        "docstatus": 1  # Only submitted documents
    }
    
    # Add status filter if specified (supports multi-select)
    if template.trigger_status:
        statuses = [s.strip() for s in template.trigger_status.split(',') if s.strip()]
        if statuses:
            if len(statuses) == 1:
                filters["status"] = statuses[0]
            else:
                filters["status"] = ["in", statuses]
    
    # Get submitted documents
    try:
        docs = frappe.get_all(doctype, filters=filters, fields=["name"])
    except Exception as e:
        log_error(
            activity_type="Auto Send Failed",
            error=e,
            template=template.name,
            metadata={"doctype": doctype, "filters": filters, "error_type": "Monitor Query Error"}
        )
        return
    
    if not docs:
        log_info(
            activity_type="Auto Send Triggered",
            template=template.name,
            metadata={"doctype": doctype, "action": "no_matches", "reason": "no_submitted_docs"}
        )
        return
    
    # Process each document
    sent_count = 0
    skipped_count = 0
    failed_count = 0
    
    for doc_data in docs:
        try:
            doc = frappe.get_doc(doctype, doc_data.name)
            
            # Check visual conditions if specified
            if template.visual_conditions:
                if not check_visual_conditions(doc, template.visual_conditions):
                    skipped_count += 1
                    continue
            
            # Check if already sent to prevent duplicates
            if was_recently_sent(doc, template.name):
                skipped_count += 1
                continue
            
            # Send the message
            result = send_auto_message(doc, template.name)
            
            if result:
                sent_count += 1
            else:
                failed_count += 1
            
            # Anti-ban delay between sends
            if sent_count < len(docs):
                delay = smart_delay(sent_count, failed_count)
                time.sleep(delay)
                
        except Exception as e:
            log_error(
                activity_type="Auto Send Failed",
                error=e,
                template=template.name,
                reference_doctype=doctype,
                reference_name=doc_data.name,
                metadata={"error_type": "Monitor Processing Error"}
            )
            failed_count += 1
            continue
    
    log_success(
        activity_type="Auto Send Completed",
        template=template.name,
        metadata={
            "action": "monitor_check_complete",
            "checked": len(docs),
            "sent": sent_count,
            "skipped": skipped_count,
            "failed": failed_count
        }
    )


def was_recently_sent(doc, template_name, hours=24):
    """
    Check if a WhatsApp was already sent for this document/template recently.
    Prevents duplicate sends for the same condition.
    """
    try:
        from frappe.utils import add_to_date, now_datetime
        
        # Check activity log for recent entries (any status)
        # We check Sent and Failed to prevent infinite retry loops in a single run
        recent = frappe.db.get_value("WhatsApp Activity Log",
            {
                "template": template_name,
                "reference_doctype": doc.doctype,
                "reference_name": doc.name,
                "activity_type": ["in", ["Auto Send Completed", "Message Sent", "Message Failed"]],
                "activity_timestamp": [">=", add_to_date(now_datetime(), hours=-hours)]
            },
            "name"
        )
        
        return bool(recent)
        
    except Exception as e:
        frappe.logger().warning(f"[MONITOR] Error checking recent sends: {str(e)}")
        return False


def was_dead_stock_sent_today(item_code, customer_name, template_name):
    """Check if this item was already sent to this customer today."""
    try:
        from frappe.utils import today
        return frappe.db.exists("WhatsApp Activity Log", {
            "template": template_name,
            "reference_name": item_code,
            "customer": customer_name,
            "activity_type": "Message Sent",
            "status": "Success",
            "activity_date": today()
        })
    except:
        return False


def process_hourly_monitoring():
    """Process hourly monitoring. Called by scheduler."""
    process_monitored_documents("Hourly")


def process_daily_monitoring():
    """Process daily monitoring. Called by scheduler."""
    # Interleaving Check: only run on ODD days of the year
    if not is_campaign_type_allowed_today("Monitor Documents"):
        frappe.logger().info("[MONITOR] Skipping today (Even day - Dead Stock rotation)")
        return

    process_monitored_documents("Daily")


def process_weekly_monitoring():
    """Process weekly monitoring. Called by scheduler."""
    process_monitored_documents("Weekly")


# ===== END MONITOR DOCUMENTS MODE =====


# ===== DEAD STOCK MARKETING MODE =====

def process_dead_stock_daily():
    """
    Main scheduler function for Dead Stock Marketing.
    Runs daily and processes all templates with Dead Stock Marketing mode enabled.
    """
    # Interleaving Check: only run on EVEN days of the year
    if not is_campaign_type_allowed_today("Dead Stock Marketing"):
        frappe.logger().info("[DEAD STOCK] Skipping today (Odd day - Monitor Documents rotation)")
        return

    try:
        current_time = frappe.utils.now_datetime().time()
        
        # Get all templates with Dead Stock Marketing mode
        templates = frappe.get_all("WhatsApp Template",
            filters={
                "enable_auto_send": 1,
                "auto_send_mode": "Dead Stock Marketing"
            },
            fields=["name", "send_time"]
        )
        
        for template_data in templates:
            try:
                template = frappe.get_doc("WhatsApp Template", template_data.name)
                
                # Check if it's time to send (within 5 minutes of scheduled time)
                scheduled_time = frappe.utils.get_time(template.send_time or "11:00:00")
                time_diff = abs((current_time.hour * 60 + current_time.minute) - 
                               (scheduled_time.hour * 60 + scheduled_time.minute))
                
                if time_diff <= 5:  # Within 5 minutes window
                    log_info(
                        activity_type="Bulk Send Started",
                        template=template.name,
                        metadata={"action": "dead_stock_campaign_start", "scheduled_time": str(scheduled_time), "current_time": str(current_time)}
                    )
                    
                    # Enqueue in background with long timeout to avoid stalling the scheduler
                    frappe.enqueue(
                        'erpnextwats.erpnextwats.api.send_dead_stock_campaign',
                        template=template,
                        queue='long',
                        timeout=72000
                    )
                    
            except Exception as e:
                log_error(
                    activity_type="Bulk Send Failed",
                    error=e,
                    template=template_data.name,
                    metadata={"error_type": "Dead Stock Campaign Trigger Failure"}
                )
                continue
                
    except Exception as e:
        frappe.logger().error(f"[DEAD STOCK] Error in process_dead_stock_daily: {str(e)}")


def get_dead_stock_items(template):
    """
    Get dead stock items based on template configuration.
    Uses the SQL query from the Slow Moving Items Report.
    """
    warehouse = template.dead_stock_warehouse or "JTL - JT"
    min_days = template.min_days_stagnant or 120
    
    sql = """
        SELECT 
            b.item_code,
            i.item_name,
            i.description,
            b.warehouse,
            b.actual_qty as qty,
            b.valuation_rate as cost,
            i.standard_rate as standard_rate,
            (b.actual_qty * b.valuation_rate) as value,
            (SELECT MAX(posting_date) 
             FROM `tabStock Ledger Entry` 
             WHERE item_code = b.item_code 
             AND warehouse = b.warehouse
             AND actual_qty > 0 
             AND is_cancelled = 0) as last_receipt_date,
            DATEDIFF(CURDATE(), (
                SELECT MAX(posting_date) 
                FROM `tabStock Ledger Entry` 
                WHERE item_code = b.item_code 
                AND warehouse = b.warehouse
                AND actual_qty > 0 
                AND is_cancelled = 0
            )) as days_stagnant
        FROM `tabBin` b
        JOIN `tabItem` i ON b.item_code = i.name
        WHERE b.actual_qty > 0
        AND b.valuation_rate > 0
        AND b.warehouse = %s
        AND DATEDIFF(CURDATE(), (
            SELECT MAX(posting_date) 
            FROM `tabStock Ledger Entry` 
            WHERE item_code = b.item_code 
            AND warehouse = b.warehouse
            AND actual_qty > 0 
            AND is_cancelled = 0
        )) >= %s
        ORDER BY days_stagnant DESC
    """
    
    try:
        items = frappe.db.sql(sql, (warehouse, min_days), as_dict=True)
        return items
    except Exception as e:
        log_error(
            activity_type="Bulk Send Failed",
            error=e,
            template=template.name,
            metadata={"warehouse": warehouse, "min_days": min_days, "error_type": "Dead Stock Query Error"}
        )
        return []


def get_todays_dead_stock_batch(template):
    """
    Get today's batch of dead stock items and calculation for next state.
    Does NOT update the database; caller must save if batch is successful.
    """
    # Get all dead stock items
    all_items = get_dead_stock_items(template)
    
    if not all_items:
        return [], 0, template.last_sent_index or 0, template.cycle_count or 0
    
    # Get current position
    last_index = template.last_sent_index or 0
    items_per_day = template.items_per_day or 5
    
    # Get today's batch
    today_items = []
    for i in range(items_per_day):
        item_index = (last_index + i) % len(all_items)
        today_items.append(all_items[item_index])
    
    # Calculate new index for tomorrow
    new_index = (last_index + items_per_day) % len(all_items)
    
    # Check if we completed a full cycle
    new_cycle_count = template.cycle_count or 0
    if new_index < last_index or (new_index == 0 and last_index > 0):
        new_cycle_count += 1
    
    return today_items, len(all_items), new_index, new_cycle_count


def get_all_customers_with_phones():
    """
    Get all customers with valid mobile numbers.
    Rechecks each time to ensure we don't miss new customers.
    """
    try:
        customers = frappe.get_all("Customer",
            filters={
                "disabled": 0
            },
            fields=["name", "customer_name", "mobile_no"]
        )
        
        # Filter customers with valid phone numbers
        valid_customers = []
        for cust in customers:
            if cust.mobile_no and len(cust.mobile_no) >= 8:
                valid_customers.append(cust)
        
        return valid_customers
        
    except Exception as e:
        log_error(
            activity_type="Bulk Send Failed",
            error=e,
            metadata={"error_type": "Dead Stock Customer Query Error"}
        )
        return []


def get_item_image(item_code):
    """
    Get item image from Item master or File attachments.
    Returns base64 encoded image or None.
    """
    try:
        # Get item doc
        item = frappe.get_doc("Item", item_code)
        
        # Check if item has image field
        if item.image:
            # Get file by URL
            file_doc = frappe.get_doc("File", {"file_url": item.image})
            if file_doc:
                file_content = file_doc.get_content()
                if isinstance(file_content, str):
                    file_content = file_content.encode('utf-8')
                
                # Determine mimetype
                import mimetypes
                mimetype = mimetypes.guess_type(item.image)[0] or "image/jpeg"
                
                return {
                    "mimetype": mimetype,
                    "data": base64.b64encode(file_content).decode('utf-8'),
                    "filename": f"{item_code}.jpg"
                }
        
        # Try to find attached file
        files = frappe.get_all("File",
            filters={
                "attached_to_doctype": "Item",
                "attached_to_name": item_code
            },
            fields=["name", "file_url"],
            limit=1
        )
        
        if files:
            file_doc = frappe.get_doc("File", files[0].name)
            file_content = file_doc.get_content()
            if isinstance(file_content, str):
                file_content = file_content.encode('utf-8')
            
            import mimetypes
            mimetype = mimetypes.guess_type(files[0].file_url)[0] or "image/jpeg"
            
            return {
                "mimetype": mimetype,
                "data": base64.b64encode(file_content).decode('utf-8'),
                "filename": f"{item_code}.jpg"
            }
        
        return None
        
    except Exception as e:
        frappe.logger().warning(f"[DEAD STOCK] Error getting image for {item_code}: {str(e)}")
        return None


def send_dead_stock_campaign(template):
    """
    Send dead stock items to all customers.
    One message per item per customer with anti-ban protection.
    Resumable: if interrupted, skips already-sent recipients for today.
    """
    # Get today's dead stock batch and potential next state
    today_items, total_pool, next_index, next_cycle = get_todays_dead_stock_batch(template)
    
    if not today_items:
        log_warning(
            "Dead Stock Campaign",
            "No dead stock items found",
            template=template.name
        )
        return
    
    # Get all customers with phones
    customers = get_all_customers_with_phones()
    
    if not customers:
        log_warning(
            "Dead Stock Campaign",
            "No customers with valid phones found",
            template=template.name
        )
        return
    
    log_info(
        activity_type="Bulk Send Started",
        template=template.name,
        metadata={
            "action": "dead_stock_campaign_process_start",
            "items_to_send": len(today_items),
            "total_customers": len(customers),
            "total_messages": len(today_items) * len(customers)
        }
    )
    
    # Track stats
    total_sent = 0
    total_failed = 0
    items_without_images = []
    include_images = template.include_item_images
    send_style = getattr(template, 'dead_stock_send_style', 'Each Item Separately') or 'Each Item Separately'
    
    # Process each customer (Cluster mode)
    for cust_idx, customer in enumerate(customers):
        # Cluster delay between customers (3-5 minutes) for stealth
        if cust_idx > 0:
            cluster_delay = random.randint(180, 300)
            log_info(
                activity_type="Retry Attempt",
                metadata={"action": "stealth_customer_gap", "duration_seconds": cluster_delay, "customer": customer.name}
            )
            time.sleep(cluster_delay)

        if send_style == "All Items in One Message":
            # ===== COMBINED MODE: One message with all items per customer =====
            # Quota Check
            while not check_global_quota(is_mass_campaign=True):
                time.sleep(120)

            # Check if already sent today (use first item as marker)
            if was_dead_stock_sent_today(today_items[0].item_code, customer.name, template.name):
                total_sent += 1
                continue

            try:
                # Build items list for Jinja template
                items_list = []
                for item_data in today_items:
                    items_list.append({
                        "item_code": item_data.item_code,
                        "item_name": item_data.item_name,
                        "description": item_data.description,
                        "qty": item_data.qty,
                        "days_stagnant": item_data.days_stagnant,
                        "cost": item_data.cost,
                        "Rate": item_data.standard_rate if hasattr(item_data, 'standard_rate') else item_data.cost,
                        "value": item_data.value
                    })

                ctx = {
                    "items": items_list,
                    "customer_name": customer.customer_name,
                    "total_items": len(items_list),
                    "frappe": frappe,
                    "today": today(),
                    "now": now_datetime()
                }
                message = frappe.render_template(template.message, ctx)

                # Send single combined message with first item's image
                media = None
                if include_images and today_items:
                    media = get_item_image(today_items[0].item_code)
                success = False
                final_error = None

                for attempt in range(1, 4):
                    try:
                        data = {
                            "userId": "shared_company_session",
                            "to": customer.mobile_no,
                            "message": message,
                            "media": media
                        }
                        result = proxy_to_service("POST", "api/whatsapp/send", data)

                        if result.get("status") == "success":
                            success = True
                            total_sent += 1
                            log_success(
                                activity_type="Message Sent",
                                template=template.name,
                                customer=customer.name,
                                customer_phone=customer.mobile_no,
                                reference_name=f"combined_{len(items_list)}_items",
                                retry_count=attempt,
                                metadata={"send_type": "dead_stock_combined", "items_count": len(items_list)}
                            )
                            break
                        else:
                            final_error = result.get("message", "Unknown error")
                            time.sleep(random.randint(5, 15))
                    except Exception as e:
                        final_error = str(e)
                        time.sleep(random.randint(5, 15))

                if not success:
                    total_failed += 1

                delay = smart_delay(total_sent, total_failed, is_mass_campaign=True)
                time.sleep(delay)

            except Exception as e:
                total_failed += 1
                log_error(activity_type="Message Failed", error=e, template=template.name, customer=customer.name)

        else:
            # ===== SEPARATE MODE: One message per item per customer =====
            for item_data in today_items:
                item_code = item_data.item_code

                while not check_global_quota(is_mass_campaign=True):
                    time.sleep(120)

                if was_dead_stock_sent_today(item_code, customer.name, template.name):
                    total_sent += 1
                    continue

                try:
                    media = None
                    if include_images:
                        media = get_item_image(item_code)
                        if not media:
                            items_without_images.append(item_code)

                    ctx = {
                        "item_code": item_code,
                        "item_name": item_data.item_name,
                        "description": item_data.description,
                        "qty": item_data.qty,
                        "days_stagnant": item_data.days_stagnant,
                        "cost": item_data.cost,
                        "Rate": item_data.standard_rate if hasattr(item_data, 'standard_rate') else item_data.cost,
                        "value": item_data.value,
                        "customer_name": customer.customer_name,
                        "frappe": frappe,
                        "today": today(),
                        "now": now_datetime()
                    }
                    message = frappe.render_template(template.message, ctx)

                    success = False
                    final_error = None

                    for attempt in range(1, 4):
                        try:
                            data = {
                                "userId": "shared_company_session",
                                "to": customer.mobile_no,
                                "message": message,
                                "media": media
                            }
                            result = proxy_to_service("POST", "api/whatsapp/send", data)

                            if result.get("status") == "success":
                                success = True
                                total_sent += 1
                                log_success(
                                    activity_type="Message Sent",
                                    template=template.name,
                                    customer=customer.name,
                                    customer_phone=customer.mobile_no,
                                    reference_name=item_code,
                                    retry_count=attempt,
                                    metadata={"send_type": "dead_stock", "price_used": ctx["Rate"]}
                                )
                                break
                            else:
                                final_error = result.get("message", "Unknown error")
                                time.sleep(random.randint(5, 15))
                        except Exception as e:
                            final_error = str(e)
                            time.sleep(random.randint(5, 15))

                    if not success:
                        total_failed += 1

                    delay = smart_delay(total_sent, total_failed, is_mass_campaign=True)
                    time.sleep(delay)

                except Exception as e:
                    total_failed += 1
                    log_error(activity_type="Message Failed", error=e, template=template.name, customer=customer.name)

        # Commit progress after each customer to ensure resumability
        frappe.db.commit()

    # Campaign finished
    template.total_items_pool = total_pool
    template.last_sent_index = next_index
    template.last_send_date = frappe.utils.today()
    template.cycle_count = next_cycle
    template.save(ignore_permissions=True)
    frappe.db.commit()
    log_success(
        activity_type="Bulk Send Completed",
        template=template.name,
        metadata={
            "action": "dead_stock_campaign_complete",
            "total_sent": total_sent,
            "total_failed": total_failed,
            "items_processed": len(today_items),
            "customers_reached": len(customers),
            "items_without_images": items_without_images
        }
    )
    
    # Log items without images to WhatsApp Activity Log
    if items_without_images:
        log_warning(
            "",
            f"{len(items_without_images)} items sent without images",
            template=template.name,
            metadata={
                "items_without_images": items_without_images,
                "total_items": len(today_items),
                "affected_items_count": len(items_without_images),
                "action": "dead_stock_missing_images"
            }
        )


@frappe.whitelist()
def preview_dead_stock_items(template_name):
    """
    Preview which dead stock items will be sent.
    Shows today's batch and tomorrow's batch.
    """
    try:
        template = frappe.get_doc("WhatsApp Template", template_name)
        
        # Get all items
        all_items = get_dead_stock_items(template)
        
        if not all_items:
            return {
                "status": "error",
                "message": "No dead stock items found matching criteria"
            }
        
        # Get today's batch
        today_items, total, _, _ = get_todays_dead_stock_batch(template)
        
        # Get tomorrow's batch
        last_index = template.last_sent_index or 0
        items_per_day = template.items_per_day or 5
        tomorrow_items = []
        
        for i in range(items_per_day):
            item_index = (last_index + i) % len(all_items)
            tomorrow_items.append(all_items[item_index])
        
        # Get customers count
        customers = get_all_customers_with_phones()
        
        return {
            "status": "success",
            "total_items": total,
            "total_customers": len(customers),
            "items_per_day": items_per_day,
            "last_sent_index": template.last_sent_index,
            "cycle_count": template.cycle_count or 0,
            "today_batch": today_items,
            "tomorrow_batch": tomorrow_items
        }
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def run_monitor_check_now(template_name):
    """Manually trigger a Monitor Documents check for a template."""
    try:
        template = frappe.get_doc("WhatsApp Template", template_name)
        if template.auto_send_mode != "Monitor Documents":
            return {"status": "error", "message": "Template is not in Monitor Documents mode"}
            
        # Run in background to avoid timeout
        frappe.enqueue(
            'erpnextwats.erpnextwats.api.process_single_monitored_template',
            template=template,
            queue='long',
            timeout=72000
        )
        return {"status": "success", "message": "Monitor check started in the background (20h timeout)"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@frappe.whitelist()
def run_dead_stock_campaign_now(template_name):
    """Manually trigger a Dead Stock campaign for a template."""
    try:
        template = frappe.get_doc("WhatsApp Template", template_name)
        if template.auto_send_mode != "Dead Stock Marketing":
            return {"status": "error", "message": "Template is not in Dead Stock Marketing mode"}
            
        # Run in background
        frappe.enqueue(
            'erpnextwats.erpnextwats.api.send_dead_stock_campaign',
            template=template,
            queue='long',
            timeout=72000
        )
        return {"status": "success", "message": "Dead stock campaign started in the background (20h timeout)"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@frappe.whitelist()
def test_dead_stock_send(template_name, phone):
    """
    Test Dead Stock campaign: sends today's batch of items to a SINGLE phone number.
    Uses short delays (3-5s) since this is a manual test, not a mass campaign.
    Does NOT advance the batch index or count toward campaign stats.
    """
    try:
        template = frappe.get_doc("WhatsApp Template", template_name)
        if template.auto_send_mode != "Dead Stock Marketing":
            return {"status": "error", "message": "Template is not in Dead Stock Marketing mode"}

        # Validate phone
        validated_phone = validate_phone_medium(phone)
        if not validated_phone:
            return {"status": "error", "message": f"Invalid phone number: {phone}"}

        # Get today's batch (does NOT advance index)
        today_items, total_pool, _, _ = get_todays_dead_stock_batch(template)

        if not today_items:
            return {"status": "error", "message": "No dead stock items found matching criteria"}

        include_images = template.include_item_images
        send_style = getattr(template, 'dead_stock_send_style', 'Each Item Separately') or 'Each Item Separately'
        sent = 0
        failed = 0
        results = []

        if send_style == "All Items in One Message":
            # ===== COMBINED MODE: One message with all items =====
            try:
                items_list = []
                for item_data in today_items:
                    items_list.append({
                        "item_code": item_data.item_code,
                        "item_name": item_data.item_name,
                        "description": item_data.description,
                        "qty": item_data.qty,
                        "days_stagnant": item_data.days_stagnant,
                        "cost": item_data.cost,
                        "Rate": item_data.standard_rate if hasattr(item_data, 'standard_rate') else item_data.cost,
                        "value": item_data.value
                    })

                ctx = {
                    "items": items_list,
                    "customer_name": "Test Customer",
                    "total_items": len(items_list),
                    "frappe": frappe,
                    "today": today(),
                    "now": now_datetime()
                }
                message = frappe.render_template(template.message, ctx)

                # Get first item's image if enabled
                media = None
                if include_images and today_items:
                    media = get_item_image(today_items[0].item_code)

                data = {
                    "userId": "shared_company_session",
                    "to": validated_phone,
                    "message": message,
                    "media": media
                }
                result = proxy_to_service("POST", "api/whatsapp/send", data)

                if result.get("status") == "success":
                    sent += 1
                    for item in items_list:
                        results.append({"item": item["item_code"], "status": "sent", "rate": item["Rate"]})
                    log_success(
                        activity_type="Message Sent",
                        template=template.name,
                        customer_phone=validated_phone,
                        reference_name=f"combined_{len(items_list)}_items",
                        metadata={"send_type": "dead_stock_test_combined", "items_count": len(items_list)}
                    )
                else:
                    failed += 1
                    for item in items_list:
                        results.append({"item": item["item_code"], "status": "failed", "error": result.get("message", "Unknown")})

            except Exception as e:
                failed += 1
                results.append({"item": "combined", "status": "error", "error": str(e)})

        else:
            # ===== SEPARATE MODE: One message per item =====
            for item_data in today_items:
                item_code = item_data.item_code
                try:
                    media = None
                    if include_images:
                        media = get_item_image(item_code)

                    ctx = {
                        "item_code": item_code,
                        "item_name": item_data.item_name,
                        "description": item_data.description,
                        "qty": item_data.qty,
                        "days_stagnant": item_data.days_stagnant,
                        "cost": item_data.cost,
                        "Rate": item_data.standard_rate if hasattr(item_data, 'standard_rate') else item_data.cost,
                        "value": item_data.value,
                        "customer_name": "Test Customer",
                        "frappe": frappe,
                        "today": today(),
                        "now": now_datetime()
                    }
                    message = frappe.render_template(template.message, ctx)

                    data = {
                        "userId": "shared_company_session",
                        "to": validated_phone,
                        "message": message,
                        "media": media
                    }

                    result = proxy_to_service("POST", "api/whatsapp/send", data)

                    if result.get("status") == "success":
                        sent += 1
                        results.append({"item": item_code, "status": "sent", "rate": ctx["Rate"]})
                        log_success(
                            activity_type="Message Sent",
                            template=template.name,
                            customer_phone=validated_phone,
                            reference_name=item_code,
                            metadata={"send_type": "dead_stock_test", "price_used": ctx["Rate"]}
                        )
                    else:
                        failed += 1
                        results.append({"item": item_code, "status": "failed", "error": result.get("message", "Unknown")})

                    time.sleep(random.randint(3, 5))

                except Exception as e:
                    failed += 1
                    results.append({"item": item_code, "status": "error", "error": str(e)})

        return {
            "status": "success",
            "message": f"Test complete ({send_style}): {sent} sent, {failed} failed out of {len(today_items)} items",
            "sent": sent,
            "failed": failed,
            "total_items": len(today_items),
            "send_style": send_style,
            "results": results
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}


# ===== END DEAD STOCK MARKETING MODE =====


# ===== AUTO-SEND MODE EXAMPLES =====
#
# MODE 1: On Submit
# Use when: You want to send WhatsApp immediately when a document is submitted
# Example: Send welcome message when new Sales Order is submitted
# Setup: Auto Send Mode = "On Submit"
#
# MODE 2: On Status Change  
# Use when: You want to send when a document status changes to specific value
# Example: Send message when Invoice status changes to "Paid"
# Setup: Auto Send Mode = "On Status Change", Trigger Status = "Paid"
#
# MODE 3: Monitor Documents ⭐ NEW ⭐
# Use when: Document is already submitted but you want to check periodically if conditions are met
# Example: Send payment reminder for invoices that become "Overdue" after due date
# Example: Send follow-up for unpaid invoices (outstanding_amount > 0)
# Setup: 
#   - Auto Send Mode = "Monitor Documents"
#   - Monitoring Frequency = "Daily" or "Hourly"
#   - Trigger Status = "Overdue" (optional)
#   - Filter Conditions: {"rules":[{"field":"outstanding_amount","operator":">","value":0}]}
#
# MODE 4: Recurring
# Use when: You want to send periodic messages to selected customers
# Example: Send monthly newsletter to selected customers
# Setup: Auto Send Mode = "Recurring", select customers, set frequency
#
# MODE 5: Dead Stock Marketing ⭐ NEW ⭐
# Use when: You want to automatically promote slow-moving inventory to all customers
# Example: Daily send top 5 dead stock items (items not sold in 120+ days) to all customers
# Setup:
#   - Auto Send Mode = "Dead Stock Marketing"
#   - Items Per Day = 5
#   - Warehouse = "JTL - JT"
#   - Min Days Without Sales = 120
#   - Send Time = 11:00:00
#   - Include Item Images = Yes
#   - Message with variables: {{ item_name }}, {{ item_code }}, {{ description }}, {{ qty }}, {{ days_stagnant }}, {{ cost }}, {{ value }}
#
# ===== DEAD STOCK MESSAGE EXAMPLES =====
#
# Example 1: Simple Promotion
# "🔥 CLEARANCE SALE - {{ item_name }}
#  Code: {{ item_code }}
#  Available: {{ qty }} units
#  Price: {{ cost }} د.م
#  Reply to order now!"
#
# Example 2: Urgency Style
# "⚠️ LAST CHANCE - {{ item_name }}
#  This item hasn't sold in {{ days_stagnant }} days!
#  Only {{ qty }} left in stock
#  Special clearance price: {{ cost }} د.م
#  Order now before it's gone!"
#
# Example 3: Professional
# "📦 Special Offer: {{ item_name }}
#  Product Code: {{ item_code }}
#  Description: {{ description }}
#  Stock Available: {{ qty }} units
#  Price: {{ cost }} د.م
#  Total Value: {{ value }} د.م
#  Contact us to place your order!"
#
# ===== EXAMPLE JSON FILTERS =====
#
# 1. Unpaid Invoices (outstanding_amount > 0):
#    {"rules":[{"field":"outstanding_amount","operator":">","value":0}]}
#
# 2. Overdue Invoices (status = Overdue):
#    {"rules":[{"field":"status","operator":"=","value":"Overdue"}]}
#
# 3. High Value Orders (grand_total >= 5000):
#    {"rules":[{"field":"grand_total","operator":">=","value":5000}]}
#
# 4. Unpaid AND Overdue (both conditions):
#    {"rules":[
#        {"field":"status","operator":"=","value":"Overdue"},
#        {"field":"outstanding_amount","operator":">","value":0}
#    ]}
#
# 5. Corporate Customers Only:
#    {"rules":[{"field":"customer_group","operator":"=","value":"Corporate"}]}
#
# 6. Specific Customer:
#    {"rules":[{"field":"customer","operator":"=","value":"CUST-00001"}]}
#
# ===== Supported Operators =====
#   =   : Equal to
#   !=  : Not equal to
#   >   : Greater than
#   <   : Less than
#   >=  : Greater than or equal
#   <=  : Less than or equal
#   contains      : String contains (case insensitive)
#   not_contains  : String does not contain
#   starts_with   : String starts with
#   ends_with     : String ends with
#
# ===== Common Fields by DocType =====
# Sales Invoice: outstanding_amount, grand_total, due_date, is_paid, customer, status
# Sales Order: grand_total, customer, delivery_date, per_delivered, per_billed
# Customer: customer_group, territory, customer_type, disabled
# Lead: source, status, company_name
# Quotation: grand_total, customer, valid_till
#
# ===== END AUTO-SEND FILTER EXAMPLES =====

