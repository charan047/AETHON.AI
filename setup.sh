#!/usr/bin/env bash
set -e

echo "=== Aethon Agency OS Setup ==="
echo ""

# Backend setup
echo "--- Setting up backend ---"
cd backend

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Created .env from .env.example — please edit it with your API keys"
fi

python -m venv venv 2>/dev/null || python3 -m venv venv
source venv/bin/activate 2>/dev/null || source venv/Scripts/activate

pip install -r requirements.txt --quiet

echo "Backend dependencies installed."
cd ..

# Frontend setup
echo ""
echo "--- Setting up frontend ---"
cd frontend
npm install --silent
echo "Frontend dependencies installed."
cd ..

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To start the platform:"
echo "  Terminal 1 (backend):  cd backend && source venv/bin/activate && uvicorn main:app --reload"
echo "  Terminal 2 (frontend): cd frontend && npm run dev"
echo ""
echo "Then open: http://localhost:5173"
echo ""
echo "Optional: Set your API keys in backend/.env"
