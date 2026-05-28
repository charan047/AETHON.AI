from __future__ import annotations


def _status_value(status: object) -> str:
    if hasattr(status, "value"):
        return str(getattr(status, "value"))
    return str(status or "")


def execution_review_presentation(status: object) -> dict[str, object]:
    raw = _status_value(status)

    if raw == "pending_review":
        return {
            "status": raw,
            "status_label": "needs review",
            "review_state": "needs_review",
            "review_stage": "final_review",
            "requires_ceo_action": True,
        }

    if raw == "waiting_approval":
        return {
            "status": raw,
            "status_label": "needs review",
            "review_state": "needs_review",
            "review_stage": "workflow_pause",
            "requires_ceo_action": True,
        }

    labels = {
        "completed": "done",
        "running": "running",
        "pending": "pending",
        "failed": "failed",
        "cancelled": "stopped",
        "rejected": "rejected",
        "timed_out": "timeout",
    }

    return {
        "status": raw,
        "status_label": labels.get(raw, raw.replace("_", " ") if raw else "unknown"),
        "review_state": None,
        "review_stage": None,
        "requires_ceo_action": False,
    }


def agent_status_presentation(status: object) -> dict[str, object]:
    raw = _status_value(status)
    labels = {
        "working": "working",
        "idle": "idle",
        "waiting_approval": "needs review",
        "blocked": "blocked",
        "off_duty": "off duty",
    }
    return {
        "status": raw,
        "status_label": labels.get(raw, raw.replace("_", " ") if raw else "unknown"),
        "requires_ceo_action": raw == "waiting_approval",
    }
