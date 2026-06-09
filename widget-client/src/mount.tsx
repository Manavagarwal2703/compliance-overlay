import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget";
import { useChatStore } from "./store/useChatStore";
import tailwindStyles from "./index.css?inline";

const ELEMENT_TAG = "compliance-chat-overlay";

class ComplianceChatElement extends HTMLElement {
  private shadowRootEl: ShadowRoot | null = null;
  private reactRoot: Root | null = null;
  private styleEl: HTMLStyleElement | null = null;

  static get observedAttributes(): string[] {
    return ["gateway-url", "open", "auth-token", "suggestions"];
  }

  connectedCallback(): void {
    if (this.shadowRootEl) {
      return;
    }

    this.shadowRootEl = this.attachShadow({ mode: "open" });

    // Inject compiled Tailwind CSS into the shadow root so styles are
    // fully isolated from the host application's stylesheet cascade.
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = tailwindStyles;
    this.shadowRootEl.appendChild(this.styleEl);

    const mountPoint = document.createElement("div");
    mountPoint.id = "compliance-chat-root";
    this.shadowRootEl.appendChild(mountPoint);

    // ── Read and apply all HTML attributes ─────────────────────────────────
    const gatewayUrl = this.getAttribute("gateway-url");
    if (gatewayUrl) {
      useChatStore.getState().setGatewayUrl(gatewayUrl);
    }

    const openAttr = this.getAttribute("open");
    if (openAttr === "true") {
      useChatStore.getState().setOpen(true);
    }

    // Auth-token handles identity; user-role and user-id are removed
    // from the host injection to support zero-trust payload architecture.

    // auth-token is optional. When present, useChatStream will attach it as
    // Authorization: Bearer <token> on every Contract A POST request.
    const authToken = this.getAttribute("auth-token");
    useChatStore.getState().setAuthToken(authToken ?? null);

    // Read custom suggestions from the host. Must be a JSON-stringified array of strings.
    const suggestionsAttr = this.getAttribute("suggestions");
    if (suggestionsAttr) {
      try {
        const parsed = JSON.parse(suggestionsAttr);
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
          useChatStore.getState().setSuggestions(parsed);
        }
      } catch (e) {
        console.error("Invalid JSON in 'suggestions' attribute", e);
      }
    }

    // ── Mount React tree ────────────────────────────────────────────────────
    this.reactRoot = createRoot(mountPoint);
    this.reactRoot.render(
      <StrictMode>
        <ChatWidget />
      </StrictMode>
    );
  }

  disconnectedCallback(): void {
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.shadowRootEl = null;
    this.styleEl = null;
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    newValue: string | null
  ): void {
    if (!this.reactRoot) {
      // Attribute changed before the component mounted — connectedCallback
      // will pick up the current value via getAttribute(), so no action needed.
      return;
    }

    switch (name) {
      case "gateway-url":
        if (newValue) useChatStore.getState().setGatewayUrl(newValue);
        break;
      case "open":
        useChatStore.getState().setOpen(newValue === "true");
        break;

      case "auth-token":
        useChatStore.getState().setAuthToken(newValue ?? null);
        break;
      case "suggestions":
        if (newValue) {
          try {
            const parsed = JSON.parse(newValue);
            if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
              useChatStore.getState().setSuggestions(parsed);
            }
          } catch (e) {
            console.error("Invalid JSON in 'suggestions' attribute", e);
          }
        }
        break;
    }
  }
}

if (!customElements.get(ELEMENT_TAG)) {
  customElements.define(ELEMENT_TAG, ComplianceChatElement);
}

export { ComplianceChatElement, ELEMENT_TAG };
