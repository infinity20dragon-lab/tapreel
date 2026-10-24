/**
 * Injected into every page the recorder drives. Draws what a viewer needs to follow a phone screen:
 *  - a ripple wherever a finger touches,
 *  - a blue ring with a numbered label around the element being talked about,
 *  - a small card for things that are not on the screen (the Add to Home Screen steps, the three rules).
 * Everything is fixed-position and pointer-events:none, so it never changes what the app does.
 */
/** masks: [{ from: 'regex source', to: 'text' }] swaps real account names on screen for sample ones. */
export const overlayScript = ({ accent = '${accent}', masks = [] } = {}) => `(() => {
  if (window.__v) return
  const css = document.createElement('style')
  css.textContent = \`
    .__rip{position:fixed;z-index:2147483646;width:68px;height:68px;margin:-34px 0 0 -34px;border-radius:50%;border:4px solid ${accent};background:${accent}47;pointer-events:none;animation:__rip .65s ease-out forwards}
    @keyframes __rip{0%{transform:scale(.35);opacity:.95}100%{transform:scale(1.35);opacity:0}}
    .__ring{position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #1d4ed8;border-radius:14px;box-shadow:0 0 0 4px rgba(29,78,216,.22),0 8px 24px rgba(15,23,42,.25);opacity:0;transition:opacity .25s}
    .__chip{position:fixed;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:8px;background:#0f172a;color:#fff;font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:8px 13px;border-radius:999px;box-shadow:0 6px 18px rgba(15,23,42,.35);opacity:0;transform:translateY(5px);transition:opacity .25s,transform .25s;max-width:350px}
    .__chip b{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;margin-left:-5px;border-radius:50%;background:#f59e0b;color:#0f172a;font-weight:800;font-size:14px}
    .__card{position:fixed;z-index:2147483647;left:18px;right:18px;pointer-events:none;background:#fff;color:#0f172a;border-radius:20px;box-shadow:0 18px 50px rgba(15,23,42,.38);padding:18px 18px 8px;font:500 17px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;transform:translateY(10px);transition:opacity .3s,transform .3s}
    .__card h3{margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${accent};font-weight:800}
    .__card .row{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-top:1px solid #e2e8f0;transition:opacity .3s}
    .__card .row:first-of-type{border-top:0}
    .__card .n{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${accent};color:#fff;font-weight:800;font-size:15px}
  \`
  // Init scripts run before the page has an <html> element, so the stylesheet is attached on first use.
  const ensureCss = () => { if (!css.isConnected) (document.head || document.documentElement).appendChild(css) }
  const live = new Set()
  const place = (el, parent) => { parent.appendChild(el); live.add(el); return el }
  const drop = (el) => { el.style.opacity = '0'; setTimeout(() => { el.remove(); live.delete(el) }, 350) }
  window.__v = {
    ripple(x, y) {
      ensureCss()
      const e = document.createElement('div')
      e.className = '__rip'
      e.style.left = x + 'px'
      e.style.top = y + 'px'
      document.body.appendChild(e)
      setTimeout(() => e.remove(), 700)
    },
    ring(box, label, ms, num) {
      ensureCss()
      const pad = 6
      const r = place(document.createElement('div'), document.body)
      r.className = '__ring'
      Object.assign(r.style, { left: box.x - pad + 'px', top: box.y - pad + 'px', width: box.width + pad * 2 + 'px', height: box.height + pad * 2 + 'px' })
      const c = place(document.createElement('div'), document.body)
      c.className = '__chip'
      c.innerHTML = (num ? '<b>' + num + '</b>' : '') + '<span></span>'
      c.querySelector('span').textContent = label
      const vw = document.documentElement.clientWidth
      const w = c.offsetWidth
      const above = box.y > 70
      c.style.top = (above ? box.y - pad - 44 : box.y + box.height + pad + 10) + 'px'
      c.style.left = Math.max(10, Math.min(vw - w - 10, box.x + box.width / 2 - w / 2)) + 'px'
      requestAnimationFrame(() => { r.style.opacity = '1'; c.style.opacity = '1'; c.style.transform = 'none' })
      setTimeout(() => { drop(r); drop(c) }, ms)
    },
    card(title, items, y) {
      ensureCss()
      const card = place(document.createElement('div'), document.body)
      card.className = '__card'
      card.style.top = (y ?? 120) + 'px'
      card.innerHTML = '<h3></h3>' + items.map((t, i) => '<div class="row"><span class="n">' + (i + 1) + '</span><span class="t"></span></div>').join('')
      card.querySelector('h3').textContent = title
      card.querySelectorAll('.t').forEach((el, i) => { el.textContent = items[i] })
      card.id = '__card'
      requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = 'none' })
    },
    /** Dim every row except the ones up to and including i. */
    reveal(i) {
      document.querySelectorAll('#__card .row').forEach((row, k) => { row.style.opacity = k <= i ? '1' : '.28' })
    },
    cardOff() {
      const c = document.getElementById('__card')
      if (c) drop(c)
    },
    clear() { live.forEach(drop) },
  }
  // The recording uses a demo account. On screen its name is swapped for a sample one.
  const SWAPS = ${JSON.stringify(masks)}.map((m) => [new RegExp(m.from, 'g'), m.to])
  const scrub = () => {
    const w = document.createTreeWalker(document, NodeFilter.SHOW_TEXT)
    let n
    while ((n = w.nextNode())) {
      let t = n.nodeValue
      for (const [re, to] of SWAPS) t = t.replace(re, to)
      if (t !== n.nodeValue) n.nodeValue = t
    }
  }
  new MutationObserver(scrub).observe(document, { childList: true, subtree: true, characterData: true })
  document.addEventListener('pointerdown', (e) => window.__v.ripple(e.clientX, e.clientY), true)
})()`
