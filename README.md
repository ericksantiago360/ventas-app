# Ventas App · Sistema multi-negocio

Sistema de gestión de ventas para Santal Machinery, Dulce Tentación y Bienes Raíces.

**Stack:** FastAPI · MongoDB (Motor) · React · Nginx · Docker Compose

---

## Inicio rápido

### 1. Requisitos
- Docker + Docker Compose v2
- Git

### 2. Clonar y configurar
```bash
git clone <repo-url>
cd ventas-app
cp .env.example .env
```

Edita `.env` y pon una `SECRET_KEY` aleatoria de al menos 32 caracteres:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 3. Levantar
```bash
make build   # construir imágenes (primera vez)
make up      # levantar todos los servicios
make init-db # crear negocios y usuario admin (solo la primera vez)
```

Accede a: **http://localhost**

- Email: `erick@santal.mx`
- Password: `cambiar-contrasena`

> Cambia la contraseña desde el perfil después del primer login.

### 4. API docs (modo debug)
Activa `DEBUG=true` en `.env` y visita `http://localhost/api/docs`

---

## Desarrollo local (sin Docker)

Requisitos adicionales: Python 3.12, Node 20

```bash
# MongoDB en Docker
make dev-mongo

# Backend (terminal 1)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env      # ajustar MONGODB_URL=mongodb://localhost:27017
make dev-backend             # uvicorn con --reload

# Frontend (terminal 2)
cd frontend
npm install
make dev-frontend            # Vite en http://localhost:5173
```

---

## Comandos útiles

```bash
make up           # levantar stack
make down         # detener
make logs         # ver logs en tiempo real
make init-db      # inicializar BD (solo 1 vez)
make shell-backend # bash en el contenedor backend
make shell-mongo   # mongosh en la BD
```

---

## Despliegue en Coolify (Hetzner VPS)

1. En Coolify, crea un nuevo proyecto tipo **Docker Compose**
2. Apunta al repositorio
3. **Elimina el servicio `nginx`** del `docker-compose.yml` — Coolify usa Traefik como reverse proxy y maneja SSL automáticamente
4. En la configuración de Coolify, expón el puerto `8000` (backend) y `80` (frontend) y configura los dominios
5. Agrega las variables de entorno del `.env` desde el panel de Coolify
6. Despliega — Coolify maneja el build y el restart automático

---

## Estructura del proyecto

```
ventas-app/
├── backend/
│   ├── app/
│   │   ├── core/          # config, database, security
│   │   ├── models/        # Pydantic base models
│   │   └── routers/       # auth, crm, catalogo, cotizaciones, pedidos
│   ├── templates/
│   │   └── cotizaciones/  # Jinja2 → WeasyPrint → PDF
│   ├── Dockerfile
│   ├── requirements.txt
│   └── init_db.py
├── frontend/
│   ├── src/
│   │   ├── api/           # axios client + helpers por módulo
│   │   ├── components/    # Layout (sidebar + header)
│   │   └── pages/         # Login, Dashboard + stubs
│   ├── Dockerfile
│   └── vite.config.js
├── nginx/
│   └── nginx.conf
├── docker-compose.yml
├── .env.example
└── Makefile
```

---

## Módulos

| Módulo | Estado | Descripción |
|---|---|---|
| Auth | ✅ Listo | JWT login, /me |
| CRM | 🏗 Scaffold | Clientes, leads, interacciones |
| Catálogo | 🏗 Scaffold | Productos, categorías, precios |
| Cotizaciones | 🏗 Scaffold | PDF multi-negocio (WeasyPrint) |
| Pedidos | 🏗 Scaffold | Kanban, estados, pagos |
| Inventario | ⏳ Pendiente | Stock y consignación (Dulce Tentación) |
| Reportes | ⏳ Pendiente | KPIs y dashboard |
