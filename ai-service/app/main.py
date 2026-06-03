"""AI Service entrypoint — Contract B in, Contract C SSE out."""

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.models.contracts import ChatStreamRequest
from app.routers.semantic_router import route_and_stream

app = FastAPI(
    title="Compliance AI Service",
    version="1.0.0",
    description="Headless semantic routing, RAG, and LLM streaming microservice",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-service"}


@app.post("/v1/chat/stream")
async def chat_stream(request: ChatStreamRequest) -> StreamingResponse:
    """Contract B endpoint — streams Contract C SSE chunks."""

    async def event_generator():
        async for chunk in route_and_stream(request):
            yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
