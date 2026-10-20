/**
 * InstaSaver Pro - Inject Script (Roda no mundo MAIN da página)
 * Intercepta o fetch da Meta para capturar video_versions (H.264 + AAC)
 * e inspeciona o React Fiber dos elementos para obter o MP4 de alta qualidade.
 */

(function () {
  'use strict';

  // Cache de URLs H.264 por código do post
  const videoUrlCache = new Map();
  let lastCapturedVideoUrl = null;

  // 1. Intercepta requisições GraphQL e API da página para pegar video_versions
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
      if (url && (url.includes('/graphql/query') || url.includes('/api/v1/'))) {
        const clone = response.clone();
        clone.json().then(data => {
          scanObjectForVideos(data);
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  // Varre respostas JSON procurando por video_versions
  function scanObjectForVideos(obj, depth = 0) {
    if (!obj || depth > 8 || typeof obj !== 'object') return;

    if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
      const bestUrl = obj.video_versions[0].url;
      if (bestUrl) {
        lastCapturedVideoUrl = bestUrl;
        if (obj.code) videoUrlCache.set(obj.code, bestUrl);
      }
    }

    if (Array.isArray(obj)) {
      for (const item of obj) scanObjectForVideos(item, depth + 1);
    } else {
      for (const k in obj) {
        if (typeof obj[k] === 'object') {
          scanObjectForVideos(obj[k], depth + 1);
        }
      }
    }
  }

  // 2. Inspeciona a árvore React Fiber do elemento DOM
  function findVideoInFiber(domNode) {
    let curr = domNode;
    while (curr && curr !== document.body) {
      const fiberKey = Object.keys(curr).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey) {
        let fiber = curr[fiberKey];
        let depth = 0;
        while (fiber && depth < 60) {
          const props = fiber.memoizedProps;
          if (props) {
            const found = deepSearchProps(props, 0);
            if (found) return found;
          }
          fiber = fiber.return;
          depth++;
        }
      }
      curr = curr.parentElement;
    }
    return null;
  }

  function deepSearchProps(obj, depth) {
    if (!obj || depth > 5 || typeof obj !== 'object') return null;

    if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
      return obj.video_versions[0].url;
    }
    if (obj.videoUrl && typeof obj.videoUrl === 'string' && obj.videoUrl.startsWith('http')) {
      return obj.videoUrl;
    }

    for (const k of ['post', 'item', 'media', 'children', 'props', 'video']) {
      if (obj[k]) {
        const res = deepSearchProps(obj[k], depth + 1);
        if (res) return res;
      }
    }
    return null;
  }

  // 3. Comunicação com o content.js através de CustomEvent
  window.addEventListener('instasaver_query_video', (e) => {
    const { videoId, postCode } = e.detail || {};
    let resolvedUrl = null;

    // Tenta pelo código do post em cache
    if (postCode && videoUrlCache.has(postCode)) {
      resolvedUrl = videoUrlCache.get(postCode);
    }

    // Tenta inspecionar o React Fiber do elemento
    if (!resolvedUrl && videoId) {
      const el = document.getElementById(videoId) || document.querySelector(`[data-instasaver-id="${videoId}"]`);
      if (el) {
        resolvedUrl = findVideoInFiber(el);
      }
    }

    // Fallback: último vídeo H.264 interceptado
    if (!resolvedUrl) {
      resolvedUrl = lastCapturedVideoUrl;
    }

    // Responde ao content.js
    window.dispatchEvent(new CustomEvent('instasaver_video_response', {
      detail: { videoId, postCode, url: resolvedUrl }
    }));
  });

})();
