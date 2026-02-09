import './index.css';

// Initialize the app
function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  // Kisame UI Layout based on SYSTEM_CONTEXT.md
  // ---------------------------------------------------------
  // | Top Bar                                                |
  // |--------------------------------------------------------|
  // | Session List | Timeline / Details | Explanation + Chat |
  // |              |                    |                    |
  // |--------------------------------------------------------|
  // | Evidence / Packet References                           |
  // ---------------------------------------------------------

  root.innerHTML = `
    <div class="h-screen flex flex-col bg-neutral-900 text-gray-200 font-sans overflow-hidden">
      
      <!-- 1. Top Bar -->
      <header class="h-14 border-b border-neutral-800 flex items-center justify-between px-4 bg-neutral-900 shrink-0">
        <div class="flex items-center gap-4">
          <h1 class="font-bold text-lg tracking-tight text-white">Kisame</h1>
          <span class="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">No Capture Loaded</span>
        </div>
        <div class="flex items-center gap-2">
           <button class="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">Open PCAP</button>
           <button class="p-1.5 hover:bg-neutral-800 rounded text-neutral-400">
             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
           </button>
        </div>
      </header>

      <!-- Main Workspace Area -->
      <main class="flex-1 flex overflow-hidden">
        
        <!-- 2. Session List (Left Panel) -->
        <aside class="w-64 border-r border-neutral-800 flex flex-col bg-neutral-900/50">
          <div class="h-8 border-b border-neutral-800 flex items-center px-3 bg-neutral-900/80">
            <span class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Sessions</span>
          </div>
          <div class="flex-1 overflow-y-auto p-2 space-y-1">
            <!-- Placeholder Session Items -->
            <div class="p-3 rounded bg-neutral-800/50 border border-neutral-700/50 hover:bg-neutral-800 cursor-pointer transition-colors group">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-mono text-emerald-400">TCP</span>
                <span class="text-[10px] text-neutral-500">10:42:01</span>
              </div>
              <div class="text-sm font-medium text-gray-300">192.168.1.104 <span class="text-neutral-500">→</span> 8.8.8.8</div>
              <div class="mt-1 text-[10px] text-neutral-500 flex gap-2">
                <span>12 pkts</span>
                <span>2.4kb</span>
              </div>
            </div>
             <div class="p-3 rounded border border-transparent hover:bg-neutral-800 cursor-pointer transition-colors">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-mono text-blue-400">UDP</span>
                <span class="text-[10px] text-neutral-500">10:42:05</span>
              </div>
              <div class="text-sm font-medium text-gray-400">192.168.1.104 <span class="text-neutral-500">→</span> 10.0.0.5</div>
               <div class="mt-1 text-[10px] text-neutral-500 flex gap-2">
                <span>4 pkts</span>
                <span>1.1kb</span>
              </div>
            </div>
             <div class="p-3 rounded border border-transparent hover:bg-neutral-800 cursor-pointer transition-colors">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-mono text-purple-400">TLS</span>
                <span class="text-[10px] text-neutral-500">10:42:15</span>
              </div>
              <div class="text-sm font-medium text-gray-400">192.168.1.104 <span class="text-neutral-500">→</span> 152.4.2.1</div>
            </div>
          </div>
        </aside>

        <!-- 3. Timeline & Details (Center Panel) -->
        <section class="flex-1 border-r border-neutral-800 flex flex-col min-w-0 bg-neutral-900">
           <div class="h-8 border-b border-neutral-800 flex items-center px-3 bg-neutral-900/80 justify-between">
            <span class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Timeline</span>
            <span class="text-[10px] text-neutral-500">Session ID: #1042</span>
          </div>
          <div class="flex-1 overflow-y-auto p-4">
             <div class="flex flex-col gap-4 relative">
                <!-- Vertical Line -->
                <div class="absolute left-3 top-2 bottom-2 w-px bg-neutral-800"></div>

                <!-- Timeline Events -->
                <div class="pl-8 relative">
                   <div class="absolute left-[9px] top-1.5 w-2 h-2 rounded-full bg-emerald-500/50 border border-emerald-500"></div>
                   <div class="text-xs text-neutral-500 mb-0.5 font-mono">10:42:01.0024</div>
                   <div class="text-sm text-gray-300">Connection Established (SYN-ACK)</div>
                </div>

                <div class="pl-8 relative">
                   <div class="absolute left-[9px] top-1.5 w-2 h-2 rounded-full bg-neutral-700 border border-neutral-600"></div>
                   <div class="text-xs text-neutral-500 mb-0.5 font-mono">10:42:01.0500</div>
                   <div class="text-sm text-gray-400">Client Hello (TLS 1.2)</div>
                   <div class="mt-1 p-2 bg-neutral-800/50 rounded border border-neutral-800 text-xs font-mono text-neutral-400">
                      SNI: google.com
                      Cipher Suites: [17]
                   </div>
                </div>

                 <div class="pl-8 relative">
                   <div class="absolute left-[9px] top-1.5 w-2 h-2 rounded-full bg-blue-500/50 border border-blue-500"></div>
                   <div class="text-xs text-neutral-500 mb-0.5 font-mono">10:42:01.1200</div>
                   <div class="text-sm text-gray-300">Server Hello</div>
                </div>
             </div>
          </div>
        </section>

        <!-- 4. Explanation + Chat (Right Panel) -->
        <aside class="w-96 flex flex-col bg-neutral-900">
           <!-- Explanation Context -->
           <div class="flex-1 overflow-y-auto border-b border-neutral-800 p-4">
              <div class="h-6 flex items-center mb-2">
                 <span class="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1">
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                   Analysis
                 </span>
              </div>
              <div class="prose prose-invert prose-sm">
                <p class="text-gray-300 leading-relaxed text-sm">
                  This session represents a standard <span class="text-purple-300">HTTPS handshake</span>. The client initiated a connection to <code class="bg-neutral-800 px-1 py-0.5 rounded text-neutral-300">8.8.8.8</code> on port 443. The handshake completed successfully in 120ms.
                </p>
                <div class="mt-4 p-3 bg-blue-900/20 border border-blue-500/20 rounded">
                   <p class="text-xs text-blue-200">
                     <strong>Note:</strong> No irregularities detected in the cipher suite negotiation.
                   </p>
                </div>
              </div>
           </div>
           
           <!-- Chat Interface -->
           <div class="h-1/2 flex flex-col bg-neutral-900">
              <div class="h-8 border-b border-neutral-800 flex items-center px-3 bg-neutral-900/80">
                <span class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Chat</span>
              </div>
              <div class="flex-1 p-3 space-y-4 overflow-y-auto">
                 <div class="flex gap-3">
                    <div class="w-6 h-6 rounded bg-purple-600 flex items-center justify-center text-[10px] shrink-0">AI</div>
                    <div class="text-sm text-gray-300">How can I help you understand this session?</div>
                 </div>
              </div>
              <div class="p-3 border-t border-neutral-800">
                 <div class="bg-neutral-800 rounded p-2 flex gap-2 border border-neutral-700 focus-within:border-neutral-500 transition-colors">
                    <input type="text" placeholder="Ask about this traffic..." class="bg-transparent border-none outline-none text-sm text-white w-full placeholder-neutral-500"/>
                    <button class="text-neutral-400 hover:text-white">
                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                 </div>
              </div>
           </div>
        </aside>

      </main>

      <!-- 5. Evidence Panel (Bottom) -->
      <footer class="h-48 border-t border-neutral-800 bg-neutral-950 flex flex-col shrink-0">
          <div class="h-8 border-b border-neutral-800 flex items-center px-3 bg-neutral-900/50 justify-between">
            <span class="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Packet Evidence</span>
            <div class="flex gap-2 text-[10px] text-neutral-500 font-mono">
               <span>Selected: Pkt #1042</span>
               <span>Offset: 0x0042</span>
            </div>
          </div>
          <div class="flex-1 overflow-auto font-mono text-xs p-2 text-neutral-400">
             <div class="grid grid-cols-[60px_100px_1fr] gap-x-4 border-b border-neutral-800/50 pb-1 mb-1 text-neutral-600">
                <div>#</div>
                <div>Time</div>
                <div>Info</div>
             </div>
             <div class="grid grid-cols-[60px_100px_1fr] gap-x-4 hover:bg-neutral-800/50 cursor-pointer text-neutral-500">
                <div>1</div>
                <div>0.000000</div>
                <div>Standard query 0x421a A google.com</div>
             </div>
             <div class="grid grid-cols-[60px_100px_1fr] gap-x-4 bg-blue-900/20 text-blue-200 cursor-pointer">
                <div>2</div>
                <div>0.045120</div>
                <div>Standard query response 0x421a A google.com A 142.250.1.100</div>
             </div>
              <div class="grid grid-cols-[60px_100px_1fr] gap-x-4 hover:bg-neutral-800/50 cursor-pointer text-neutral-500">
                <div>3</div>
                <div>0.045200</div>
                <div>Subsequent packet data...</div>
             </div>
          </div>
      </footer>

    </div>
  `;
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
