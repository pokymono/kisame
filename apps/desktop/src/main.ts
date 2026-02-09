import './index.css';

// Initialize the app
function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = `<h1>Hello World</h1>`;
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
