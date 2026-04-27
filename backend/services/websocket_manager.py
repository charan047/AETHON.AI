from fastapi import WebSocket
import json
import asyncio
from datetime import datetime
from collections import deque


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.log_buffer: deque = deque(maxlen=500)

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send buffered logs to new connection
        for log in self.log_buffer:
            try:
                await websocket.send_json(log)
            except Exception:
                pass

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        event = {**message, "timestamp": datetime.utcnow().isoformat()}
        self.log_buffer.append(event)

        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_json(event)
            except Exception:
                dead.append(connection)

        for d in dead:
            self.disconnect(d)

    async def send_personal(self, websocket: WebSocket, message: dict):
        try:
            await websocket.send_json(message)
        except Exception:
            self.disconnect(websocket)


ws_manager = ConnectionManager()
