import asyncio
import atexit
from collections.abc import Awaitable
from typing import TypeVar


T = TypeVar("T")

_worker_loop: asyncio.AbstractEventLoop | None = None


def get_worker_loop() -> asyncio.AbstractEventLoop:
    global _worker_loop
    if _worker_loop is None or _worker_loop.is_closed():
        _worker_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_worker_loop)
    return _worker_loop


def run_async(awaitable: Awaitable[T]) -> T:
    loop = get_worker_loop()
    return loop.run_until_complete(awaitable)


def _close_worker_loop() -> None:
    global _worker_loop
    if _worker_loop is None or _worker_loop.is_closed():
        return
    pending = asyncio.all_tasks(_worker_loop)
    for task in pending:
        task.cancel()
    if pending:
        try:
            _worker_loop.run_until_complete(
                asyncio.gather(*pending, return_exceptions=True)
            )
        except Exception:
            pass
    _worker_loop.close()
    _worker_loop = None


atexit.register(_close_worker_loop)
