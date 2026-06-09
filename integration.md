# Enterprise Integration Guide: Chatbot Overlay

## Overview & Architecture
The Chatbot Overlay is delivered as a custom Web Component (`<compliance-chat-overlay>`) wrapped within a native React/Next.js component (`ChatbotWidget`). 
It communicates with the backend via a Zero-Trust architecture requiring an `Authorization: Bearer <token>` header, which is passed securely from the parent app via the `auth-token` prop.
The widget internally leverages plain-text React rendering to prevent Stored XSS, ensuring all chat messages are treated as inert strings.

## 1. Files to Transfer
To integrate the chatbot into your Parent Application, copy the following exact structure from the handoff package into your application:

- `src/widget/` (Copy the entire directory, including `components`, `hooks`, `store`, `utils`, `index.css`, and `mount.tsx`)
- `src/components/ChatbotWidget.tsx` (The Next.js wrapper component)

Your target structure should look like this:
```text
your-next-app/
├── src/
│   ├── components/
│   │   └── ChatbotWidget.tsx
│   ├── widget/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store/
│   │   ├── utils/
│   │   ├── index.css
│   │   └── mount.tsx
```

## 2. Dependency Updates
Ensure your `package.json` includes the following dependencies required by the widget.

```json
{
  "dependencies": {
    "framer-motion": "^12.40.0",
    "lucide-react": "^1.17.0",
    "zustand": "^5.0.14"
  }
}
```
*Note: The widget is built for React 19. If you are using React 18, it is highly compatible, but ensure your Next.js version is relatively modern (App Router is recommended).*

## 3. Configuration Merges

### CSS & Tailwind Configuration
The widget uses Tailwind CSS v4. If your application also uses Tailwind v4, update your global CSS to ensure the widget source is scanned:

In your `src/app/globals.css` (or wherever your main CSS resides):
```css
@import "tailwindcss";
/* Add this to scan the widget directory for Tailwind classes */
@source "../widget";

/* Add bespoke widget scrollbar & web component base styles */
.widget-scrollbar::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
.widget-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.widget-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(215, 25, 32, 0.6);
  border-radius: 10px;
}
.widget-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(215, 25, 32, 0.8);
}

.widget-no-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.widget-no-scrollbar::-webkit-scrollbar {
  display: none;
}

compliance-chat-overlay {
  display: block;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  width: 100%;
  height: 100%;
}
```

### Environment Variables
Add the Gateway URL to your `.env.local`:
```env
NEXT_PUBLIC_GATEWAY_URL=https://your-production-gateway.com
```

## 4. Component Implementation
First, modify the provided `ChatbotWidget.tsx` so that it accepts the `token` dynamically as a prop.

**`src/components/ChatbotWidget.tsx`**
```tsx
"use client";

import { useEffect } from 'react';

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'compliance-chat-overlay': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                'gateway-url'?: string;
                'auth-token'?: string;
                'suggestions'?: string;
            };
        }
    }
}
import '../widget/index.css';

interface ChatbotWidgetProps {
    token: string;
}

export default function ChatbotWidget({ token }: ChatbotWidgetProps) {
    useEffect(() => {
        import('../widget/mount');
    }, []);

    const gatewayBase = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:3000";

    if (!token) return null;

    return (
        <div suppressHydrationWarning className="fixed bottom-6 right-6 z-50 w-[400px] h-[600px] pointer-events-none flex flex-col justify-end items-end">
            <div className="pointer-events-auto w-full h-full">
                {/* @ts-expect-error Custom web component */}
                <compliance-chat-overlay
                    gateway-url={`${gatewayBase}/api/chat`}
                    auth-token={token}
                    suggestions={JSON.stringify([
                        "Show me the latest audit logs.",
                        "What is the password rotation policy?",
                        "Check ISO 27001 status."
                    ])}
                />
            </div>
        </div>
    );
}
```

Mount it in your Root Layout (`src/app/layout.tsx`):
```tsx
import ChatbotWidget from '@/components/ChatbotWidget';
import { cookies } from 'next/headers';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Obtain the token (example via next/headers)
  const cookieStore = await cookies();
  const token = cookieStore.get('your-auth-token')?.value || '';

  return (
    <html lang="en">
      <body>
        {children}
        <ChatbotWidget token={token} />
      </body>
    </html>
  );
}
```


```tsx
{token ? <ChatbotWidget token={token} /> : null}
```
Above is to hide while logged out. To be updated in pages.tsx

## 5. Authentication Handoff
The web component requires a valid JWT to authorize requests to the chat API. 
The Parent App developers must:
1. Extract the active user's JWT (e.g., from an HttpOnly session cookie, NextAuth session, or localStorage depending on your architecture).
2. Pass it directly into the `<ChatbotWidget token={userJwt} />` as shown in the layout implementation above.
3. The Widget will automatically inject this into the `Authorization: Bearer <token>` header for all WebSocket/HTTP traffic.

## 6. Security Posture
- **XSS Prevention:** Stored XSS is natively mitigated; the internal component relies solely on React's standard text interpolation (no `dangerouslySetInnerHTML`), ensuring all user and AI responses are rendered safely as plain strings.
- **Content Security Policy (CSP):** Update your Parent App's CSP headers to explicitly allow network traffic to the Gateway Service.
  ```http
  Content-Security-Policy: connect-src 'self' https://your-production-gateway.com wss://your-production-gateway.com;
  ```
