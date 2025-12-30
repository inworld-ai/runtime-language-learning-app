.PHONY: build docker-build docker-run local-install local-start local-build help

# Docker image name
IMAGE_NAME ?= oai-realtime-api-voice-agent
IMAGE_TAG ?= latest

GH_TOKEN ?=

# Default target
help:
	@echo "Available commands:"
	@echo "  make docker-build    - Build Docker image"
	@echo "  make docker-run      - Run Docker container"
	@echo "  make local-install   - Install dependencies locally"
	@echo "  make local-start     - Start server locally (development mode)"
	@echo "  make local-build     - Build TypeScript project locally"
	@echo "  make help           - Show this help message"
	@echo ""
	@echo "Note: For docker-build, you can set GITHUB_TOKEN environment variable"
	@echo "      to download @inworld/runtime binaries from GitHub:"
	@echo "      GH_TOKEN=your_token make docker-build"

# Build Docker image
docker-build:
	@echo "Building Docker image: $(IMAGE_NAME):$(IMAGE_TAG)"
	@if [ -n "$(GH_TOKEN)" ]; then \
		echo "Using GH_TOKEN for downloading binaries..."; \
		docker build --platform linux/amd64 --build-arg GH_TOKEN=$(GH_TOKEN) --build-arg SERVICE_PATH=serving/realtime-service --build-arg SERVICE_PORT=4000 -t $(IMAGE_NAME):$(IMAGE_TAG) -f ../../.github/builds/Dockerfile.node-service.common ../..; \
	else \
		echo "Warning: GH_TOKEN not set. Build may fail if @inworld/runtime binaries require authentication."; \
		docker build --platform linux/amd64 --build-arg SERVICE_PATH=serving/realtime-service --build-arg SERVICE_PORT=4000 -t $(IMAGE_NAME):$(IMAGE_TAG) -f ../../.github/builds/Dockerfile.node-service.common ../..; \
	fi

# Run Docker container
docker-run:
	@echo "Running Docker container: $(IMAGE_NAME):$(IMAGE_TAG)"
	docker run --platform linux/amd64 -p 4000:4000 -p 9000:9000 --env-file .env -e LLM_PROVIDER=groq -e LLM_MODEL_NAME=llama-3.3-70b-versatile $(IMAGE_NAME):$(IMAGE_TAG)

# Install dependencies locally
local-install:
	@echo "Installing dependencies..."
	cd server && npm install

# Build TypeScript project locally
local-build:
	@echo "Building TypeScript project..."
	cd server && npm run build

# Start server locally (development mode with nodemon)
local-start: local-install
	@echo "Starting server locally..."
	cd server && npm start

