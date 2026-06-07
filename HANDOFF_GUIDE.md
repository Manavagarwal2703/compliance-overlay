# Enterprise Compliance AI Assistant — Client Handoff Guide

> **Document Classification:** Executive Handoff | Version 1.0 | Prepared: June 2026
>
> This document is the authoritative operational and architectural reference for the Enterprise Compliance AI Assistant. It is intended for client administrators, IT leads, and executive stakeholders.

---

## 1. Executive Summary

The **Enterprise Compliance AI Assistant** is a production-grade, three-tier Retrieval-Augmented Generation (RAG) system purpose-built for enterprise compliance workflows. It enables employees to query internal policy documents and receive precise, grounded, citation-backed answers — all without any sensitive data ever leaving the organization's infrastructure.

The system is architected around three non-negotiable pillars:

| Pillar | Technology | Guarantee |
|---|---|---|
| 🔒 **Privacy** | Local RAG via ChromaDB | All document embeddings are stored and queried on-premises. No policy data is transmitted to any external embedding service. |
| 🛡️ **Security** | JWT Authentication + CORS Lockdown | Every API route is protected by signed JSON Web Tokens. Cross-Origin Resource Sharing is locked to declared, trusted origins only. |
| ✨ **UX** | Bespoke Interaction Design | A custom-engineered chat widget — not a generic SDK — built specifically for this enterprise context, with a refined, professional interaction model. |

The result is a system that is **simultaneously secure enough for a production enterprise environment and intuitive enough for any employee to use without training.**

---

## 2. Key Feature Highlights

### 2.1 Semantic Routing — Intelligent Query Classification

The AI does not blindly forward every message to the document database. Before any retrieval occurs, the system classifies the incoming query using a structured LLM-based extraction step (`extract_entities`).

**How it works:**

1. The user's query is evaluated against a set of semantic criteria to determine its intent.
2. Queries flagged as **`is_general_chat`** (greetings, general professional knowledge) are answered using a *General Intelligence* prompt — conversational, helpful, and efficient.
3. Queries identified as **Internal Policy** questions trigger the full **RAG pipeline**: ChromaDB similarity search → context injection → strict compliance synthesis.
4. Queries that are off-topic, unprofessional (entertainment, jokes, non-work requests), or out-of-scope are intercepted by the compliance guardrail and refused with a standardized, professional message.

This routing layer is the system's first line of defence against prompt injection and irrelevant queries, and its primary mechanism for cost efficiency — only grounding queries that actually require it.

---

### 2.2 Contextual Memory — The AI Remembers

The system implements a **5-turn rolling conversation window**. The Gateway Service automatically fetches the last 5 message pairs from the database and injects them into each new request's context payload (Contract B).

**The practical effect:** Users can ask natural follow-up questions like *"What does that mean for contractors?"* or *"Can you simplify that?"* without needing to repeat themselves. The AI understands the thread of the conversation.

This feature is controlled by the `ENABLE_AI_MEMORY=true` flag in the gateway's environment configuration and can be toggled independently of all other features.

---

### 2.3 Bespoke UI — Engineered for Enterprise

The `widget-client` is not a third-party embed. It is a purpose-built React application with the following enterprise-grade UX features:

| Feature | Description |
|---|---|
| **Auto-Expanding Input** | The text input field grows dynamically as the user types multi-line queries, eliminating the frustration of a cramped single-line box for complex compliance questions. |
| **Pulsing Health Indicator** | A live status indicator (🟢/🔴) with a subtle animation confirms the system is online before the user sends a message, building immediate trust and preventing confused submissions to a downed service. |
| **Citation Pills** | Answers grounded in internal documents display inline citation pills (e.g., `📄 HR_Policy_v3.pdf`) directly beneath the response. This allows users to immediately verify the source and builds confidence in the AI's output. |
| **Date-Grouped Session Sidebar** | Conversation history is automatically organized into "Today", "Previous 7 Days", and "Older" groups for fast retrieval. |
| **Inline Session Renaming** | Users can rename their saved chat sessions directly in the sidebar for personal organization. |

---

## 3. The "One-Click" Deployment — The Master Keys

The entire system deployment is fully automated via two shell scripts in the project root. No manual dependency installation or service configuration is required.

> **Prerequisite:** A Linux or macOS host with `bash` available. Ensure the `.env` files for each service are populated with the correct secrets before running (see Section 4.2).

### Step 1: Grant Execution Permission (Run Once)

```bash
chmod +x *.sh
```

### Step 2: Install All Dependencies (Run Once Per Server)

```bash
./install.sh
```

This single command performs the following actions in sequence:
- Installs all **Node.js** dependencies for the `gateway-service` via `npm install`.
- Runs **Prisma** database migrations to provision the SQLite session/message store (`npx prisma migrate deploy`).
- Creates a Python **virtual environment** for the `ai-service` and installs all dependencies from `requirements.txt`.

### Step 3: Launch All Services

```bash
./start.sh
```

This command launches both services as background processes with full PID tracking:

| Service | Default Port | PID File |
|---|---|---|
| `gateway-service` (Next.js) | `3000` | `gateway.pid` |
| `ai-service` (FastAPI) | `8000` | `ai-service.pid` |

Logs for each service are written to `gateway.log` and `ai-service.log` in the project root for monitoring.

---

## 4. Administrative Workflows

### 4.1 Updating the Knowledge Base

To add new policy documents or update existing ones, follow this procedure:

1. **Place new PDF files** into the `ai-service/data/` directory.
2. **Run the ingestion script** from the `ai-service` directory:

```bash
# From the project root
cd ai-service
source venv/bin/activate   # or: venv\Scripts\activate on Windows
python -m app.ingest
```

3. The script will **chunk**, **embed**, and **store** all documents in the local ChromaDB vector database, making them immediately available for semantic retrieval.

> **Note:** Existing documents are re-processed on each run. For large document sets, schedule ingestion during off-peak hours.

---

### 4.2 Managing Security — Auth Toggle

The `gateway-service` exposes a single master switch for authentication enforcement in its `.env` file:

```dotenv
# gateway-service/.env

# Set to "true" for Production. Set to "false" for Developer Testing ONLY.
REQUIRE_AUTH=true
```

| Mode | Value | Behavior |
|---|---|---|
| **Production** | `REQUIRE_AUTH=true` | All API routes require a valid, signed JWT bearer token. Unauthenticated requests receive a `401 Unauthorized` response. |
| **Testing / Development** | `REQUIRE_AUTH=false` | Authentication middleware is bypassed. All routes are open. **Never deploy to production in this state.** |

> ⚠️ **Security Advisory:** The `REQUIRE_AUTH=false` setting is provided exclusively for local development and integration testing. Deploying with auth disabled in a network-accessible environment is a critical security vulnerability.

---

## 5. Azure OpenAI Cost Optimization

### The Dual-Model Strategy

The system is designed with a **model-agnostic architecture** — the AI model is never hardcoded into business logic. The model identifier is declared exclusively via environment variable (`AZURE_OPENAI_DEPLOYMENT_NAME`), meaning the entire fleet can be switched to a different model by changing a single line in the `.env` file with no code changes.

**Current Recommended Configuration:**

| Scenario | Recommended Model | Est. Cost |
|---|---|---|
| **Standard Operations** (all routing, synthesis, general chat) | `gpt-4o-mini` | **~$0.60 per 1,000 queries** |
| **High-Reasoning Tasks** (complex legal interpretation, multi-doc synthesis) | `gpt-4o` | ~$5.00–$15.00 per 1,000 queries |

**Why `gpt-4o-mini` is the default:**

The semantic routing layer extracts structured entities and classifies intent before the synthesizer receives the query. This pre-processing step dramatically reduces the reasoning burden on the synthesis model, meaning `gpt-4o-mini` achieves near-identical output quality to `gpt-4o` for the vast majority of compliance Q&A use cases, at a **fraction of the cost**.

**To switch models**, update the gateway's `.env`:

```dotenv
# gateway-service/.env
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o-mini   # Default: cost-optimized
# AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o      # Premium: high-reasoning tasks
```

No restart of the `ai-service` is required — only the `gateway-service`.

---

## 6. Future Roadmap

The following enhancements are recommended as the highest-value next iterations of this system:

### 🔐 Secure Document Downloads
Allow users to download the source PDF documents that the AI cites directly from the chat interface. This would require a new authenticated file-serving endpoint in the `gateway-service` and an update to the citation pill UI to include a download action.

### 👍 User Feedback Loop (Thumbs Up / Down)
Implement a per-message feedback mechanism to capture user sentiment on AI responses. This data would feed into a quality monitoring dashboard, enabling the team to identify low-confidence responses, flag hallucinations, and measure the impact of knowledge base updates over time.

### 📁 SharePoint Integration
Replace the manual `ai-service/data/` PDF drop with an automated SharePoint connector. The ingestion script would be updated to poll a designated SharePoint document library on a schedule, automatically syncing new and updated policy documents into the ChromaDB knowledge base without any manual administrator intervention.

---

*This document was prepared at project completion. For architectural deep-dives, refer to the `SYSTEM_DESIGN.md` in the repository root. For service-specific operational notes, consult the `README.md` within each service subdirectory (`gateway-service/`, `ai-service/`, `widget-client/`).*
