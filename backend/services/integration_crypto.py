import base64
import hashlib
import json

from cryptography.fernet import Fernet

from config import settings


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.jwt_secret_key.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_config(config: dict) -> str:
    payload = json.dumps(config).encode("utf-8")
    return _fernet().encrypt(payload).decode("utf-8")


def decrypt_config(encrypted_config: str) -> dict:
    payload = _fernet().decrypt(encrypted_config.encode("utf-8"))
    return json.loads(payload.decode("utf-8"))


def encrypt_value(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_value(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""
