# MVP Spec: Voice Quiz Co-Driver (Backend)

Status: draft for hackathon MVP
Companion to `mvp-driver-quiz-frontend.md`. This spec covers the server side that wires the frontend to real services. Its two key functions are **map navigation** and the **Voice AI Agent**, which creates quizzes and helps with driving.

---

## 1. Scope

In scope:
- Map navigation: destination search, driving route, spoken instructions, places along the route.
- Voice AI Agent: answering the driver's trip questions, and generating quizzes from the route.
- Voice output through Murf Falcon TTS.

Out of scope for the MVP: server-side speech recognition (the browser does it), accounts, a database, re-routing, finding stops, changing the destination by voice.

---

## 2. Architecture

```
Browser (Web Speech STT, engine, map)
   │  text + trip snapshot            ▲ JSON / MP3 audio
   ▼                                  │
Next.js route handlers  app/frontend/src/app/api/*
   │        server-only modules  app/frontend/src/server/*
   ├─ Nominatim (search)    ├─ OSRM (route)     ├─ Overpass (places)
   ├─ Murf Falcon (TTS)     └─ Claude API (Voice AI Agent)
   ▼
JSON files  app/data/  (questions, places, generated questions)
```

- One Next.js app; the backend is its route handlers. No separate server.
- Keys live in the project-root `.env` and are read only on the server: `MURF_API_KEY`, `ANTHROPIC_API_KEY`, optional `CLAUDE_MODEL`.
- No key or upstream URL with a key ever reaches the browser.

---

## 3. Map navigation

### 3.1 Endpoints (built)
| Endpoint | Purpose | Request | Response | Errors |
|---|---|---|---|---|
| `GET /api/geocode` | Destination search | `q`, optional `near=lat,lon` | up to 5 `{ name, detail, lat, lon }`, nearest first | 502 when search fails |
| `GET /api/route` | Driving route | `from=lat,lon`, `to=lat,lon`, `name` | Route object (frontend spec 3.5) | 400 bad input, 404 no route, 502 routing failed |
| `POST /api/tts` | Host voice | `{ text, language }` | `audio/mpeg` stream | 400 bad input, 503 no key, 502 Murf error |
| `GET /api/questions` | Seed questions | `language`, optional `type` | question list | - |

- **Search:** Nominatim, at most 1 request per second, results cached, search only on submit.
- **Route:** OSRM driving profile with steps. Instructions are built from templates in Hindi, Tamil and English, and steps that need no action are dropped. Landmarks and regions from `places.json` are attached with `at_m`.
- **TTS:** one Murf Falcon voice per language; the voice IDs live in one config map.

### 3.2 Places along the route
Feeds the route quizzes in 4.3, so routes outside the curated list still get landmark and region quizzes.
- Found in the background quiz call (4.3), not while the route is planned, because the public servers can take 20+ seconds.
- **Source 1:** one **Overpass API** query for `place=city` and `place=town` nodes in the route's bounding box, kept if within 3 km of the route (15 s timeout).
- **Source 2 (fallback):** **Nominatim reverse lookups** at town/city level, sampled along the route every 12 km (at most 15 lookups, 1 per second). This also detects **state crossings**.
- Cities and newly entered states become **regions**; towns (and taluks from the fallback) become **landmarks**. They get `at_m` the same way curated places do and are marked `source: "osm"`. Regions get a default welcome line until the agent writes one.
- A curated `places.json` item wins over a found place within 5 km of it or with the same name.
- At most 8 found places per route, spread along it.
- If both sources fail, the route keeps its curated places only.

---

## 4. Voice AI Agent

### 4.1 Model and call style
- Claude through the official `@anthropic-ai/sdk`, called from route handlers.
- Model `claude-opus-5-5`, overridable with `CLAUDE_MODEL`.
- Every call is a single request with all context in it, so there is no agent loop, no tools and no hosted agent.
- Replies are typed JSON through structured outputs (`messages.parse` with a Zod schema).
- Server-side refusal fallback is on (`fallbacks: "default"`).
- Effort: `low` for live turns, `medium` for quiz generation.

### 4.2 Trip questions: `POST /api/agent/turn`
**When:** the frontend sends any driver utterance that is neither a voice command nor an answer during LISTEN.

**Request**
```json
{
  "language": "hi-IN",
  "utterance": "कितना दूर है?",
  "trip": {
    "destination": "Mysore Palace",
    "remaining_m": 48000,
    "remaining_s": 2340,
    "arrival_time": "13:39",
    "next_maneuver": { "text": "गोल चक्कर पर दूसरा एग्ज़िट लीजिए।", "distance_m": 4400 },
    "region": "Mandya",
    "next_landmark": { "name": "Srirangapatna", "distance_m": 21000 }
  }
}
```
`trip` is `null` in "No route (quiz only)" mode.

**Response**
```json
{ "intent": "trip_question | start_quiz | other", "reply": "मैसूर पैलेस अभी 48 किलोमीटर दूर है, करीब 39 मिनट।" }
```
- `start_quiz`: the frontend starts a round (OFFER is skipped because the driver asked).
- `other`: the reply briefly says the co-driver can't help with that.

**Rules for the reply**
- At most 2 short sentences, in the chosen language.
- Uses only facts in `trip`. It never invents traffic, places or times.
- Never asks the driver to look at, read or touch the screen.

**Speech:** the frontend speaks the reply as host speech. It may play inside the "directions first" zone because it answers the driver, and directions still interrupt it.

**On error or timeout (8 s):** the frontend speaks a fixed "Sorry, I didn't catch that" line in the chosen language.

**Mic note:** the driver can only be heard while the mic is open (OFFER, IDLE, LISTEN). At a city start the first offer waits for the "directions first" zone, so a question is answered once the mic opens.

### 4.3 Quizzes from the route: `POST /api/agent/quiz`
**When:** right after Start, in the background. It must not delay the greeting or the first offer.

**Request:** `language`, the route `path` (null in quiz-only mode) and `trivia_count` (default 5). The backend finds the places itself (3.2).

**Response:** the found `landmarks` and `regions` that got a question (with `at_m` / `enter_at_m`), the `questions`, and `stats` (places source, counts, time, errors). The frontend adds the places to the route and the questions to its pool.

**Questions**

Questions use the existing format (frontend spec 3.2), with `source: "generated"`:
- Landmark: a prompt and up to 2 clues, hardest first.
- Region: one easy question, plus a welcome line and the local greeting written in the chosen language's script.
- Trivia: short factual questions (cricket, cinema, food, geography).

**Content rules**
- Written natively in the chosen language.
- Well-known facts only. The model leaves out any place it is unsure about.
- Never names the place in a landmark clue; uses "we are near" wording.
- No disputed borders or sensitive topics.
- Never asks the driver to look at, spot or read anything.

**Storage and use**
- Generated questions are appended to `app/data/generated-questions.json` with the place, language and time, so a human can fact-check and reuse them.
- A place that already has a generated question in that language is reused from the file, not generated again.
- Curated questions always win. Generated ones fill only places without a curated question.
- On failure: curated and seed questions only.

### 4.4 Latency
| Step | Target |
|---|---|
| End of driver speech to start of the agent's spoken reply | < 1.5 s (measured: 1.7–5.2 s on Claude Opus 5.5, about 2 s for most trip questions) |
| Quiz generation | background, done before the first route trigger where possible (measured: 17–60 s) |

---

## 5. Frontend wiring
- The engine sends non-command utterances outside LISTEN to `/api/agent/turn` with a trip snapshot, and speaks the reply.
- After Start, the engine calls `/api/agent/quiz` and merges the results into the route's landmarks, regions and trivia pool.
- The Demo Panel debug view shows the agent intent and reply, and marks generated questions.

---

## 6. Privacy and safety
- Only the trip snapshot and place names are sent to Claude, not location history or audio.
- No voice audio is stored anywhere.
- GPS coordinates are sent only to the map services, to search and to plan the route.

---

## 7. Done when (acceptance)
1. Saying "कितना दूर है?" (how far is it?) during a Hindi drive gives a correct spoken answer from the live trip state, starting within 1.5 s.
2. "Next turn?" in Tamil gives the next instruction and its distance in Tamil.
3. A route that passes no curated place still gets at least one landmark or region quiz.
4. Generated questions appear in `app/data/generated-questions.json`.
5. When Claude or Overpass is unavailable, the drive still works with curated content and the fallback line.
6. No key is visible in the browser bundle or in any browser network request.

---

## 8. Risks and open questions
- Opus 5.5 latency for live voice turns is above the 1.5 s target (see 4.4). Switching models is a `CLAUDE_MODEL` change.
- Generated facts are unchecked until someone reviews the saved file.
- Overpass, Nominatim and the OSRM demo server are public services with usage limits and no uptime guarantee. During the build all public Overpass servers were failing, so the Nominatim fallback carried the place search.

---

## 9. Build order
1. Add `ANTHROPIC_API_KEY` to `.env` and install `@anthropic-ai/sdk`.
2. `/api/agent/turn` and the engine wiring for trip questions.
3. Places along the route (Overpass, Nominatim fallback).
4. `/api/agent/quiz`, the merge into the route and the review file.
5. Rehearse the demo end to end.
