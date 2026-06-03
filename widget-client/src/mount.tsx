import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget";
import { useChatStore, type ChatRole } from "./store/useChatStore";
import tailwindStyles from "./index.css?inline";

const ELEMENT_TAG = "compliance-chat-overlay";

class ComplianceChatElement extends HTMLElement {
  private shadowRootEl: ShadowRoot | null = null;
  private reactRoot: Root | null = null;
  private styleEl: HTMLStyleElement | null = null;

  static get observedAttributes(): string[] {
    return ["gateway-url", "open", "user-role", "user-id"];
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

    // user-role and user-id are injected by the host and passed into the
    // Zustand store. They drive AI routing and message attribution without
    // any manual UI toggle inside the widget.
    const rawRole = this.getAttribute("user-role") ?? "user";
    const userRole: ChatRole =
      rawRole === "reviewer" ? "reviewer" : "user";
    const userId = this.getAttribute("user-id") ?? "";
    useChatStore.getState().initUser(userId, userRole);

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
      case "user-role": {
        const role: ChatRole =
          newValue === "reviewer" ? "reviewer" : "user";
        const current = useChatStore.getState();
        useChatStore.getState().initUser(current.userId, role);
        break;
      }
      case "user-id": {
        const current = useChatStore.getState();
        useChatStore.getState().initUser(newValue ?? "", current.userRole);
        break;
      }
    }
  }
}

if (!customElements.get(ELEMENT_TAG)) {
  customElements.define(ELEMENT_TAG, ComplianceChatElement);
}

export { ComplianceChatElement, ELEMENT_TAG };
