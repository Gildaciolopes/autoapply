SHELL := /bin/bash
.DEFAULT_GOAL := help
COMPOSE := docker compose
INFRA := postgres redis minio
MODELS := qwen3:8b bge-m3 qwen2.5vl:7b

help: ## Lista comandos
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n",$$1,$$2}'

setup: ## Primeira vez: .env, deps, modelos, infra, migrations
	@test -f .env || (cp .env.example .env && sed -i '' "s/SESSION_ENCRYPTION_KEY=change-me/SESSION_ENCRYPTION_KEY=$$(openssl rand -hex 32)/" .env)
	pnpm install
	cd services/scraper && uv sync
	pnpm exec playwright install chromium
	$(MAKE) models infra migrate

dev: infra packages ## Infra no Docker + api/worker/web/scraper em watch no host
	@trap 'kill 0' EXIT; \
	(cd services/scraper && uv run autoapply-scraper) & \
	pnpm exec turbo run dev --parallel --filter=./apps/* --filter=./packages/*

infra: ## Sobe postgres, redis, minio (espera healthy)
	$(COMPOSE) up -d --wait $(INFRA)
	@$(COMPOSE) run --rm minio-init >/dev/null

packages: ## Build dos packages compartilhados (shared, db, llm)
	pnpm --filter "./packages/*" run build

down: ## Para containers (mantém volumes)
	$(COMPOSE) --profile linkedin --profile apps down

logs: ## Logs da infra (s=postgres|redis|minio|linkedin-mcp)
	$(COMPOSE) logs -f $(s)

migrate: ## Aplica migrations (dev)
	pnpm --filter @autoapply/db run migrate:dev

migration: ## Nova migration: make migration name=add_x
	pnpm --filter @autoapply/db exec prisma migrate dev --name $(name)

studio: ## Prisma Studio
	pnpm --filter @autoapply/db run studio

models: ## Baixa modelos Ollama (16GB RAM)
	@command -v ollama >/dev/null || (echo "instale Ollama: brew install ollama" && exit 1)
	@for m in $(MODELS); do ollama pull $$m; done

scraper: ## Só o worker Python (JobSpy)
	cd services/scraper && uv run autoapply-scraper

linkedin-login: ## Login LinkedIn MCP (abre viewer em http://localhost:6080)
	mkdir -p data/linkedin-mcp
	docker run -it --rm -v $(PWD)/data/linkedin-mcp:/home/pwuser/.linkedin-mcp \
	  -p 127.0.0.1:6080:6080 stickerdaniel/linkedin-mcp-server:latest --login --login-viewer

linkedin-up: ## Sobe LinkedIn MCP (HTTP em LINKEDIN_MCP_URL)
	$(COMPOSE) --profile linkedin up -d linkedin-mcp

test: ## Testes TS + Python
	pnpm exec turbo run test
	cd services/scraper && uv run pytest -q

typecheck: packages ## Typecheck de tudo
	pnpm exec turbo run typecheck
	cd services/scraper && uv run ruff check src tests

lint: ## Lint
	pnpm exec turbo run lint
	cd services/scraper && uv run ruff check src tests

health: ## Status de db/redis/ollama via API
	@curl -s localhost:$${API_PORT:-3001}/health; echo

graph: ## Atualiza grafo de código (graphify, sem LLM)
	graphify update .

reset: ## APAGA volumes (db, redis, minio). Pede confirmação
	@read -p "Apagar TODOS os dados locais? [y/N] " a && [ "$$a" = y ]
	$(COMPOSE) --profile linkedin --profile apps down -v

.PHONY: help setup dev infra packages down logs migrate migration studio models scraper linkedin-login linkedin-up test typecheck lint health graph reset
