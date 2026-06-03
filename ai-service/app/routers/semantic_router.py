"""Intent-based semantic routing with LLM classification."""

from __future__ import annotations

import asyncio
import json
import logging
from enum import Enum
from typing import AsyncIterator

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from app.llm_factory import get_active_provider, get_llm
from app.models.contracts import ChatStreamRequest, ContextMessage

logger = logging.getLogger(__name__)


class UserIntent(str, Enum):
    REPORT_QUERY = "REPORT_QUERY"
    KNOWLEDGE_BASE = "KNOWLEDGE_BASE"
    GENERAL_CHAT = "GENERAL_CHAT"


class IntentClassification(BaseModel):
    """Strict JSON schema for the routing LLM."""

    intent: UserIntent = Field(
        description=(
            "REPORT_QUERY: compliance results, control status (full/partial/not), "
            "evidence, failure reasons. "
            "KNOWLEDGE_BASE: policies, uploads, evidence requirements, how-to. "
            "GENERAL_CHAT: greetings or off-topic."
        )
    )
    reasoning: str = Field(description="Brief justification for the chosen intent")


INTENT_SYSTEM_PROMPT = """You are an intent classifier for an enterprise compliance platform.

The platform has two data sources:
1. STRUCTURED REPORT DATABASE — Report outputs with Controls, Evidence, Compliance Status (full/partial/not), and Reason fields.
2. VECTOR KNOWLEDGE BASE — General policies, how to upload files, evidence requirements, and system usage.

Classify the latest user message into exactly ONE intent:

- REPORT_QUERY — Asking about specific compliance results, a control's status, evidence tied to controls, partial/full/not compliance, or why something failed in a report.
- KNOWLEDGE_BASE — Asking general rules, policies, how to use the system, how to upload files, or what evidence is required in general.
- GENERAL_CHAT — Greetings, thanks, small talk, or questions unrelated to compliance workflows.

Use conversation history only for disambiguation. Prefer the most specific intent when unclear between report data vs general KB."""

_parser = PydanticOutputParser(pydantic_object=IntentClassification)

_intent_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", INTENT_SYSTEM_PROMPT + "\n\n{format_instructions}"),
        ("human", "Conversation history:\n{history}\n\nLatest user query:\n{query}"),
    ]
).partial(format_instructions=_parser.get_format_instructions())


def _format_chat_history(chat_history: list[ContextMessage]) -> str:
    if not chat_history:
        return "(none)"
    lines: list[str] = []
    for msg in chat_history[-10:]:
        lines.append(f"{msg.role}: {msg.content}")
    return "\n".join(lines)


def _sse_chunk(event_type: str, content: str = "") -> str:
    payload: dict[str, str] = {"type": event_type}
    if content:
        payload["content"] = content
    return f"data: {json.dumps(payload)}\n\n"


async def _mock_stream_text(text: str, *, delay: float = 0.04) -> AsyncIterator[str]:
    for word in text.split():
        yield _sse_chunk("token", word + " ")
        await asyncio.sleep(delay)
    yield _sse_chunk("done")


async def analyze_intent(
    query: str, chat_history: list[ContextMessage]
) -> IntentClassification:
    """
    Classify user intent via LLM with a strict Pydantic JSON parser.

    Falls back to GENERAL_CHAT if the model or parser fails.
    """
    llm = get_llm(streaming=False)
    chain = _intent_prompt | llm | _parser

    try:
        result = await chain.ainvoke(
            {
                "query": query,
                "history": _format_chat_history(chat_history),
            }
        )
        if isinstance(result, IntentClassification):
            logger.info(
                "Intent classified: %s — %s",
                result.intent.value,
                result.reasoning,
            )
            return result
    except Exception as exc:
        logger.warning("Intent classification failed, using GENERAL_CHAT: %s", exc)

    return IntentClassification(
        intent=UserIntent.GENERAL_CHAT,
        reasoning="Classification fallback due to LLM or parse error.",
    )


async def handle_report_query(request: ChatStreamRequest) -> AsyncIterator[str]:
    """Placeholder — structured report DB (controls, evidence, status, reason)."""
    provider = get_active_provider()
    mock = (
        f"[MOCK REPORT DATA] provider={provider} | "
        f"Query: \"{request.query[:120]}\" | "
        f"Would query structured Report Outputs (Controls, Evidence, "
        f"Compliance Status: full/partial/not, Reason)."
    )
    async for chunk in _mock_stream_text(mock, delay=0.03):
        yield chunk


async def handle_kb_query(request: ChatStreamRequest) -> AsyncIterator[str]:
    """Placeholder — vector knowledge base (policies, uploads, evidence rules)."""
    provider = get_active_provider()
    mock = (
        f"[MOCK KNOWLEDGE BASE] provider={provider} | "
        f"Query: \"{request.query[:120]}\" | "
        f"Would retrieve from Vector DB (policies, file upload steps, "
        f"evidence requirements)."
    )
    async for chunk in _mock_stream_text(mock, delay=0.03):
        yield chunk


async def handle_general_chat(request: ChatStreamRequest) -> AsyncIterator[str]:
    """Conversational fallback — can be swapped for real LLM streaming later."""
    provider = get_active_provider()
    _ = get_llm(streaming=True)
    text = (
        f"Hello! I'm here to help with compliance questions. "
        f"(intent=GENERAL_CHAT, provider={provider}, role={request.role})"
    )
    async for chunk in _mock_stream_text(text, delay=0.04):
        yield chunk


async def route_and_stream(request: ChatStreamRequest) -> AsyncIterator[str]:
    """Analyze intent, then dispatch to the appropriate handler."""
    classification = await analyze_intent(request.query, request.context_history)

    if classification.intent == UserIntent.REPORT_QUERY:
        async for chunk in handle_report_query(request):
            yield chunk
    elif classification.intent == UserIntent.KNOWLEDGE_BASE:
        async for chunk in handle_kb_query(request):
            yield chunk
    else:
        async for chunk in handle_general_chat(request):
            yield chunk
