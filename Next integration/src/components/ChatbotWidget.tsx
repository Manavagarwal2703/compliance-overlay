"use client";

import Script from 'next/script';

export default function ChatbotWidget() {
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
        user-role="reviewer"
        user-id="dev_user_001"
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
