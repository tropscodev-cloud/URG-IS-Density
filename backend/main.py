# main.py
import asyncio
import os
import sys
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
import uvicorn

# Ensure the root path is configured
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from core.database import init_db
from core.crowd_analytics import analytics_service
from core.metrics_store import live_metrics
from api.routes import auth, cameras, history, analytics
from api.ws.connection import manager as ws_manager
from workers.manager import process_manager

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
app.include_router(analytics.router, prefix="/api/v1", tags=["Analytics"])

app.mount("/data", StaticFiles(directory="data"), name="data")

# latest_metrics_cache is now the shared live_metrics singleton from core.metrics_store
# so that analytics routes (chatbot) can read live data without circular imports.
latest_metrics_cache = live_metrics

async def websocket_queue_reader():
    """Reads frame metrics payloads from workers queue and broadcasts to all WebSocket clients."""
    loop = asyncio.get_event_loop()
    while True:
        try:
            # Non-blocking fetch using run_in_executor
            payload = await loop.run_in_executor(None, process_manager.queue.get)
            if payload is None:
                break
                
            camera_id = payload.get("camera_id")
            seq = payload.get("seq", 0)
            metrics = payload.get("metrics", {})
            entities = payload.get("entities", [])
            video_time_s = payload.get("video_time_s")
            effective_fps = payload.get("effective_fps")

            # Update the geofenced crowd analytics service with live coordinates
            analytics_service.process_entities(entities)

            # Format to the camera metrics JSON schema expected by the React frontend
            ts_str = datetime.utcnow().isoformat() + "Z"
            metrics_data = {
                "cameraId": camera_id,
                "seq": seq,
                "ts": ts_str,
                "headcount": metrics.get("headcount", 0),
                "flowRate": metrics.get("flow_rate", 0),
                "movementPct": metrics.get("moving_percentage", 65.0),
                "densityRisk": metrics.get("risk_percentage", 0.0) / 100.0,
                "inferenceLatencyMs": 15,
                "entities": entities,
                # Position within the *source* video file this frame's detections came from — lets
                # a client seek its own <video> playback to match instead of free-running out of
                # sync with when these boxes were actually observed.
                "sourceVideoTimeS": video_time_s,
                # What the worker is actually sampling at right now — may lag a moment behind a
                # just-requested target_fps until the worker's next raw-frame poll picks it up.
                "effectiveFps": effective_fps,
            }
            
            # Cache it
            latest_metrics_cache[camera_id] = metrics_data
            
            # Prepare standard metrics message
            metrics_msg = {
                "type": "metrics",
                "topic": f"camera:{camera_id}",
                "cameraId": camera_id,
                "seq": seq,
                "ts": ts_str,
                "data": metrics_data
            }
            
            # Broadcast metrics payload to active websockets
            await ws_manager.broadcast_camera_metrics(camera_id, metrics_msg)
            
        except Exception as e:
            logger.error(f"Error in WebSocket queue reader: {e}")
            await asyncio.sleep(0.1)

async def global_fleet_snapshot_loop():
    """Periodically (1 Hz) sends a fleet-wide snapshot of all camera metrics to 'global' topic subscribers."""
    while True:
        try:
            await asyncio.sleep(1.0)
            cameras_metrics = list(latest_metrics_cache.values())
            
            # Send snapshot if we have active data
            if cameras_metrics:
                snapshot_msg = {
                    "type": "fleet_snapshot",
                    "topic": "global",
                    "ts": datetime.utcnow().isoformat() + "Z",
                    "cameras": cameras_metrics
                }
                await ws_manager.broadcast_global(snapshot_msg)
                
                # Periodically send server time sync frame
                time_msg = {
                    "type": "server_time",
                    "ts": datetime.utcnow().isoformat() + "Z"
                }
                await ws_manager.broadcast_global(time_msg)
        except Exception as e:
            logger.error(f"Error in global fleet snapshot loop: {e}")

@app.on_event("startup")
async def startup_event():
    logger.info("Initializing database schemas...")
    init_db()
    
    logger.info("Starting background camera processes...")
    process_manager.start_all()
    
    # Start the queue listener and global snapshot tasks
    asyncio.create_task(websocket_queue_reader())
    asyncio.create_task(global_fleet_snapshot_loop())
    logger.success("URG-IS Backend Services successfully running.")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Stopping camera processes...")
    process_manager.stop_all()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """The multiplexed WebSocket endpoint supporting camera and global subscriptions."""
    await ws_manager.connect(websocket)
    try:
        while True:
            # Receive subscription and ping frames from client
            text_data = await websocket.receive_text()
            await ws_manager.handle_client_message(websocket, text_data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket client disconnected due to error: {e}")
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
