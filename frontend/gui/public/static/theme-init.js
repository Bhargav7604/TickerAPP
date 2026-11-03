// Applies a saved dark-mode choice before the app loads, so the page never flashes light first.
// Kept as a file (not inline) because the Content-Security-Policy only allows scripts from this site.
try {
  if (localStorage.getItem("index-tool-theme-v1") === "dark") {
    document.documentElement.dataset.theme = "dark";
    document.querySelector('meta[name="theme-color"]').setAttribute("content", "#0a0f1a");
  }
} catch (error) { /* Storage blocked: keep the light default. */ }
