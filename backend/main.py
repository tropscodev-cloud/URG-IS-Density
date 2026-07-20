# main.py
import asyncio
import os
import sys
from datetime import datetime
import jwt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
import uvicorn

# Ensure the root path is configured
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from core.config import settings
from core.database import init_db, SessionLocal
from core.crowd_analytics import analytics_service
from core.alert_engine import alert_engine
from core.metrics_store import live_metrics
from api.routes import auth, cameras, history, analytics, users, telemetry
from api.routes.analytics import serialize_alert
from api.ws.connection import manager as ws_manager
from models.orm import User
from workers.manager import process_manager

app = FastAPI(
    title="URG-IS Lightweight Backend API",
    description="Universal Relationship Graph Intelligence System - Live Density Tracking Backend",
    version="1.0.0"
)

# CORS configuration — explicit allowlist, required alongside allow_credentials=True. A wildcard
# origin combined with credentials is a real misconfiguration to fix at the server, not something
# to rely on the browser's own same-origin defenses to paper over.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(cameras.router, prefix="/api/v1", tags=["Cameras"])
app.include_router(history.router, prefix="/api/v1", tags=["History"])
app.include_router(analytics.router, prefix="/api/v1", tags=["Analytics"])
app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
app.include_router(telemetry.router, prefix="/api/v1", tags=["Telemetry"])

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

            # Update the geofenced crowd analytics service with live coordinates. The synchronous
            # DB write this triggers every 5 minutes runs on the executor (mirroring the queue.get
            # above), not inline — a SQLite write-lock blocking straight on the event loop would
            # stall every other coroutine, including the fleet-wide broadcast below.
            write_due = analytics_service.process_entities(entities)
            if write_due:
                await loop.run_in_executor(None, analytics_service.write_historical_records)

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

            # Real-time density alerting: hysteresis-debounced threshold crossing, evaluated every
            # frame (cheap, in-memory) but only ever written to the DB on an actual state
            # transition (raise/upgrade/resolve) — and that write runs off the event loop for the
            # same reason the zone-history write above does.
            alert_action = alert_engine.evaluate(camera_id, metrics_data["densityRisk"])
            if alert_action is not None:
                alert_row = await loop.run_in_executor(None, alert_engine.apply_action, alert_action)
                if alert_row is not None:
                    event = "resolved" if alert_action["type"] == "resolve" else "raised"
                    await ws_manager.broadcast_alerts({
                        "type": "alert",
                        "topic": "alerts",
                        "event": event,
                        "alert": serialize_alert(alert_row),
                    })

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

    # alert_engine is constructed as a module-level singleton (import time, before init_db() has
    # necessarily created its tables on a brand-new DB file) — refresh both caches now that the
    # schema and seed cameras are guaranteed to exist.
    alert_engine.load_configs()
    alert_engine.load_camera_zones()

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
    session_token = websocket.cookies.get("session_token")
    authenticated = False
    if session_token:
        try:
            payload = jwt.decode(session_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
            # Scoped reset/enroll tokens must never authenticate a WS connection either, and a
            # deactivated user's still-unexpired JWT must stop working here too — same DB-backed
            # check get_current_user applies to every REST call, done inline since this handshake
            # runs before any FastAPI dependency injection.
            if payload.get("purpose") is None and payload.get("sub"):
                db = SessionLocal()
                try:
                    user = db.query(User).filter(User.id == payload["sub"]).first()
                    authenticated = bool(user and user.is_active)
                finally:
                    db.close()
        except jwt.PyJWTError:
            pass
    if not authenticated:
        # Closing with a specific code *before* accept() fails the opening handshake itself —
        # compliant clients only ever observe an abrupt 1006 (no real WS close frame was ever
        # sent), not the 1008 we're asking for here. Accept first, then close, so a real Close
        # frame carrying 1008 actually reaches the client. The sleep(0) matters: uvicorn's
        # websockets implementation batches accept-immediately-followed-by-close within the same
        # event-loop tick into never completing the opening handshake at all (observed as a 403
        # at the transport level, not a real 1008 close) — yielding once first lets it actually
        # flush the 101 before the close frame goes out. This never touches ws_manager (no entry
        # in its active_connections/last_sent dicts), so there's nothing to clean up afterward for
        # a connection that was never really let in.
        await websocket.accept()
        await asyncio.sleep(0)
        await websocket.close(code=1008)
        return

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
async def get_zones_state(_user = Depends(auth.get_current_user)):
    """Returns real-time headcounts and severity alerts for all geofenced zones."""
    return analytics_service.get_zone_metrics()

@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/docs")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
