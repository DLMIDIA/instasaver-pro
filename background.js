/**
 * InstaSaver Pro - Background Service Worker
 * Gerencia downloads, captura de tráfego de mídia em segundo plano e comunicação.
 */

// Armazena URLs de mídia interceptadas por aba
const mediaCacheByTab = new Map();
const MAX_CACHE_PER_TAB = 50;

// Sniffer de requisições de mídia do Instagram (CDN)
if (chrome.webRequest && chrome.webRequest.onResponseStarted) {
  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      try {
        const { url, tabId, responseHeaders } = details;
        if (!url || tabId < 0) return;

        // Verifica se é um arquivo de vídeo ou imagem das CDNs do Instagram/Meta
        const isCdn = url.includes('cdninstagram.com') || url.includes('fbcdn.net');
        if (!isCdn) return;

        let isVideo = false;
        let isImage = false;

        // Análise de cabeçalhos Content-Type
        if (responseHeaders) {
          const contentTypeHeader = responseHeaders.find(
            h => h.name.toLowerCase() === 'content-type'
          );
          if (contentTypeHeader && contentTypeHeader.value) {
            const val = contentTypeHeader.value.toLowerCase();
            if (val.includes('video/mp4') || val.includes('video/webm')) isVideo = true;
            if (val.includes('image/jpeg') || val.includes('image/webp') || val.includes('image/png')) isImage = true;
          }
        }

        // Análise por URL caso não haja header explícito
        if (!isVideo && !isImage) {
          if (url.includes('.mp4') || url.includes('/v/t50.') || url.includes('&efg=')) isVideo = true;
          else if (url.includes('.jpg') || url.includes('.webp') || url.includes('/v/t51.')) isImage = true;
        }

        if (isVideo || isImage) {
          if (!mediaCacheByTab.has(tabId)) {
            mediaCacheByTab.set(tabId, []);
          }
          const list = mediaCacheByTab.get(tabId);
          
          // Evita duplicatas recentes
          const exists = list.some(item => item.url === url);
          if (!exists) {
            list.unshift({
              url: url,
              type: isVideo ? 'video' : 'image',
              timestamp: Date.now()
            });
            if (list.length > MAX_CACHE_PER_TAB) {
              list.pop();
            }
          }
        }
      } catch (err) {
        console.error('[InstaSaver] Erro ao analisar requisição:', err);
      }
    },
    {
      urls: [
        "*://*.cdninstagram.com/*",
        "*://*.fbcdn.net/*"
      ]
    },
    ["responseHeaders"]
  );
}

// Limpa cache quando a aba for fechada
chrome.tabs.onRemoved.addListener((tabId) => {
  mediaCacheByTab.delete(tabId);
});

// Limpa cache quando a página recarregar ou navegar
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Mantém o cache se for navegação interna SPA, limpa se for URL completamente nova
    if (changeInfo.url && !changeInfo.url.includes('instagram.com')) {
      mediaCacheByTab.delete(tabId);
    }
  }
});

// Mensagens vindas do Content Script e Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = (sender && sender.tab && sender.tab.id) || message.tabId;

  if (message.action === 'GET_SNIFFED_MEDIA') {
    const list = mediaCacheByTab.get(tabId) || [];
    sendResponse({ success: true, media: list });
    return true;
  }

  if (message.action === 'DOWNLOAD_MEDIA') {
    const { url, filename, saveAs } = message;
    
    // Tratamento de nome de arquivo limpo
    const safeFilename = sanitizeFilename(filename || `instagram_media_${Date.now()}.mp4`);

    chrome.downloads.download({
      url: url,
      filename: safeFilename,
      saveAs: Boolean(saveAs)
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('[InstaSaver] Falha no download:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }

  if (message.action === 'BATCH_DOWNLOAD') {
    const items = message.items || [];
    let completed = 0;
    let errors = 0;

    items.forEach((item, index) => {
      setTimeout(() => {
        const safeFilename = sanitizeFilename(item.filename || `instagram_${index + 1}_${Date.now()}.${item.type === 'video' ? 'mp4' : 'jpg'}`);
        chrome.downloads.download({
          url: item.url,
          filename: safeFilename,
          saveAs: false
        }, (id) => {
          if (chrome.runtime.lastError) errors++;
          else completed++;
        });
      }, index * 350); // intervalo de 350ms para não bloquear o Chrome
    });

    sendResponse({ success: true, total: items.length });
    return true;
  }

  if (message.action === 'OPEN_INSTAGRAM') {
    chrome.tabs.create({ url: message.url || 'https://www.instagram.com/' });
    sendResponse({ success: true });
    return true;
  }
});

function sanitizeFilename(name) {
  // Remove caracteres inválidos no sistema de arquivos
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}
