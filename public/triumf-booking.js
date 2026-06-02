/*
 * Triumf Tenis - booking widget
 * --------------------------------
 * Drop-in script for triumf-tenis.ro. Renders court availability for the next
 * 3 days (from /api/schedule) and lets visitors book a slot (via /api/reserve).
 *
 * Embed on the page:
 *   <div id="booking-system"></div>
 *   <script src="https://triumf-tenis.vercel.app/triumf-booking.js" defer></script>
 *
 * Optional attributes on the <script> tag:
 *   data-mount="#some-selector"   where to render (default: #booking-system)
 *   data-api="https://..."        API origin (default: the script's own origin)
 */
(function () {
  'use strict';

  var CURRENT = document.currentScript;
  var API = (CURRENT && CURRENT.dataset.api) ||
    (CURRENT && CURRENT.src ? new URL(CURRENT.src).origin : 'https://triumf-tenis.vercel.app');
  var MOUNT_SEL = (CURRENT && CURRENT.dataset.mount) || '#booking-system';

  var DURATIONS = [
    { value: 60, label: '1 oră' },
    { value: 90, label: '1 oră 30 min' },
    { value: 120, label: '2 ore' },
  ];

  // Map the API's English errors to Romanian for the visitor.
  function translateError(msg) {
    if (!msg) return 'A apărut o eroare. Încearcă din nou.';
    if (/already booked/i.test(msg)) return 'Acest interval este deja rezervat.';
    if (/No matching time slot/i.test(msg)) return 'Nu există un interval liber care să corespundă orei și duratei alese.';
    if (/No schedule found/i.test(msg)) return 'Programul pentru această zi nu este disponibil.';
    if (/Invalid|Missing/i.test(msg)) return 'Date invalide. Verifică informațiile introduse.';
    if (/Origin not allowed/i.test(msg)) return 'Rezervările nu sunt permise de pe acest site.';
    return msg;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

  // Group 30-min slots into hourly rows. A court counts as booked for an hour
  // if ANY 30-min slot within it is booked (conservative).
  function hoursFor(day) {
    var map = {}; // hour -> { court1: bool, court2: bool, seen: bool }
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

  function injectStyles() {
    if (document.getElementById('ttb-styles')) return;
    var css = [
      '.ttb{font-family:inherit;max-width:640px;margin:0 auto;color:#1f2937}',
      '.ttb *{box-sizing:border-box}',
      '.ttb-nav{display:flex;align-items:center;justify-content:center;gap:16px;margin:0 0 12px}',
      '.ttb-nav button{background:#0f766e;color:#fff;border:0;border-radius:8px;width:38px;height:38px;font-size:18px;cursor:pointer;line-height:1}',
      '.ttb-nav button:disabled{opacity:.35;cursor:default}',
      '.ttb-nav .ttb-day{font-size:18px;font-weight:600;min-width:170px;text-align:center;text-transform:capitalize}',
      '.ttb-table{width:100%;border-collapse:collapse;font-size:14px}',
      '.ttb-table th,.ttb-table td{border:1px solid #e5e7eb;padding:8px;text-align:center}',
      '.ttb-table th{background:#f3f4f6;font-weight:600}',
      '.ttb-cell{cursor:default;font-weight:600}',
      '.ttb-free{background:#dcfce7;color:#166534;cursor:pointer}',
      '.ttb-free:hover{background:#bbf7d0}',
      '.ttb-booked{background:#fee2e2;color:#991b1b}',
      '.ttb-ora{background:#f9fafb;color:#374151;font-weight:600}',
      '.ttb-legend{display:flex;gap:16px;justify-content:center;margin:10px 0;font-size:13px;color:#6b7280}',
      '.ttb-legend span{display:inline-flex;align-items:center;gap:6px}',
      '.ttb-dot{width:12px;height:12px;border-radius:3px;display:inline-block}',
      '.ttb-msg{text-align:center;padding:16px;color:#6b7280}',
      '.ttb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}',
      '.ttb-modal{background:#fff;border-radius:14px;padding:22px;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.3)}',
      '.ttb-modal h3{margin:0 0 4px;font-size:18px}',
      '.ttb-modal .ttb-sub{margin:0 0 16px;color:#6b7280;font-size:14px}',
      '.ttb-field{margin-bottom:12px;display:flex;flex-direction:column;gap:4px}',
      '.ttb-field label{font-size:13px;font-weight:600;color:#374151}',
      '.ttb-field input,.ttb-field select{padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;width:100%}',
      '.ttb-actions{display:flex;gap:10px;margin-top:8px}',
      '.ttb-actions button{flex:1;padding:10px;border-radius:8px;border:0;font-size:14px;font-weight:600;cursor:pointer}',
      '.ttb-submit{background:#0f766e;color:#fff}',
      '.ttb-submit:disabled{opacity:.6;cursor:default}',
      '.ttb-cancel{background:#e5e7eb;color:#374151}',
      '.ttb-error{color:#b91c1c;font-size:13px;margin:4px 0 0;min-height:16px}',
      '.ttb-ok{color:#166534;font-size:14px;text-align:center;padding:8px 0}',
    ].join('');
    var style = el('style', { id: 'ttb-styles' });
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  function App(root) {
    this.root = root;
    this.days = [];
    this.idx = 0;
    this.load();
  }

  App.prototype.load = function () {
    var self = this;
    this.root.innerHTML = '';
    this.root.appendChild(el('div', { class: 'ttb-msg', text: 'Se încarcă disponibilitatea…' }));
    fetch(API + '/api/schedule', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        self.days = (data && data.days) || [];
        if (!self.days.length) {
          self.root.innerHTML = '';
          self.root.appendChild(el('div', { class: 'ttb-msg', text: 'Programul nu este disponibil momentan.' }));
          return;
        }
        if (self.idx >= self.days.length) self.idx = 0;
        self.render();
      })
      .catch(function () {
        self.root.innerHTML = '';
        self.root.appendChild(el('div', { class: 'ttb-msg', text: 'Nu am putut încărca disponibilitatea.' }));
      });
  };

  App.prototype.render = function () {
    var self = this;
    var day = this.days[this.idx];
    this.root.innerHTML = '';

    var nav = el('div', { class: 'ttb-nav' }, [
      el('button', { text: '‹', 'aria-label': 'Ziua anterioară', disabled: this.idx === 0 ? '' : null, onclick: function () { self.idx--; self.render(); } }),
      el('div', { class: 'ttb-day', text: titleCase(day.dayOfWeek) + ' • ' + self.prettyDate(day.date) }),
      el('button', { text: '›', 'aria-label': 'Ziua următoare', disabled: this.idx === this.days.length - 1 ? '' : null, onclick: function () { self.idx++; self.render(); } }),
    ]);
    this.root.appendChild(nav);

    var table = el('table', { class: 'ttb-table' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Ora' }), el('th', { text: 'Teren 1' }), el('th', { text: 'Teren 2' }),
    ])]));
    var tbody = el('tbody');
    hoursFor(day).forEach(function (row) {
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'ttb-ora', text: row.label }),
        self.courtCell(day, row, 1, row.court1),
        self.courtCell(day, row, 2, row.court2),
      ]));
    });
    table.appendChild(tbody);
    this.root.appendChild(table);

    this.root.appendChild(el('div', { class: 'ttb-legend' }, [
      el('span', {}, [el('i', { class: 'ttb-dot', style: 'background:#dcfce7' }), document.createTextNode('Liber (apasă pentru a rezerva)')]),
      el('span', {}, [el('i', { class: 'ttb-dot', style: 'background:#fee2e2' }), document.createTextNode('Ocupat')]),
    ]));
  };

  App.prototype.courtCell = function (day, row, court, booked) {
    var self = this;
    if (booked) return el('td', { class: 'ttb-cell ttb-booked', text: 'Ocupat' });
    return el('td', {
      class: 'ttb-cell ttb-free',
      text: 'Liber',
      onclick: function () { self.openBooking(day, row, court); },
    });
  };

  App.prototype.prettyDate = function (iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  };

  App.prototype.openBooking = function (day, row, court) {
    var self = this;
    var overlay = el('div', { class: 'ttb-overlay', onclick: function (e) { if (e.target === overlay) document.body.removeChild(overlay); } });

    var name = el('input', { type: 'text', placeholder: 'Numele tău', required: '' });
    var email = el('input', { type: 'email', placeholder: 'email@exemplu.ro' });
    var phone = el('input', { type: 'tel', placeholder: '07xx xxx xxx' });
    var duration = el('select', {}, DURATIONS.map(function (d) { return el('option', { value: d.value, text: d.label }); }));
    var errorBox = el('p', { class: 'ttb-error' });
    var submit = el('button', { class: 'ttb-submit', text: 'Rezervă' });

    function field(labelText, input) {
      return el('div', { class: 'ttb-field' }, [el('label', { text: labelText }), input]);
    }

    submit.addEventListener('click', function () {
      errorBox.textContent = '';
      if (!name.value.trim()) { errorBox.textContent = 'Te rugăm să introduci numele.'; return; }
      submit.disabled = true; submit.textContent = 'Se trimite…';
      fetch(API + '/api/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: day.date,
          time: row.time,
          duration: Number(duration.value),
          court: court,
          name: name.value.trim(),
          email: email.value.trim(),
          phone: phone.value.trim(),
        }),
      })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .then(function (res) {
          if (res.body && res.body.ok) {
            var box = overlay.querySelector('.ttb-modal');
            box.innerHTML = '';
            box.appendChild(el('h3', { text: 'Rezervare confirmată!' }));
            box.appendChild(el('p', { class: 'ttb-ok', text: 'Teren ' + court + ' • ' + titleCase(day.dayOfWeek) + ' • ' + row.label }));
            box.appendChild(el('div', { class: 'ttb-actions' }, [
              el('button', { class: 'ttb-submit', text: 'Închide', onclick: function () { document.body.removeChild(overlay); self.load(); } }),
            ]));
          } else {
            errorBox.textContent = translateError(res.body && res.body.error);
            submit.disabled = false; submit.textContent = 'Rezervă';
          }
        })
        .catch(function () {
          errorBox.textContent = 'Conexiune eșuată. Încearcă din nou.';
          submit.disabled = false; submit.textContent = 'Rezervă';
        });
    });

    var modal = el('div', { class: 'ttb-modal' }, [
      el('h3', { text: 'Rezervă terenul' }),
      el('p', { class: 'ttb-sub', text: 'Teren ' + court + ' • ' + titleCase(day.dayOfWeek) + ' ' + self.prettyDate(day.date) + ' • ora ' + row.label }),
      field('Nume *', name),
      field('Email', email),
      field('Telefon', phone),
      field('Durată', duration),
      errorBox,
      el('div', { class: 'ttb-actions' }, [
        el('button', { class: 'ttb-cancel', text: 'Anulează', onclick: function () { document.body.removeChild(overlay); } }),
        submit,
      ]),
    ]);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    name.focus();
  };

  function init() {
    var root = document.querySelector(MOUNT_SEL);
    if (!root) {
      // Fall back to appending a container at the end of <main> or <body>.
      root = el('div', { id: 'booking-system' });
      (document.querySelector('main') || document.body).appendChild(root);
    }
    root.classList.add('ttb');
    injectStyles();
    new App(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
