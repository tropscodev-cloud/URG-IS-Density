# api/ws/connection.py
import asyncio
import time
from typing import Set, Dict
from fastapi import WebSocket
from loguru import logger

class ConnectionManager:
    """Manages active WebSocket connections and broadcasts 4 Hz rate-capped metrics frames."""
    
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        # Track last sent epoch time per (websocket, camera_id) to enforce 4 Hz limit
        self.last_sent: Dict[WebSocket, Dict[str, float]] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        self.last_sent[websocket] = {}
        logger.info(f"WebSocket client connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        self.last_sent.pop(websocket, None)
        logger.info(f"WebSocket client disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast_frame(self, frame_data: dict):
        camera_id = frame_data.get("camera_id")
        if not camera_id:
            return

        now = time.time()
        disconnected_sockets = []

        # Broadcast to all active sockets with 4 Hz rate-limiting per camera stream
        for websocket in list(self.active_connections):
            last_sent_time = self.last_sent.get(websocket, {}).get(camera_id, 0.0)
            
            # Enforce 4 Hz (0.25 seconds between frames per camera channel)
            if now - last_sent_time < 0.25:
                continue

            try:
                await websocket.send_json(frame_data)
                if websocket not in self.last_sent:
                    self.last_sent[websocket] = {}
                self.last_sent[websocket][camera_id] = now
            except Exception as e:
                logger.error(f"Failed to send JSON to client: {e}")
                disconnected_sockets.append(websocket)

        # Cleanup closed/disconnected sockets
        for ws in disconnected_sockets:
            self.disconnect(ws)

manager = ConnectionManager()
