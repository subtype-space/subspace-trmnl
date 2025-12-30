#!/bin/bash
# Helper shell script to run builds
set -euo pipefail

MODE=${1:-prod}
BRANCH=${2:-v1}
LATEST_RELEASE="v1"

echo "🧹 Ensuring all subspace-api containers are stopped..."
docker compose down || true
docker compose -f docker-compose.dev.yml down || true


case "$MODE" in
  prod)
    echo "📦 Pulling latest image from GitHub Container Registry..."
    echo "🚀 Starting subspace-api in '$MODE' mode"
    docker compose pull && docker compose up -d
    ;;

  branch)
    echo "🔀 Switching to branch '$BRANCH'..."
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git pull origin "$BRANCH"

    echo "🔧 Building $BRANCH build locally..."
    docker compose -f docker-compose.dev.yml build
    echo "🚀 Starting subspace-api in '$MODE' mode (branch: $BRANCH)..."
    docker compose -f docker-compose.dev.yml up -d
    ;;

  dev)
    echo "🔧 Building development locally..."
    docker compose -f docker-compose.dev.yml build
    echo "🚀 Starting subspace-api in '$MODE' mode"
    docker compose -f docker-compose.dev.yml up -d
  ;;

  *)
    echo "Unknown mode: $MODE"
    echo "Usage: $0 [dev|branch|prod] [branch (optional)]"
    echo "  dev to build and start whatever is in the current directory"
    echo "  branch to switch branches to [option] and build"
    echo "  prod (default) pull down latest image from GHCR.io and run"
    exit 1
    ;;
esac

echo "✅ Done! Mode: $MODE"
