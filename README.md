# Quiz Co-Driver

A browser prototype of an in-car voice host: real map navigation from your GPS location to a destination, with spoken turn-by-turn directions and voice quizzes in Hindi, Tamil and English (Murf Falcon voices).

## Run

```bash
cd app/frontend
npm install
npm run dev
```

Open http://localhost:3000 in Chrome and allow location and microphone. Press `D` on the Drive screen for the Demo Panel (replay the route, jump to turns/landmarks/regions, type answers).

## Environment

Create `.env` in the project root (never committed):

```
MURF_API_KEY=...
ANTHROPIC_API_KEY=...   # Voice AI Agent (trip questions, generated quizzes)
CLAUDE_MODEL=...        # optional, default claude-opus-5-5
```

## Layout

- `app/frontend` – Next.js app (UI and API route handlers)
- `app/data` – questions and the curated place list
