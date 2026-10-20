/**
 * InstaSaver Pro - Background Service Worker (v1.2.0)
 * Filtra fluxos DASH/VP9 da Meta e garante apenas vídeos H.264 com áudio AAC estéreo
 * compatíveis nativamente com QuickTime, Mac, iPhone e WhatsApp.
 */

const capturedVideosByTab = new Map();
const MAX_CACHE = 20;

if (chrome.webRequest && chrome.webRequest.onResponseStarted) {
  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      try {
        const { url, tabId, responseHeaders } = details;
        if (!url || tabId < 0) return;

        const isCdn = url.includes('cdninstagram.com') || url.includes('fbcdn.net');
        if (!isCdn) return;

        // 1. DESCARTA FLUXOS VP9 / DASH (Incompatíveis com QuickTime e sem áudio)
        if (
          url.includes('vp09') ||
          url.includes('vp9') ||
          url.includes('/dash-') ||
          url.includes('bytestart=')
        ) {
          return;
        }

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

        // Na Meta, 't50' identifica fluxos de VÍDEO
        if (url.includes('/t50.') || url.includes('/v/t50.') || url.includes('.mp4')) {
          isVideo = true;
        }

        if (responseHeaders && !isVideo) {
          for (const h of responseHeaders) {
            if (h.name.toLowerCase() === 'content-type') {
              const val = (h.value || '').toLowerCase();
              if (val.includes('video/mp4')) {
                isVideo = true;
                break;
              }
            }
          }
        }

        if (isVideo) {
          if (!capturedVideosByTab.has(tabId)) {
            capturedVideosByTab.set(tabId, []);
          }
          const list = capturedVideosByTab.get(tabId);

          const exists = list.some(item => item.url === url);
          if (!exists) {
            list.unshift({
              url: url,
              timestamp: Date.now()
            });

            if (list.length > MAX_CACHE) {
              list.pop();
            }
          }
        }
      } catch (err) {
        console.error('[InstaSaver] Erro no sniffer:', err);
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

// Limpeza de abas
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedVideosByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url && !changeInfo.url.includes('instagram.com')) {
    capturedVideosByTab.delete(tabId);
  }
});

// Mensagens
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = (sender && sender.tab && sender.tab.id) || message.tabId;

  if (message.action === 'GET_LATEST_VIDEO') {
    const list = capturedVideosByTab.get(tabId) || [];
    const latest = list.length > 0 ? list[0].url : null;
    sendResponse({ success: true, url: latest });
    return true;
  }

  if (message.action === 'DOWNLOAD_MEDIA') {
    const { url, filename, saveAs } = message;
    if (!url) {
      sendResponse({ success: false, error: 'URL vazia' });
      return true;
    }

    const safeFilename = (filename || `insta_video_${Date.now()}.mp4`).replace(/[/\\?%*:|"<>]/g, '_').trim();

    chrome.downloads.download({
      url: url,
      filename: safeFilename,
      saveAs: Boolean(saveAs)
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('[InstaSaver] Falha download:', chrome.runtime.lastError.message);
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
