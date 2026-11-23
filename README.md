# Adaptive Interview-Prep Engine

JD-driven mock interviews with evidence-grounded, uncertainty-aware scoring, per-skill mastery tracking and adaptive question selection. Work in progress; see `CLAUDE.md` for the roadmap.

## Structure
- `client/` – React (Vite) + Tailwind CSS
- `server/` – Node.js + Express + MongoDB (Mongoose)

## Run locally
```bash
# terminal 1
cd server
npm install
copy .env.example .env
npm run dev

# terminal 2
cd client
npm install
npm run dev
```
Client: http://localhost:5173 · API: http://localhost:5000/api/health
