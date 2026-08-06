// ==UserScript==
// @name         Etsy Auto Tracking (from Merchize)
// @namespace    etsy-auto-tracking
// @version      1.2
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
    function scanMerchizeOrders() {
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
      const rows = document.querySelectorAll('tr');

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

  function getOrderRows() {
    return Array.from(document.querySelectorAll('a[href*="order_id="]'))
      .map((a) => a.closest('.panel-body-row'))
      .filter((v, i, arr) => v && arr.indexOf(v) === i);
  }

  function getOrderId(row) {
    const a = row.querySelector('a[href*="order_id="]');
    if (!a) return null;
    const m = a.href.match(/order_id=(\d+)/);
    return m ? m[1] : null;
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

    trigger.click();
    await sleep(200);

    const container = trigger.closest('[data-dropdown-container="true"]');
    const menu = container.querySelector('[data-dropdown-target="true"]');
    await waitFor(
      () => menu.getAttribute('aria-hidden') === 'false' || !menu.classList.contains('is-closed'),
      { timeout: 3000, desc: 'dropdown open for order ' + orderId }
    );

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

  async function processOrder(row) {
    const orderId = getOrderId(row);
    if (!orderId) return;

    log('Checking order', orderId, 'against Merchize...');

    // Look up Merchize FIRST. Only open the "Complete order" modal at all
    // if we actually have tracking data to put into it.
    const result = await requestMerchizeLookup(orderId);

    if (!result.found) {
      log('  not found in Merchize -> skipped (no modal opened)');
      return;
    }
    log('  found:', result.tracking, '/', result.carrier);

    const opened = await openCompleteOrderModal(row, orderId);
    if (!opened) {
      log('  no "Complete order" action available on this row -> skipped');
      return;
    }

    try {
      await fillAndSubmit(orderId, result.tracking, result.carrier);
      log('  done:', result.tracking, '/', result.carrier);
    } catch (e) {
      log('  ERROR filling modal:', e.message);
      closeModalIfOpen(orderId);
    }
  }

  async function runAll() {
    GM_setValue(RUN_KEY, true);
    setStatus('Running...');
    const rows = getOrderRows();
    log(`Found ${rows.length} order(s) on this page.`);

    for (const row of rows) {
      if (!GM_getValue(RUN_KEY)) {
        log('Stopped by user.');
        break;
      }
      try {
        await processOrder(row);
      } catch (e) {
        log('ERROR processing row:', e.message);
      }
      // Give the page (and the browser) a moment to settle between orders —
      // running back-to-back with no pause is what tends to freeze the tab.
      await sleep(2000);
    }

    GM_setValue(RUN_KEY, false);
    setStatus('Idle');
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
    #at-panel .stop{background:#dc2626;color:#fff}
    #at-status{font:12px monospace;opacity:.8;margin-top:4px}
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
    <button class="stop" id="at-stop">Stop</button>
    <div id="at-log" class="at-log"></div>
  `;
  document.body.appendChild(panel);
  makeDraggable(panel, panel.querySelector('.at-drag-handle'), 'at_panel_pos_etsy');

  function setStatus(text) {
    const el = document.getElementById('at-status');
    if (el) el.textContent = text;
  }

  document.getElementById('at-start').addEventListener('click', () => {
    if (GM_getValue(RUN_KEY)) return;
    runAll();
  });
  document.getElementById('at-stop').addEventListener('click', () => {
    GM_setValue(RUN_KEY, false);
    setStatus('Stopping...');
  });

  log('Etsy helper loaded. Open the Merchize "Shipment Status" tab too, then click Start.');
})();
