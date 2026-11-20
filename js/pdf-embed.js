// "Read in the page" for a ::pdf card in a post (see PDF_RE in scripts/lib/markdown.mjs).
// The card is plain HTML with a normal Download link, so it works without this script. With it, the "Read in the page" link opens the site's own
// reader (js/papers-reader.js, pdf.js hosted here): zoom, find, thumbnails, Download and Print. Nothing is sent anywhere and nothing is stored here
// (the reader keeps its one dark-mode preference, listed in the Cookie Policy). If the reader cannot start, the link opens the PDF in a new tab,
// which is what the link does without script.
let readerModule = null;
const load = () => (readerModule ||= import('./papers-reader.js').catch((err) => { readerModule = null; throw err; }));

document.addEventListener('click', async (e) => {
  const link = e.target.closest?.('[data-pdf-open]');
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const fig = link.closest('[data-pdf-embed]');
  const url = fig?.dataset.pdfUrl;
  if (!url) return;
  e.preventDefault();
  link.classList.add('is-busy');
  try {
    const { openReader } = await load();
    openReader({ docs: [{ kind: '', url }], title: fig.dataset.title || 'PDF guide', subtitle: 'Mayobe Bros' });
  } catch {
    window.open(url, '_blank', 'noopener'); // the browser's own viewer still shows the file
  } finally {
    link.classList.remove('is-busy');
  }
});

// a pointer resting on the button (or keyboard focus) fetches the reader ahead of time, so the first press opens at once
const warm = (e) => {
  if (readerModule || navigator.connection?.saveData || !e.target.closest?.('[data-pdf-open]')) return;
  load().catch(() => {});
};
document.addEventListener('pointerover', warm, { passive: true });
document.addEventListener('focusin', warm);
