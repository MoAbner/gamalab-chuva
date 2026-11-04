/* Apply the saved preference before paint; follow the system until chosen. */
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem('gama_theme'); } catch (_) {}
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#10151d' : '#efede7');
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.textContent = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }
  apply(preference === 'light' || preference === 'dark' ? preference : system.matches ? 'dark' : 'light');
  system.addEventListener('change', () => { if (!preference) apply(system.matches ? 'dark' : 'light'); });
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('gama_theme', preference); } catch (_) {}
      apply(preference);
    });
  });
})();

