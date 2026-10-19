"""Fechas: se guardan en UTC; el SAT las pide en hora local sin zona (AAAA-MM-DDThh:mm:ss)."""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.core.config import settings


def zona() -> ZoneInfo:
    return ZoneInfo(settings.ZONA_HORARIA)


def a_utc(dt: datetime) -> datetime:
    """Sin zona horaria = hora local del negocio. Mongo devuelve UTC sin zona; también se marca."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=zona())
    return dt.astimezone(timezone.utc)


def desde_db(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt


def local_sat(dt: datetime) -> str:
    """Formato tdCFDI:t_FechaH en hora local."""
    return desde_db(dt).astimezone(zona()).strftime("%Y-%m-%dT%H:%M:%S")


def hoy() -> date:
    return datetime.now(zona()).date()
