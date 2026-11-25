#!/usr/bin/env python3
"""tides.alola.lol (2026-11-24): Alola CSS look for Coast Watch: the alola.lol theme palettes (shared
`alola-theme` cookie, default white), a theme picker, the VT323 / Share Tech Mono fonts and square corners.
One-shot: stops if already applied."""
import sys

PALETTES = '''{
        alola: ["#0a0014", "#120025", "#1a0033", "#3a1a5a", "#d4c8ff", "#9a8abb", "#ffcc00", "#00ff88"],
        white: ["#ffffff", "#f5f5f5", "#ececec", "#d4d4d4", "#0a0a0a", "#555555", "#e11d48", "#111111"],
        red: ["#1a0004", "#2a0008", "#3a0010", "#7a2030", "#ffe0e4", "#cc9999", "#ff2a44", "#ff7a66"],
        black: ["#000000", "#0a0a0a", "#161616", "#2e2e2e", "#f5f5f5", "#888888", "#ff2a44", "#e5e5e5"],
        dark: ["#0a0a0a", "#111111", "#1a1a1a", "#2a2a2a", "#e0e0e0", "#666666", "#888888", "#00ff00"],
        light: ["#fafafa", "#f0f0f4", "#e6e6ea", "#d4d4da", "#1a1a1e", "#6b7280", "#4f46e5", "#16a34a"],
        sepia: ["#fdf6e3", "#f5e6c8", "#efe0b8", "#d8c8a0", "#433422", "#7a6a5a", "#b58900", "#589500"],
        cyberpunk: ["#0a0020", "#120030", "#1a0045", "#6633cc", "#f0e0ff", "#8877bb", "#ff00ff", "#00ffaa"],
        ocean: ["#0a1628", "#0f1f3a", "#152a4a", "#1e3a5f", "#e0f0ff", "#6080b0", "#4fc3ff", "#4caf88"],
        dracula: ["#282a36", "#1e1f2b", "#21222c", "#44475a", "#f8f8f2", "#6272a4", "#bd93f9", "#50fa7b"],
        gruvbox: ["#282828", "#1d2021", "#32302f", "#504945", "#ebdbb2", "#928374", "#fabd2f", "#b8bb26"],
        tokyo: ["#1a1b26", "#16161e", "#1f2335", "#363b54", "#c0d0ff", "#565f89", "#7aa2f7", "#9ece6a"],
        matrix: ["#000000", "#001100", "#002200", "#003300", "#00ff00", "#006600", "#00ff00", "#00ff00"],
        solarized: ["#002b36", "#073642", "#093b46", "#1a5a6a", "#d0d0a0", "#586e75", "#b58900", "#859900"],
        pastel: ["#1a1a2e", "#16213e", "#1f2a47", "#3a4a6a", "#f0e0ff", "#a0a0c0", "#ff88cc", "#88dd88"],
        catppuccin: ["#1e1e2e", "#181825", "#232340", "#45475a", "#cdd6f4", "#6c7086", "#89b4fa", "#a6e3a1"]
      }'''


def rw(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        if s.count(old) != 1:
            sys.exit(f'STOP {path}: {s.count(old)}x {old[:80]!r}')
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('ok', path)


if 'ALOLA_THEMES' in open('site/index.html', encoding='utf-8').read():
    sys.exit('already applied')

rw('scripts/build-site.mjs', [
    ('await cp(join(site, "_headers"), join(out, "_headers"));',
     'await cp(join(site, "_headers"), join(out, "_headers"));\n'
     'await cp(join(site, "fonts"), join(out, "fonts"), { recursive: true }); // Alola CSS fonts (VT323, Share Tech Mono; OFL)'),
])

HEAD_OLD = '''  <script>
    // Light by default (her rule). Dark only if picked here, or a dark theme was picked on alola.lol.
    (function () {
      var t = null;
      try { t = localStorage.getItem("tides-theme"); } catch (e) {}
      if (t !== "light" && t !== "dark") {
        var m = document.cookie.match(/(?:^|; )alola-theme=([^;]+)/), c = m && m[1];
        t = !c || c === "white" || c === "light" || c === "sepia" ? "light" : "dark";
      }
      document.documentElement.setAttribute("data-theme", t);
    })();
  </script>
'''
HEAD_NEW = '''  <script>
    // Alola CSS themes (the same palettes as alola.lol, EMON and TIDO). The theme is the `alola-theme` cookie that
    // every *.alola.lol site shares (or ?alola=<name> to try one); no cookie = "white". Set before first paint.
    (function () {
      var P = ''' + PALETTES + ''';
      window.ALOLA_THEMES = P;
      var q = (location.search.match(/[?&]alola=([a-z]+)/) || [])[1];
      var m = document.cookie.match(/(?:^|; )alola-theme=([^;]+)/), c = m && decodeURIComponent(m[1]);
      var name = P[q] ? q : P[c] ? c : "white";
      var v = P[name];
      var hex = function (h) { h = h.replace("#", ""); return h.length === 3 ? h.replace(/(.)/g, "$1$1") : h; };
      var lum = function (h) { var n = parseInt(hex(h), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
      var light = lum(v[0]) > 0.5;
      var r = document.documentElement;
      r.setAttribute("data-theme", light ? "light" : "dark");
      r.setAttribute("data-alola", name);
      var s = r.style;
      s.setProperty("--bg", v[0]); s.setProperty("--bg2", v[1]); s.setProperty("--surface", v[2]);
      s.setProperty("--border", v[3]); s.setProperty("--glass-border", v[3]);
      s.setProperty("--glass", "#" + hex(v[1]) + "f2");
      s.setProperty("--text", v[4]); s.setProperty("--text2", v[4]); s.setProperty("--muted", v[5]); s.setProperty("--faint", v[5]);
      s.setProperty("--accent", v[6]); s.setProperty("--green", v[7]);
      s.setProperty("--tint", light ? "0, 0, 0" : "255, 255, 255");
    })();
  </script>
'''
rw('site/index.html', [
    (HEAD_OLD, HEAD_NEW),
    ('''    <button id="theme" class="icon-btn" aria-label="Light or dark">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>
    </button>
''', '''    <label class="theme-pick" title="Theme (shared with alola.lol, EMON and TIDO)"><span class="sr-only">Theme</span><select id="theme" aria-label="Theme"></select></label>
'''),
])

rw('site/js/app.js', [
    ('''$("#theme").addEventListener("click", () => { store.set("tides-theme", THEME === "light" ? "dark" : "light"); location.reload(); });
$("#theme").title = THEME === "light" ? "Switch to dark" : "Switch to light";''',
     '''// Theme picker: Alola CSS palettes. Writes the shared `alola-theme` cookie (across *.alola.lol when hosted there),
// so alola.lol, EMON, TIDO and this page all change together.
{
  const sel = $("#theme");
  const now = document.documentElement.dataset.alola || "white";
  sel.innerHTML = Object.keys(window.ALOLA_THEMES || { white: 1 }).map((n) => `<option value="${n}"${n === now ? " selected" : ""}>${n}</option>`).join("");
  sel.addEventListener("change", () => {
    const dom = /(^|\\.)alola\\.lol$/.test(location.hostname) ? ";domain=.alola.lol" : "";
    document.cookie = `alola-theme=${encodeURIComponent(sel.value)}${dom};path=/;max-age=31536000;SameSite=Lax`;
    const q = new URLSearchParams(location.search);
    q.delete("alola");
    location.href = location.pathname + (q.toString() ? `?${q}` : "") + location.hash;
  });
}'''),
])

CSS_ADD = '''
/* ---------- Alola CSS look (2026-11-24): fonts, square corners, flat panels; colours come from the theme ---------- */
@font-face { font-family: "VT323"; src: url("/fonts/VT323.woff2") format("woff2"); font-display: swap; }
@font-face { font-family: "Share Tech Mono"; src: url("/fonts/ShareTechMono.woff2") format("woff2"); font-display: swap; }
:root, :root[data-theme="dark"] {
  --font: "Share Tech Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --display: "VT323", "Share Tech Mono", monospace;
  --radius: 4px;
}
html, body { letter-spacing: 0.01em; }
.glass { backdrop-filter: none; -webkit-backdrop-filter: none; border: 1px solid var(--glass-border); box-shadow: 0 2px 8px var(--shadow); }
.brand h1 { font: 400 26px/1 var(--display); letter-spacing: 0.04em; text-transform: uppercase; color: var(--accent); }
.panel-head h2, #timeline .tl-label, .d-section h3 { font-family: var(--display); font-size: 17px; letter-spacing: 0.08em; font-weight: 400; }
.stat-value, .signal .v { font-family: var(--display); font-size: 26px; font-weight: 400; letter-spacing: 0.02em; }
.signal .v { font-size: 21px; }
.d-title { font-family: var(--display); font-size: 24px; font-weight: 400; letter-spacing: 0.03em; }
.layer, .signal, .d-list li, .fc, .flood-lines li, .chip, #timeline button, .icon-btn, .region-pick select, .flood-pick select, .theme-pick select { border-radius: 3px; }
#timeline button { font-family: var(--display); font-size: 18px; font-weight: 400; letter-spacing: 0.06em; padding: 2px 12px; }
#timeline button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.layer-title { font-weight: 400; }
.theme-pick select {
  font: 12px/1.2 var(--font); color: var(--text); background: var(--surface, rgba(var(--tint), 0.05));
  border: 1px solid var(--glass-border); padding: 4px; max-width: 96px;
}
.region-pick select { font-family: var(--font); color: var(--accent); background: var(--surface, rgba(var(--tint), 0.05)); }
a, #news-list li a { color: var(--accent); }
.swatch { border-radius: 2px; }
'''
s = open('site/css/style.css', encoding='utf-8').read()
if 'Alola CSS look' in s:
    sys.exit('css already has it')
open('site/css/style.css', 'a', encoding='utf-8').write(CSS_ADD)
print('ok css')
