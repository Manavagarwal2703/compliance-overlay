"""
Swappable LLM factory — Groq (default) or Azure OpenAI.

Set USE_AZURE=true to switch back to Azure instantly.
"""

from __future__ import annotations

import os

from langchain_core.language_models import BaseChatModel

# Cache instances per (provider, streaming) so intent calls and streams do not clash.
_llm_cache: dict[tuple[str, bool], BaseChatModel] = {}


def _use_azure() -> bool:
    return os.getenv("USE_AZURE", "").strip().lower() in ("1", "true", "yes")


def _build_azure_llm(*, streaming: bool) -> BaseChatModel:
    """Azure OpenAI — gpt-5-mini fast path (configuration unchanged from original)."""
    from langchain_openai import AzureChatOpenAI

    return AzureChatOpenAI(
        azure_deployment=os.getenv("AZURE_OPENAI_DEPLOYMENT_FAST", "gpt-5-mini"),
        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
        api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
        temperature=0.2,
        streaming=streaming,
    )


def _build_groq_llm(*, streaming: bool) -> BaseChatModel:
    """Groq — default local/dev path via langchain-groq."""
    from langchain_groq import ChatGroq

    return ChatGroq(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        api_key=os.getenv("GROQ_API_KEY", ""),
        temperature=0.2,
        streaming=streaming,
    )


def get_llm(*, streaming: bool = True) -> BaseChatModel:
    """
    Return a cached chat model for the active provider.

    - Default: Groq (set GROQ_API_KEY)
    - Azure: set USE_AZURE=true (keeps original AzureChatOpenAI config)
    """
    provider = "azure" if _use_azure() else "groq"
    cache_key = (provider, streaming)

    if cache_key not in _llm_cache:
        if provider == "azure":
            _llm_cache[cache_key] = _build_azure_llm(streaming=streaming)
        else:
            _llm_cache[cache_key] = _build_groq_llm(streaming=streaming)

    return _llm_cache[cache_key]


def get_active_provider() -> str:
    """Human-readable provider label for logging and mock prefixes."""
    return "azure" if _use_azure() else "groq"


def clear_llm_cache() -> None:
    """Reset cached clients (useful in tests or after env changes)."""
    _llm_cache.clear()
