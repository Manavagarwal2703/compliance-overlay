"use client";

import Script from 'next/script';

interface ChatbotWidgetProps {
  authToken?: string;
}

export default function ChatbotWidget({ authToken }: ChatbotWidgetProps) {
  return (
    <>
      {/* Load the Vite bundle from the public folder */}
      <Script 
        type="module" 
        src="/widget/compliance-chat-widget.js" 
        strategy="lazyOnload" 
      />
      
      {/* Mount the web component */}
      <compliance-chat-overlay
        gateway-url="http://localhost:3000/api/chat"
        auth-token={authToken}
        // Pass dynamic suggestions via JSON.stringify
        suggestions={JSON.stringify([
          "Show me the latest audit logs.",
          "What is the password rotation policy?",
          "Check ISO 27001 status."
        ])}
      ></compliance-chat-overlay>
    </>
  );
}
