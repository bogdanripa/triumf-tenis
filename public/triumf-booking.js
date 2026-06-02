/*
 * Triumf Tenis - booking widget
 * --------------------------------
 * Replaces the static "Disponibilitate Terenuri" card on triumf-tenis.ro with
 * a live one (data from /api/schedule) and lets visitors book (via /api/reserve).
 * The table markup reuses the site's own Tailwind classes so it looks identical;
 * only the booking modal is self-styled (it has no equivalent in the original).
 *
 * Embed (after the app's own scripts):
 *   <script src="https://triumf-tenis.vercel.app/triumf-booking.js" defer></script>
 *
 * Optional <script> attributes:
 *   data-card="#selector"   element to replace (default: the "Disponibilitate
 *                           Terenuri" .glass-card found by heading text)
 *   data-api="https://..."  API origin (default: the script's own origin)
 */
(function () {
  'use strict';

  var CURRENT = document.currentScript;
  var API = (CURRENT && CURRENT.dataset.api) ||
    (CURRENT && CURRENT.src ? new URL(CURRENT.src).origin : 'https://triumf-tenis.vercel.app');
  var CARD_SEL = CURRENT && CURRENT.dataset.card;
  var HEADING = 'Disponibilitate Terenuri';

  var RO_DAYS = { LUNI: 'luni', MARTI: 'marți', MIERCURI: 'miercuri', JOI: 'joi', VINERI: 'vineri', SAMBATA: 'sâmbătă', DUMINICA: 'duminică' };
  var RO_MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
  var DURATIONS = [ { value: 60, label: '1 oră' }, { value: 90, label: '1 oră 30 min' }, { value: 120, label: '2 ore' } ];

  var GRID_COLS = 'grid-template-columns: 80px repeat(2, 1fr);';
  var CAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-days w-5 h-5 text-violet-300"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path></svg>';
  var CHEV_L = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-left w-4 h-4"><path d="m15 18-6-6 6-6"></path></svg>';
  var CHEV_R = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right w-4 h-4"><path d="m9 18 6-6-6-6"></path></svg>';

  // status: 'loading' | 'ready' | 'error'
  var state = { days: [], idx: 0, status: 'loading' };

  function pad(n) { return String(n).padStart(2, '0'); }
  function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
  }

  // Romanian or international: only digits and separators (+, spaces, -, (), .),
  // no letters, and at least 10 digits overall.
  function validPhone(v) {
    v = (v || '').trim();
    if (!/^\+?[0-9\s().\-]+$/.test(v)) return false;
    return v.replace(/\D/g, '').length >= 10;
  }

  function translateError(msg) {
    if (!msg) return 'A apărut o eroare. Încearcă din nou.';
    if (/already booked/i.test(msg)) return 'Acest interval este deja rezervat.';
    if (/No matching time slot/i.test(msg)) return 'Nu există un interval liber care să corespundă orei și duratei alese.';
    if (/No schedule found/i.test(msg)) return 'Programul pentru această zi nu este disponibil.';
    if (/30-minute boundary/i.test(msg)) return 'Rezervările încep la oră fixă sau la și jumătate.';
    if (/30-minute increments/i.test(msg)) return 'Durata trebuie să fie multiplu de 30 de minute.';
    if (/Invalid|Missing/i.test(msg)) return 'Date invalide. Verifică informațiile introduse.';
    return msg;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'style') node.style.cssText = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function ensureStyles() {
    if (document.getElementById('ttb-modal-style')) return;
    var s = document.createElement('style');
    s.id = 'ttb-modal-style';
    s.textContent =
      '@keyframes ttb-spin{to{transform:rotate(360deg)}}' +
      '.ttb-spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,.18);border-top-color:#a78bfa;border-radius:50%;animation:ttb-spin .8s linear infinite}';
    document.head.appendChild(s);
  }

  function fmt(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

  // Map of slot-start-minute -> { c1, c2 } booked flags.
  function slotMap(day) {
    var m = {};
    (day.slots || []).forEach(function (s) { m[s.time] = { c1: s.court1 === 'booked', c2: s.court2 === 'booked' }; });
    return m;
  }
  // Distinct hours that have any slot.
  function hoursOf(day) {
    var set = {};
    (day.slots || []).forEach(function (s) { set[Math.floor(s.time / 60)] = 1; });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  function dateLabel(day) {
    var p = (day.date || '').split('-');
    var roDay = RO_DAYS[day.dayOfWeek] || titleCase(day.dayOfWeek || '');
    if (p.length === 3) return roDay + ', ' + Number(p[2]) + ' ' + RO_MONTHS[Number(p[1]) - 1];
    return roDay;
  }

  function isPast(day, minutes) {
    if (day.dayIdx !== 0) return false;
    var now = new Date();
    return minutes < now.getHours() * 60 + now.getMinutes();
  }

  function headerHtml(dateText, prevDisabled, nextDisabled) {
    return '<div class="flex items-center justify-between gap-2 flex-wrap mb-5">' +
      '<h3 class="text-lg sm:text-xl font-bold flex items-center gap-2">' + CAL_SVG + HEADING + '</h3>' +
      '<div class="flex items-center gap-1.5">' +
        '<button data-ttb-prev ' + (prevDisabled ? 'disabled' : '') + ' class="w-9 h-9 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors">' + CHEV_L + '</button>' +
        '<div class="px-3 sm:px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs sm:text-sm font-bold uppercase tracking-wider min-w-[170px] sm:min-w-[220px] text-center text-foreground">' + dateText + '</div>' +
        '<button data-ttb-next ' + (nextDisabled ? 'disabled' : '') + ' class="w-9 h-9 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors">' + CHEV_R + '</button>' +
      '</div>' +
    '</div>';
  }

  function legendHtml() {
    return '<div class="flex items-center gap-4 text-xs text-muted-foreground mb-3 flex-wrap">' +
      '<span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-emerald-400/70 border border-emerald-300/60"></span> Liber</span>' +
      '<span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-rose-400/60 border border-rose-300/60"></span> Ocupat</span>' +
      '<span class="ml-auto hidden sm:inline">Apasă o casetă liberă ca să rezervi</span>' +
    '</div>';
  }

  var COURT_NAMES = { 1: 'Teren 1', 2: 'Teren 2' };
  var STATE_RO = { free: 'liber', booked: 'ocupat' };

  function halfState(day, court, minutes, map) {
    var s = map[minutes];
    if (!s) return 'none';
    if (isPast(day, minutes)) return 'past';
    return (court === 1 ? s.c1 : s.c2) ? 'booked' : 'free';
  }

  // One 30-min half. pos: 'solo' (own rounded box) | 'top' | 'bot' (merged, shared box).
  function halfEl(day, court, minutes, st, pos) {
    var round = pos === 'top' ? 'rounded-t-md border-b-0' : pos === 'bot' ? 'rounded-b-md border-t-0' : 'rounded-md';
    var base = 'h-7 flex items-center justify-center border transition-all ' + round;
    // 'past' (the elapsed half of the current hour) renders blank, like 'none'.
    if (st === 'none' || st === 'past') return '<div class="' + base + ' bg-transparent border-transparent"></div>';
    var tip = COURT_NAMES[court] + ', ' + fmt(minutes) + '-' + fmt(minutes + 30) + ', ' + STATE_RO[st];
    if (st === 'booked') return '<div title="' + tip + '" class="' + base + ' bg-rose-400/30 border-rose-300/40"></div>';
    return '<button data-ttb-free data-court="' + court + '" data-time="' + fmt(minutes) + '" title="' + tip +
      '" class="' + base + ' bg-emerald-400/30 border-emerald-300/40 hover:bg-emerald-400/50 cursor-pointer"></button>';
  }

  // A court's hour cell: one merged rounded box when both halves share a state,
  // otherwise two separated half-boxes (split look via different colors).
  function courtCellHtml(day, court, hour, map) {
    var t0 = hour * 60, t1 = hour * 60 + 30;
    var s0 = halfState(day, court, t0, map), s1 = halfState(day, court, t1, map);
    var merged = s0 === s1;
    return '<div class="flex flex-col p-1 ' + (merged ? '' : 'gap-1') + '">' +
      halfEl(day, court, t0, s0, merged ? 'top' : 'solo') +
      halfEl(day, court, t1, s1, merged ? 'bot' : 'solo') +
    '</div>';
  }

  // One row per hour: hourly label (vertically centered) + two court cells.
  function rowHtml(day, hour, map) {
    return '<div class="grid items-stretch rounded-lg bg-white/[0.02]" style="' + GRID_COLS + '">' +
      '<div class="px-3 flex items-center text-xs sm:text-sm font-medium text-foreground/80 border-r border-white/10">' + pad(hour) + '-' + pad(hour + 1) + '</div>' +
      courtCellHtml(day, 1, hour, map) + courtCellHtml(day, 2, hour, map) + '</div>';
  }

  function tableHtml(rowsHtml) {
    return '<div class="overflow-x-auto scrollbar-thin -mx-1 px-1">' +
      '<div class="min-w-[420px]">' +
        '<div class="grid mb-2" style="' + GRID_COLS + '">' +
          '<div class="px-3 py-2 text-xs font-bold uppercase tracking-wider text-foreground/90">Ora</div>' +
          '<div class="px-3 py-2 text-xs sm:text-sm font-bold text-center text-foreground/90">Teren 1</div>' +
          '<div class="px-3 py-2 text-xs sm:text-sm font-bold text-center text-foreground/90">Teren 2</div>' +
        '</div>' +
        '<div class="space-y-2">' + rowsHtml + '</div>' +
      '</div>' +
    '</div>';
  }

  // A few shimmering skeleton rows shown while data loads.
  function skeletonRows() {
    var bar = '<div class="h-4 rounded bg-white/10 animate-pulse"></div>';
    var cell = '<div class="m-1 h-10 sm:h-11 rounded-md bg-white/[0.05] animate-pulse"></div>';
    var rows = '';
    for (var i = 0; i < 6; i++) {
      rows += '<div class="grid border-b border-white/5 last:border-b-0" style="' + GRID_COLS + '">' +
        '<div class="px-3 py-2.5 border-r border-white/10 bg-white/[0.02]">' + bar + '</div>' + cell + cell + '</div>';
    }
    return rows;
  }

  function render(card) {
    card.setAttribute('data-ttb', '1');

    if (state.status === 'loading') {
      card.innerHTML = headerHtml('Se încarcă…', true, true) + legendHtml() + tableHtml(skeletonRows());
      return;
    }
    if (state.status === 'error') {
      card.innerHTML = headerHtml('—', true, true) +
        '<div class="py-10 text-center text-sm text-muted-foreground">Nu am putut încărca disponibilitatea. Reîncarcă pagina.</div>';
      return;
    }
    var day = state.days[state.idx];
    if (!day) {
      card.innerHTML = headerHtml('—', true, true) +
        '<div class="py-10 text-center text-sm text-muted-foreground">Programul nu este disponibil momentan.</div>';
      return;
    }

    var map = slotMap(day);
    // Drop hours that are entirely in the past (both halves before now).
    var hours = hoursOf(day).filter(function (h) { return !isPast(day, h * 60 + 30); });
    var rows = hours.map(function (h) { return rowHtml(day, h, map); }).join('');
    var body = rows
      ? tableHtml(rows)
      : '<div class="py-10 text-center text-sm text-muted-foreground">Nu mai sunt intervale disponibile pentru această zi.</div>';
    card.innerHTML = headerHtml(dateLabel(day), state.idx === 0, state.idx === state.days.length - 1) + legendHtml() + body;

    var prev = card.querySelector('[data-ttb-prev]');
    var next = card.querySelector('[data-ttb-next]');
    if (prev) prev.addEventListener('click', function () { if (state.idx > 0) { state.idx--; render(card); } });
    if (next) next.addEventListener('click', function () { if (state.idx < state.days.length - 1) { state.idx++; render(card); } });
    card.querySelectorAll('[data-ttb-free]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openBooking(day, btn.getAttribute('data-time'), Number(btn.getAttribute('data-court')));
      });
    });
  }

  // Our own container. We never modify React-owned nodes (that triggers
  // "removeChild ... not a child" when React later reconciles); instead we hide
  // the original mock card and render into this sibling that React doesn't track.
  var ours = null;
  function makeOurs() {
    var d = document.createElement('div');
    d.setAttribute('data-ttb-own', '1');
    d.className = 'glass-card p-4 sm:p-6';
    return d;
  }

  // Find the React-rendered mock card (never our own container).
  function findReactCard() {
    if (CARD_SEL) return document.querySelector(CARD_SEL);
    var hs = document.querySelectorAll('h1,h2,h3,h4,h5');
    for (var i = 0; i < hs.length; i++) {
      if ((hs[i].textContent || '').indexOf(HEADING) === -1) continue;
      var card = hs[i].closest('.glass-card') || hs[i].parentElement;
      if (!card || card.getAttribute('data-ttb-own') === '1') continue;
      if (ours && ours.contains(card)) continue;
      return card;
    }
    return null;
  }

  // The element we render INTO. With data-card we render straight into that
  // (presumed-empty) element; otherwise we place our own card next to the mock
  // and hide the mock. Returns null if there's nowhere to mount yet.
  function container() {
    if (CARD_SEL) return document.querySelector(CARD_SEL);
    var anchor = findReactCard();
    if (!ours) ours = makeOurs();
    if (anchor && anchor.parentNode) {
      if (ours.previousElementSibling !== anchor || ours.parentNode !== anchor.parentNode) {
        anchor.parentNode.insertBefore(ours, anchor.nextSibling);
      }
      if (anchor.style.display !== 'none') anchor.style.setProperty('display', 'none', 'important');
    }
    return ours.parentNode ? ours : null;
  }

  function mount() {
    var c = container();
    if (c) render(c);
  }

  function load() {
    fetch(API + '/api/schedule', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.days = (data && data.days) || [];
        if (state.idx >= state.days.length) state.idx = 0;
        state.status = 'ready';
        mount();
      })
      .catch(function () { state.status = 'error'; mount(); });
  }

  // ---- Booking modal (self-styled; no equivalent in the original design) ----
  function openBooking(day, startTime, court) {
    ensureStyles();
    var overlay = el('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;', onclick: function (e) { if (e.target === overlay) close(); } });
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    var INPUT = 'width:100%;padding:9px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-size:14px;font-family:inherit;';
    var LABEL = 'font-size:13px;font-weight:600;color:#cbd5e1;margin-bottom:4px;display:block;';

    var name = el('input', { type: 'text', placeholder: 'Numele tău', style: INPUT });
    var email = el('input', { type: 'email', placeholder: 'email@exemplu.ro', style: INPUT });
    var phone = el('input', { type: 'tel', placeholder: '07xx xxx xxx', style: INPUT });
    var duration = el('select', { style: INPUT }, DURATIONS.map(function (d) { return el('option', { value: d.value, text: d.label }); }));
    duration.addEventListener('change', function () { summaryEl.textContent = courtName + ' • ' + dateLabel(day) + ' • ' + rangeText(); });
    var errorBox = el('p', { style: 'color:#fca5a5;font-size:13px;margin:6px 0 0;min-height:16px;' });
    var submit = el('button', { text: 'Rezervă', style: 'flex:1;padding:11px;border-radius:8px;border:0;font-size:14px;font-weight:700;cursor:pointer;color:#fff;background:linear-gradient(to right,#7c3aed,#d946ef);' });
    var cancel = el('button', { text: 'Anulează', onclick: close, style: 'flex:1;padding:11px;border-radius:8px;border:0;font-size:14px;font-weight:600;cursor:pointer;color:#e5e7eb;background:rgba(255,255,255,.1);' });

    function field(t, input) { return el('div', { style: 'margin-bottom:12px;' }, [el('label', { text: t, style: LABEL }), input]); }

    var courtName = court === 2 ? 'Teren 2' : 'Teren 1';
    var startMin = (function () { var p = String(startTime).split(':'); return (+p[0]) * 60 + (+p[1] || 0); })();
    function rangeText() { return fmt(startMin) + '-' + fmt(startMin + Number(duration.value)); }
    var summary = courtName + ' • ' + dateLabel(day) + ' • ' + rangeText();

    // Spinner overlay shown over the modal while the request is in flight.
    var loadingLayer = el('div', { style: 'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(21,19,31,.9);border-radius:16px;z-index:1;' }, [
      el('div', { class: 'ttb-spinner' }),
      el('p', { text: 'Se trimite rezervarea…', style: 'margin:0;color:#cbd5e1;font-size:14px;' }),
    ]);
    function setBusy(on) {
      loadingLayer.style.display = on ? 'flex' : 'none';
      [name, email, phone, duration, submit, cancel].forEach(function (f) { f.disabled = on; });
    }

    function showSuccess() {
      modal.style.position = 'static';
      modal.innerHTML =
        '<div style="text-align:center;">' +
          '<div style="width:56px;height:56px;border-radius:50%;background:rgba(16,185,129,.15);display:flex;align-items:center;justify-content:center;margin:4px auto 14px;">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>' +
          '</div>' +
          '<h3 style="margin:0 0 6px;font-size:18px;color:#fff;">Rezervare confirmată!</h3>' +
          '<p style="margin:0 0 18px;color:#a7f3d0;font-size:14px;">' + (courtName + ' • ' + dateLabel(day) + ' • ' + rangeText()) + '</p>' +
          '<button data-ttb-close style="width:100%;padding:11px;border-radius:8px;border:0;font-weight:700;cursor:pointer;color:#fff;background:linear-gradient(to right,#7c3aed,#d946ef);">Închide</button>' +
        '</div>';
      modal.querySelector('[data-ttb-close]').addEventListener('click', function () { close(); state.status = 'loading'; mount(); load(); });
    }

    submit.addEventListener('click', function () {
      errorBox.textContent = '';
      if (!name.value.trim()) { errorBox.textContent = 'Te rugăm să introduci numele.'; return; }
      if (!validEmail(email.value)) { errorBox.textContent = 'Te rugăm să introduci o adresă de email validă.'; return; }
      if (!validPhone(phone.value)) { errorBox.textContent = 'Număr de telefon invalid (minim 10 cifre, fără litere).'; return; }
      setBusy(true);
      fetch(API + '/api/reserve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: day.date, time: startTime, duration: Number(duration.value), court: court, name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() }),
      })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .then(function (res) {
          if (res.body && res.body.ok) { showSuccess(); }
          else { setBusy(false); errorBox.textContent = translateError(res.body && res.body.error); }
        })
        .catch(function () { setBusy(false); errorBox.textContent = 'Conexiune eșuată. Încearcă din nou.'; });
    });

    var summaryEl = el('p', { text: summary, style: 'margin:0 0 16px;color:#9ca3af;font-size:14px;' });
    var modal = el('div', { style: 'position:relative;background:#15131f;color:#e5e7eb;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px;max-width:380px;width:100%;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,.5);' }, [
      el('h3', { text: 'Rezervă terenul', style: 'margin:0 0 4px;font-size:18px;color:#fff;' }),
      summaryEl,
      field('Nume *', name), field('Email *', email), field('Telefon *', phone), field('Durată', duration),
      errorBox,
      el('div', { style: 'display:flex;gap:10px;margin-top:8px;' }, [cancel, submit]),
      loadingLayer,
    ]);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    name.focus();
  }

  // If the SPA re-renders, re-hide its (new) mock card and make sure our
  // container is still mounted/rendered. Debounced; never touches React nodes'
  // children, so it can't cause a removeChild error.
  function guard() {
    if (typeof MutationObserver === 'undefined') return;
    var pending = false;
    var obs = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        var c = container(); // side effect: re-hides any fresh mock, re-places ours
        if (c && c.getAttribute('data-ttb') !== '1') render(c); // only if our content got wiped
      }, 50);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    var tries = 0;
    (function waitForCard() {
      if (findReactCard()) { mount(); load(); guard(); return; } // show loading immediately, then fetch
      if (tries++ < 20) setTimeout(waitForCard, 150);
    })();
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
