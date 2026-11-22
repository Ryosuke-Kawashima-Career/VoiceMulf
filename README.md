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
ANTHROPIC_API_KEY=...   # needed once the Voice AI Agent is built (see backend spec)
```

## Layout

- `app/frontend` – Next.js app (UI and API route handlers)
- `app/data` – questions and the curated place list
- `dev/specs/mvp-driver-quiz-frontend.md` – frontend spec
- `dev/specs/mvp-backend.md` – backend spec (map navigation, Voice AI Agent)
