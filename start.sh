#!/bin/bash
set -e

echo "Starting Gateway Service on port 3000..."
cd gateway-service
npm run build
npm start &
GATEWAY_PID=$!
cd ..

echo "Starting AI Service on port 8000..."
cd ai-service
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
AI_PID=$!
cd ..

echo ""
echo "=========================================="
echo "      Services started successfully!"
echo "=========================================="
echo "Gateway Service PID: $GATEWAY_PID"
echo "AI Service PID:      $AI_PID"
echo "=========================================="
