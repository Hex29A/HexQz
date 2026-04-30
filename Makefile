.PHONY: dev build up down logs clean

# Development: hot-reload server + client
dev:
	docker compose -f docker-compose.dev.yml up --build

# Production: build and start
build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

clean:
	docker compose down -v
	docker compose -f docker-compose.dev.yml down -v
