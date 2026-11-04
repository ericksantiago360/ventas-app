"""
Cifrado en reposo de las llaves privadas (.key) y contraseñas de los CSD.

La clave Fernet viene de CSD_MASTER_KEY (entorno, no base de datos): si solo se filtra
MongoDB, las llaves cifradas no sirven. Generar una vez con:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from cryptography.fernet import Fernet

from app.core.config import settings


def _fernet() -> Fernet:
    if not settings.CSD_MASTER_KEY:
        raise RuntimeError("Falta CSD_MASTER_KEY en el entorno: no se puede cifrar ni descifrar el CSD")
    return Fernet(settings.CSD_MASTER_KEY.encode())


def cifrar(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def descifrar(data: bytes) -> bytes:
    return _fernet().decrypt(data)
