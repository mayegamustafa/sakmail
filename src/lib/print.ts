'use client';

/**
 * Prints a conversation without disturbing the page it was opened from.
 *
 * The sheet is written into a hidden same-origin iframe rather than the current
 * document, so the app's own styling, sidebar and toolbars cannot reach the
 * paper and nothing has to be hidden with print-only rules. Browsers offer
 * "Save as PDF" from the same dialog, which is how a PDF comes out of this
 * without shipping a PDF library.
 */
export function printDocument(title: string, bodyHtml: string): void {
  if (typeof document === 'undefined') return;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Georgia,"Times New Roman",serif; color:#141C26; font-size:11pt; line-height:1.5; }
  .head { display:flex; align-items:center; gap:12px; border-bottom:2px solid #EC375A; padding-bottom:10px; margin-bottom:18px; }
  .head img { width:44px; height:44px; object-fit:contain; }
  .head h1 { margin:0; font-size:14pt; color:#A81433; }
  .head .meta { margin:2px 0 0; font-size:9pt; color:#6b6b6b; font-family:Arial,sans-serif; }
  h2.subject { font-size:13pt; margin:0 0 4px; }
  .thread-meta { font-family:Arial,sans-serif; font-size:9pt; color:#6b6b6b; margin:0 0 16px; }
  /* A message split across two sheets is hard to read and hard to file. */
  .msg { border:1px solid #ddd6d7; border-radius:6px; padding:12px 14px; margin:0 0 12px; page-break-inside:avoid; break-inside:avoid; }
  .msg .who { font-family:Arial,sans-serif; font-size:9.5pt; color:#141C26; font-weight:bold; margin:0; }
  .msg .addr { font-family:Arial,sans-serif; font-size:8.5pt; color:#6b6b6b; margin:2px 0 8px; }
  .msg .body { margin:0; white-space:pre-wrap; }
  .tag { display:inline-block; font-family:Arial,sans-serif; font-size:7.5pt; text-transform:uppercase; letter-spacing:.06em; border:1px solid #A81433; color:#A81433; border-radius:999px; padding:1px 7px; margin-left:6px; }
  .foot { margin-top:16px; border-top:1px solid #ddd6d7; padding-top:8px; font-family:Arial,sans-serif; font-size:8.5pt; color:#8a8a8a; }
</style></head><body>${bodyHtml}</body></html>`);
  doc.close();

  // Chrome needs the document, images included, settled before print() or the
  // badge is missing from the first page.
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Removing it at once cancels the dialog in Safari, so it lingers.
    window.setTimeout(() => frame.remove(), 60_000);
  };
  if (frame.contentWindow?.document.readyState === 'complete') window.setTimeout(go, 60);
  else frame.onload = () => window.setTimeout(go, 60);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sheetHead(title: string, subtitle?: string): string {
  return `<div class="head">
    <img src="/sak.jpg" alt="" />
    <div>
      <h1>Sir Apollo Kaggwa Schools</h1>
      <p class="meta">${escapeHtml(title)}${subtitle ? ` &middot; ${escapeHtml(subtitle)}` : ''} &middot; printed ${escapeHtml(new Date().toLocaleString())}</p>
    </div>
  </div>`;
}
