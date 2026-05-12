import logging
import uuid

from fastapi import Request


logger = logging.getLogger(__name__)


class RequestIDMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())[:8]
        scope["request_id"] = request_id
        scope.setdefault("state", {})
        scope["state"]["request_id"] = request_id

        logger.debug(
            "REQUEST %s %s %s",
            request_id,
            request.method,
            request.url.path,
        )

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
                status = message.get("status", 500)
                logger.info(
                    "REQUEST %s %s %s -> %s",
                    request_id,
                    request.method,
                    request.url.path,
                    status,
                )
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            logger.exception(
                "REQUEST %s %s %s -> 500",
                request_id,
                request.method,
                request.url.path,
            )
            raise
