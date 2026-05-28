from __future__ import annotations

from database.models import IntegrationType


SUPPORTED_INTEGRATION_TYPES: set[IntegrationType] = {
    IntegrationType.github,
    IntegrationType.gmail,
    IntegrationType.email_smtp,
    IntegrationType.slack,
    IntegrationType.search_api,
}


def is_supported_integration_type(integration_type: IntegrationType) -> bool:
    return integration_type in SUPPORTED_INTEGRATION_TYPES


def unsupported_integration_note(integration_type: IntegrationType) -> str:
    return (
        f"{integration_type.value} exists in stored data, but it is not yet supported "
        "as a first-class Aethon integration."
    )
