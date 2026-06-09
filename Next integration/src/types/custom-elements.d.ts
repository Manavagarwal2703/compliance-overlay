declare namespace JSX {
    interface IntrinsicElements {
      'compliance-chat-overlay': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        'gateway-url'?: string;
        'user-role': 'user' | 'reviewer';
        'user-id': string;
        'auth-token'?: string;
        'open'?: string;
        'suggestions'?: string; // Add this line
      };
    }
  }