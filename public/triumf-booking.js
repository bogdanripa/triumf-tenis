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

  var BTN_BASE = 'h-10 sm:h-11 m-1 rounded-md border transition-all flex items-center justify-center gap-1 text-[10px]';
  var GRID_COLS = 'grid-template-columns: 80px repeat(2, 1fr);';
  var CAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-days w-5 h-5 text-violet-300"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path></svg>';
  var CHEV_L = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-left w-4 h-4"><path d="m15 18-6-6 6-6"></path></svg>';
  var CHEV_R = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right w-4 h-4"><path d="m9 18 6-6-6-6"></path></svg>';

  // status: 'loading' | 'ready' | 'error'
  var state = { days: [], idx: 0, status: 'loading' };

  function pad(n) { return String(n).padStart(2, '0'); }
  function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

  function translateError(msg) {
    if (!msg) return 'A apărut o eroare. Încearcă din nou.';
    if (/already booked/i.test(msg)) return 'Acest interval este deja rezervat.';
    if (/No matching time slot/i.test(msg)) return 'Nu există un interval liber care să corespundă orei și duratei alese.';
    if (/No schedule found/i.test(msg)) return 'Programul pentru această zi nu este disponibil.';
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

  function hoursFor(day) {
    var map = {};
    day.slots.forEach(function (s) {
      var h = Math.floor(s.time / 60);
      if (!map[h]) map[h] = { court1: false, court2: false };
      if (s.court1 === 'booked') map[h].court1 = true;
      if (s.court2 === 'booked') map[h].court2 = true;
    });
    return Object.keys(map).map(Number).sort(function (a, b) { return a - b; }).map(function (h) {
      return { hour: h, label: pad(h) + '-' + pad(h + 1), time: pad(h) + ':00', court1: map[h].court1, court2: map[h].court2 };
    });
  }

  function dateLabel(day) {
    var p = (day.date || '').split('-');
    var roDay = RO_DAYS[day.dayOfWeek] || titleCase(day.dayOfWeek || '');
    if (p.length === 3) return roDay + ', ' + Number(p[2]) + ' ' + RO_MONTHS[Number(p[1]) - 1];
    return roDay;
  }

  function isPast(day, hour) {
    if (day.dayIdx !== 0) return false;
    return hour < new Date().getHours();
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

  function cellHtml(day, row, court) {
    var booked = court === 1 ? row.court1 : row.court2;
    if (isPast(day, row.hour)) {
      return '<button disabled aria-label="Trecut" class="' + BTN_BASE + ' bg-white/[0.02] border-white/5 cursor-not-allowed"></button>';
    }
    if (booked) {
      return '<button disabled aria-label="Ocupat" class="' + BTN_BASE + ' bg-rose-400/30 border-rose-300/40 cursor-not-allowed"></button>';
    }
    return '<button data-ttb-free data-court="' + court + '" data-time="' + row.time + '" data-label="' + row.label +
      '" aria-label="Liber - apasă pentru rezervare" class="' + BTN_BASE +
      ' bg-emerald-400/30 border-emerald-300/40 hover:bg-emerald-400/50 hover:scale-[1.02] cursor-pointer"></button>';
  }

  function rowHtml(day, row) {
    var past = isPast(day, row.hour);
    var oraCls = 'px-3 py-2.5 text-xs sm:text-sm font-medium border-r border-white/10 bg-white/[0.02] ' + (past ? 'text-foreground/30' : 'text-foreground/80');
    return '<div class="grid border-b border-white/5 last:border-b-0" style="' + GRID_COLS + '">' +
      '<div class="' + oraCls + '">' + row.label + '</div>' +
      cellHtml(day, row, 1) + cellHtml(day, row, 2) + '</div>';
  }

  function tableHtml(rowsHtml) {
    return '<div class="overflow-x-auto scrollbar-thin -mx-1 px-1">' +
      '<div class="min-w-[420px] rounded-xl overflow-hidden border border-white/10">' +
        '<div class="grid bg-white/[0.06] border-b border-white/10" style="' + GRID_COLS + '">' +
          '<div class="p-3 text-xs font-bold uppercase tracking-wider text-foreground/90 border-r border-white/10">Ora</div>' +
          '<div class="p-3 text-xs sm:text-sm font-bold text-center text-foreground/90 border-l border-white/10">Teren 1</div>' +
          '<div class="p-3 text-xs sm:text-sm font-bold text-center text-foreground/90 border-l border-white/10">Teren 2 (Indoor)</div>' +
        '</div>' + rowsHtml +
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

    var rows = hoursFor(day).map(function (r) { return rowHtml(day, r); }).join('');
    card.innerHTML = headerHtml(dateLabel(day), state.idx === 0, state.idx === state.days.length - 1) + legendHtml() + tableHtml(rows);

    var prev = card.querySelector('[data-ttb-prev]');
    var next = card.querySelector('[data-ttb-next]');
    if (prev) prev.addEventListener('click', function () { if (state.idx > 0) { state.idx--; render(card); } });
    if (next) next.addEventListener('click', function () { if (state.idx < state.days.length - 1) { state.idx++; render(card); } });
    card.querySelectorAll('[data-ttb-free]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openBooking(day, { time: btn.getAttribute('data-time'), label: btn.getAttribute('data-label') }, Number(btn.getAttribute('data-court')));
      });
    });
  }

  function findCard() {
    if (CARD_SEL) { var e = document.querySelector(CARD_SEL); if (e) return e; }
    var hs = document.querySelectorAll('h1,h2,h3,h4,h5');
    for (var i = 0; i < hs.length; i++) {
      if ((hs[i].textContent || '').indexOf(HEADING) !== -1) {
        return hs[i].closest('.glass-card') || hs[i].parentElement;
      }
    }
    return null;
  }

  function mount() {
    var card = findCard();
    if (card) render(card);
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
  function openBooking(day, row, court) {
    var overlay = el('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;', onclick: function (e) { if (e.target === overlay) close(); } });
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    var INPUT = 'width:100%;padding:9px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-size:14px;font-family:inherit;';
    var LABEL = 'font-size:13px;font-weight:600;color:#cbd5e1;margin-bottom:4px;display:block;';

    var name = el('input', { type: 'text', placeholder: 'Numele tău', style: INPUT });
    var email = el('input', { type: 'email', placeholder: 'email@exemplu.ro', style: INPUT });
    var phone = el('input', { type: 'tel', placeholder: '07xx xxx xxx', style: INPUT });
    var duration = el('select', { style: INPUT }, DURATIONS.map(function (d) { return el('option', { value: d.value, text: d.label }); }));
    var errorBox = el('p', { style: 'color:#fca5a5;font-size:13px;margin:6px 0 0;min-height:16px;' });
    var submit = el('button', { text: 'Rezervă', style: 'flex:1;padding:11px;border-radius:8px;border:0;font-size:14px;font-weight:700;cursor:pointer;color:#fff;background:linear-gradient(to right,#7c3aed,#d946ef);' });
    var cancel = el('button', { text: 'Anulează', onclick: close, style: 'flex:1;padding:11px;border-radius:8px;border:0;font-size:14px;font-weight:600;cursor:pointer;color:#e5e7eb;background:rgba(255,255,255,.1);' });

    function field(t, input) { return el('div', { style: 'margin-bottom:12px;' }, [el('label', { text: t, style: LABEL }), input]); }

    var courtName = court === 2 ? 'Teren 2 (Indoor)' : 'Teren 1';
    submit.addEventListener('click', function () {
      errorBox.textContent = '';
      if (!name.value.trim()) { errorBox.textContent = 'Te rugăm să introduci numele.'; return; }
      submit.disabled = true; submit.textContent = 'Se trimite…'; submit.style.opacity = '.7';
      fetch(API + '/api/reserve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: day.date, time: row.time, duration: Number(duration.value), court: court, name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() }),
      })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .then(function (res) {
          if (res.body && res.body.ok) {
            modal.innerHTML = '';
            modal.appendChild(el('h3', { text: 'Rezervare confirmată!', style: 'margin:0 0 8px;font-size:18px;color:#fff;' }));
            modal.appendChild(el('p', { text: courtName + ' • ' + dateLabel(day) + ' • ora ' + row.label, style: 'margin:0 0 16px;color:#a7f3d0;font-size:14px;' }));
            modal.appendChild(el('button', { text: 'Închide', onclick: function () { close(); state.status = 'loading'; mount(); load(); }, style: 'width:100%;padding:11px;border-radius:8px;border:0;font-weight:700;cursor:pointer;color:#fff;background:linear-gradient(to right,#7c3aed,#d946ef);' }));
          } else {
            errorBox.textContent = translateError(res.body && res.body.error);
            submit.disabled = false; submit.textContent = 'Rezervă'; submit.style.opacity = '1';
          }
        })
        .catch(function () { errorBox.textContent = 'Conexiune eșuată. Încearcă din nou.'; submit.disabled = false; submit.textContent = 'Rezervă'; submit.style.opacity = '1'; });
    });

    var modal = el('div', { style: 'background:#15131f;color:#e5e7eb;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px;max-width:380px;width:100%;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,.5);' }, [
      el('h3', { text: 'Rezervă terenul', style: 'margin:0 0 4px;font-size:18px;color:#fff;' }),
      el('p', { text: courtName + ' • ' + dateLabel(day) + ' • ora ' + row.label, style: 'margin:0 0 16px;color:#9ca3af;font-size:14px;' }),
      field('Nume *', name), field('Email', email), field('Telefon', phone), field('Durată', duration),
      errorBox,
      el('div', { style: 'display:flex;gap:10px;margin-top:8px;' }, [cancel, submit]),
    ]);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    name.focus();
  }

  // Re-assert over the original card if the SPA re-renders it.
  function guard() {
    if (typeof MutationObserver === 'undefined') return;
    var scope = document.getElementById('booking-system') || document.body;
    var obs = new MutationObserver(function () {
      var card = findCard();
      if (card && card.getAttribute('data-ttb') !== '1') render(card);
    });
    obs.observe(scope, { childList: true, subtree: true });
  }

  function init() {
    var tries = 0;
    (function waitForCard() {
      if (findCard()) { mount(); load(); guard(); return; } // show loading immediately, then fetch
      if (tries++ < 20) setTimeout(waitForCard, 150);
    })();
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
