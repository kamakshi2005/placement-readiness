# AI Mock Interview & Placement Readiness Platform

MCA final year project. JD-targeted mock interviews with explainable feedback and an adaptive retest loop that measures per-skill improvement.

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
