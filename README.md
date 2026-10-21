# Bob Agents

The control plane for autonomous AI agents. Deploy, observe, and govern agents that take real action across your stack.

## Features

- **Agent runtime** — sandboxed execution with retries, timeouts, checkpointing.
- **Tool registry** — typed HTTP/SQL/custom tools agents discover and call safely.
- **Full observability** — every run is a searchable, replayable trace.
- **Guardrails** — allow/deny lists, PII redaction, approval gates.
- **Human in the loop** — pause any run for review from console or Slack.
- **Multi-model** — route across providers with fallbacks and cost caps.

## Run locally

Static site. Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
# or
python -m http.server 8000
```

Then visit `http://localhost:8000` and the console at `/console.html`.

## Structure

- `index.html` — marketing landing
- `console.html` — agent console / dashboard
- `styles.css` — Data Console design system
- `app.js` — interactions and live mock data

## License

MIT
