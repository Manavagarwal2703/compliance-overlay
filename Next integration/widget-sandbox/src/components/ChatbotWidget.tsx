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

export default function ChatbotWidget() {
    useEffect(() => {
        import('../widget/mount');
    }, []);

    const gatewayBase = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:3000";

    return (
        <div suppressHydrationWarning className="fixed bottom-6 right-6 z-50 w-[400px] h-[600px] pointer-events-none flex flex-col justify-end items-end">
            <div className="pointer-events-auto w-full h-full">
                {/* @ts-expect-error Custom web component */}
                <compliance-chat-overlay
                    gateway-url={`${gatewayBase}/api/chat`}
                    auth-token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkZXZfdXNlcl9tYW5hdiIsImV4cCI6MTkwMDAwMDAwMH0.dstg4xOxdwq6ABNZNO4grIbxe-z1DBkruNt49wE8f4Q"
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