import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget";
import { useChatStore } from "./store/useChatStore";
const ELEMENT_TAG = "compliance-chat-overlay";

class ComplianceChatElement extends HTMLElement {
  private reactRoot: Root | null = null;

  static get observedAttributes(): string[] {
    return ["gateway-url", "open", "auth-token", "suggestions"];
  }

  connectedCallback(): void {
    if (this.reactRoot) {
      return;
    }

    // Since we're integrated in Next.js, we drop the Shadow DOM so the 
    // global Tailwind CSS from the host application can style the widget.
    const mountPoint = document.createElement("div");
    mountPoint.id = "compliance-chat-root";
    mountPoint.className = "w-full h-full"; // ensure it expands
    this.appendChild(mountPoint);

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
