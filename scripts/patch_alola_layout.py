#!/usr/bin/env python3
"""Coast Watch (2026-11-25): the real Alola CSS (v1.2) look, matching EMON: a full-width top bar with a 2px accent
line, panels docked square to the screen edges with uppercase VT323 accent headings, alola.css switches and buttons,
and the css.alola.lol colour-swatch theme row instead of a dropdown. One-shot: stops if already applied."""
import sys


def rw(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        if s.count(old) != 1:
            sys.exit(f'STOP {path}: {s.count(old)}x {old[:80]!r}')
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('ok', path)


if 'alola-swatch' in open('site/js/app.js', encoding='utf-8').read():
    sys.exit('already applied')

rw('site/index.html', [
    ('''        <label class="theme-pick" title="Theme (shared with alola.lol, EMON and TIDO)"><span class="sr-only">Theme</span><select id="theme" aria-label="Theme"></select></label>
''', ''),
    ('''    <button id="refresh" class="icon-btn" title="Refresh data" aria-label="Refresh data">''',
     '''    <div id="theme" class="theme-swatches" role="group" aria-label="Theme (shared with alola.lol, EMON and TIDO)"></div>
    <button id="refresh" class="icon-btn" title="Refresh data" aria-label="Refresh data">'''),
])

rw('site/js/app.js', [
    ('''{
  const sel = $("#theme");
  const now = document.documentElement.dataset.alola || "white";
  sel.innerHTML = Object.keys(window.ALOLA_THEMES || { white: 1 }).map((n) => `<option value="${n}"${n === now ? " selected" : ""}>${n}</option>`).join("");
  sel.addEventListener("change", () => {
    const dom = /(^|\\.)alola\\.lol$/.test(location.hostname) ? ";domain=.alola.lol" : "";
    document.cookie = `alola-theme=${encodeURIComponent(sel.value)}${dom};path=/;max-age=31536000;SameSite=Lax`;''',
     '''// Shown as the css.alola.lol colour swatches: each square is the theme's background with its accent along the bottom.
{
  const box = $("#theme");
  const now = document.documentElement.dataset.alola || "white";
  const P = window.ALOLA_THEMES || {};
  box.innerHTML = Object.keys(P).map((n) => `<button type="button" class="alola-swatch" data-name="${n}" title="${n}" aria-label="Theme: ${n}" aria-pressed="${n === now}" style="--sw-bg:${P[n][0]};--sw-accent:${P[n][6]}"></button>`).join("");
  box.addEventListener("click", (e) => {
    const b = e.target.closest(".alola-swatch");
    if (!b || b.dataset.name === now) return;
    const dom = /(^|\\.)alola\\.lol$/.test(location.hostname) ? ";domain=.alola.lol" : "";
    document.cookie = `alola-theme=${encodeURIComponent(b.dataset.name)}${dom};path=/;max-age=31536000;SameSite=Lax`;'''),
    ('''function placeLayers() {
  const below = Math.ceil($(".brand").getBoundingClientRect().bottom);
  const wide = window.innerWidth > 820;
  $("#layers").style.top = wide ? `${below + 12}px` : "";
  $("#right").style.top = wide ? "" : `${below + 8}px`; // phones: the details sheet starts under the header
}''',
     '''function placeLayers() {
  // The top bar can wrap onto two lines; everything below it is placed from its real height (--bar-h).
  const below = Math.ceil($(".brand").getBoundingClientRect().bottom);
  const wide = window.innerWidth > 820;
  document.documentElement.style.setProperty("--bar-h", `${below}px`);
  $("#layers").style.top = "";
  $("#right").style.top = wide ? "" : `${below}px`; // phones: the details sheet starts under the bar
  try { map.resize(); } catch {}
}'''),
])

css = open('site/css/style.css', encoding='utf-8').read()
old_switch = ':root:not([data-theme="dark"]) .switch input:not(:checked) + span { background: #c9d0da; }\n'
if css.count(old_switch) != 1:
    sys.exit('STOP css switch line')
css = css.replace(old_switch, '')
css = css.replace('.region-pick select { max-width: 170px; }\n.theme-pick select { max-width: 104px; }\n', '.region-pick select { max-width: 170px; }\n')
css += '''
/* ---------- Alola CSS v1.2 layout (2026-11-25): the EMON look ----------
   Full-width top bar with a 2px accent line, panels docked square to the screen edges, uppercase VT323 accent
   headings, alola.css switches / buttons, and the css.alola.lol swatch row for themes. Colours all come from the
   theme (--bg, --bg2, --surface, --border, --text, --muted, --accent). */
:root { --bar-h: 56px; --left-w: 300px; --right-w: 360px; }
@media (max-width: 1180px) { :root { --left-w: 264px; --right-w: 320px; } }
.glass { background: var(--bg2); border: 1px solid var(--border); border-radius: 0; box-shadow: none; }

/* top bar */
.brand {
  top: 0; left: 0; right: 0; width: auto; z-index: 4;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 7px 16px;
  background: var(--surface); border: 0; border-bottom: 2px solid var(--accent);
}
.brand > div:nth-child(2) { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 16px; flex: 1; min-width: 0; }
.brand h1 { font: 400 27px/1 var(--display); letter-spacing: 3px; text-transform: uppercase; color: var(--accent); }
.brand-mark svg { width: 26px; height: 26px; }
.brand .picks { margin: 0; }
.brand .sub { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
.region-pick select {
  border-radius: 0; background: var(--bg2); color: var(--text); border: 1px solid var(--border);
  font: 12px/1.2 var(--font); letter-spacing: 1px; text-transform: uppercase; padding: 4px 8px; margin: 0;
}
.region-pick select:hover, .region-pick select:focus { border-color: var(--accent); }
.theme-swatches { display: flex; flex-wrap: wrap; gap: 4px; }
.alola-swatch {
  width: 18px; height: 18px; padding: 0; cursor: pointer; border: 1px solid var(--border); border-radius: 3px;
  background: linear-gradient(to top, var(--sw-accent) 0 4px, var(--sw-bg) 4px);
}
.alola-swatch:hover { border-color: var(--accent); }
.alola-swatch[aria-pressed="true"] { outline: 2px solid var(--text); outline-offset: 1px; }
.icon-btn { border-radius: 0; background: transparent; border: 1px solid var(--border); color: var(--text); }
.icon-btn:hover { background: transparent; border-color: var(--accent); color: var(--accent); }

/* panels */
.panel { padding: 0 12px 12px; }
.panel-head { margin: 0 -12px 10px; padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border); }
.panel-head h2 { font: 400 18px/1.1 var(--display); letter-spacing: 2px; text-transform: uppercase; color: var(--accent); }
.hint { font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; }
#detail { padding: 12px; }
#detail .close { top: 8px; right: 8px; }
.credit { margin: 10px 0 0; }

/* layer list */
#layer-list { gap: 4px; }
.layer { border-radius: 0; background: var(--bg); border: 1px solid var(--border); }
.layer:hover { background: var(--bg); border-color: var(--accent); }
.layer.drop-before { border-top: 2px solid var(--accent); }
.layer.drop-after { border-bottom: 2px solid var(--accent); }
.layer-title { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; }
.layer-meta { font-size: 10.5px; }
.swatch, .legend-item i, .legend-ramp { border-radius: 0; }

/* alola.css switch */
.switch { width: 38px; height: 20px; }
.switch span { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
.switch span::after { top: 2px; left: 2px; width: 14px; height: 14px; background: var(--muted); }
.switch input:checked + span { background: color-mix(in srgb, var(--accent) 25%, var(--surface)); border-color: var(--accent); }
.switch input:checked + span::after { transform: translateX(18px); background: var(--accent); }

/* stats, chips, lists */
.stat-label, .signal .k, .d-kicker { font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
.signal, .d-list li, .fc, .flood-lines li { border-radius: 0; background: var(--bg); border: 1px solid var(--border); }
.flood-lines li { border-left-width: 3px; }
.chip { border-radius: 0; font-size: 11px; font-weight: 400; letter-spacing: 1px; text-transform: uppercase; border: 1px solid currentColor; background: transparent; }
.chip.neutral { border-color: var(--border); }
.d-section h3 { color: var(--accent); letter-spacing: 2px; text-transform: uppercase; }
.flood-pick select { border-radius: 0; background: var(--bg); border: 1px solid var(--border); }

/* timeline: an alola button group */
#timeline { padding: 4px; gap: 0; }
#timeline .tl-label { color: var(--accent); letter-spacing: 2px; padding: 0 10px 0 6px; }
#timeline button { border-radius: 0; border: 1px solid var(--border); margin-left: -1px; color: var(--text); letter-spacing: 2px; }
#timeline button:hover { background: transparent; border-color: var(--accent); color: var(--accent); position: relative; }
#timeline button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--bg); position: relative; }

/* map furniture */
.maplibregl-ctrl-group { border-radius: 0 !important; background: var(--bg2) !important; border-color: var(--border); }
.maplibregl-ctrl-attrib { background: var(--bg2) !important; }
.maplibregl-popup-content { border-radius: 0; background: var(--bg2); border-color: var(--border); box-shadow: none; backdrop-filter: none; }

/* desktop: docked like EMON (map between the two columns, nothing floating over it but the timeline) */
@media (min-width: 821px) {
  #map { top: var(--bar-h); left: var(--left-w); right: var(--right-w); bottom: 0; }
  #layers { top: var(--bar-h); left: 0; bottom: 0; width: var(--left-w); max-height: none; border-width: 0 1px 0 0; }
  #right { top: var(--bar-h); right: 0; bottom: 0; width: var(--right-w); gap: 0; background: var(--bg2); border-left: 1px solid var(--border); overflow: auto; }
  #right > .panel { border-width: 0 0 1px 0; }
  #news { max-height: none; flex: 1 1 auto; }
  .maplibregl-ctrl-bottom-right { right: 0; bottom: 0; }
  #timeline { left: calc(var(--left-w) + (100vw - var(--left-w) - var(--right-w)) / 2); bottom: 30px; }
}

/* phones: bar on top, details under it, layers as a bottom sheet, all flush to the edges */
@media (max-width: 820px) {
  .brand { top: 0; left: 0; right: 0; padding: 6px 10px; gap: 8px; }
  .brand h1 { font-size: 24px; letter-spacing: 2px; }
  .brand-mark { display: none; }
  .alola-swatch { width: 17px; height: 17px; }
  #layers { left: 0; right: 0; bottom: 0; border-width: 1px 0 0; }
  #right { left: 0; right: 0; }
  #right > .panel { border-width: 0 0 1px 0; }
  #timeline { left: 8px; bottom: calc(30vh + 10px); }
}
'''
open('site/css/style.css', 'w', encoding='utf-8').write(css)
print('ok css')
