/**
 * InstaSaver Pro - Background Service Worker (v2.0.0)
 * Gerencia a fila de downloads via chrome.downloads API oficial.
 * Garante downloads sequenciais estáveis e nomes organizados.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Download Individual
  if (message.action === 'DOWNLOAD_MEDIA') {
    const { url, filename, saveAs } = message;
    if (!url) {
      sendResponse({ success: false, error: 'URL vazia ou inválida.' });
      return true;
    }

    const safeFilename = sanitizeFilename(filename || `insta_video_${Date.now()}.mp4`);

    chrome.downloads.download({
      url: url,
      filename: safeFilename,
      saveAs: Boolean(saveAs)
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('[InstaSaver] Erro no chrome.downloads:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }

  // 2. Download em Lote (ex: múltiplos vídeos do perfil do cliente)
  if (message.action === 'BATCH_DOWNLOAD') {
    const items = message.items || [];
    if (!items.length) {
      sendResponse({ success: false, error: 'Nenhum item na fila.' });
      return true;
    }

    let started = 0;
    items.forEach((item, index) => {
      // Intervalo de 400ms entre arquivos para não engasgar o Chrome
      setTimeout(() => {
        const safeName = sanitizeFilename(item.filename || `insta_lote_${index + 1}_${Date.now()}.mp4`);
        chrome.downloads.download({
          url: item.url,
          filename: safeName,
          saveAs: false
        });
        started++;
      }, index * 400);
    });

    sendResponse({ success: true, total: items.length });
    return true;
  }

  // 3. Abrir aba do Instagram
  if (message.action === 'OPEN_INSTAGRAM') {
    chrome.tabs.create({ url: message.url || 'https://www.instagram.com/' });
    sendResponse({ success: true });
    return true;
  }
});

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}
