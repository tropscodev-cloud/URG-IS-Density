# main.py
import asyncio
import os
import sys
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
import uvicorn

# Ensure the root path is configured
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from core.database import init_db
from core.crowd_analytics import analytics_service
from api.routes import auth, cameras, history
from api.ws.connection import manager as ws_manager
from workers.manager import CameraProcessManager

app = FastAPI(
    title="URG-IS Lightweight Backend API",
    description="Universal Relationship Graph Intelligence System - Live Density Tracking Backend",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(cameras.router, prefix="/api/v1", tags=["Cameras"])
app.include_router(history.router, prefix="/api/v1", tags=["History"])

# Initialize multiprocessing manager
process_manager = CameraProcessManager()

async def websocket_queue_reader():
    """Reads frame metrics payloads from workers queue and broadcasts to all WebSocket clients."""
    loop = asyncio.get_event_loop()
    while True:
        try:
            # Non-blocking fetch using run_in_executor
            payload = await loop.run_in_executor(None, process_manager.queue.get)
            if payload is None:
                break
                
            # Update the geofenced crowd analytics service with live coordinates
            entities = payload.get("entities", [])
            analytics_service.process_entities(entities)
            
            # Broadcast metrics payload to active websockets (rate-limited inside manager)
            await ws_manager.broadcast_frame(payload)
            
        except Exception as e:
            logger.error(f"Error in WebSocket queue reader: {e}")
            await asyncio.sleep(0.1)

@app.on_event("startup")
async def startup_event():
    logger.info("Initializing database schemas...")
    init_db()
    
    logger.info("Starting background camera processes...")
    process_manager.start_all()
    
    # Start the queue listener
    asyncio.create_task(websocket_queue_reader())
    logger.success("URG-IS Backend Services successfully running.")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Stopping camera processes...")
    process_manager.stop_all()

@app.websocket("/api/v1/ws/metrics")
async def websocket_metrics_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep socket open and listen for text frames (e.g. heartbeat)
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket client crash: {e}")
        ws_manager.disconnect(websocket)

@app.get("/health")
async def health():
    return {
        "status": "online",
        "engine": "YOLO-BoTSORT",
        "active_processes": len(process_manager.processes)
    }

@app.get("/api/v1/zones/state")
async def get_zones_state():
    """Returns real-time headcounts and severity alerts for all geofenced zones."""
    return analytics_service.get_zone_metrics()

@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/docs")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
