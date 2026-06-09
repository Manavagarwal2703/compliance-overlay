import ChatbotWidget from '../components/ChatbotWidget';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-slate-100 text-black">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold mb-4">Widget Sandbox Test</h1>
        <p className="text-lg text-slate-600 mb-8">
          If the integration is successful, your bespoke Vite widget will render on this page.
        </p>
      </div>
      
      {/* Mount the widget */}
      <ChatbotWidget />
    </main>
  );
}