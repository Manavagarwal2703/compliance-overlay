import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget";
import { useChatStore } from "./store/useChatStore";
import tailwindStyles from "./index.css?inline";

const ELEMENT_TAG = "compliance-chat-widget";

class ComplianceChatElement extends HTMLElement {
  private shadowRootEl: ShadowRoot | null = null;
  private reactRoot: Root | null = null;
  private styleEl: HTMLStyleElement | null = null;

  static get observedAttributes(): string[] {
    return ["gateway-url", "open"];
  }

  connectedCallback(): void {
    if (this.shadowRootEl) {
      return;
    }

    this.shadowRootEl = this.attachShadow({ mode: "open" });

    this.styleEl = document.createElement("style");
    this.styleEl.textContent = tailwindStyles;
    this.shadowRootEl.appendChild(this.styleEl);

    const mountPoint = document.createElement("div");
    mountPoint.id = "compliance-chat-root";
    this.shadowRootEl.appendChild(mountPoint);

    const gatewayUrl = this.getAttribute("gateway-url");
    if (gatewayUrl) {
      useChatStore.getState().setGatewayUrl(gatewayUrl);
    }

    const openAttr = this.getAttribute("open");
    if (openAttr === "true") {
      useChatStore.getState().setOpen(true);
    }

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
      return;
    }
    if (name === "gateway-url" && newValue) {
      useChatStore.getState().setGatewayUrl(newValue);
    }
    if (name === "open") {
      useChatStore.getState().setOpen(newValue === "true");
    }
  }
}

if (!customElements.get(ELEMENT_TAG)) {
  customElements.define(ELEMENT_TAG, ComplianceChatElement);
}

export { ComplianceChatElement, ELEMENT_TAG };
