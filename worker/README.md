# ClassPilot Coach And Canvas Worker

This Worker is the security boundary between the public GitHub Pages frontend and its model providers. It accepts bounded Coach, Canvas OAuth, and one-time Canvas Companion import requests, applies origin and rate limits, and never returns secrets or raw upstream errors.

Each request may include a bounded source catalog generated from only the selected course and assignment. Both mock and live responses use evidence objects with `sourceId`, `label`, `excerpt`, and `location`. The Worker drops evidence whose source ID is absent from the request and replaces mismatched excerpts with trusted source text. The live prompt requires source IDs for factual course claims and places unknown information in `missingInformation`.

Every validated Coach response includes a learning `phase`, zero or one `currentStep`, zero or one `checkpointQuestion`, and `waitingForStudent`. The Coach gives one action or one diagnostic question, then waits for the student. It makes a step smaller when the student is stuck, reviews one high-impact issue at a time, and does not produce a complete assessed submission.

## Modes

- `COACH_MODE=workers_ai` uses the `AI` binding and the model configured by `WORKERS_AI_MODEL`. This is the public default.
- `COACH_MODE=mock` returns deterministic, visibly labeled test guidance without a model request.
- `COACH_MODE=live` calls the optional OpenAI model configured by `OPENAI_MODEL` and requires the `OPENAI_API_KEY` Worker secret.

## Configuration

The checked-in `wrangler.toml` contains only non-secret deployment settings:

```toml
[vars]
ALLOWED_ORIGIN = "https://cngei2.github.io"
COACH_MODE = "workers_ai"
WORKERS_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"
OPENAI_MODEL = "gpt-5-mini"
ENVIRONMENT = "production"

[ai]
binding = "AI"
```

`ALLOWED_ORIGIN` accepts an exact comma-separated allowlist. Do not use `*` in production. Localhost origins are accepted only when `ENVIRONMENT=development`.

## Deploy The Conversational Coach

```bash
npx wrangler deploy --config worker/wrangler.toml
```

Wrangler creates the Workers AI binding from `[ai]`. The default multilingual dialogue model receives bounded multi-turn messages and returns the same validated response contract used by the optional OpenAI provider.

Workers AI usage is billed to the Cloudflare account according to the selected model. Keep `WORKERS_AI_MODEL` in configuration so a model can be changed without modifying frontend code.

For deterministic local interface testing, set `COACH_MODE=mock`; the frontend labels those replies as Practice mode.

## Optional OpenAI Provider

Store the key as a Worker secret. Never put it in `wrangler.toml`, `index.html`, JavaScript, localStorage, GitHub Actions logs, or a chat message.

```bash
npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.toml
```

Then change `COACH_MODE` to `live`, deploy again, and confirm the Worker endpoint in `index.html`:

```html
<meta name="classpilot-coach-endpoint" content="https://classpilot-ai-coach.cngei2-classpilot.workers.dev/api/coach">
```

The endpoint uses the OpenAI Responses API with structured JSON output, low reasoning effort, a bounded output budget, and `store: false`.

## Enable Read-Only Canvas Sync

Canvas OAuth requires a Developer Key approved by the Canvas root-account administrator. Configure its redirect URI as:

```text
https://classpilot-ai-coach.cngei2-classpilot.workers.dev/api/canvas/callback
```

Limit the key to the read scopes in `wrangler.toml`: list courses, read one course, and list assignments. The Worker does not expose Canvas write routes.

Create a KV namespace and add the returned namespace ID as the `CANVAS_SESSIONS` binding shown in `wrangler.toml`:

```bash
npx wrangler kv namespace create CANVAS_SESSIONS --config worker/wrangler.toml
```

Set the approved Client ID in `CANVAS_CLIENT_ID`, then store the Client Secret without committing it:

```bash
npx wrangler secret put CANVAS_CLIENT_SECRET --config worker/wrangler.toml
```

`CANVAS_ALLOWED_DOMAINS` is an exact comma-separated allowlist. OAuth state expires after ten minutes. Access and refresh tokens stay in Worker KV; the browser receives only an opaque ClassPilot session by an origin-checked `postMessage`. The frontend keeps that session in `sessionStorage`, not `localStorage`.

Canvas' API policy permits manually generated tokens for testing only and requires multi-user applications to use OAuth. Do not add a token-paste field to the public product.

## Enable Canvas Companion Handoffs

Canvas Companion does not require a Canvas Developer Key. It requires a dedicated KV namespace for short-lived page captures:

```bash
npx wrangler kv namespace create IMPORT_HANDOFFS --config worker/wrangler.toml
```

Add the returned namespace ID to `worker/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "IMPORT_HANDOFFS"
id = "the_namespace_id"
```

`POST /api/import-handoffs` accepts only an explicit browser-extension capture. It removes unexpected fields and rejects over-limit content before storage. The opaque code expires after ten minutes. `POST /api/import-handoffs/redeem` accepts only the configured ClassPilot origin, deletes the record before returning it, and rejects a second redemption. Canvas passwords, cookies, session tokens, personal access tokens, and calendar-feed secrets are not accepted by the capture schema.

## Enable Canvas Calendar Feed Sync

`POST /api/calendar-feed` retrieves a student's private Canvas iCalendar feed without a Developer Key. The Worker accepts only an HTTPS `feeds/calendars/*.ics` URL on `*.instructure.com` or a hostname listed in `CANVAS_ALLOWED_DOMAINS`. It blocks redirects, limits the response to 1 MB, does not forward browser credentials, and does not store or return the feed URL.

The public site stores the feed URL only in that browser's local storage. It is not included in the ClassPilot workspace or exported backup. Each refresh must be initiated from the Data view.

## Local Development

Use `.dev.vars.example` as the field reference for local variables. The example contains no real secret. Run Worker tests without network access:

```bash
node --test tests/coach-worker.test.js
```

Run the full product verification before deployment:

```bash
npm run verify
```
