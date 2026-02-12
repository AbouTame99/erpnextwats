
import time
import random
import datetime

# Mock Frappe and dependencies
class MockFrappe:
    def __init__(self):
        self.flags = {}
        self.db = MockDB()
        self.cache_store = {}

    def get_doc(self, doctype, name=None):
        return MockDoc(doctype, name)

    def get_all(self, doctype, filters=None, fields=None, limit=None):
        return []

    def cache(self):
        return self

    def get(self, key):
        return self.cache_store.get(key, 0)

    def incrby(self, key, value):
        self.cache_store[key] = self.cache_store.get(key, 0) + value

    def render_template(self, template, context):
        return f"Rendered message for {context.get('item_code')}"

class MockDB:
    def commit(self):
        print("[DB] Commit transaction")

class MockDoc:
    def __init__(self, doctype, name):
        self.doctype = doctype
        self.name = name
        self.customer_name = "Test Customer"
        self.mobile_no = "1234567890"
        self.include_item_images = 1
        self.message = "Hi {{ customer_name }}, item {{ item_name }} is available at {{ Rate }}"

# Global mocks
frappe = MockFrappe()
random.seed(42) # Deterministic for testing

def now_datetime():
    return datetime.datetime.now()

def check_global_quota(is_mass_campaign=True):
    # Simulate quota check
    return True

def smart_delay(sent_count=0, failed_count=0, is_mass_campaign=True):
    base = random.randint(20, 45) if is_mass_campaign else random.randint(3, 7)
    
    # Simulate human break
    if is_mass_campaign and sent_count > 0 and sent_count % 30 == 0:
        print(f"[STEALTH] Triggering HUMAN BREAK simulation (would sleep 10-20 min)")
        return 0 # Don't actually sleep in test
        
    return base

# Mocked Campaign Logic
def simulate_dead_stock_campaign():
    print("=== STARTING DEAD STOCK SIMULATION ===")
    
    # Mock Data
    customers = [
        MockDoc("Customer", "CUST-001"),
        MockDoc("Customer", "CUST-002"),
        MockDoc("Customer", "CUST-003")
    ]
    
    # 2 items per customer
    items = [
        {"item_code": "ITEM-A", "standard_rate": 100, "cost": 80},
        {"item_code": "ITEM-B", "standard_rate": 200, "cost": 150}
    ]
    
    total_sent = 0
    
    # Simulation Loop
    for cust_idx, customer in enumerate(customers):
        print(f"\n[Customer Loop] Processing {customer.name} ({cust_idx+1}/{len(customers)})")
        
        # Inter-customer delay
        if cust_idx > 0:
            cluster_delay = random.randint(180, 300)
            print(f"[STEALTH] Waiting {cluster_delay}s between customers (Inter-Cluster Delay)")
            
        for item_idx, item in enumerate(items):
            print(f"  [Item Loop] Sending {item['item_code']} to {customer.name}...")
            
            # Quota Check simulation
            if not check_global_quota(is_mass_campaign=True):
                print("  [QUOTA] Limit reached, waiting...")
                
            # Simulate Send
            total_sent += 1
            print(f"  [SEND] Message sent. Rate used: {item['standard_rate']}")
            
            # Intra-cluster delay
            delay = smart_delay(total_sent, 0, is_mass_campaign=True)
            print(f"  [STEALTH] Waiting {delay}s before next item (Intra-Cluster Delay)")
            
        print(f"[DB] Commit after {customer.name}")

if __name__ == "__main__":
    simulate_dead_stock_campaign()
