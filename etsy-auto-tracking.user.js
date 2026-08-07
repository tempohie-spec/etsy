// ==UserScript==
// @name         Etsy Auto Tracking (from Merchize)
// @namespace    etsy-auto-tracking
// @version      1.9
// @description  Auto complete Etsy orders with tracking number + carrier looked up from Merchize seller dashboard
// @match        https://www.etsy.com/your/orders/sold*
// @match        https://seller.merchize.com/a/orders*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Shared cross-tab protocol (GM storage is shared per-script regardless
  // of which domain/tab is reading/writing it).
  //   AT_REQUEST  = { orderId, ts }                      set by Etsy tab
  //   AT_RESPONSE = { orderId, found, tracking, carrier, ts }  set by Merchize tab
  // ---------------------------------------------------------------------

  const REQ_KEY = 'AT_REQUEST';
  const RES_KEY = 'AT_RESPONSE';

  // Manual overrides if the automatic substring match picks the wrong
  // carrier option. Key = lowercase Merchize carrier text (or part of it),
  // value = exact text of the Etsy <option> to pick. Leave empty if the
  // automatic matching (see matchCarrierOption) works fine for your shop.
  const CARRIER_ALIASES = {
    // 'dhl ecommerce': 'DHL',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // Make `panel` draggable by its `handle` element, remembering position
  // (per tab type) in localStorage so it persists across page reloads.
  function makeDraggable(panel, handle, storageKey) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

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
      localStorage.setItem(
        storageKey,
        JSON.stringify({ left: parseInt(panel.style.left, 10), top: parseInt(panel.style.top, 10) })
      );
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

  // ===================================================================
  //  MERCHIZE TAB
  // ===================================================================
  if (location.hostname === 'seller.merchize.com') {
    // Scanning the whole document's <tr> list on every single lookup gets
    // expensive fast on shops with a big order list (hundreds of rows, each
    // with several nested tooltip/copy-button divs) — that's what was
    // tipping the tab into a freeze/crash during long runs. Two cheap fixes:
    //   1. Scope the scan to the actual orders <table> instead of the whole
    //      document (skips sidebar/nav/etc. entirely).
    //   2. Cache the resulting map for a couple seconds, since Etsy only
    //      asks for a lookup once every ~2s anyway — no need to re-walk the
    //      whole table that often.
    let cachedTable = null;
    let cachedMap = null;
    let cachedAt = 0;
    const SCAN_CACHE_TTL_MS = 2000;

    function getOrdersTable() {
      if (cachedTable && document.contains(cachedTable)) return cachedTable;
      const anyCode = document.querySelector('td.OrderCodeCell');
      cachedTable = anyCode ? anyCode.closest('table') : null;
      return cachedTable;
    }

    function scanMerchizeOrders() {
      const now = Date.now();
      if (cachedMap && now - cachedAt < SCAN_CACHE_TTL_MS) return cachedMap;

      // Walk all <tr> in document order. Whenever we see a row containing
      // td.OrderCodeCell we remember its <code> text as the "current"
      // external order number; the following tr.OrderExtendPackagesRow
      // row(s) carry the tracking link + carrier text for that order, inside
      // the <td> that holds the a.PackageName link:
      //   <td class="align-top" colspan="2">
      //     <a class="PackageName">RN-...-F1 (1/1)</a>
      //     <div class="">USPS</div>
      //     <a target="_blank" href="...">TRACKINGNUMBER</a>
      //   </td>
      const map = {};
      let currentExternal = null;
      const table = getOrdersTable();
      const rows = table ? table.querySelectorAll('tr') : document.querySelectorAll('tr');

      rows.forEach((tr) => {
        const codeEl = tr.querySelector('td.OrderCodeCell code');
        if (codeEl) {
          currentExternal = codeEl.textContent.trim();
          return;
        }
        if (!tr.classList.contains('OrderExtendPackagesRow') || !currentExternal) return;

        const packageLink = tr.querySelector('a.PackageName');
        if (!packageLink) return;
        const packageTd = packageLink.closest('td');
        if (!packageTd) return;

        const trackingA = packageTd.querySelector('a[target="_blank"]');
        if (!trackingA) return;
        const tracking = trackingA.textContent.trim();

        // carrier = whatever isn't one of the two <a> links in that cell
        // (currently a bare <div>USPS</div> / <div>DHL eCommerce</div> etc.)
        let carrier = '';
        packageTd.childNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A') return;
          carrier += node.textContent;
        });
        carrier = carrier.replace(/\s+/g, ' ').trim();

        if (!map[currentExternal]) map[currentExternal] = [];
        map[currentExternal].push({ tracking, carrier });
      });

      cachedMap = map;
      cachedAt = now;
      return map;
    }

    function handleRequest(orderId) {
      log('Lookup requested for order', orderId);
      const map = scanMerchizeOrders();
      const entries = map[orderId];
      if (entries && entries.length) {
        const { tracking, carrier } = entries[0];
        log('  -> found', { tracking, carrier });
        GM_setValue(RES_KEY, { orderId, found: true, tracking, carrier, ts: Date.now() });
      } else {
        log('  -> not found on this page');
        GM_setValue(RES_KEY, { orderId, found: false, ts: Date.now() });
      }
    }

    GM_addValueChangeListener(REQ_KEY, (name, oldVal, newVal) => {
      if (!newVal || !newVal.orderId) return;
      handleRequest(newVal.orderId);
    });

    // Small floating panel so you know the helper is alive on this tab, with
    // a short rolling log of lookups it has answered. Draggable via its title bar.
    GM_addStyle(`
      #at-panel{position:fixed;bottom:16px;right:16px;z-index:999999;
        background:#111;color:#fff;font:13px sans-serif;padding:10px 12px;
        border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.4);width:240px}
      .at-drag-handle{cursor:move;user-select:none;padding-bottom:6px;margin-bottom:6px;
        border-bottom:1px solid rgba(255,255,255,.15)}
      #at-status{font:12px monospace;opacity:.8}
      .at-log{margin-top:8px;max-height:150px;overflow-y:auto;background:#000;
        border-radius:6px;padding:6px;font:11px/1.4 monospace;color:#9ca3af}
      .at-log-line{white-space:pre-wrap;word-break:break-word;
        border-bottom:1px solid rgba(255,255,255,.06);padding:2px 0}
      .at-log-line:last-child{border-bottom:none}
    `);

    const panel = document.createElement('div');
    panel.id = 'at-panel';
    panel.innerHTML = `
      <div class="at-drag-handle"><strong>Merchize AutoTrack</strong></div>
      <div id="at-status">Listening...</div>
      <div id="at-log" class="at-log"></div>
    `;
    document.body.appendChild(panel);
    makeDraggable(panel, panel.querySelector('.at-drag-handle'), 'at_panel_pos_merchize');

    log('Merchize helper loaded.');

    return; // nothing else to do on this domain
  }

  // ===================================================================
  //  ETSY TAB
  // ===================================================================

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

  async function requestMerchizeLookup(orderId) {
    GM_deleteValue(RES_KEY);
    GM_setValue(REQ_KEY, { orderId, ts: Date.now() });
    try {
      return await waitFor(
        () => {
          const r = GM_getValue(RES_KEY);
          return r && r.orderId === orderId ? r : null;
        },
        { timeout: 15000, interval: 300, desc: 'Merchize response for ' + orderId }
      );
    } catch (e) {
      log('  no response from Merchize tab (is it open on the Shipment Status list?)', e.message);
      return { orderId, found: false };
    }
  }

  // ---------------------------------------------------------------------
  // Alternative data source: paste a copy of the tracking sheet's DATA ROWS
  // ONLY (no header) — select the range in Google Sheets, Ctrl+C, paste into
  // the textarea — instead of relying on the Merchize tab.
  //
  // No header means columns can't be matched by name, so this uses a fixed
  // positional convention instead (adjust the constants below if your sheet
  // is laid out differently):
  //   - column index 1 (the 2nd column) = ORDER CODE
  //   - the LAST column of each row     = carrier (DVVC)
  //   - the 2nd-to-last column          = TRACKING
  //
  // The tricky part: a cell with a manual line break (Alt+Enter) — e.g. a
  // wrapped name or address — copies as a literal newline embedded in the
  // clipboard text, which would otherwise look like "the next row" to a
  // naive line-by-line parser. To handle that, a line only starts a NEW row
  // if its first cell looks like a date (matches column 0 / ORDER DATE);
  // any other line is treated as a continuation and glued onto the row
  // being built (its first cell merges into the previous row's last cell,
  // the rest become new cells) — this keeps every column correctly aligned
  // by the time a row is complete.
  // ---------------------------------------------------------------------

  let dataSource = localStorage.getItem('at_data_source') || 'merchize';
  let sheetMap = null; // orderId -> { tracking, carrier }
  let sheetOrder = null; // order ids, in the order they appear in the pasted sheet

  const ORDER_CODE_COLUMN_INDEX = 1;
  const ROW_START_DATE_RE = /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/;

  function parseSheetPaste(text) {
    const rawLines = text.split(/\r?\n/);
    const rows = [];
    let current = null;

    for (const rawLine of rawLines) {
      if (rawLine.trim() === '') continue; // skip blank separator lines
      const cells = rawLine.split('\t');
      const looksLikeRowStart = ROW_START_DATE_RE.test((cells[0] || '').trim());

      if (looksLikeRowStart) {
        if (current) rows.push(current);
        current = cells.slice();
      } else if (current) {
        // Continuation line from a wrapped cell: glue its first field onto
        // the row's last cell so far, append the rest as new cells.
        current[current.length - 1] += '\n' + cells[0];
        for (let i = 1; i < cells.length; i++) current.push(cells[i]);
      }
      // A line before any row has started (e.g. a stray header) is ignored.
    }
    if (current) rows.push(current);

    if (!rows.length) return { ok: false, rowCount: 0 };

    const map = {};
    const order = []; // unique order ids, first-appearance order
    let count = 0;
    for (const cells of rows) {
      if (cells.length < ORDER_CODE_COLUMN_INDEX + 3) continue; // not enough columns
      const orderId = (cells[ORDER_CODE_COLUMN_INDEX] || '').trim();
      const carrier = (cells[cells.length - 1] || '').trim();
      const tracking = (cells[cells.length - 2] || '').trim();
      if (!orderId || !tracking) continue; // order not shipped yet -> skip
      if (!(orderId in map)) order.push(orderId);
      map[orderId] = { tracking, carrier }; // last occurrence wins if duplicated
      count++;
    }
    return { ok: true, map, order, count, rowCount: rows.length };
  }

  async function lookupTracking(orderId) {
    if (dataSource === 'sheet') {
      if (!sheetMap) return { orderId, found: false };
      const entry = sheetMap[orderId];
      return entry
        ? { orderId, found: true, tracking: entry.tracking, carrier: entry.carrier }
        : { orderId, found: false };
    }
    return requestMerchizeLookup(orderId);
  }

  // Returns true if a real "open modal / fill / submit" attempt happened
  // (used by runAll to decide how long to pause before the next order —
  // a quick skip shouldn't cost the same settle time as a real completion).
  async function processOrder(orderId) {
    const sourceLabel = dataSource === 'sheet' ? 'Sheet' : 'Merchize';

    if (dataSource === 'sheet') {
      // Driving the loop off the sheet means scanning every order number in
      // it from the top and matching against what's on the Etsy page — the
      // sheet can hold far more history than the page currently shows, so
      // check page presence first (cheap, synchronous) and skip near-
      // instantly (no log line) for anything not currently on the page.
      if (!findRowByOrderId(orderId)) return false;
    }

    log('Checking order', orderId, 'against', sourceLabel, '...');

    // Look up the tracking source FIRST. Only open the "Complete order"
    // modal at all if we actually have tracking data to put into it.
    const result = await lookupTracking(orderId);

    if (!result.found) {
      log(`  not found in ${sourceLabel} -> skipped (no modal opened)`);
      return false;
    }
    log('  found:', result.tracking, '/', result.carrier);

    // Fetch the row fresh right before touching it (see findRowByOrderId).
    const row = await waitForRow(orderId);
    if (!row) {
      log('  row no longer on page -> skipped');
      return false;
    }

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

    let orderIds;
    if (dataSource === 'sheet') {
      // Driven by the sheet: scan every order number in it, top to bottom,
      // and match each against the current Etsy page (see processOrder).
      if (!sheetOrder || !sheetOrder.length) {
        log('Chưa có dữ liệu Sheet — bấm "Nạp dữ liệu Sheet" trước.');
        orderIds = [];
      } else {
        orderIds = sheetOrder;
        log(`Scanning ${orderIds.length} order(s) from Sheet against this page...`);
      }
    } else {
      orderIds = getOrderIds();
      log(`Found ${orderIds.length} order(s) on this page.`);
    }

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
      // open-modal/fill/submit attempt; a quick non-match skip (common when
      // scanning a large sheet against a much shorter page) doesn't need it.
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
    .at-drag-handle{cursor:move;user-select:none;padding-bottom:6px;margin-bottom:6px;
      border-bottom:1px solid rgba(255,255,255,.15)}
    #at-panel button{width:100%;margin-top:6px;padding:6px 0;border:0;border-radius:6px;
      cursor:pointer;font:13px sans-serif;font-weight:600}
    #at-panel .start{background:#16a34a;color:#fff}
    #at-panel .pause{background:#d97706;color:#fff}
    #at-panel .stop{background:#dc2626;color:#fff}
    #at-status{font:12px monospace;opacity:.8;margin-top:4px}
    .at-source{margin-top:8px;font:12px sans-serif}
    .at-source label{display:block;margin-top:2px;cursor:pointer}
    #at-sheet-import textarea{width:100%;box-sizing:border-box;margin-top:6px;
      font:10px monospace;resize:vertical;background:#1a1a1a;color:#e5e7eb;
      border:1px solid #333;border-radius:4px;padding:4px}
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
    <div class="at-drag-handle"><strong>Etsy Auto Tracking</strong></div>
    <div id="at-status">Idle</div>
    <button class="start" id="at-start">Start</button>
    <button class="pause" id="at-pause">Pause</button>
    <button class="stop" id="at-stop">Stop</button>
    <div class="at-source">
      <label><input type="radio" name="at-source" value="merchize"> Nguồn: Merchize (tab)</label>
      <label><input type="radio" name="at-source" value="sheet"> Nguồn: dán từ Sheet</label>
    </div>
    <div id="at-sheet-import">
      <textarea id="at-sheet-paste" rows="3" placeholder="Bôi đen các dòng dữ liệu trong Sheet (KHÔNG cần dòng header), Ctrl+C, rồi dán (Ctrl+V) vào đây"></textarea>
      <button class="start" id="at-sheet-load">Nạp dữ liệu Sheet</button>
      <div id="at-sheet-info"></div>
    </div>
    <div id="at-log" class="at-log"></div>
  `;
  document.body.appendChild(panel);
  makeDraggable(panel, panel.querySelector('.at-drag-handle'), 'at_panel_pos_etsy');

  function setStatus(text) {
    const el = document.getElementById('at-status');
    if (el) el.textContent = text;
  }

  function applyDataSourceUI() {
    panel.querySelectorAll('input[name="at-source"]').forEach((r) => {
      r.checked = r.value === dataSource;
    });
    document.getElementById('at-sheet-import').style.display =
      dataSource === 'sheet' ? 'block' : 'none';
  }
  applyDataSourceUI();

  panel.querySelectorAll('input[name="at-source"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      dataSource = e.target.value;
      localStorage.setItem('at_data_source', dataSource);
      applyDataSourceUI();
      log('Data source ->', dataSource);
    });
  });

  document.getElementById('at-sheet-load').addEventListener('click', () => {
    const text = document.getElementById('at-sheet-paste').value;
    const info = document.getElementById('at-sheet-info');

    if (!text.trim()) {
      info.textContent = 'Ô dán đang trống.';
      return;
    }

    const result = parseSheetPaste(text);
    if (!result.ok) {
      info.textContent =
        'Không dò được dòng đơn nào.\n' +
        '-> Mỗi đơn phải bắt đầu bằng cột ORDER DATE dạng ngày/tháng/năm (VD: 5/8/26).';
      log('Sheet import failed: no rows detected.');
      return;
    }
    if (result.count === 0) {
      info.textContent =
        `Đọc được ${result.rowCount} dòng đơn nhưng không đơn nào có TRACKING để nạp ` +
        `(có thể các đơn chưa có tracking, hoặc thiếu cột mã đơn/tracking ở cuối mỗi dòng).`;
      log(`Sheet import: ${result.rowCount} row(s) read, 0 with tracking.`);
      return;
    }

    sheetMap = result.map;
    sheetOrder = result.order;
    info.textContent = `Đã nạp ${result.count} đơn từ Sheet.`;
    log(`Sheet import: loaded ${result.count} order(s).`);
  });

  function setPauseButtonLabel() {
    const btn = document.getElementById('at-pause');
    if (btn) btn.textContent = GM_getValue(PAUSE_KEY) ? 'Resume' : 'Pause';
  }

  // Start: begins a brand-new run (fresh scan of the current order list) if
  // idle, or resumes if currently paused. Pause: temporarily halts the loop
  // in place — same in-progress list, same position, nothing re-scanned.
  // Stop: cancels the run entirely; the next Start rescans from the top.
  document.getElementById('at-start').addEventListener('click', () => {
    if (GM_getValue(RUN_KEY)) {
      if (GM_getValue(PAUSE_KEY)) {
        GM_setValue(PAUSE_KEY, false);
        setPauseButtonLabel();
        log('Resumed by user.');
      }
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

    // Wipe the pasted-sheet textarea and the on-page log per user request.
    const paste = document.getElementById('at-sheet-paste');
    if (paste) paste.value = '';
    const logBox = document.getElementById('at-log');
    if (logBox) logBox.innerHTML = '';
  });

  log('Etsy helper loaded. Open the Merchize "Shipment Status" tab too, then click Start.');
})();
