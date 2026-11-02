/**
 * InstaSaver Pro - In-Page Engine (inject.js)
 * Roda no contexto "MAIN" da página do Instagram (document_start).
 * 
 * Funcionalidades:
 * 1. Intercepta todas as requisições Fetch e XHR da página para capturar
 *    os objetos reais de mídia com 'video_versions' (H.264 + áudio AAC estéreo).
 * 2. Inspeciona a árvore React Fiber dos componentes do DOM para extrair links diretos.
 * 3. Permite busca ativa via GraphQL e API oficial do Instagram caso a mídia não esteja em cache.
 * 4. Indexa vídeos por post, reel, story e perfil para permitir download individual e em lote.
 */

(function () {
  'use strict';

  // Armazém central de mídias indexadas
  window.__INSTASAVER_STORE__ = window.__INSTASAVER_STORE__ || {
    byShortcode: new Map(), // code -> MediaObject
    byId: new Map(),        // id/pk -> MediaObject
    recentVideos: [],       // Lista em ordem cronológica reversa
    profileVideos: new Map()// username -> [MediaObject]
  };

  const store = window.__INSTASAVER_STORE__;

  // Utilitário para extrair dados limpos de uma mídia
  function normalizeMediaItem(item) {
    if (!item || typeof item !== 'object') return null;

    // Se for um nó de carousel/sidecar ou edge
    const media = item.node || item;

    // Identificadores
    const code = media.code || media.shortcode || null;
    const id = media.id || media.pk || (code ? `c_${code}` : null);
    if (!code && !id) return null;

    // Verifica se tem vídeo
    let videoUrl = null;
    let isVideo = Boolean(media.is_video || media.media_type === 2 || media.video_versions);

    if (Array.isArray(media.video_versions) && media.video_versions.length > 0) {
      // Ordena por maior resolução para garantir a melhor qualidade
      const sorted = [...media.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
      videoUrl = sorted[0].url;
      isVideo = true;
    } else if (media.video_url && typeof media.video_url === 'string') {
      videoUrl = media.video_url;
      isVideo = true;
    }

    // Miniatura / Imagem
    let thumbnailUrl = null;
    if (media.image_versions2 && Array.isArray(media.image_versions2.candidates) && media.image_versions2.candidates.length > 0) {
      thumbnailUrl = media.image_versions2.candidates[0].url;
    } else if (media.display_url) {
      thumbnailUrl = media.display_url;
    } else if (Array.isArray(media.display_resources) && media.display_resources.length > 0) {
      thumbnailUrl = media.display_resources[media.display_resources.length - 1].src;
    }

    // Nome de usuário
    const username = media.user?.username || media.owner?.username || '';
    const takenAt = media.taken_at || media.taken_at_timestamp || Math.floor(Date.now() / 1000);
    const caption = media.caption?.text || media.edge_media_to_caption?.edges?.[0]?.node?.text || '';

    // Trata carrossel (múltiplas mídias no mesmo post)
    const carouselMedia = [];
    const children = media.carousel_media || media.edge_sidecar_to_children?.edges;
    if (Array.isArray(children)) {
      children.forEach(ch => {
        const sub = normalizeMediaItem(ch);
        if (sub) carouselMedia.push(sub);
      });
    }

    return {
      code,
      id,
      isVideo,
      videoUrl,
      thumbnailUrl,
      username,
      takenAt,
      caption: caption ? caption.slice(0, 120) : '',
      carouselMedia
    };
  }

  // Registra mídia no cache central
  function registerMediaItem(normalized) {
    if (!normalized) return;

    if (normalized.code) {
      store.byShortcode.set(normalized.code, normalized);
    }
    if (normalized.id) {
      store.byId.set(normalized.id, normalized);
    }

    // Se tiver vídeo direto, adiciona à lista de recentes
    if (normalized.isVideo && normalized.videoUrl) {
      const exists = store.recentVideos.some(v => v.videoUrl === normalized.videoUrl || (v.code && v.code === normalized.code));
      if (!exists) {
        store.recentVideos.unshift(normalized);
        if (store.recentVideos.length > 50) {
          store.recentVideos.pop();
        }
      }

      // Adiciona ao índice do perfil
      if (normalized.username) {
        if (!store.profileVideos.has(normalized.username)) {
          store.profileVideos.set(normalized.username, []);
        }
        const pList = store.profileVideos.get(normalized.username);
        const pExists = pList.some(v => v.code === normalized.code);
        if (!pExists) {
          pList.push(normalized);
        }
      }
    }

    // Registra filhos do carrossel
    if (normalized.carouselMedia && normalized.carouselMedia.length > 0) {
      normalized.carouselMedia.forEach(registerMediaItem);
    }
  }

  // Varredura recursiva de qualquer JSON vindo das APIs do Instagram
  function scanPayloadRecursively(obj, depth = 0) {
    if (!obj || depth > 9 || typeof obj !== 'object') return;

    // Detecta se este objeto representa uma mídia do Instagram
    if ((obj.code || obj.shortcode) && (obj.video_versions || obj.image_versions2 || obj.media_type || obj.is_video)) {
      const normalized = normalizeMediaItem(obj);
      if (normalized) {
        registerMediaItem(normalized);
      }
    }

    // Percorre arrays e objetos filhos
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        scanPayloadRecursively(obj[i], depth + 1);
      }
    } else {
      for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          const val = obj[k];
          if (val && typeof val === 'object') {
            scanPayloadRecursively(val, depth + 1);
          }
        }
      }
    }
  }

  // 1. INTERCEPTAÇÃO DO WINDOW.FETCH
  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await nativeFetch.apply(this, args);
    try {
      const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
      if (requestUrl && (
        requestUrl.includes('/graphql/query') ||
        requestUrl.includes('/api/v1/') ||
        requestUrl.includes('instagram.com')
      )) {
        const clone = response.clone();
        clone.json().then(data => {
          scanPayloadRecursively(data);
          // Notifica content.js que há novos dados disponíveis
          window.dispatchEvent(new CustomEvent('instasaver_data_updated', {
            detail: { count: store.recentVideos.length }
          }));
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  // 2. INTERCEPTAÇÃO DO XMLHTTPREQUEST
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._instasaverUrl = url;
    return nativeXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        const url = this._instasaverUrl || '';
        if (url.includes('/graphql/query') || url.includes('/api/v1/') || url.includes('instagram.com')) {
          if (this.responseType === '' || this.responseType === 'text') {
            const txt = this.responseText;
            if (txt && (txt.startsWith('{') || txt.startsWith('['))) {
              const data = JSON.parse(txt);
              scanPayloadRecursively(data);
            }
          } else if (this.responseType === 'json' && this.response) {
            scanPayloadRecursively(this.response);
          }
        }
      } catch (e) {}
    });
    return nativeXhrSend.apply(this, arguments);
  };

  // 3. INSPEÇÃO DE REACT FIBER (Deep Scan)
  function getReactFiber(domNode) {
    if (!domNode) return null;
    for (const key in domNode) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        return domNode[key];
      }
    }
    return null;
  }

  function searchFiberForMedia(domNode) {
    let curr = domNode;
    let iterations = 0;

    while (curr && curr !== document.documentElement && iterations < 25) {
      const fiber = getReactFiber(curr);
      if (fiber) {
        let f = fiber;
        let depth = 0;

        while (f && depth < 70) {
          // Inspeciona memoizedProps
          if (f.memoizedProps) {
            const found = deepExtractFromObject(f.memoizedProps, 0);
            if (found && found.videoUrl) return found;
          }
          // Inspeciona memoizedState
          if (f.memoizedState) {
            const found = deepExtractFromObject(f.memoizedState, 0);
            if (found && found.videoUrl) return found;
          }
          // Inspeciona stateNode
          if (f.stateNode && typeof f.stateNode === 'object') {
            const found = deepExtractFromObject(f.stateNode, 0);
            if (found && found.videoUrl) return found;
          }
          f = f.return;
          depth++;
        }
      }
      curr = curr.parentElement;
      iterations++;
    }
    return null;
  }

  function deepExtractFromObject(obj, depth = 0) {
    if (!obj || depth > 6 || typeof obj !== 'object') return null;

    if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
      const normalized = normalizeMediaItem(obj);
      if (normalized && normalized.videoUrl) return normalized;
    }

    if (obj.code && obj.video_url) {
      const normalized = normalizeMediaItem(obj);
      if (normalized && normalized.videoUrl) return normalized;
    }

    // Busca nas propriedades filhas
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const val = obj[key];
        if (val && typeof val === 'object') {
          const res = deepExtractFromObject(val, depth + 1);
          if (res && res.videoUrl) return res;
        }
      }
    }
    return null;
  }

  // 4. BUSCA ATIVA VIA GRAPHQL (PolarisPostRootQuery)
  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function getLsdToken() {
    let token = '';
    document.querySelectorAll('script[type="application/json"]').forEach(s => {
      const m = s.textContent.match(/\["LSD",\[\],\{"token":"([0-9a-zA-Z_-]+)"\}/);
      if (m && m[1]) token = m[1];
    });
    return token;
  }

  async function fetchMediaByShortcode(shortcode) {
    if (!shortcode) return null;

    // Verifica primeiro se já temos em cache
    if (store.byShortcode.has(shortcode)) {
      const cached = store.byShortcode.get(shortcode);
      if (cached.videoUrl) return cached;
    }

    // Tenta consulta oficial GraphQL PolarisPostRootQuery
    const docIds = ['39422285384081769', '27128499623469141', '8845758582119845'];
    const lsd = getLsdToken();
    const csrftoken = getCookie('csrftoken');

    for (const docId of docIds) {
      try {
        const formData = new URLSearchParams();
        formData.append('doc_id', docId);
        formData.append('variables', JSON.stringify({
          shortcode: shortcode,
          __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
          __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false
        }));
        if (lsd) formData.append('lsd', lsd);

        const resp = await nativeFetch('https://www.instagram.com/graphql/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-IG-App-ID': '936619743392459',
            'X-CSRFToken': csrftoken,
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: formData.toString()
        });

        if (resp.ok) {
          const json = await resp.json();
          scanPayloadRecursively(json);
          if (store.byShortcode.has(shortcode)) {
            const found = store.byShortcode.get(shortcode);
            if (found.videoUrl) return found;
          }
        }
      } catch (err) {}
    }

    // Fallback: consulta endpoint embed/info
    try {
      const resp2 = await nativeFetch(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
        headers: {
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (resp2.ok) {
        const json2 = await resp2.json();
        scanPayloadRecursively(json2);
        if (store.byShortcode.has(shortcode)) {
          return store.byShortcode.get(shortcode);
        }
      }
    } catch (err) {}

    return null;
  }

  // 5. ESCUTA REQUISIÇÕES DO CONTENT SCRIPT
  window.addEventListener('instasaver_request', async (e) => {
    const { requestId, action, shortcode, domSelector } = e.detail || {};

    if (action === 'GET_MEDIA_FOR_SHORTCODE') {
      let item = store.byShortcode.get(shortcode) || null;

      // Se não achou em cache, tenta inspecionar React Fiber no elemento
      if (!item && domSelector) {
        const el = document.querySelector(domSelector);
        if (el) {
          item = searchFiberForMedia(el);
          if (item) registerMediaItem(item);
        }
      }

      // Se ainda não achou, faz a busca ativa no GraphQL
      if (!item && shortcode) {
        item = await fetchMediaByShortcode(shortcode);
      }

      window.dispatchEvent(new CustomEvent('instasaver_response', {
        detail: { requestId, success: Boolean(item && item.videoUrl), item }
      }));
      return;
    }

    if (action === 'GET_ALL_VIDEOS') {
      const videos = [...store.recentVideos];
      window.dispatchEvent(new CustomEvent('instasaver_response', {
        detail: { requestId, success: true, videos }
      }));
      return;
    }

    if (action === 'GET_PROFILE_VIDEOS') {
      const username = e.detail.username;
      const list = store.profileVideos.get(username) || [];
      window.dispatchEvent(new CustomEvent('instasaver_response', {
        detail: { requestId, success: true, videos: list }
      }));
      return;
    }
  });

  console.log('[InstaSaver Pro v2.0] Engine inicializado no mundo MAIN com sucesso.');
})();
