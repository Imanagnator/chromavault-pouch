/* Pouch viewer runtime — shell wiring (sidebar filter etc.) */
(function () {
  'use strict';
  const PV = window.PV;
  function wireFilter() {
    const input = document.getElementById('file-filter');
    if (!input || input._pv) return;
    input._pv = true;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      document.querySelectorAll('#file-list .file-item').forEach((el) => {
        el.style.display = !q || (el.getAttribute('aria-label') || '').toLowerCase().includes(q) ? '' : 'none';
      });
      document.querySelectorAll('#file-list .folder-content').forEach((c) => {
        const any = [...c.children].some((x) => x.style.display !== 'none');
        c.parentElement.style.display = any || !q ? '' : 'none';
        if (q && any) { c.classList.add('open'); const hd = c.previousElementSibling; hd && hd.classList.add('open'); }
      });
    });
  }
  PV.shell = { wireFilter };
  document.addEventListener('DOMContentLoaded', wireFilter);
  if (document.readyState !== 'loading') wireFilter();
})();
