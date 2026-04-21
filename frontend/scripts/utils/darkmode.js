// Apply dark mode immediately on load to avoid flash
if (localStorage.getItem('darkMode') === 'true') {
  document.body.classList.add('dark');
}
