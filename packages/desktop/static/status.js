// The desktop app's own page while the server starts or after it failed. Everything shown comes from the
// query string and is set as text.
const q = new URLSearchParams(location.search);
document.documentElement.lang = q.get("lang") || "en";
for (const id of ["title", "text", "detail"]) {
  const el = document.getElementById(id);
  const value = q.get(id) || "";
  el.textContent = value;
  if (id === "detail") el.hidden = !value;
}
document.title = q.get("title") || "BukitJalil";
const restart = document.getElementById("restart");
if (q.get("restart")) {
  restart.textContent = q.get("restart");
  restart.hidden = false;
  restart.addEventListener("click", () => {
    restart.disabled = true;
    window.bukitjalil.restart();
  });
}
