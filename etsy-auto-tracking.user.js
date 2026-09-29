// ==UserScript==
// @name         Etsy Auto Tracking (from Google Sheet)
// @namespace    etsy-auto-tracking
// @version      4.3
// @description  Auto complete Etsy orders with tracking number + carrier loaded from a Google Sheets link
// @match        https://www.etsy.com/your/orders/sold*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @connect      accounts.google.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '4.3';

  // Manual overrides if the automatic substring match picks the wrong
  // carrier option. Key = lowercase DVVC/carrier text (or part of it) as it
  // appears in the sheet, value = exact text of the Etsy <option> to pick.
  // Leave empty if the automatic matching (see matchCarrierOption) works
  // fine for your shop.
  const CARRIER_ALIASES = {
    // 'dhl ecommerce': 'DHL',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Used by the order-code-first / customer-name-fallback order matching.
  function normalizeName(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Short log lines shown inside the on-page panel (kept separate from the
  // full console log, which stays verbose for debugging).
  const MAX_UI_LOG_LINES = 12;

  function uiLog(text) {
    const box = document.getElementById('at-log');
    if (!box) return;
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const line = document.createElement('div');
    line.className = 'at-log-line';
    line.textContent = `${time} ${text}`;
    box.appendChild(line);
    while (box.children.length > MAX_UI_LOG_LINES) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function log(...a) {
    console.log('%c[AutoTrack]', 'color:#0ea5e9;font-weight:bold', ...a);
    let text = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 90) text = text.slice(0, 87) + '...';
    uiLog(text);
  }

  // Make `panel` draggable by its `handle` element, remembering position in
  // localStorage so it persists across page reloads. `onTap` (optional)
  // fires when the handle was clicked WITHOUT being dragged (moved less
  // than a few px) — used to toggle collapse/expand without that also
  // firing on the tail end of a drag.
  function makeDraggable(panel, handle, storageKey, onTap) {
    let dragging = false;
    let moved = false;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        panel.style.left = saved.left + 'px';
        panel.style.top = saved.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
    } catch (e) {
      /* ignore malformed saved position */
    }

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      if (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4) moved = true;
      const maxLeft = window.innerWidth - panel.offsetWidth;
      const maxTop = window.innerHeight - panel.offsetHeight;
      const left = Math.max(0, Math.min(e.clientX - offsetX, maxLeft));
      const top = Math.max(0, Math.min(e.clientY - offsetY, maxTop));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      if (moved) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ left: parseInt(panel.style.left, 10), top: parseInt(panel.style.top, 10) })
        );
      } else if (onTap) {
        onTap();
      }
    });
  }

  async function waitFor(fn, { timeout = 10000, interval = 200, desc = '' } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = await fn();
      if (v) return v;
      await sleep(interval);
    }
    throw new Error('Timeout waiting for: ' + desc);
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, value);
  }

  const RUN_KEY = 'AT_RUNNING';
  const PAUSE_KEY = 'AT_PAUSED';

  function getOrderIds() {
    return Array.from(document.querySelectorAll('a[href*="order_id="]'))
      .map((a) => {
        const m = a.href.match(/order_id=(\d+)/);
        return m ? m[1] : null;
      })
      .filter((v, i, arr) => v && arr.indexOf(v) === i);
  }

  // Look the row up fresh by order id rather than keeping a DOM reference
  // captured earlier — completing an order re-renders the list (the
  // finished row disappears), which can leave previously-captured element
  // references detached/stale, causing clicks on them to silently do
  // nothing (symptom: "dropdown open" timeouts right after a completion).
  function findRowByOrderId(orderId) {
    const a = document.querySelector(`a[href*="order_id=${orderId}"]`);
    return a ? a.closest('.panel-body-row') : null;
  }

  async function waitForRow(orderId, timeout = 4000) {
    try {
      return await waitFor(() => findRowByOrderId(orderId), {
        timeout,
        interval: 200,
        desc: 'row for order ' + orderId,
      });
    } catch (e) {
      return null;
    }
  }

  // Shipping recipient's name, used as a fallback match key when an order
  // code doesn't turn up a match in the Sheet data (e.g. a cancelled order
  // redone under a different code keeps the same shipping name).
  function getOrderCustomerName(row) {
    // Prefer the "Ship to" summary name (the actual shipping recipient) — a
    // <div class="text-body-smaller strong"> beneath the Ship to accordion.
    // Whether Etsy wraps the text in an extra
    // <span data-test-id="unsanitize"> or not varies per order (confirmed:
    // some orders render it as plain text with no such span at all), so
    // just read the element's own text instead of depending on that span.
    const shipToEl = row.querySelector('.text-body-smaller.strong');
    if (shipToEl && shipToEl.textContent.trim()) return shipToEl.textContent.trim();

    // Fallback: the buyer's account name shown at the top of the order (a
    // dropdown-button holding the name + a chevron icon). The row has other
    // dropdown buttons too (e.g. "Update progress"), so explicitly skip any
    // whose container carries a clg-tooltip — only the action-menu ones do.
    const dropdownButtons = row.querySelectorAll('[data-dropdown-button="true"]');
    for (const btn of dropdownButtons) {
      const container = btn.closest('[data-dropdown-container="true"]');
      if (container && container.querySelector('clg-tooltip')) continue;
      const text = btn.textContent.trim();
      if (text) return text;
    }
    return '';
  }

  function findUpdateProgressTrigger(row) {
    const groups = row.querySelectorAll('[data-dropdown-container="true"]');
    for (const g of groups) {
      const tip = g.querySelector('clg-tooltip');
      if (tip && tip.textContent.includes('Update progress')) {
        return g.querySelector('[data-dropdown-button="true"]');
      }
    }
    return null;
  }

  async function openCompleteOrderModal(row, orderId) {
    const trigger = findUpdateProgressTrigger(row);
    if (!trigger) return false; // no "Update progress" action on this row -> skip

    // Scroll the row into view first — some pages skip/deprioritise click
    // handling on elements sitting outside the viewport.
    row.scrollIntoView({ block: 'center' });
    await sleep(150);

    const container = trigger.closest('[data-dropdown-container="true"]');
    const menu = container.querySelector('[data-dropdown-target="true"]');
    // Check multiple signals (trigger's own aria-expanded as well as the
    // menu's aria-hidden/class) since which one flips first can vary.
    const isOpen = () =>
      trigger.getAttribute('aria-expanded') === 'true' ||
      menu.getAttribute('aria-hidden') === 'false' ||
      !menu.classList.contains('is-closed');

    trigger.click();
    await sleep(250);

    try {
      await waitFor(isOpen, { timeout: 8000, desc: 'dropdown open for order ' + orderId });
    } catch (e) {
      // Dropdown never opened in time (page was busy/laggy). Try to close it
      // again so it doesn't sit open and block clicks on the next order.
      trigger.click();
      throw e;
    }

    const completeBtn = Array.from(menu.querySelectorAll('button')).find((b) =>
      b.textContent.trim().includes('Complete order')
    );
    if (!completeBtn) {
      // No "Complete order" action (already shipped / cancelled / etc.) -> skip
      trigger.click(); // close the dropdown again
      return false;
    }
    completeBtn.click();

    await waitFor(
      () => document.querySelector(`select[name="carrierNameSelect-${orderId}"]`),
      { timeout: 8000, desc: 'Complete order modal for ' + orderId }
    );
    return true;
  }

  function matchCarrierOption(select, carrierRaw) {
    const carrierNorm = carrierRaw.trim().toLowerCase();

    for (const key of Object.keys(CARRIER_ALIASES)) {
      if (carrierNorm.includes(key)) {
        const wanted = CARRIER_ALIASES[key].toLowerCase();
        const opt = Array.from(select.querySelectorAll('option')).find(
          (o) => o.textContent.trim().toLowerCase() === wanted
        );
        if (opt) return opt;
      }
    }

    const options = Array.from(select.querySelectorAll('option')).filter((o) => {
      const t = o.textContent.trim().toLowerCase();
      return t && t !== 'other' && t !== 'select shipping carrier';
    });

    return options.find((o) => {
      const t = o.textContent.trim().toLowerCase();
      return carrierNorm.includes(t) || t.includes(carrierNorm);
    });
  }

  async function setClgTextInputValue(clgEl, value) {
    const input = await waitFor(
      () => clgEl.shadowRoot && clgEl.shadowRoot.querySelector('input'),
      { timeout: 4000, desc: 'inner <input> of ' + (clgEl.getAttribute('name') || clgEl.tagName) }
    );
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    // Only 'input' + 'change' — dispatching 'blur' too has been seen to send
    // this custom element (and Etsy's own React tree) into a heavy re-render
    // loop that can hang/crash the tab, especially with DevTools open.
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  async function fillAndSubmit(orderId, tracking, carrierRaw) {
    const select = document.querySelector(`select[name="carrierNameSelect-${orderId}"]`);
    if (!select) throw new Error('carrier select not found for ' + orderId);

    const matched = matchCarrierOption(select, carrierRaw);

    if (matched) {
      log(`  carrier "${carrierRaw}" -> "${matched.textContent.trim()}"`);
      setNativeValue(select, matched.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      // Let Etsy's own React tree finish re-rendering around the select
      // before we touch anything else in the modal.
      await sleep(500);
    } else {
      const other = Array.from(select.querySelectorAll('option')).find(
        (o) => o.textContent.trim().toLowerCase() === 'other'
      );
      if (!other) throw new Error('No "Other" option found in carrier select');
      log(`  carrier "${carrierRaw}" -> Other (custom text)`);
      setNativeValue(select, other.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      // Selecting "Other" makes the custom carrier-name field appear/enable;
      // give the app a moment to settle before we grab and fill it — doing
      // this too fast back-to-back is what tends to freeze the tab.
      await sleep(500);

      const carrierInput = await waitFor(
        () => document.querySelector(`clg-text-input[name="carrierName-${orderId}"]`),
        { timeout: 3000, desc: 'custom carrier text input' }
      );
      await setClgTextInputValue(carrierInput, carrierRaw);
      await sleep(300);
    }

    const trackingInput = await waitFor(
      () => document.querySelector(`clg-text-input[name="trackingCode-${orderId}"]`),
      { timeout: 3000, desc: 'tracking number input' }
    );
    await setClgTextInputValue(trackingInput, tracking);

    await sleep(500);

    // The modal's own footer button, not the dropdown menu item -> exclude
    // anything still living inside a dropdown container.
    const submitBtn = Array.from(document.querySelectorAll('button')).find(
      (b) =>
        b.textContent.trim() === 'Complete order' &&
        !b.closest('[data-dropdown-target="true"]')
    );
    if (!submitBtn) throw new Error('Modal submit button not found');

    await waitFor(() => !submitBtn.disabled, { timeout: 5000, desc: 'submit button enabled' });
    submitBtn.click();

    await waitFor(
      () => !document.querySelector(`select[name="carrierNameSelect-${orderId}"]`),
      { timeout: 8000, desc: 'modal closed for ' + orderId }
    );
  }

  function closeModalIfOpen(orderId) {
    const select = document.querySelector(`select[name="carrierNameSelect-${orderId}"]`);
    if (!select) return;
    const cancelBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Cancel'
    );
    if (cancelBtn) cancelBtn.click();
  }

  // ---------------------------------------------------------------------
  // Load tracking data straight from a Google Sheets link (no copy/paste),
  // via the CSV export endpoint. Requires the sheet's sharing set to
  // "Anyone with the link" (Viewer) — otherwise Google serves an HTML
  // sign-in page instead of CSV, which is detected and reported. The CSV
  // export always includes the real header row, so columns are matched by
  // name (ORDER CODE / FULL NAME / TRACKING / DVVC) instead of guessing a
  // fixed position.
  // ---------------------------------------------------------------------

  let sheetMap = null; // orderId -> { tracking, carrier }
  let sheetMapByName = null; // normalized customer name -> { tracking, carrier } (fallback)
  let sheetOrder = null; // order ids, in the order they appear in the sheet

  function extractSheetIdAndGid(url) {
    const idMatch = (url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) return null;
    const gidMatch = url.match(/[?&#]gid=(\d+)/);
    return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : '0' };
  }

  function gmFetchText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 15000,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText);
          else reject(new Error('HTTP ' + res.status));
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  // Minimal RFC4180-ish CSV parser: handles quoted fields with embedded
  // commas, real newlines, and escaped "" quotes — which is exactly how
  // Google's CSV export represents a wrapped multi-line cell.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\r') {
        // ignore; \n (below) is what ends the row
      } else if (c === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // Only orders placed within this many days are kept when loading a sheet —
  // older rows are skipped entirely (not matched, not filled).
  const RECENT_DAYS_LIMIT = 10;

  // Parses "D/M/YY", "D/M/YYYY" (day-first, matching this sheet's ORDER DATE
  // convention, e.g. "20/5/26") or an ISO "YYYY-MM-DD" date string. Returns
  // null if it doesn't look like a date at all (in which case the row is
  // kept rather than guessed away).
  function parseSheetDate(str) {
    const s = (str || '').trim();
    if (!s) return null;

    let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      let y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      const dt = new Date(y, mo - 1, d);
      return isNaN(dt.getTime()) ? null : dt;
    }

    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      return isNaN(dt.getTime()) ? null : dt;
    }

    return null;
  }

  function isWithinRecentDays(date, days) {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days);
    return date >= cutoff;
  }

  // Finds a header column by trying keyword groups in priority order (all
  // header cells checked against the first group before falling back to the
  // next) — e.g. "ORDER DATE" contains the bare substring "ORDER", so a
  // single flat keyword list risked matching the date column instead of the
  // real "ORDER CODE" column whenever the date column came first.
  function findColPriority(header, tiers) {
    for (const tier of tiers) {
      const idx = header.findIndex((h) => tier.some((k) => h.includes(k)));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function parseSheetCsv(text) {
    const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
    if (!rows.length) return { ok: false, rowCount: 0 };

    const header = rows[0].map((h) => h.trim().toUpperCase());
    const colOrder = findColPriority(header, [
      ['ORDER CODE'],
      ['ORDER ID'],
      ['MA DON', 'MÃ ĐƠN'],
      ['ORDER'],
    ]);
    const colName = findColPriority(header, [['FULL NAME'], ['NAME'], ['CUSTOMER']]);
    const colTracking = findColPriority(header, [['TRACKING']]);
    const colCarrier = findColPriority(header, [
      ['DVVC'],
      ['CARRIER'],
      ['VAN CHUYEN', 'VẬN CHUYỂN'],
    ]);
    const colDate = findColPriority(header, [['ORDER DATE'], ['DATE', 'NGAY', 'NGÀY']]);

    if (colOrder === -1 || colTracking === -1) {
      return { ok: false, header, colOrder, colTracking };
    }

    const map = {};
    const mapByName = {};
    const order = [];
    let count = 0;
    let skippedOld = 0;
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      const orderId = (cells[colOrder] || '').trim();
      const tracking = (cells[colTracking] || '').trim();
      const carrier = colCarrier !== -1 ? (cells[colCarrier] || '').trim() : '';
      if (!orderId || !tracking) continue; // order not shipped yet -> skip

      if (colDate !== -1) {
        const date = parseSheetDate(cells[colDate]);
        if (date && !isWithinRecentDays(date, RECENT_DAYS_LIMIT)) {
          skippedOld++;
          continue;
        }
      }

      if (!(orderId in map)) order.push(orderId);
      map[orderId] = { tracking, carrier };
      if (colName !== -1) {
        const name = normalizeName(cells[colName]);
        if (name) mapByName[name] = { tracking, carrier };
      }
      count++;
    }
    return { ok: true, map, mapByName, order, count, rowCount: rows.length - 1, skippedOld };
  }

  function lookupTracking(orderId, customerName) {
    if (!sheetMap) return { orderId, found: false };
    let entry = sheetMap[orderId];
    let byName = false;
    if (!entry && customerName && sheetMapByName) {
      entry = sheetMapByName[normalizeName(customerName)];
      byName = !!entry;
    }
    return entry
      ? { orderId, found: true, tracking: entry.tracking, carrier: entry.carrier, byName }
      : { orderId, found: false };
  }

  // Returns true if a real "open modal / fill / submit" attempt happened
  // (used by runAll to decide how long to pause before the next order —
  // a quick skip shouldn't cost the same settle time as a real completion).
  async function processOrder(orderId) {
    // Fetch the row first — completing an order re-renders the list (see
    // findRowByOrderId), and we also need the customer name off of it as a
    // fallback match key in case the order code itself doesn't match.
    const row = await waitForRow(orderId);
    if (!row) {
      return false; // order no longer on page -> skip silently
    }
    const customerName = getOrderCustomerName(row);

    log('Checking order', orderId, customerName ? `(name: "${customerName}")` : '(no name found)', '...');

    const result = lookupTracking(orderId, customerName);

    if (!result.found) {
      log('  not found in Sheet -> skipped (no modal opened)');
      return false;
    }
    log(result.byName ? '  found (by customer name):' : '  found:', result.tracking, '/', result.carrier);

    const opened = await openCompleteOrderModal(row, orderId);
    if (!opened) {
      log('  no "Complete order" action available on this row -> skipped');
      return false;
    }

    try {
      await fillAndSubmit(orderId, result.tracking, result.carrier);
      log('  done:', result.tracking, '/', result.carrier);
    } catch (e) {
      log('  ERROR filling modal:', e.message);
      closeModalIfOpen(orderId);
    }
    return true;
  }

  async function runAll() {
    GM_setValue(RUN_KEY, true);
    GM_setValue(PAUSE_KEY, false);
    setStatus('Running...');

    if (!sheetMap) {
      log('Chưa có dữ liệu Sheet — dán link Google Sheet rồi bấm Start.');
    }

    // Always driven by the Etsy page: scan every order currently shown on
    // this page first, then check each one against the loaded Sheet data.
    const orderIds = getOrderIds();
    log(`Found ${orderIds.length} order(s) on this page.`);

    for (const orderId of orderIds) {
      if (!GM_getValue(RUN_KEY)) {
        log('Stopped by user.');
        break;
      }

      // Pause: block right here (loop position/order id list is kept,
      // nothing is re-scanned) until Resume is clicked or Stop cancels the run.
      while (GM_getValue(PAUSE_KEY)) {
        setStatus('Paused');
        await sleep(300);
        if (!GM_getValue(RUN_KEY)) break;
      }
      if (!GM_getValue(RUN_KEY)) {
        log('Stopped by user.');
        break;
      }
      setStatus('Running...');

      let attempted = false;
      try {
        attempted = await processOrder(orderId);
      } catch (e) {
        log('ERROR processing row:', e.message);
        // Best-effort cleanup: close any dropdown/modal left open by the
        // failed step so it doesn't block clicks on the next order.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        attempted = true;
      }
      // Only pay the full "let the page settle" pause after a real
      // open-modal/fill/submit attempt; a quick non-match skip doesn't need it.
      await sleep(attempted ? 2000 : 150);
    }

    GM_setValue(RUN_KEY, false);
    GM_setValue(PAUSE_KEY, false);
    setStatus('Idle');
    setPauseButtonLabel();
    log('All done.');
  }

  // --- minimal floating control panel -------------------------------
  GM_addStyle(`
    #at-panel{position:fixed;bottom:16px;right:16px;z-index:999999;
      background:#111;color:#fff;font:13px sans-serif;padding:10px 12px;
      border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.4);width:240px}
    .at-drag-handle{cursor:pointer;user-select:none;padding-bottom:6px;margin-bottom:6px;
      border-bottom:1px solid rgba(255,255,255,.15);display:flex;align-items:center;
      justify-content:space-between}
    #at-panel.at-collapsed .at-drag-handle{padding-bottom:0;margin-bottom:0;border-bottom:none}
    #at-panel.at-collapsed > *:not(.at-drag-handle){display:none}
    #at-toggle-icon-etsy{opacity:.6;font-size:10px;margin-left:8px}
    .at-version{opacity:.5;font-weight:400;font-size:10px}
    #at-panel button{width:100%;margin-top:6px;padding:6px 0;border:0;border-radius:6px;
      cursor:pointer;font:13px sans-serif;font-weight:600}
    #at-panel .start{background:#16a34a;color:#fff}
    #at-panel .pause{background:#d97706;color:#fff}
    #at-panel .stop{background:#dc2626;color:#fff}
    #at-status{font:12px monospace;opacity:.8;margin-top:4px}
    #at-sheet-import textarea{width:100%;box-sizing:border-box;margin-top:4px;
      font:11px monospace;background:#1a1a1a;color:#e5e7eb;resize:vertical;
      border:1px solid #333;border-radius:4px;padding:5px}
    .at-sheet-url-label{font-size:11px;opacity:.8;margin-top:8px;display:block}
    #at-sheet-url-count{font-size:11px;opacity:.7;margin-top:3px}
    #at-sheet-info{font:11px monospace;opacity:.75;margin-top:4px;white-space:pre-wrap}
    .at-log{margin-top:8px;max-height:150px;overflow-y:auto;background:#000;
      border-radius:6px;padding:6px;font:11px/1.4 monospace;color:#9ca3af}
    .at-log-line{white-space:pre-wrap;word-break:break-word;
      border-bottom:1px solid rgba(255,255,255,.06);padding:2px 0}
    .at-log-line:last-child{border-bottom:none}
  `);

  const panel = document.createElement('div');
  panel.id = 'at-panel';
  panel.innerHTML = `
    <div class="at-drag-handle"><strong>Etsy Auto Tracking <span class="at-version">v${SCRIPT_VERSION}</span></strong><span id="at-toggle-icon-etsy">▾</span></div>
    <div id="at-status">Idle</div>
    <button class="start" id="at-start">Start</button>
    <button class="pause" id="at-pause">Pause</button>
    <button class="stop" id="at-stop">Stop</button>
    <div id="at-sheet-import">
      <label class="at-sheet-url-label">Link Google Sheet (mỗi link 1 dòng, share "Anyone with the link" — Viewer)</label>
      <textarea id="at-sheet-url" rows="3" placeholder="https://docs.google.com/spreadsheets/d/...&#10;https://docs.google.com/spreadsheets/d/..."></textarea>
      <div id="at-sheet-url-count"></div>
      <div id="at-sheet-info"></div>
    </div>
    <div id="at-log" class="at-log"></div>
  `;
  document.body.appendChild(panel);

  const PANEL_COLLAPSED_KEY = 'at_panel_collapsed_etsy';
  function applyCollapsedUI() {
    const collapsed = localStorage.getItem(PANEL_COLLAPSED_KEY) === '1';
    panel.classList.toggle('at-collapsed', collapsed);
    const icon = document.getElementById('at-toggle-icon-etsy');
    if (icon) icon.textContent = collapsed ? '▸' : '▾';
  }
  applyCollapsedUI();

  makeDraggable(panel, panel.querySelector('.at-drag-handle'), 'at_panel_pos_etsy', () => {
    const collapsed = localStorage.getItem(PANEL_COLLAPSED_KEY) === '1';
    localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? '0' : '1');
    applyCollapsedUI();
  });

  function setStatus(text) {
    const el = document.getElementById('at-status');
    if (el) el.textContent = text;
  }

  // Fetches + parses a single sheet URL. Returns { ok:true, ...parseSheetCsv
  // result } or { ok:false, error } — never throws, so the caller can keep
  // going through a list of URLs even if one of them fails.
  async function fetchOneSheet(url) {
    const parsed = extractSheetIdAndGid(url);
    if (!parsed) {
      return { ok: false, error: 'link không hợp lệ (cần dạng .../spreadsheets/d/<id>/...)' };
    }

    const exportUrl = `https://docs.google.com/spreadsheets/d/${parsed.sheetId}/export?format=csv&gid=${parsed.gid}`;
    let text;
    try {
      text = await gmFetchText(exportUrl);
    } catch (e) {
      return { ok: false, error: `không tải được (${e.message})` };
    }

    if (/^\s*<(!DOCTYPE|html)/i.test(text)) {
      return { ok: false, error: 'chưa share công khai (Share -> Anyone with the link -> Viewer)' };
    }

    const result = parseSheetCsv(text);
    if (!result.ok) {
      const missing = [];
      if (result.colOrder === -1) missing.push('ORDER CODE');
      if (result.colTracking === -1) missing.push('TRACKING');
      return { ok: false, error: `thiếu cột ${missing.join(', ')}` };
    }
    if (result.count === 0) {
      const reason =
        result.skippedOld > 0
          ? `${result.skippedOld} đơn có tracking nhưng đều cũ hơn ${RECENT_DAYS_LIMIT} ngày`
          : `đọc được ${result.rowCount} dòng nhưng không đơn nào có TRACKING`;
      return { ok: false, error: reason };
    }
    return result;
  }

  // Loads and merges sheet data from one or more Google Sheets links (one
  // per line — see fetchOneSheet/parseSheetCsv above for the "Anyone with
  // the link" requirement). A later sheet's entry for the same order code
  // overwrites an earlier one; order ids are kept in first-appearance order
  // across all sheets combined. Remembers the URLs in localStorage so Start
  // can quietly re-fetch the latest data on every run without re-entering
  // them. Keeps going through every URL even if some fail, and only reports
  // total failure if NONE of them produced usable data.
  async function loadSheetsFromUrls(urlsText) {
    const info = document.getElementById('at-sheet-info');
    const urls = (urlsText || '')
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter(Boolean);

    if (!urls.length) {
      if (info) info.textContent = 'Dán ít nhất 1 link Google Sheet.';
      return false;
    }

    if (info) info.textContent = `Đang tải dữ liệu từ ${urls.length} link Sheet...`;

    const combinedMap = {};
    const combinedMapByName = {};
    const combinedOrder = [];
    const errors = [];
    let okCount = 0;
    let totalSkippedOld = 0;

    for (const url of urls) {
      log('Fetching Sheet:', url);
      const result = await fetchOneSheet(url);
      if (!result.ok) {
        log('  failed:', result.error);
        errors.push(`${url}\n  -> ${result.error}`);
        continue;
      }
      okCount++;
      totalSkippedOld += result.skippedOld || 0;
      log(`  loaded ${result.count} order(s).`);
      for (const orderId of result.order) {
        if (!(orderId in combinedMap)) combinedOrder.push(orderId);
        combinedMap[orderId] = result.map[orderId];
      }
      Object.assign(combinedMapByName, result.mapByName);
    }

    if (!okCount) {
      if (info) info.textContent = `Không tải được link nào.\n${errors.join('\n')}`;
      log('All Sheet URLs failed to load.');
      return false;
    }

    sheetMap = combinedMap;
    sheetMapByName = combinedMapByName;
    sheetOrder = combinedOrder;
    localStorage.setItem('at_sheet_urls', urlsText);

    let msg = `Đã tải ${combinedOrder.length} đơn từ ${okCount}/${urls.length} link.`;
    if (totalSkippedOld > 0) msg += ` (bỏ qua ${totalSkippedOld} đơn cũ hơn ${RECENT_DAYS_LIMIT} ngày)`;
    if (errors.length) msg += `\nLỗi:\n${errors.join('\n')}`;
    if (info) info.textContent = msg;
    log(
      `Sheet URLs: loaded ${combinedOrder.length} order(s) from ${okCount}/${urls.length} link(s)`,
      totalSkippedOld > 0 ? `(skipped ${totalSkippedOld} older than ${RECENT_DAYS_LIMIT}d)` : ''
    );
    return true;
  }

  const sheetUrlInput = document.getElementById('at-sheet-url');
  if (sheetUrlInput) {
    sheetUrlInput.value = localStorage.getItem('at_sheet_urls') || localStorage.getItem('at_sheet_url') || '';
  }

  // Live line-count so it's obvious each pasted link actually landed on its
  // own line (a paste that silently collapses everything onto one line
  // would otherwise look identical to the eye) instead of needing to click
  // a separate "load" button just to find out.
  function updateSheetUrlCount() {
    const countEl = document.getElementById('at-sheet-url-count');
    if (!countEl || !sheetUrlInput) return;
    const lines = sheetUrlInput.value
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) {
      countEl.textContent = '';
      return;
    }
    const validCount = lines.filter((l) => extractSheetIdAndGid(l)).length;
    let text = `${lines.length} dòng — ${validCount} link Sheet hợp lệ`;
    if (validCount !== lines.length) text += `, ${lines.length - validCount} dòng không phải link Sheet`;
    countEl.textContent = text;
  }
  updateSheetUrlCount();
  if (sheetUrlInput) sheetUrlInput.addEventListener('input', updateSheetUrlCount);

  function setPauseButtonLabel() {
    const btn = document.getElementById('at-pause');
    if (btn) btn.textContent = GM_getValue(PAUSE_KEY) ? 'Resume' : 'Pause';
  }

  // Start: begins a brand-new run (fresh scan of the current order list) if
  // idle, or resumes if currently paused. Always re-fetches the latest data
  // from the Sheet link first (so tracking added since the last run is
  // picked up automatically). Pause: temporarily halts the loop in place —
  // same in-progress list, same position, nothing re-scanned. Stop: cancels
  // the run entirely; the next Start rescans from the top.
  document.getElementById('at-start').addEventListener('click', async () => {
    if (GM_getValue(RUN_KEY)) {
      if (GM_getValue(PAUSE_KEY)) {
        GM_setValue(PAUSE_KEY, false);
        setPauseButtonLabel();
        log('Resumed by user.');
      }
      return;
    }
    const urlsText = sheetUrlInput ? sheetUrlInput.value : '';
    if (!urlsText.trim()) {
      log('Chưa có link Google Sheet — dán link vào ô rồi bấm Start lại.');
      return;
    }
    if (!(await loadSheetsFromUrls(urlsText))) {
      return;
    }
    runAll();
  });
  document.getElementById('at-pause').addEventListener('click', () => {
    if (!GM_getValue(RUN_KEY)) return; // nothing running to pause
    const nowPaused = !GM_getValue(PAUSE_KEY);
    GM_setValue(PAUSE_KEY, nowPaused);
    setPauseButtonLabel();
    log(nowPaused ? 'Paused by user.' : 'Resumed by user.');
  });
  document.getElementById('at-stop').addEventListener('click', () => {
    GM_setValue(RUN_KEY, false);
    GM_setValue(PAUSE_KEY, false);
    setPauseButtonLabel();
    setStatus('Stopping...');

    // Wipe the on-page log per earlier request (the Sheet link itself is
    // kept, same as before, so Start doesn't need it re-entered).
    const logBox = document.getElementById('at-log');
    if (logBox) logBox.innerHTML = '';
  });

  log('Etsy helper loaded. Dán link Google Sheet rồi bấm Start.');
})();
