from __future__ import annotations

import asyncio
import hmac
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from .config import Settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), geolocation=()"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response


class RequireHTTPSMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, enabled: bool) -> None:
        super().__init__(app)
        self.enabled = enabled

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        if self.enabled and forwarded_proto != "https" and request.url.hostname not in {
            "localhost",
            "127.0.0.1",
            "api",
        }:
            return JSONResponse({"detail": "HTTPS is required."}, status_code=426)
        return await call_next(request)


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, limit: int, window_seconds: int) -> None:
        super().__init__(app)
        self.limit = limit
        self.window_seconds = window_seconds
        self.requests: dict[str, deque[float]] = defaultdict(deque)
        self.lock = asyncio.Lock()

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if not request.url.path.startswith("/api/v1/"):
            return await call_next(request)

        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        client_key = forwarded or (request.client.host if request.client else "unknown")
        now = time.monotonic()

        async with self.lock:
            history = self.requests[client_key]
            while history and now - history[0] >= self.window_seconds:
                history.popleft()
            if len(history) >= self.limit:
                retry_after = max(1, int(self.window_seconds - (now - history[0])))
                return JSONResponse(
                    {"detail": "Rate limit exceeded. Please retry shortly."},
                    status_code=429,
                    headers={"Retry-After": str(retry_after)},
                )
            history.append(now)

        return await call_next(request)


def api_key_dependency(settings: Settings):
    async def verify_api_key(request: Request) -> None:
        provided = request.headers.get("x-api-key", "")
        if not provided or not hmac.compare_digest(provided, settings.api_key):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API credentials.",
            )

    return verify_api_key
