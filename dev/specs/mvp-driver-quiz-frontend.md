# MVP Spec: Voice Quiz Co-Driver (Frontend)

Status: draft for hackathon MVP
Goal of the MVP: let a reviewer **see and hear how the app works** and give feedback. It is a browser prototype of an in-car voice host that (1) navigates a driver on a real map from their current location to a destination they choose and (2) keeps them entertained with voice quizzes along the way.

---

## 1. What the MVP must show

1. **Navigation:** the current location detected by GPS, a destination picked by search, a real driving route on a real map, a moving car, and spoken turn-by-turn directions.
2. **Quizzes by voice**, asked by the host and answered aloud:
   - **Landmark quiz:** about a famous place near the road as the car approaches it.
   - **City / state quiz:** a welcome and one easy question when the car enters a new city or state.
   - **Other trivia:** e.g. cricket, cinema, food.
3. **Navigation comes first:** the host never starts a quiz just before a turn, and directions interrupt any quiz.
4. **Indian languages:** Hindi, Tamil and English voices (Murf Falcon 2), picked at the start.

Out of scope for the MVP: accounts, scores across sessions, passenger/team modes, mid-session language switching, safety nudges, re-routing, traffic, alternative routes, saved places, fleet features, real vehicle data.

---

## 2. User flow

```
Home (pick language + destination) -> Drive (map + voice quiz) -> Summary
```

Voice commands at any time: `skip`, `repeat`, `pause`, `resume`, `stop`.

### 2.1 Quiz round (one round)
```
OFFER -> ASK -> LISTEN -> JUDGE -> FEEDBACK -> (next round)
```
| Step | What happens |
|---|---|
| OFFER | Host: "Ready for a quick one?" Waits for yes / skip / stop (8 s, then goes quiet). Not used for route-triggered questions. |
| ASK | Host speaks one short question. |
| LISTEN | Mic opens, no countdown. 8 s of silence counts as "no answer". |
| JUDGE | Compare the transcript with the accepted answers (see 5.4). |
| FEEDBACK | Warm reply, the answer, and a one-line fun fact. No penalties. |

Rules: one question at a time, short host sentences, answers in one or two words, no timers, no streaks, no "wrong" red styling.

---

## 3. Content

### 3.1 Question types
| Type | Shape | Example (verify before use) |
|---|---|---|
| Landmark (route) | Up to 3 clues, hardest first, asked ~2 km before the landmark | "A palace city famous for its Dasara festival. Which city?" |
| Region welcome (route) | Welcome + local greeting + 1 easy question when entering a region | "Welcome to Tamil Nadu. Vanakkam! Which soft steamed rice cake is a famous breakfast?" -> Idli |
| Trivia | Short factual question (cricket, cinema, food, geography) | "Who captained India to the 1983 World Cup?" -> Kapil Dev |

### 3.2 Question format
```json
{
  "id": "q_0001",
  "type": "landmark | region | trivia",
  "language": "hi-IN",
  "prompt": "spoken by the host (for landmark: first clue)",
  "clues": ["optional extra clue", "optional extra clue"],
  "answers": ["idli", "idly", "इडली"],
  "fun_fact": "one short sentence"
}
```

### 3.3 Content rules
- Written natively in each language, not machine-translated.
- Answerable from memory. Never ask the driver to look at, spot or read anything. Say "we are near", never "on your left".
- Every fact checked by a human before the demo. Avoid disputed borders and sensitive topics.
- Seed set: about 8 trivia questions each in Hindi, Tamil and English, plus the place list below. Stored in JSON files, no database.

### 3.4 Place list (landmarks and regions)
Routes are no longer hand-made, so route quizzes come from a **curated place list** with coordinates. When a route is calculated, every landmark within **5 km** of the route line and every region the route enters is attached to the route. Routes that pass no listed place get trivia only.

```json
{
  "landmarks": [
    { "id": "ramanagara", "name": { "en-IN": "...", "hi-IN": "...", "ta-IN": "..." },
      "lat": 0, "lon": 0, "question_id": "lm_ramanagara" }
  ],
  "regions": [
    { "id": "mysuru", "name": { "en-IN": "..." }, "lat": 0, "lon": 0, "radius_m": 8000,
      "welcome": { "en-IN": "...", "hi-IN": "...", "ta-IN": "..." },
      "greeting": { "en-IN": "Namaskara!", "hi-IN": "नमस्कार!", "ta-IN": "நமஸ்காரா!" },
      "question_id": "rg_mysuru" }
  ]
}
```
- A region is a circle (centre + radius). The route "enters" it at the first point inside the circle. A region that already contains the start point is skipped.
- The local greeting is stored per language so captions show the right script.
- MVP seed: the Bengaluru–Mysuru landmarks (Ramanagara hills, Channapatna, Maddur, Srirangapatna) and regions (Mandya, Mysuru), plus regions for Chennai and Hyderabad. All coordinates and facts are verified by hand.

### 3.5 Route (computed)
The backend turns a routing result into the route object the app uses. Position is still held as **distance along the route** (`progress_m`), so triggers need no coordinate matching after the route is built.

```json
{
  "route_id": "live",
  "name": { "en-IN": "destination name" },
  "length_m": 0,
  "duration_s": 0,
  "origin": [12.97, 77.59],
  "destination": [12.30, 76.65],
  "path": [[12.97, 77.59], [12.30, 76.65]],
  "maneuvers": [
    { "at_m": 0, "icon": "left | right | exit | roundabout | straight | arrive",
      "text": { "en-IN": "Turn left onto ...", "hi-IN": "...", "ta-IN": "..." },
      "text_early": { "en-IN": "optional, replaces the 800 m sentence" } }
  ],
  "landmarks": [ { "name": {}, "at_m": 0, "lat": 0, "lon": 0, "question_id": "..." } ],
  "regions":   [ { "name": {}, "enter_at_m": 0, "welcome": {}, "greeting": {}, "question_id": "..." } ]
}
```
- Instruction sentences are built from the routing step (turn type, direction, road name) with short templates written natively per language. Road names stay as the map has them.
- `duration_s` is the routing service estimate without traffic. `origin` is the GPS start point and `destination` the picked place (the path itself may start and end on the nearest road).
- Steps that need no action (continue straight, road changes name, departure) are not spoken. The last step is "You have arrived at your destination".

---

## 4. Frontend UI

Single-page web app, mobile-first, light theme, fonts that render Devanagari and Tamil. The screen is for the audience; the driver only listens and talks.

### 4.1 Home
- App name, one-line tagline.
- Language picker (Hindi / Tamil / English).
- **Current location:** detected by GPS (browser Geolocation API) when Home opens. Shows "Locating…", then "Current location found (±N m)". If access is denied or fails, a plain message with a Retry button.
- **Destination:** a search box with a Search button (search runs on submit, not while typing). Up to 5 results, nearest first; tap one to select it.
- **Route preview** (like the route preview in Google Maps or Uber): as soon as a destination is selected, the route is calculated and shown on a small map fitted so that the **current location (blue dot), the destination (pin) and the whole route line** are visible at once. Under the map: destination name, distance and estimated driving time. Picking another result replaces the preview. If no route is found, a plain message is shown instead of the map.
- "No route (quiz only)" option instead of a destination.
- **Start** button, with a microphone-permission check and a plain retry message if denied. With a destination, Start is enabled once the route preview is ready, and the drive uses that same route.

### 4.2 Drive (main screen, no scrolling)
Top to bottom:
1. **Status bar:** language, current region name.
2. **Map panel:** a real street map (OpenStreetMap tiles) with the route line, the part already driven, a moving car marker, the **destination pin**, landmark pins and the next turn marked. Map attribution is shown.
   - **Follow view** (default): the map follows the car at street zoom; the driver never needs to touch it.
   - **Route overview:** an Overview button on the map zooms out so the car, the destination and the remaining route are all visible (as in Google Maps / Uber). The button then reads Re-centre and returns to the follow view. The drive starts in overview for 4 seconds, then switches to follow view, so everyone sees where the trip goes.
   - **Trip card** on the map (bottom-left): destination name, remaining distance, remaining time and arrival time, e.g. "Mysore Palace · 139 km · 2 h 31 min · arrive 16:05". Remaining time is the route estimate scaled by the remaining distance. It is information only, not a countdown.
3. **Next-turn strip:** big arrow icon, distance to the turn, instruction text in the chosen language. Always in the same place.
4. **Voice orb:** animates while the host speaks, pulses while listening, still when paused. A label shows `Directions` vs `Quiz`.
5. **Caption area:** host sentence and what the app heard, in the right script, large text.
6. **State label and score:** `Asking / Listening / Checking / Paused`, plus "correct answers" count.
7. **Controls:** Pause/Resume, Skip, Stop (at least 56 px high).

Without a route, the map and next-turn strip are hidden.

### 4.3 Summary
Questions asked, correct count, landmarks and regions passed (answered ones marked), a spoken goodbye. Buttons: Play again, Home.

### 4.4 Demo Panel (hidden, press `D`)
| Control | Effect |
|---|---|
| Play / pause | Replays the car along the real route (simulated position). Once used, GPS updates are ignored for the rest of the trip |
| Speed (1x / 5x / 20x) | Shows a whole route in a few minutes |
| Jump to next turn / landmark / region | Moves the car ~1-2 km before it, to show each trigger quickly |
| Type an answer | Fallback when speech recognition fails |
| Debug | Shows the raw transcript, match result and the "held / played / dropped" decisions for speech |

---

## 5. Behaviour

### 5.1 GPS and navigation
- **Start point:** the GPS position at Start.
- **Position while driving:** the browser Geolocation API (`watchPosition`). Each fix is snapped to the nearest point of the route ahead of the car (a window from 200 m behind to 3 km ahead), and `progress_m` moves forward to that point. Fixes more than 100 m from the route are ignored (no re-routing in the MVP).
- **Simulated position:** the Demo Panel replay advances `progress_m` along the same real route, for demos at a desk.
- **Instructions:** each maneuver is spoken twice, in the chosen language: 800 m before ("In 800 metres, turn left") and 100 m before ("Turn left"). The 800 m sentence is skipped when the previous maneuver is less than 900 m earlier, so instructions never refer past a turn that has not happened yet. Instructions are short and flat. Their audio is rendered and cached ahead, when the car is about 3 km from the maneuver.
- **Next-turn strip** updates with the distance in real time.

### 5.2 Navigation first
One rule set decides who speaks:
1. A navigation instruction **interrupts** any quiz speech immediately. An unanswered question is repeated once, briefly, after the instruction ("Back to the question: ...").
2. **No new quiz speech** from 900 m before a turn until 100 m after it (the "directions first" zone). The map shows a small "Directions first" chip while it is active.
3. A landmark question that would fall in that zone is dropped (or becomes a one-line fun fact after the zone). A region welcome waits until the zone ends.
4. Only one question is active at a time.
5. Distances are settings and may be tuned.

On city streets turns come close together, so the zone is active most of the time and quizzes mostly play on longer stretches. This is intended.

### 5.3 Route quizzes
- **Landmark:** triggered when the car is ~2 km before the landmark. The host asks one clue at a time, hardest first; an early correct answer skips the rest; after the last clue it gives the answer and a fun fact.
- **Region:** triggered once when the car crosses a region boundary: welcome line, local greeting in that language, one easy question, answer and fun fact. The host keeps the language the user chose.

### 5.4 Answer judging
Lowercase, trim and strip punctuation. Accept any listed answer (including local-script and spelling variants), allow a small edit distance, and accept a sentence that contains the answer ("I think it is Hyderabad"). On a miss, the host gives the answer. No retry.

### 5.5 Voice
- **Speaking:** Murf Falcon 2 TTS, one warm, calm voice per language. Common phrases are cached.
- **Listening:** browser speech recognition (Web Speech API, best in Chrome) with the chosen language tag. The mic is closed while the host speaks.
- **Ask the co-driver:** outside a quiz answer, the driver can ask trip questions ("how far is it?", "when do we arrive?", "next turn?") and hear a short spoken answer. See `mvp-backend.md` 4.2.
- **Key safety:** the Murf key stays on a small backend (`.env`), never in the browser.

### 5.6 Map services
| Need | Service | Notes |
|---|---|---|
| Map tiles | OpenStreetMap standard tiles | Attribution "© OpenStreetMap contributors" on the map |
| Destination search | Nominatim (OpenStreetMap) | Called through the backend, on submit only, at most 1 request per second, results cached |
| Driving route | OSRM public demo server | Called through the backend, driving profile, full geometry with steps |

The public servers are free but meant for light use, so they are fine for a demo, not for a product. Search and routing go through the backend so the app identifies itself properly and can cache results. The user's location is sent to these services only to search and to calculate the route.

---

## 6. Technical outline

| Part | Choice |
|---|---|
| Frontend | Next.js + TypeScript |
| Map | Leaflet with OpenStreetMap tiles |
| Position | GPS (Geolocation API) snapped to the route, or the Demo Panel replay; both emit events: turn ahead, landmark due, region entered |
| Speech arbiter | A small module in front of the audio player that implements 5.2 |
| Backend | Next.js route handlers: `POST /api/tts`, `GET /api/questions`, `GET /api/geocode?q=`, `GET /api/route?from=&to=` |
| Data | `data/questions.json`, `data/places.json` |

---

## 7. Done when (acceptance)

1. Open Home: the current location is found by GPS (or a plain retry message appears if it is denied).
2. Search a destination and pick it: a preview map shows the current location, the destination and the route between them at once, with distance and driving time. Press Start: the drive map shows the whole route first, then follows the car, and the host greets and offers a round.
3. During the drive, Overview shows the car, the destination and the remaining route together; Re-centre goes back to following the car. The trip card shows remaining distance, time and arrival time.
4. Answer a trivia question by voice and hear the right/wrong reaction with a fun fact.
5. Press Play (or drive with GPS): the car moves on the map and the next-turn strip and spoken directions (800 m and 100 m) match each turn of the route.
6. No quiz speech starts in the "directions first" zone, and the chip shows while it holds back.
7. A navigation instruction interrupts a running quiz, which is then repeated briefly or dropped.
8. On a route that passes a listed landmark, "Jump to next landmark" gives a landmark quiz with clues, and an early correct answer skips the remaining clues.
9. On a route that enters a listed region, "Jump to next region" plays the welcome, local greeting and one easy question once.
10. `skip`, `repeat`, `pause`, `resume`, `stop` work by voice and by button, and the Summary appears after Stop.
11. No timers, streaks or penalty messages appear anywhere, and the Murf key is not visible in the browser.

---

## 8. Open questions and risks

- Which Indian languages and voices Falcon 2 offers, and whether audio can stream. Check the docs before fixing the language list.
- Browser speech recognition quality for Hindi and Tamil. Keep the typed-answer fallback.
- Question and place facts need human checking.
- The public OpenStreetMap services (tiles, Nominatim, OSRM demo) have usage policies and no uptime guarantee. A product would need its own servers or a paid provider.
- Browser GPS needs HTTPS (or localhost) and the user's permission; accuracy on laptops is low (Wi-Fi based). Test on a phone for real driving.
- Navigation audio of other apps cannot be controlled; the app gives its own directions.
- Do not claim the app improves road safety without real validation. It is a prototype of the interaction.

---

## 9. Build order

1. Backend `/api/tts` and a button that speaks one Hindi sentence.
2. Quiz round with typed answers, then voice input.
3. Home / Drive / Summary screens and the voice orb.
4. GPS on Home, destination search, route calculation and the Leaflet map.
5. Spoken directions and the next-turn strip, GPS snapping and the Demo Panel replay.
6. "Directions first" rules (5.2).
7. Place list, landmark and region quizzes.
8. Tamil and English content, polish, rehearse the demo.
