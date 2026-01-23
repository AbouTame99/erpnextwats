import asyncio
import os
import signal
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from neonize.client import NewClient
from neonize.events import ConnectedEv, MessageEv, QRReadyEv, ReadyEv
from neonize.types import MessageSource
import uvicorn
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("whatsapp_gateway")

app = FastAPI()

# Global state to track sessions
sessions = {}

class WhatsAppSession:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.status = "init"
        self.qr_code = None
        self.client = None
        self.loop = asyncio.get_event_loop()

    def on_qr(self, client: NewClient, qr: str):
        logger.info(f"QR Ready for {self.user_id}")
        self.qr_code = qr
        self.status = "qr_ready"

    def on_connected(self, client: NewClient, evt: ConnectedEv):
        logger.info(f"Connected for {self.user_id}")
        self.status = "connecting"

    def on_ready(self, client: NewClient, evt: ReadyEv):
        logger.info(f"Ready for {self.user_id}")
        self.status = "ready"
        self.qr_code = None

    async def start(self):
        # Database file per user
        db_path = f"session_{self.user_id}.db"
        self.client = NewClient(db_path)
        
        # Register events
        self.client.event_handler.register(ConnectedEv)(self.on_connected)
        self.client.event_handler.register(ReadyEv)(self.on_ready)
        self.client.event_handler.register(QRReadyEv)(self.on_qr)
        
        # Start the client non-blocking
        # Neonize's connect() is usually blocking in its standard usage, 
        # but the library might differ. We'll use a thread/task.
        # Note: Neonize's architecture is a bit unique with GOMP.
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self.client.connect)

@app.post("/api/whatsapp/init")
async def init_session(data: dict):
    user_id = data.get("userId")
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")
    
    if user_id in sessions:
        # If already ready, just return status
        if sessions[user_id].status == "ready":
            return {"status": "ready"}
        # If initializing, wait
        return {"status": sessions[user_id].status}

    session = WhatsAppSession(user_id)
    sessions[user_id] = session
    asyncio.create_task(session.start())
    
    return {"status": "initializing"}

@app.get("/api/whatsapp/status/{user_id}")
async def get_status(user_id: str):
    if user_id not in sessions:
        return {"status": "disconnected"}
    
    session = sessions[user_id]
    return {
        "status": session.status,
        "qr": session.qr_code
    }

@app.post("/api/whatsapp/send")
async def send_message(data: dict):
    user_id = data.get("userId")
    to = data.get("to")
    message = data.get("message")
    
    if user_id not in sessions or sessions[user_id].status != "ready":
        raise HTTPException(status_code=400, detail="Session not ready")
    
    # Simple text message implementation
    # Neonize usage: client.send_text(to, message)
    # The 'to' number usually needs to be formatted (e.g. 1234567890@s.whatsapp.net)
    if "@" not in to:
        to = f"{to}@s.whatsapp.net"
        
    try:
        sessions[user_id].client.send_text(to, message)
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3000)
