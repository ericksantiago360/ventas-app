from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from .core.config import settings
from .core.database import connect_db, close_db
from .routers import (auth, crm, catalogo, cotizaciones, pedidos, finanzas, contabilidad, inventario, reportes, personal, pacientes, lab, )


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

# ── Archivos estáticos (PDFs generados) ───────────────────────────────────────
os.makedirs(settings.STORAGE_PATH, exist_ok=True)
app.mount("/storage", StaticFiles(directory=settings.STORAGE_PATH), name="storage")

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(crm.router, prefix="/api/crm", tags=["crm"])
app.include_router(catalogo.router, prefix="/api/catalogo", tags=["catalogo"])
app.include_router(cotizaciones.router, prefix="/api/cotizaciones", tags=["cotizaciones"])
app.include_router(pedidos.router, prefix="/api/pedidos", tags=["pedidos"])
app.include_router(finanzas.router, prefix="/api")
app.include_router(contabilidad.router, prefix="/api")
app.include_router(inventario.router, prefix="/api")
app.include_router(reportes.router, prefix="/api")
app.include_router(personal.router, prefix="/api")
app.include_router(pacientes.router, prefix="/api")
app.include_router(lab.router,      prefix="/api")

@app.get("/api/health", tags=["system"])
async def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": "0.1.0"}
