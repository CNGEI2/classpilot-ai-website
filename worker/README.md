# ClassPilot Coach Worker

This Worker is the security boundary between the public GitHub Pages frontend and the OpenAI Responses API. It accepts only `POST /api/coach`, validates a bounded selected-course payload, applies origin and rate limits, and never returns secrets or raw upstream errors.

Each request may include a bounded source catalog generated from only the selected course and assignment. Both mock and live responses use evidence objects with `sourceId`, `label`, `excerpt`, and `location`. The Worker drops evidence whose source ID is absent from the request and replaces mismatched excerpts with trusted source text. The live prompt requires source IDs for factual course claims and places unknown information in `missingInformation`.

## Modes

- `COACH_MODE=mock` returns deterministic, visibly labeled test guidance without an OpenAI request.
- `COACH_MODE=live` calls the model configured by `OPENAI_MODEL` and requires the `OPENAI_API_KEY` Worker secret.

## Configuration

The checked-in `wrangler.toml` contains only non-secret deployment settings:

```toml
[vars]
ALLOWED_ORIGIN = "https://cngei2.github.io"
COACH_MODE = "mock"
OPENAI_MODEL = "gpt-5-mini"
ENVIRONMENT = "production"
```

`ALLOWED_ORIGIN` accepts an exact comma-separated allowlist. Do not use `*` in production. Localhost origins are accepted only when `ENVIRONMENT=development`.

## Deploy Mock Mode

```bash
npx wrangler deploy --config worker/wrangler.toml
```

The resulting Worker URL can be tested without an API key. Keep the frontend visibly labeled as Mock during this stage.

## Enable Live Mode

Store the key as a Worker secret. Never put it in `wrangler.toml`, `index.html`, JavaScript, localStorage, GitHub Actions logs, or a chat message.

```bash
npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.toml
```

Then change `COACH_MODE` to `live`, deploy again, and confirm the Worker endpoint in `index.html`:

```html
<meta name="classpilot-coach-endpoint" content="https://classpilot-ai-coach.cngei2-classpilot.workers.dev/api/coach">
```

The endpoint uses the OpenAI Responses API with structured JSON output, low reasoning effort, a bounded output budget, and `store: false`.

## Local Development

Use `.dev.vars.example` as the field reference for local variables. The example contains no real secret. Run Worker tests without network access:

```bash
node --test tests/coach-worker.test.js
```

Run the full product verification before deployment:

```bash
npm run verify
```
