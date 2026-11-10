// app.js – placeholder for frontend logic

// Example: fetch health check from backend
async function checkHealth() {
  try {
    const response = await fetch('http://localhost:8000/health');
    const data = await response.json();
    console.log('Backend health:', data);
  } catch (err) {
    console.error('Failed to reach backend:', err);
  }
}

// Run on page load
window.addEventListener('DOMContentLoaded', () => {
  checkHealth();
  // Further UI initialization will go here.
});
