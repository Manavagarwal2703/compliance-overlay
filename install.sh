#!/bin/bash
set -e

echo "Starting Installation..."

echo "--> Gateway Service: npm install & prisma generate"
cd gateway-service
npm install
npx prisma generate
cd ..

echo "--> AI Service: creating .venv & installing requirements"
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

echo "Installation complete!"
