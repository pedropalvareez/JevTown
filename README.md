# Jev Town

A small, deterministic town with 50 inhabitants walking its streets. You type an announcement ("Fresh bread at half price in the bakery!", "There's a fire next to the market") and every NPC decides how to react. The decision is not a hand-written `if`: the town state is sent to [Jev](https://docs.typesafe.ai/api) as a batch of 50 closed-choice questions, one per inhabitant, and the simulation applies the answers while the town keeps moving.

The project is a demo of one specific pattern: a runtime decision engine wired into an authoritative server-side simulation. The model does not generate code or free text. It picks one of seven fixed actions, and the backend validates every answer before touching state.

The UI and the NPC prompts are in Spanish.

## How it works

There are two processes. The backend (Fastify, Node 20) owns a single in-memory simulation. The frontend (React + PixiJS 8) only draws what it receives.

**The map.** A 40×40 tile grid generated deterministically: five avenues on each axis, 52 cream cottages with terracotta roofs, five named districts and four fixed points of interest (bakery, fountain, market, park). Everything is drawn with Pixi geometry; there are no sprites or external assets.

**The inhabitants.** 50 NPCs, each with a name, an occupation and a one-sentence personality. They move only along streets, using A* over the grid. Every 500 ms the server advances one tick and pushes a snapshot over WebSocket to every client.

**Rendering.** The client keeps a small buffer of snapshots and renders roughly 600 ms in the past, interpolating between two consecutive ticks. This gives smooth motion at `requestAnimationFrame` cadence from data that arrives at 2 Hz. If a tick is missing the NPC snaps instead of interpolating, because a diagonal between two non-consecutive tiles can cut straight through a house.

**The broadcast.** `POST /broadcast` takes a single string. The server freezes a snapshot of the 50 NPCs, calls `decideBatch` once, and keeps ticking while it waits. When the decisions arrive they are applied from each NPC's position at that moment, not the snapshot's. The available actions are:

| Action | Effect |
|---|---|
| `continue_current_activity` | Keeps the current activity and route. |
| `go_to_bakery`, `go_to_fountain`, `go_to_market`, `go_to_park` | Walks to the POI, then keeps strolling on streets within 3 Manhattan tiles of it. |
| `warn_others` | Chases the nearest neighbour (by path length, not straight-line distance) with A* until adjacent, then stops. No propagation. |
| `flee` | Walks to the POI with the longest A* route and strolls around it. |

Only one broadcast runs at a time; an overlapping one gets `409`. If the batch is invalid (a missing NPC, an unknown option, probabilities out of range) the response is `502` and the town is left untouched. There are no automatic retries and no silent fallback to the mock.

**Free wandering.** `POST /wander` sends every NPC back to wandering the town with random destinations, without calling Jev and without resetting the simulation.

**The inspector.** The Inhabitants panel lets you pick an NPC and see its occupation, personality, activity and position. After a broadcast it also shows what the NPC chose, the probability of each option, the confidence and the activity it had before. In HTTP mode these are exactly the provider's values, not normalized.

## The two Jev modes

`JEV_MODE` selects the client.

- **`mock`** (default). Makes no network calls. It waits 600 ms to imitate latency and draws random decisions weighted by keywords in the announcement: "pan" (bread) favours the bakery, "incendio" (fire) favours fleeing and warning. Useful for working on the UI and the simulation at zero cost.
- **`http`**. Uses native `fetch` against `https://api.typesafe.ai/v1/systemone` with the `jev-latest` model. It sends a shared state (the announcement and the 50 agents) and one `Choice` question per NPC whose instructions reference that agent's index in the state. The timeout is 10 s including reading the body, redirects are disabled and errors are mapped to fixed messages: `503` when the key is missing, `504` on timeout, `502` when the response fails validation. Provider bodies, headers and the key are never logged or forwarded to the browser.

Every broadcast in HTTP mode is **one paid request** containing 50 questions. Startup, healthchecks, ticks and normal walking never call the provider.

The key lives only in the backend (`process.env.JEV_API_KEY`). Never put it in a `VITE_*` variable: Vite inlines those into the browser bundle.

## Simulated sensors

Six virtual sensors count how many NPCs are on the streets around the four POIs and the crossings (3,19) and (35,19). Each zone is the 13 street tiles within Manhattan distance ≤ 3 of its centre; zones don't overlap. Counting uses only the authoritative snapshot positions, never destinations or interpolated positions, so the six counts can sum to less than 50.

Readings go through a simulated IoT Agent that turns them into NGSI-LD entities of the Smart Data Models [`CrowdFlowObserved`](https://github.com/smart-data-models/dataModel.Transportation/tree/master/CrowdFlowObserved) type (`peopleCount`, `dateObserved`), and through a simulated Context Broker that keeps only the latest batch. They ride in the same WebSocket message as the snapshot and can also be queried at `GET /sensors`.

All of this is local and in memory. There is no Orion, no real IoT Agent, no made-up geographic coordinates, and no claim of full FIWARE compatibility. Sensors are observation only: they never produce decisions or broadcasts.

## Running it

Requirement: Docker with Compose. The image pins Node 20.20.0, so the host version doesn't matter.

```sh
docker compose -f infra/docker-compose.yml up -d --build --wait --wait-timeout 120
```

Open http://localhost:5173. It starts in `mock` mode, with no key and no cost. Both ports are published on `127.0.0.1` only.

The Docker build runs the typecheck, the tests and both workspace builds; if anything fails, the image doesn't build.

To use the real Jev, copy `.env.example` to `.env`, put your key in `JEV_API_KEY` and start in HTTP mode:

```sh
# bash
JEV_MODE=http docker compose --env-file .env -f infra/docker-compose.yml up -d --build --wait --wait-timeout 120
```

```powershell
# PowerShell
$env:JEV_MODE = 'http'
docker compose --env-file .env -f infra/docker-compose.yml up -d --build --wait --wait-timeout 120
```

`--env-file .env` is needed because the Compose file lives in `infra/` and would otherwise look for `.env` there. `GET /api/jev` reports the active mode and whether a key is configured (not whether it is valid).

Recreating the API container resets the town: positions, routes and activities are lost, because everything lives in memory.

### Development without Docker

With Node 20:

```sh
npm ci
npm run dev:api   # terminal 1, port 4000
npm run dev:web   # terminal 2, port 5173, proxies /api → :4000
```

The backend compiles on startup, not on file changes: restart it after editing. In Windows PowerShell use `npm.cmd` if the execution policy blocks `npm.ps1`.

## Tests

```sh
npm run typecheck
npm test
npm run build
```

Or inside the container:

```sh
docker compose -f infra/docker-compose.yml exec -T api npm run typecheck
docker compose -f infra/docker-compose.yml exec -T api node --test apps/api/test
```

These are backend tests using Node's built-in runner (`node --test`), no frameworks. They cover the map, A*, the simulation, batch validation, the HTTP client with an injected `fetch`, the routes, the WebSocket and the sensors. They never call the real API: test keys are fake and the suite passes with networking disabled. There are no E2E or rendering tests; browser smoothness is checked by hand.

## API

Every route is also available behind the Vite proxy under the `/api` prefix.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/healthz` | API readiness. |
| `GET` | `/ws` | WebSocket. One `init` message with the map, sensor markers and snapshot; then a `tick` every 500 ms. |
| `GET` | `/jev` | `{ mode, available }`. |
| `POST` | `/broadcast` | Body `{ "broadcast": "..." }`, 1–2000 characters. Returns latency, distribution and a per-NPC trace. |
| `POST` | `/wander` | Sends everyone back to wandering. `204`. |
| `GET` | `/sensors` | Latest batch of `CrowdFlowObserved` entities. `Cache-Control: no-store`. |

## Layout

```
apps/
  api/
    src/
      simulation/   map, A*, authoritative state and tick
      jev/          internal interface, mock, HTTP client and validation
      sensors/      virtual sensors, simulated IoT Agent and Context Broker
      app.ts        Fastify routes and tick loop
    test/           node --test suites
  web/
    src/
      town/         Pixi scene, interpolation buffer
      App.tsx       HUD: sensors, inhabitants, broadcast
infra/
  docker-compose.yml
Dockerfile          one base image, two targets: api and web
```

`DecisionOption` and `Decision` are the application's internal interface, not Jev's contract. The HTTP client translates between the two, so swapping providers only touches `apps/api/src/jev/`.

## Limitations

This is a local demo. There is no authentication, no persistence, no per-user state and no rate limiting: anyone who can reach port 4000 can send broadcasts and, in HTTP mode, spend your quota. Don't expose it to the internet as is. Vite preview is used only for the demo, not as a production server.

## License

MIT. See [LICENSE](LICENSE).
