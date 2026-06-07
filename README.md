# Compliance Chatbot Overlay

Enterprise-grade, **fully decoupled** compliance chat overlay built on the **Sandboxed Vibe Coding** philosophy: three independent modules that share **zero code** and make **zero cross-imports**. All inter-service communication happens exclusively over HTTP/JSON and Server-Sent Events (SSE). Any single module can be completely rewritten in any language or framework, as long as the [Data Exchange Contracts](#data-exchange-contracts) are honoured.

---

## The Sandboxed Vibe Coding Philosophy

Traditional monorepos create invisible coupling: a shared `utils/` library becomes a dependency of everything; a shared type definition drifts out of sync with half the codebase. This project inverts that pattern.

**Three rules, zero exceptions:**

1. **No shared code.** Each module (`widget-client`, `gateway-service`, `ai-service`) is a completely standalone project with its own `package.json` / `requirements.txt` and no symlinks or workspace references to siblings.
2. **Contracts are the only interface.** The three HTTP/SSE contracts defined in this document are the only coupling surface. Any team can own any module independently.
3. **HTTP boundary = deployment boundary.** Each module runs in its own process, on its own port, and can be scaled, deployed, or replaced independently.

The result: you can swap the AI backend from Groq to Azure to a local Ollama instance in fifteen minutes by editing one `.env` file and restarting one process.

---

## System Architecture

```mermaid
flowchart TB
  subgraph host["Host Application (any stack)"]
    WC["<compliance-chat-overlay\nuser-role='reviewer'\nuser-id='usr_123'>"]
  end

  subgraph widget["widget-client  :5173"]
    UI["React 19 + Zustand 5"]
    SHADOW["Shadow DOM isolation"]
  end

  subgraph gateway["gateway-service  :3000"]
    API["Next.js 16 App Router\nNode.js runtime"]
    DB["PostgreSQL via Prisma 7"]
  end

  subgraph ai["ai-service  :8000"]
    PIPELINE["Context Aggregator Pipeline"]
    GUARD["Security Guardrail"]
    EXTRACT["Extractor & Fetchers"]
    SYNTH["Synthesizer (Groq/Azure)"]
  end

  WC -->|"HTML attributes"| UI
  UI -->|"Contract A  POST /api/chat"| API
  API --> DB
  API -->|"Contract B  POST /v1/chat/stream"| PIPELINE
  PIPELINE --> GUARD
  GUARD --> EXTRACT
  EXTRACT --> SYNTH
  SYNTH -->|"Contract C  SSE"| API
  API -->|"Contract C  SSE passthrough"| UI
```

### Module Boundaries

| Module | Port (dev) | Responsibility | Stack |
|--------|------------|----------------|-------|
| [widget-client](./widget-client/) | 5173 | Shadow DOM Web Component, chat UI, session history sidebar, SSE client. **Features input locking and a loading skeleton during extraction latency.** | React 19, Vite 6, Zustand 5, Tailwind CSS 3 |
| [gateway-service](./gateway-service/) | 3000 | Session upsert, message persistence, SSE stream proxy | Next.js 16.1.4, Prisma 7, PostgreSQL |
| [ai-service](./ai-service/) | 8000 | **Context Aggregator Pipeline**, Security Guardrails, entity extraction, dynamic prompting (**GENERAL_CHAT** path for greetings/general knowledge, **COMPLIANCE_RAG** path for policy/audit questions), ChromaDB RAG retrieval, LLM streaming | FastAPI, LangChain, Groq / Azure OpenAI |

**Isolation rule:** No shared packages, no monorepo libs, no cross-folder imports. Integration is HTTP-contract-only.

---

## Data Exchange Contracts

These three contracts are the **only** coupling between modules. Changing any field name requires coordinating all consumers of that contract.

---

### Contract A — Widget → Gateway

**Endpoint:** `POST http://<GATEWAY_HOST_IP>:3000/api/chat`

**Request headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | **Yes** | Must be `application/json` |
| `Accept` | **Yes** | Must be `text/event-stream` |
| `Authorization` | Conditional | `Bearer <JWT>` — required when gateway `REQUIRE_AUTH=true`. The JWT must be HS256-signed with the gateway's `JWT_SECRET`. When `REQUIRE_AUTH=false`, this header is optional and `userId` is read from the body instead. |

**Request body:**

```json
{
  "sessionId": "sess_1748956800_abc123",
  "userId": "usr_abc123",
  "role": "reviewer",
  "message": "Check Q2 compliance status."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string` | **Yes** | Client-generated stable session identifier (format: `sess_<timestamp>_<random>`) |
| `userId` | `string` | Conditional | User ID from the `user-id` HTML attribute. **Ignored by the gateway when `REQUIRE_AUTH=true`** — the gateway extracts `userId` from the verified JWT instead. Still required in the body when `REQUIRE_AUTH=false`. |
| `role` | `"user"` \| `"reviewer"` | **Yes** | Active persona; affects AI routing in the semantic router |
| `message` | `string` | **Yes** | The user's message text |

**Response:** `200 OK` with `Content-Type: text/event-stream` (Contract C).

**Error responses:**

| Status | Cause |
|--------|-------|
| `400` | Missing or malformed required fields |
| `401` | Missing or invalid `Authorization` header (only when `REQUIRE_AUTH=true`) |
| `500` | Database error before streaming begins |
| `502` | AI service unreachable or returned an error |

---

### Contract B — Gateway → AI Service

**Endpoint:** `POST http://<AI_SERVICE_HOST_IP>:8000/v1/chat/stream`

```json
{
  "conversation_id": "sess_1748956800_abc123",
  "role": "reviewer",
  "query": "Check Q2 compliance status.",
  "context_history": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| `conversation_id` | `string` | Mapped from Contract A `sessionId` |
| `role` | `"user"` \| `"reviewer"` | Forwarded directly from Contract A |
| `query` | `string` | Mapped from Contract A `message` |
| `context_history` | `Array<{ role, content }>` | Prior conversation turns (currently sent as empty array; hydration TBD) |

**Response:** `200 OK` with `Content-Type: text/event-stream` (Contract C).

---

### Contract C — AI → Gateway → Widget (SSE)

Each event is a single line starting with `data:` followed by a JSON object. The gateway forwards these bytes **verbatim** to the widget — no transformation, no buffering.

```
data: {"type": "token", "content": "The Q2 "}
data: {"type": "token", "content": "compliance status is "}
data: {"type": "token", "content": "fully compliant."}
data: {"type": "done"}
```

| `type` | Extra fields | Meaning |
|--------|-------------|---------|
| `token` | `content: string` | Incremental assistant text chunk |
| `sources` | `content: string[]` | **Optional.** Deduplicated list of source filenames retrieved from ChromaDB. Only emitted when `ENABLE_CITATIONS=true` in the AI service. Always sent **before** `done`. |
| `done` | — | Stream is complete; client should finalise the message |
| `error` | `content?: string` | Stream failed; client should show an error state |

---

## Master Boot Sequence

Follow this exact sequence in **separate terminals** after a fresh clone. All three services must be running for end-to-end functionality.

### Prerequisites

- Node.js 20+
- Python 3.10+
- Docker Desktop (for local DB) OR a free Supabase/Neon account (for cloud DB)

---

### Terminal 1 — PostgreSQL (Docker)

Option A: Local Docker (Client/Enterprise Setup)
Spin up a local PostgreSQL container in your terminal:

```powershell
docker run --name gateway-postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=gateway_db `
  -p 5432:5432 `
  -d postgres:16-alpine
  ```
Verify it is running: docker ps --filter name=gateway-postgres

Option B: Free Cloud DB (Supabase / Neon)
If you do not have Docker installed:
Go to Supabase or Neon.tech and create a free PostgreSQL project.
Copy your connection string (e.g., postgresql://user:pass@host/db?sslmode=require).
Proceed to Terminal 2.

### Terminal 2 — AI Service

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env: set GROQ_API_KEY (or set USE_AZURE=true and fill Azure vars)

# --host 0.0.0.0 makes the service reachable from any machine on the network.
# Omit --reload in dev if you want; it is NEVER used in production.
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Health check: `curl http://localhost:8000/health` → `{"status":"ok","service":"ai-service"}`

---

### Terminal 3 — Gateway Service

```powershell
cd gateway-service
npm install

# Create your .env file
New-Item -Path .env -ItemType File

# ---> IMPORTANT: Open the .env file and add your configuration <---
# If using Docker (Option A), add: 
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gateway_db"
#
# If using Supabase/Neon (Option B), add:
# DATABASE_URL="postgresql://YOUR_CLOUD_URL_HERE?sslmode=require"
#
# Also add:
# AI_SERVICE_URL="http://localhost:8000/v1/chat/stream"

# Push the schema to the database
npx prisma generate
npx prisma db push

# Start the Gateway
npm run dev
```

API available at: `http://localhost:3000/api/chat`

---

### Terminal 4 — Widget Client

```powershell
cd widget-client
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in a browser. The widget mounts with `user-role="reviewer"` and `user-id="dev_user_001"` by default.

---

### Quick End-to-End Smoke Test (PowerShell)

With all three services running:

```powershell
curl -X POST http://localhost:3000/api/chat `
  -H "Content-Type: application/json" `
  -H "Accept: text/event-stream" `
  -d '{"sessionId":"sess_smoke","userId":"usr_test","role":"reviewer","message":"Hello, check compliance."}'
```

You should see streamed `data:` lines arrive in the terminal. Then verify persistence:

```powershell
curl "http://localhost:3000/api/chat/history?userId=usr_test"
curl "http://localhost:3000/api/chat/history/sess_smoke"
```

---

## Production Deployment (Enterprise Intranet)

Use these instructions when deploying to a **production or intranet server**. The development commands in the section above use file-watchers and hot-reload — they must **never** be used in production.

### Prerequisites

- Node.js 20+ installed on the gateway server
- Python 3.10+ installed on the AI service server
- PostgreSQL accessible from the gateway server (intranet IP or managed cloud)
- All three `.env` files configured with **real intranet IPs** (not `localhost`)

---

### Step 1 — Configure Environment Variables

Each module ships a `.env.example` that is safe to commit. Copy it to `.env` and fill in the real values before starting any service.

```powershell
# Gateway service
copy gateway-service\.env.example gateway-service\.env
# Edit gateway-service\.env — set DATABASE_URL and AI_SERVICE_URL

# AI service
copy ai-service\.env.example ai-service\.env
# Edit ai-service\.env — set GROQ_API_KEY or Azure OpenAI vars
```

> **Critical:** `AI_SERVICE_URL` in `gateway-service/.env` must be the **intranet IP** of the machine running the AI service, not `localhost`. If the two services run on different servers and you leave it as `localhost`, the gateway will try to call itself and fail immediately.

---

### Step 2 — Start the AI Service

```powershell
cd ai-service
.\.venv\Scripts\Activate.ps1   # activate the virtual environment

# Production start — no --reload flag, bound to all interfaces.
# --host 0.0.0.0 is REQUIRED: without it, uvicorn binds only to 127.0.0.1
# and the gateway on a different intranet IP will receive "connection refused".
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Optional: add `--workers 2` (or more) to utilise multiple CPU cores:

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
```

Verify: `curl http://<AI_SERVICE_HOST_IP>:8000/health` → `{"status":"ok","service":"ai-service"}`

---

### Step 3 — Build and Start the Gateway Service

```powershell
cd gateway-service
npm install
npx prisma generate
npx prisma db push     # applies schema to the production database

# Build the Next.js app (compiles, tree-shakes, optimises).
npm run build

# Start in production mode — no hot-reload, no file watchers.
# This runs the compiled output from .next/ using the Node.js production runtime.
npm run start
```

Gateway available at: `http://<GATEWAY_HOST_IP>:3000/api/chat`

---

### Step 4 — Build and Serve the Widget Client

The widget is a static bundle — it is not a running server. Build it once and serve the output file from any static file server or CDN.

```powershell
cd widget-client
npm install

# Set the gateway URL for the production build.
# Create a .env.production file:
"VITE_GATEWAY_URL=http://<GATEWAY_HOST_IP>:3000" | Out-File -Encoding utf8 .env.production

# Build the static bundle.
npm run build
# Output: dist/compliance-chat-overlay.es.js and dist/compliance-chat-overlay.iife.js
```

Serve the `dist/` folder from IIS, Nginx, or any intranet static file host. Then embed the widget in your host application:

```html
<script type="module" src="http://<STATIC_HOST_IP>/compliance-chat-overlay.es.js"></script>
<compliance-chat-overlay
  gateway-url="http://<GATEWAY_HOST_IP>:3000/api/chat"
  user-role="reviewer"
  user-id="usr_abc123"
></compliance-chat-overlay>
```

---

### Production Deployment Summary

| Service | Command | Notes |
|---------|---------|-------|
| AI Service | `uvicorn app.main:app --host 0.0.0.0 --port 8000` | No `--reload`. `--host 0.0.0.0` is mandatory for intranet access. |
| Gateway | `npm run build` then `npm run start` | Never use `npm run dev` in production. |
| Widget | `npm run build` then serve `dist/` statically | Not a running server — just a static JS file. |

---

## Environment Variables

| Service | Variable | Default | Purpose |
|---------|----------|---------|---------|
| Gateway | `DATABASE_URL` | — | **Required.** PostgreSQL connection string |
| Gateway | `AI_SERVICE_URL` | — | **Required.** Full URL to ai-service `/v1/chat/stream`. Use intranet IP, not localhost. |
| Gateway | `NEXT_PUBLIC_GATEWAY_URL` | — | Optional. Public base URL of this gateway (for self-referential links). |
| Gateway | `REQUIRE_AUTH` | `true` | When `true`, `POST /api/chat` requires `Authorization: Bearer <JWT>`. When `false`, bypasses JWT check and trusts `userId` from the request body (dev only). |
| Gateway | `JWT_SECRET` | — | **Required when `REQUIRE_AUTH=true`.** HS256 HMAC signing secret (32+ chars). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`  |
| Gateway | `ALLOWED_ORIGINS` | `""` (wildcard `*`) | Comma-separated origin allowlist for CORS. Empty = `Access-Control-Allow-Origin: *` (dev only). |
| Widget | `VITE_GATEWAY_URL` | `http://localhost:3000` | Base URL of the gateway, baked into the JS bundle at build time. Set before `npm run build`. |
| AI | `GROQ_API_KEY` | `""` | Groq API key (required unless `USE_AZURE=true`) |
| AI | `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model name |
| AI | `USE_AZURE` | `false` | Set `true` to use Azure OpenAI instead of Groq |
| AI | `AZURE_OPENAI_ENDPOINT` | — | Azure resource URL |
| AI | `AZURE_OPENAI_API_KEY` | — | Azure API key |
| AI | `AZURE_OPENAI_API_VERSION` | `2024-08-01-preview` | API version string |
| AI | `AZURE_OPENAI_DEPLOYMENT_FAST` | `gpt-5-mini` | Fast chat deployment name |
| AI | `AZURE_OPENAI_DEPLOYMENT_RAG` | `gpt-4o-mini` | RAG deployment name |
| AI | `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | `text-embedding-3-large` | Embedding deployment name |
| AI | `CHROMA_PERSIST_DIR` | `./chroma_db` | Path (relative to `ai-service/`) where ChromaDB persists the vector store |
| AI | `ENABLE_CITATIONS` | `false` | Set `true` to emit an SSE `sources` event with source filenames before `done` |

See [ai-service/.env.example](./ai-service/.env.example) for the full template.

---

## Embed the Widget in a Host Application

### Build the widget bundle

```powershell
cd widget-client
npm run build
```

This produces `dist/compliance-chat-overlay.es.js` (ES module) and `dist/compliance-chat-overlay.iife.js` (plain `<script>` tag). Serve either file from your CDN or static host.

### Add to any HTML page

```html
<!-- Load the bundle -->
<script type="module" src="https://cdn.example.com/compliance-chat-overlay.es.js"></script>

<!-- Mount the widget with the required host attributes -->
<compliance-chat-overlay
  gateway-url="https://api.example.com/api/chat"
  user-role="reviewer"
  user-id="usr_abc123"
  auth-token="<jwt-from-your-auth-provider>"
></compliance-chat-overlay>
```

### Available HTML Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `user-role` | **Yes** | `"user"` or `"reviewer"`. Controls AI routing. Read-only from inside the widget. |
| `user-id` | **Yes** | Authenticated user's unique identifier. Sent in every Contract A request as `userId`. |
| `gateway-url` | **Yes** (production) | Full URL to the gateway `/api/chat` endpoint, e.g. `http://192.168.1.100:3000/api/chat`. In dev the widget falls back to `VITE_GATEWAY_URL` from `.env`. |
| `open` | No | `"true"` to open the chat panel immediately on mount |
| `auth-token` | Conditional | JWT Bearer token. **Required in production** when gateway `REQUIRE_AUTH=true`. Omit for dev when `REQUIRE_AUTH=false`. |

---

## Repository Layout

```
ABB Chatbot Overlay/
├── README.md                      ← this file
├── ai-service/
│   ├── README.md
│   ├── .env.example
│   ├── requirements.txt
│   ├── data/                      ← place .pdf/.txt compliance documents here
│   ├── chroma_db/                 ← auto-created by ingest.py (git-ignored)
│   └── app/
│       ├── main.py
│       ├── llm_factory.py
│       ├── ingest.py              ← standalone ingestion CLI (run before server start)
│       ├── models/contracts.py
│       └── routers/semantic_router.py
├── gateway-service/
│   ├── README.md
│   ├── prisma/schema.prisma
│   ├── prisma.config.ts
│   └── src/
│       ├── lib/
│       │   ├── contracts.ts
│       │   └── prisma.ts
│       └── app/api/chat/
│           ├── route.ts
│           └── history/
│               ├── route.ts
│               └── [sessionId]/route.ts
└── widget-client/
    ├── README.md
    └── src/
        ├── mount.tsx
        ├── store/useChatStore.ts
        ├── hooks/useChatStream.ts
        └── components/ChatWidget.tsx
```

---

## Design Principles

1. **Contract-first integration** — Internals are yours to change. Contracts are shared and versioned.
2. **Stream-first UX** — Tokens reach the browser immediately via TransformStream passthrough. The full reply is persisted to Postgres only after the stream closes.
3. **Shadow DOM isolation** — Widget styles and layout are fully isolated from the host page.
4. **Semantic routing** — The `reviewer` role and compliance-specific keywords route to the deeper RAG path in the AI service.
5. **Multi-tenant persistence** — Every message is associated with a `userId` and `sessionId`. The history API supports per-user session retrieval.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| AI returns "I do not have enough information" for compliance questions | `chroma_db/` not yet created | Add documents to `ai-service/data/` and run `python -m app.ingest`; see [ai-service README](./ai-service/README.md#️-troubleshooting) |
| AI says "I do not have enough information" for "hi" or "what is AI" | Old code without general-chat path | Update to latest `semantic_router.py`; the `is_general_chat` extractor now routes greetings/general questions to a relaxed prompt |
| Widget shows network error | Gateway not running or wrong `gateway-url` | Start gateway on `:3000`; verify attribute |
| Gateway returns `502` | AI service down | Start `uvicorn` on `:8000` |
| Gateway returns `500` | `DATABASE_URL` missing or Postgres down | Check `.env.local`; verify Docker container |
| Empty stream | AI returned non-SSE body | Check AI service logs; verify Contract C format |
| `prisma db push` fails | `DATABASE_URL` not set or Postgres not reachable | Set `.env.local`; verify Docker container is running |
| CORS error in browser | Gateway CORS misconfigured | Gateway allows `*` for dev by default |
| `user-role` not applied | Attribute set after element connect | Rely on `attributeChangedCallback` — it propagates changes at any time |

---

## Module Documentation

- [widget-client/README.md](./widget-client/README.md) — Web Component, Zustand store, embedding guide
- [gateway-service/README.md](./gateway-service/README.md) — Next.js API proxy, Prisma setup, history endpoints
- [ai-service/README.md](./ai-service/README.md) — FastAPI, semantic routing, LLM providers

---

## Version Manifest

| Layer | Key Packages |
|-------|-------------|
| Widget | React 19.0.0, Vite 6.x, TypeScript 5.7+, Tailwind CSS 3.4+, Zustand 5.x |
| Gateway | Next.js 16.1.4, React 19.0.0, TypeScript 5.7+, Prisma 7.x |
| AI | Python 3.10+, FastAPI 0.129.0, Uvicorn 0.41.0, LangChain-Groq 0.3.3, LangChain-OpenAI 1.1.10, ChromaDB 1.5.0 |

Pinned versions live in each module's `package.json` or `requirements.txt`.
