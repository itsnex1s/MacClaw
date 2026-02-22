import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

document.body.addEventListener("click", () => invoke("notch_clicked"));

listen("notch-state", (e) => {
  const el = document.getElementById("indicator");
  const previewEl = document.getElementById("preview");
  if (!el) return;

  const payload = e.payload as { state: string; preview?: string };
  el.className = "notch-wrap indicator--" + payload.state;

  if (previewEl) {
    if (payload.state === "ready" && payload.preview) {
      // Strip markdown and take first line.
      const clean = payload.preview
        .replace(/[#*_`~>\[\]()!]/g, "")
        .trim();
      const firstLine = clean.split("\n").find((l) => l.trim().length > 0) ?? clean;
      previewEl.textContent = firstLine.slice(0, 80);
      previewEl.style.display = "block";
    } else {
      previewEl.textContent = "";
      previewEl.style.display = "none";
    }
  }
});
