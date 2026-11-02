"""Logo y banner de la tienda: subir, reemplazar (borra el archivo anterior) y quitar."""
import base64
from pathlib import Path

from app.core.config import settings

from .conftest import datos
from .test_ecommerce import _tienda_activa

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
NEG = "santal"
N = {"negocio_id": NEG}


def _ruta(url: str) -> Path:
    return Path(settings.STORAGE_PATH) / url.removeprefix("/storage/")


def _subir(client, admin, tipo: str) -> str:
    r = client.post(f"/api/admin/tienda/{tipo}", headers=admin, params=N,
                    files={"archivo": ("foto.png", PNG_1X1, "image/png")})
    assert r.status_code == 200, r.text
    return r.json()[f"{tipo}_url"]


def _config(client, admin) -> dict:
    return client.get("/api/admin/tienda/config", headers=admin, params=N).json()


def test_subir_logo_y_banner_quedan_en_la_config(client, admin):
    _tienda_activa(client, admin)
    logo = _subir(client, admin, "logo")
    banner = _subir(client, admin, "banner")
    assert logo.startswith(f"/storage/tienda/{NEG}/logo-") and logo.endswith(".png")
    assert banner.startswith(f"/storage/tienda/{NEG}/banner-")
    cfg = _config(client, admin)
    assert cfg["logo_url"] == logo and cfg["banner_url"] == banner
    assert _ruta(logo).exists() and _ruta(banner).exists()


def test_reemplazar_logo_borra_el_archivo_anterior(client, admin):
    _tienda_activa(client, admin)
    anterior = _subir(client, admin, "logo")
    nuevo = _subir(client, admin, "logo")
    assert nuevo != anterior
    assert _config(client, admin)["logo_url"] == nuevo
    assert not _ruta(anterior).exists()
    assert _ruta(nuevo).exists()


def test_quitar_logo_limpia_url_y_archivo(client, admin):
    _tienda_activa(client, admin)
    url = _subir(client, admin, "logo")
    r = client.delete("/api/admin/tienda/logo", headers=admin, params=N)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "logo_url": ""}
    assert _config(client, admin)["logo_url"] == ""
    assert not _ruta(url).exists()


def test_quitar_banner_no_toca_el_logo(client, admin):
    _tienda_activa(client, admin)
    logo = _subir(client, admin, "logo")
    banner = _subir(client, admin, "banner")
    r = client.delete("/api/admin/tienda/banner", headers=admin, params=N)
    assert r.status_code == 200, r.text
    cfg = _config(client, admin)
    assert cfg["banner_url"] == "" and cfg["logo_url"] == logo
    assert not _ruta(banner).exists() and _ruta(logo).exists()


def test_quitar_sin_imagen_no_falla(client, admin):
    _tienda_activa(client, admin)
    r = client.delete("/api/admin/tienda/logo", headers=admin, params=N)
    assert r.status_code == 200, r.text


def test_quitar_imagen_publica_se_refleja_en_la_tienda(client, admin):
    slug = _tienda_activa(client, admin)
    _subir(client, admin, "banner")
    assert client.get(f"/api/tienda/{slug}/config").json()["banner_url"]
    client.delete("/api/admin/tienda/banner", headers=admin, params=N)
    assert client.get(f"/api/tienda/{slug}/config").json()["banner_url"] == ""
