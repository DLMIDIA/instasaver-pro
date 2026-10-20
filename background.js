/**
 * InstaSaver Pro - Background Service Worker
 * Filtra tráfego para reter APENAS vídeos reais e fotos em alta resolução.
 * Descarta pixels de rastreamento, avatars, miniaturas e chunks corrompidos.
 */

// Cache de URLs de mídia legítimas por aba
const verifiedMediaByTab = new Map();
const MAX_CACHE = 25;

// Monitoramento inteligente de tráfego de mídia (CDN Instagram / Meta)
if (chrome.webRequest && chrome.webRequest.onResponseStarted) {
  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      try {
        const { url, tabId, responseHeaders } = details;
        if (!url || tabId < 0) return;

        // Apenas URLs das CDNs do Instagram/Meta
        const isCdn = url.includes('cdninstagram.com') || url.includes('fbcdn.net');
        if (!isCdn) return;

        // Descarta avatares, miniaturas e rastreadores
        if (
          url.includes('s150x150') ||
          url.includes('s320x320') ||
          url.includes('profile_pic') ||
          url.includes('/rsrc.php') ||
          url.includes('logging_client_events')
        ) {
          return;
        }

        let isVideo = false;
        let isImage = false;
        let contentLength = 0;

        if (responseHeaders) {
          for (const h of responseHeaders) {
            const name = h.name.toLowerCase();
            const val = (h.value || '').toLowerCase();

            if (name === 'content-type') {
              if (val.includes('video/mp4') || val.includes('video/webm')) isVideo = true;
              else if (val.includes('image/jpeg') || val.includes('image/webp')) isImage = true;
            }
            if (name === 'content-length') {
              contentLength = parseInt(val, 10) || 0;
            }
          }
        }

        // Se não tiver cabeçalho explícito, inspeciona pela URL
        if (!isVideo && !isImage) {
          if (url.includes('.mp4') || url.includes('/v/t50.') || url.includes('&efg=')) isVideo = true;
          else if (url.includes('.jpg') || url.includes('/v/t51.')) isImage = true;
        }

        // FILTRO DE TAMANHO MÍNIMO PARA ELIMINAR ARQUIVOS QUEBRADOS:
        // Vídeos legítimos devem ter mais de 100 KB
        // Imagens legítimas de post devem ter mais de 40 KB
        if (contentLength > 0) {
          if (isVideo && contentLength < 100000) return; // descarta fragmentos < 100KB
          if (isImage && contentLength < 40000) return;  // descarta ícones e miniaturas
        }

        if (isVideo || isImage) {
          if (!verifiedMediaByTab.has(tabId)) {
            verifiedMediaByTab.set(tabId, []);
          }
          const list = verifiedMediaByTab.get(tabId);

          // Normaliza URL limpando parâmetros de corte/byte range se existirem
          const cleanUrl = cleanCdnUrl(url);

          const exists = list.some(item => item.url === cleanUrl);
          if (!exists) {
            list.unshift({
              url: cleanUrl,
              type: isVideo ? 'video' : 'image',
              size: contentLength,
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

// Remove parâmetros de byte range para garantir que o download baixe o vídeo completo do início ao fim
function cleanCdnUrl(url) {
  try {
    const u = new URL(url);
    // Remove parâmetros que cortam o arquivo em pedaços pequenos
    u.searchParams.delete('bytestart');
    u.searchParams.delete('byteend');
    return u.toString();
  } catch (e) {
    return url;
  }
}

// Limpeza de abas
chrome.tabs.onRemoved.addListener((tabId) => {
  verifiedMediaByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url && !changeInfo.url.includes('instagram.com')) {
    verifiedMediaByTab.delete(tabId);
  }
});

// Mensagens
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = (sender && sender.tab && sender.tab.id) || message.tabId;

  if (message.action === 'GET_RECENT_MEDIA') {
    const list = verifiedMediaByTab.get(tabId) || [];
    sendResponse({ success: true, media: list });
    return true;
  }

  if (message.action === 'DOWNLOAD_MEDIA') {
    const { url, filename, saveAs } = message;
    if (!url) {
      sendResponse({ success: false, error: 'URL inválida' });
      return true;
    }

    const cleanUrl = cleanCdnUrl(url);
    const safeFilename = sanitizeFilename(filename || `insta_video_${Date.now()}.mp4`);

    chrome.downloads.download({
      url: cleanUrl,
      filename: safeFilename,
      saveAs: Boolean(saveAs)
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('[InstaSaver] Erro no download:', chrome.runtime.lastError.message);
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

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}
