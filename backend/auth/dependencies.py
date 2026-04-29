from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, Query, WebSocketException, status
from fastapi.security.utils import get_authorization_scheme_param
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import HTTPConnection

from auth.security import decode_token, verify_password
from database.db import get_db
from database.models import ApiKey, User, UserRole


def verify_api_key(raw: str, hashed: str) -> bool:
    return verify_password(raw, hashed)


def _auth_error(detail: str = "No authentication provided"):
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _websocket_auth_error():
    return WebSocketException(code=4001)


async def get_current_user(
    connection: HTTPConnection,
    x_api_key: str | None = Header(None),
    ws_token: str | None = Query(None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    is_websocket = connection.scope.get("type") == "websocket"

    if x_api_key:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(ApiKey).where(
                ApiKey.is_active == True,  # noqa: E712
                or_(ApiKey.expires_at.is_(None), ApiKey.expires_at > now),
            )
        )
        keys = result.scalars().all()

        for key in keys:
            if verify_api_key(x_api_key, key.key_hash):
                key.last_used_at = now
                await db.commit()

                user_result = await db.execute(select(User).where(User.id == key.user_id))
                user = user_result.scalars().first()
                if not user or not user.is_active:
                    if is_websocket:
                        raise _websocket_auth_error()
                    raise _auth_error("Invalid API key")

                connection.state.user = user
                return user

        if is_websocket:
            raise _websocket_auth_error()
        raise _auth_error("Invalid API key")

    authorization = connection.headers.get("Authorization")
    scheme, credentials = get_authorization_scheme_param(authorization)
    bearer_token = credentials if authorization and scheme.lower() == "bearer" else None

    if is_websocket and not bearer_token:
        bearer_token = ws_token

    if bearer_token:
        try:
            payload = decode_token(bearer_token)
        except Exception:
            if is_websocket:
                raise _websocket_auth_error()
            raise _auth_error("Invalid or expired token")

        if payload.get("type") != "access":
            if is_websocket:
                raise _websocket_auth_error()
            raise _auth_error("Invalid token type")

        user_id = payload.get("sub")
        if not user_id:
            if is_websocket:
                raise _websocket_auth_error()
            raise _auth_error("Invalid token payload")

        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalars().first()
        if not user or not user.is_active:
            if is_websocket:
                raise _websocket_auth_error()
            raise _auth_error("User not found or inactive")

        connection.state.user = user
        return user

    if is_websocket:
        raise _websocket_auth_error()
    raise _auth_error()


def require_editor(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in (UserRole.admin, UserRole.editor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    return current_user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    return current_user
