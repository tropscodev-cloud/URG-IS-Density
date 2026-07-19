# api/ws/connection.py
import asyncio
import time
from typing import Dict, Set
from fastapi import WebSocket
from loguru import logger
from datetime import datetime

class ConnectionManager:
    """Manages WebSocket connections, tracks topic subscriptions, and broadcasts rate-capped metrics frames."""
    
    def __init__(self):
        # Map websocket connection to its set of subscribed topics (e.g. 'global', 'camera:CAM_001')
        self.active_connections: Dict[WebSocket, Set[str]] = {}
        # Track last sent epoch time per (websocket, camera_id) to enforce 4 Hz limit
        self.last_sent: Dict[WebSocket, Dict[str, float]] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = set()
        self.last_sent[websocket] = {}
        logger.info(f"WebSocket client connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.pop(websocket, None)
        self.last_sent.pop(websocket, None)
        logger.info(f"WebSocket client disconnected. Active connections: {len(self.active_connections)}")

    async def handle_client_message(self, websocket: WebSocket, text_data: str):
        """Processes subscription and ping messages from the client."""
        import json
        try:
            msg = json.loads(text_data)
            m_type = msg.get("type")
            if m_type == "subscribe":
                topics = msg.get("topics", [])
                if websocket in self.active_connections:
                    self.active_connections[websocket].update(topics)
                    logger.debug(f"Client subscribed to topics: {topics}")
            elif m_type == "unsubscribe":
                topics = msg.get("topics", [])
                if websocket in self.active_connections:
                    self.active_connections[websocket].difference_update(topics)
                    logger.debug(f"Client unsubscribed from topics: {topics}")
            elif m_type == "ping":
                await websocket.send_json({
                    "type": "pong",
                    "ts": datetime.utcnow().isoformat() + "Z"
                })
        except Exception as e:
            logger.error(f"Error handling client websocket message: {e}")

    async def broadcast_camera_metrics(self, camera_id: str, metrics_msg: dict):
        """Broadcasts real-time camera metrics to clients subscribed to camera:CAM_ID."""
        topic = f"camera:{camera_id}"
        now = time.time()
        disconnected_sockets = []

        for websocket, subscriptions in list(self.active_connections.items()):
            # Only broadcast if the client is explicitly subscribed to this camera channel
            if topic in subscriptions:
                last_sent_time = self.last_sent.get(websocket, {}).get(camera_id, 0.0)
                
                # Enforce 4 Hz (0.25 seconds limit)
                if now - last_sent_time < 0.25:
                    continue

                try:
                    await websocket.send_json(metrics_msg)
                    if websocket not in self.last_sent:
                        self.last_sent[websocket] = {}
                    self.last_sent[websocket][camera_id] = now
                except Exception as e:
                    logger.error(f"Failed to send metrics to client: {e}")
                    disconnected_sockets.append(websocket)

        for ws in disconnected_sockets:
            self.disconnect(ws)

    async def broadcast_global(self, snapshot_msg: dict):
        """Broadcasts fleet_snapshot message to all clients subscribed to the 'global' topic."""
        disconnected_sockets = []

        for websocket, subscriptions in list(self.active_connections.items()):
            if "global" in subscriptions:
                try:
                    await websocket.send_json(snapshot_msg)
                except Exception as e:
                    logger.error(f"Failed to send fleet snapshot to client: {e}")
                    disconnected_sockets.append(websocket)

        for ws in disconnected_sockets:
            self.disconnect(ws)

manager = ConnectionManager()
