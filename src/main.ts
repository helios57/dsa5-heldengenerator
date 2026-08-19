export {}; // force module scope; otherwise `status` collides with the ambient DOM global `window.status`

const status = document.querySelector<HTMLElement>('#status');
if (status) status.textContent = 'bereit';
