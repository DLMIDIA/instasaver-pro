/**
 * InstaSaver Pro - Background Service Worker
 * Intercepta URLs das CDNs da Meta (t50 para vídeos) e remove parâmetros de corte (bytestart/byteend)
 * para fornecer o download do arquivo MP4 completo e com som.
 */

const videoUrlsByTab = new Map();
const MAX_CACHE = 30;

// Remove parâmetros de corte da URL para que o CDN envie o vídeo inteiro
function stripRangeParams(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('bytestart');
    u.searchParams.delete('byteend');
    return u.toString();
  } catch (e) {
    return url;
  }
}

// Intercepta todas as requisições de mídia da CDN do Instagram
if (chrome.webRequest && chrome.webRequest.onResponseStarted) {
  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      try {
        const { url, tabId, responseHeaders } = details;
        if (!url || tabId < 0) return;

        const isCdn = url.includes('cdninstagram.com') || url.includes('fbcdn.net');
        if (!isCdn) return;

        // Descarta avatares, rastreadores e scripts
        if (
          url.includes('s150x150') ||
          url.includes('s320x320') ||
          url.includes('profile_pic') ||
          url.includes('logging_client_events') ||
          url.includes('/rsrc.php')
        ) {
          return;
        }

        let isVideo = false;

        // Na CDN da Meta, 't50' é o identificador oficial de fluxos de VÍDEO
        if (url.includes('/t50.') || url.includes('/v/t50.') || url.includes('.mp4')) {
          isVideo = true;
        }

        // Checagem por cabeçalho Content-Type
        if (responseHeaders && !isVideo) {
          for (const h of responseHeaders) {
            if (h.name.toLowerCase() === 'content-type') {
              const val = (h.value || '').toLowerCase();
              if (val.includes('video/mp4') || val.includes('video/webm')) {
                isVideo = true;
                break;
              }
            }
          }
        }

        if (isVideo) {
          if (!videoUrlsByTab.has(tabId)) {
            videoUrlsByTab.set(tabId, []);
          }
          const list = videoUrlsByTab.get(tabId);
          const fullVideoUrl = stripRangeParams(url);

          const exists = list.some(item => item.url === fullVideoUrl);
          if (!exists) {
            list.unshift({
              url: fullVideoUrl,
              timestamp: Date.now()
            });

            if (list.length > MAX_CACHE) {
              list.pop();
            }
          }
        }
      } catch (err) {
        console.error('[InstaSaver] Erro ao monitorar CDN:', err);
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

// Limpeza de cache
chrome.tabs.onRemoved.addListener((tabId) => {
  videoUrlsByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url && !changeInfo.url.includes('instagram.com')) {
    videoUrlsByTab.delete(tabId);
  }
});

// Comunicação
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = (sender && sender.tab && sender.tab.id) || message.tabId;

  // Retorna os vídeos reais capturados para esta aba
  if (message.action === 'GET_RECENT_VIDEOS') {
    const list = videoUrlsByTab.get(tabId) || [];
    sendResponse({ success: true, videos: list });
    return true;
  }

  // Executa o download via API oficial do Chrome
  if (message.action === 'DOWNLOAD_MEDIA') {
    const { url, filename, saveAs } = message;
    if (!url) {
      sendResponse({ success: false, error: 'URL vazia' });
      return true;
    }

    const cleanUrl = stripRangeParams(url);
    const safeFilename = (filename || `insta_video_${Date.now()}.mp4`).replace(/[/\\?%*:|"<>]/g, '_').trim();

    chrome.downloads.download({
      url: cleanUrl,
      filename: safeFilename,
      saveAs: Boolean(saveAs)
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('[InstaSaver] Falha no chrome.downloads:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }

  if (message.action === 'OPEN_INSTAGRAM') {
    chrome.tabs.create({ url: message.url || 'https://www.instagram.com/' });
    sendResponse({ success: true });
    return true;
  }
});
