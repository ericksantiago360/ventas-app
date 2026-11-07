.PHONY: up down build logs init-db init-contabilidad seed-tienda shell-backend shell-mongo dev-backend dev-frontend test

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build --no-cache

logs:
	docker compose logs -f

init-db:
	docker compose exec backend python init_db.py

# Catálogo de cuentas y periodo del mes para todos los negocios (idempotente)
init-contabilidad:
	docker compose exec backend python init_contabilidad.py

# Seed de prueba: tienda de conveniencia (idempotente). Ej: make seed-tienda NEGOCIO=santal
seed-tienda:
	docker compose exec backend python scripts/seed_tienda_conveniencia.py $(or $(NEGOCIO),dulce_tentacion)

shell-backend:
	docker compose exec backend bash

shell-mongo:
	docker compose exec mongo mongosh ventas

# Desarrollo local sin Docker
dev-backend:
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev

dev-mongo:
	docker compose up -d mongo

# Pruebas (Mongo efímero en Docker). Ej: make test ARGS="-k catalogo -x"
test:
	docker compose -p ventas-test -f docker-compose.test.yml run --rm -e PYTEST_ARGS="$(ARGS)" tests; \
	status=$$?; docker compose -p ventas-test -f docker-compose.test.yml down -v >/dev/null 2>&1; exit $$status
