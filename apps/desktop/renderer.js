// Renderer process script
window.addEventListener('DOMContentLoaded', () => {
  // Display platform information
  const platformElement = document.getElementById('platform');
  if (platformElement && window.electronAPI) {
    platformElement.textContent = `Platform: ${window.electronAPI.platform}`;
  }

  // Add button interaction
  const actionBtn = document.getElementById('actionBtn');
  if (actionBtn) {
    actionBtn.addEventListener('click', () => {
      actionBtn.textContent = '🚀 Ready to build!';
      setTimeout(() => {
        actionBtn.textContent = 'Get Started';
      }, 2000);
    });
  }
});
