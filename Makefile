.PHONY: up down build logs init-db shell-backend shell-mongo dev-backend dev-frontend

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
