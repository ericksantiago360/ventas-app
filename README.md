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

- Email: ``
- Password: ``

> Cambia la contraseña desde el perfil después del primer login.

### 4. API docs (modo debug)
Activa `DEBUG=true` en `.env` y visita `http://localhost/api/docs`

### 5. Envío de resultados por correo y portal del paciente
Configura en `.env` la URL pública y un servidor SMTP:

```
APP_URL=https://lab.midominio.com     # base de los enlaces del portal
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587                         # 465 → SMTP_SSL=true
SMTP_USER=resultados@midominio.com
SMTP_PASSWORD=contraseña-de-aplicacion
SMTP_FROM_NAME=Laboratorio Diagnóstico Plus
```

- **Resultados → orden completada → "✉ Enviar por correo"**: manda el PDF (solo estudios validados) y un enlace al portal; queda registrado en la orden.
- **Portal del paciente** en `/portal`: el paciente entra con un enlace personal (sin contraseña) que recibe por correo o que el personal copia desde la ficha del paciente. Los enlaces vencen a los `PORTAL_TOKEN_DAYS` días (30 por defecto) y se pueden revocar desde la ficha.

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

## Pruebas

Suite de pytest en `backend/tests/` (~230 pruebas: acceso por negocio, CRM, catálogo,
cotizaciones, pedidos, facturación, inventario, nómina, contabilidad, laboratorio y portal).
Corre la app en proceso contra un MongoDB real, en una base temporal que se borra al terminar.

```bash
make test                       # levanta un Mongo efímero en Docker y corre todo
make test ARGS="-k catalogo -x" # filtrar / detener en el primer fallo
```

Sin Docker (requiere un MongoDB accesible y las dependencias de WeasyPrint):

```bash
cd backend
pip install -r requirements-dev.txt
MONGODB_URL=mongodb://localhost:27017 pytest
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
