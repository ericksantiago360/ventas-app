from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from pymongo.errors import DuplicateKeyError

from .core.config import settings
from .core.database import connect_db, close_db
from .routers import (auth, crm, leads, catalogo, cotizaciones, pedidos, finanzas, contabilidad, inventario, compras, mostrador, reportes, personal, pacientes, lab, facturacion, portal, negocios, usuarios, )
from .modules.clinica.routes import (
    citas as clinica_citas, consentimientos as clinica_consentimientos, expedientes as clinica_expedientes,
    farmacia as clinica_farmacia, recetas as clinica_recetas,
)
from .modules.carta_porte.routes import cartas_porte as cp_cartas, operadores as cp_operadores, vehiculos as cp_vehiculos
from .modules.timbrado.routes import csd as timbrado_csd
from .modules.ecommerce.routes import (
    admin_ordenes as ecommerce_admin_ordenes, catalogo as ecommerce_catalogo,
    config as ecommerce_config, ordenes as ecommerce_ordenes,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await close_db()


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url="/api/redoc" if settings.DEBUG else None,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# En producción, reemplaza los orígenes con tu dominio real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev
        "http://localhost:80",
        "http://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Registros duplicados (índices únicos de MongoDB) → 409 ────────────────────
@app.exception_handler(DuplicateKeyError)
async def duplicado_handler(request: Request, exc: DuplicateKeyError):
    campos = [
        k for k in ((exc.details or {}).get("keyValue") or {})
        if k != "negocio_id"
    ]
    detalle = "Ya existe un registro con ese valor"
    if campos:
        detalle += f" ({', '.join(campos)})"
    return JSONResponse(status_code=409, content={"detail": detalle})

# ── Archivos estáticos (PDFs generados) ───────────────────────────────────────
os.makedirs(settings.STORAGE_PATH, exist_ok=True)
app.mount("/storage", StaticFiles(directory=settings.STORAGE_PATH), name="storage")

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(crm.router, prefix="/api/crm", tags=["crm"])
app.include_router(leads.router, prefix="/api", tags=["crm-leads"])
app.include_router(catalogo.router, prefix="/api/catalogo", tags=["catalogo"])
app.include_router(cotizaciones.router, prefix="/api/cotizaciones", tags=["cotizaciones"])
app.include_router(pedidos.router, prefix="/api/pedidos", tags=["pedidos"])
app.include_router(finanzas.router, prefix="/api")
app.include_router(contabilidad.router, prefix="/api")
app.include_router(inventario.router, prefix="/api")
app.include_router(compras.router, prefix="/api")
app.include_router(mostrador.router, prefix="/api")
app.include_router(reportes.router, prefix="/api")
app.include_router(personal.router, prefix="/api")
app.include_router(pacientes.router, prefix="/api")
app.include_router(lab.router,      prefix="/api")
app.include_router(facturacion.router, prefix="/api")
app.include_router(portal.router, prefix="/api")
app.include_router(negocios.router, prefix="/api")
app.include_router(usuarios.router, prefix="/api")
app.include_router(clinica_expedientes.router, prefix="/api")
app.include_router(clinica_citas.router, prefix="/api")
app.include_router(clinica_recetas.router, prefix="/api")
app.include_router(clinica_farmacia.router, prefix="/api")
app.include_router(clinica_consentimientos.router, prefix="/api")
# Carta Porte: flota y operadores antes que /carta-porte/{id}
app.include_router(cp_vehiculos.router, prefix="/api")
app.include_router(cp_operadores.router, prefix="/api")
app.include_router(cp_cartas.router, prefix="/api")
app.include_router(timbrado_csd.router, prefix="/api")
# Tienda en línea: pública (/api/tienda) y admin (/api/admin/tienda)
app.include_router(ecommerce_config.router, prefix="/api")
app.include_router(ecommerce_catalogo.router, prefix="/api")
app.include_router(ecommerce_ordenes.router, prefix="/api")
app.include_router(ecommerce_admin_ordenes.router, prefix="/api")

@app.get("/api/health", tags=["system"])
async def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": "0.1.0"}
