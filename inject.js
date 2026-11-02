/**
 * InstaSaver Pro - In-Page Engine (inject.js) - v2.1.0
 * Roda no contexto "MAIN" da página do Instagram (document_start).
 * 
 * Funcionalidades:
 * 1. Intercepta requisições Fetch e XHR da página para capturar objetos
 *    de mídia com 'video_versions' (H.264 + áudio AAC estéreo).
 * 2. Conversão direta de shortcode para 64-bit numeric media_id.
 * 3. Consulta direta às APIs oficiais:
 *    - /api/v1/media/${mediaId}/info/
 *    - GraphQL PolarisPostRootQuery
 * 4. Inspeciona a árvore React Fiber dos componentes do DOM.
 * 5. Indexa vídeos por post, reel, story e perfil para downloads individuais e em lote.
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

  // Utilitário para converter shortcode do Instagram em media_id numérico de 64 bits
  function shortcodeToMediaId(shortcode) {
    if (!shortcode || typeof shortcode !== 'string') return null;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    try {
      let id = BigInt(0);
      for (let i = 0; i < shortcode.length; i++) {
        const char = shortcode[i];
        const val = BigInt(alphabet.indexOf(char));
        if (val < BigInt(0)) return null;
        id = id * BigInt(64) + val;
      }
      return id.toString();
    } catch (e) {
      return null;
    }
  }

  // Localiza o X-IG-App-ID na página ou usa o padrão web oficial
  function findAppId() {
    try {
      const appIdPattern = /"X-IG-App-ID":"([\d]+)"/;
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent;
        if (text) {
          const match = text.match(appIdPattern);
          if (match && match[1]) return match[1];
        }
      }
    } catch (e) {}
    return '936619743392459'; // App ID web padrão oficial da Meta
  }

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
      // Ordena por maior resolução para garantir o melhor arquivo H.264 com som
      const sorted = [...media.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
      videoUrl = sorted[0].url;
      isVideo = true;
    } else if (media.video_url && typeof media.video_url === 'string') {
      videoUrl = media.video_url;
      isVideo = true;
    }

    // Miniatura / Imagem de alta resolução
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
        if (store.recentVideos.length > 60) {
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
    if (!obj || depth > 10 || typeof obj !== 'object') return;

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

  // 3. CONSULTA DIRETA À API OFICIAL DE MÍDIA (/api/v1/media/${mediaId}/info/)
  const mediaInfoCache = new Map();
  async function fetchMediaInfoById(mediaId) {
    if (!mediaId) return null;
    if (mediaInfoCache.has(mediaId)) return mediaInfoCache.get(mediaId);

    const appId = findAppId();
    const endpoints = [
      `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
      `https://i.instagram.com/api/v1/media/${mediaId}/info/`
    ];

    for (const endpoint of endpoints) {
      try {
        const resp = await nativeFetch(endpoint, {
          method: 'GET',
          headers: {
            'Accept': '*/*',
            'X-IG-App-ID': appId,
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include'
        });

        if (resp.ok) {
          const json = await resp.json();
          scanPayloadRecursively(json);

          if (json && json.items && json.items.length > 0) {
            const firstItem = json.items[0];
            const normalized = normalizeMediaItem(firstItem);
            if (normalized) {
              registerMediaItem(normalized);
              mediaInfoCache.set(mediaId, normalized);
              return normalized;
            }
          }
        }
      } catch (err) {
        console.warn('[InstaSaver] Falha ao consultar endpoint info:', err);
      }
    }
    return null;
  }

  // 4. INSPEÇÃO DE REACT FIBER (Deep Scan)
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

    while (curr && curr !== document.documentElement && iterations < 30) {
      const fiber = getReactFiber(curr);
      if (fiber) {
        let f = fiber;
        let depth = 0;

        while (f && depth < 80) {
          if (f.memoizedProps) {
            const found = deepExtractFromObject(f.memoizedProps, 0);
            if (found && found.videoUrl) return found;
          }
          if (f.memoizedState) {
            const found = deepExtractFromObject(f.memoizedState, 0);
            if (found && found.videoUrl) return found;
          }
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
    if (!obj || depth > 7 || typeof obj !== 'object') return null;

    if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
      const normalized = normalizeMediaItem(obj);
      if (normalized && normalized.videoUrl) return normalized;
    }

    if (obj.code && obj.video_url) {
      const normalized = normalizeMediaItem(obj);
      if (normalized && normalized.videoUrl) return normalized;
    }

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

  // 5. BUSCA ATIVA VIA GRAPHQL E DOM SCRIPTS
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

    // 1. Verifica cache local
    if (store.byShortcode.has(shortcode)) {
      const cached = store.byShortcode.get(shortcode);
      if (cached && (cached.videoUrl || cached.thumbnailUrl)) return cached;
    }

    // 2. Converte shortcode em mediaId e consulta endpoint oficial info
    const mediaId = shortcodeToMediaId(shortcode);
    if (mediaId) {
      const fromInfo = await fetchMediaInfoById(mediaId);
      if (fromInfo && (fromInfo.videoUrl || fromInfo.thumbnailUrl)) {
        return fromInfo;
      }
    }

    // 3. Consulta GraphQL oficial PolarisPostRootQuery
    const docIds = ['39422285384081769', '27128499623469141', '8845758582119845'];
    const lsd = getLsdToken();
    const csrftoken = getCookie('csrftoken');
    const appId = findAppId();

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
            'X-IG-App-ID': appId,
            'X-CSRFToken': csrftoken,
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include',
          body: formData.toString()
        });

        if (resp.ok) {
          const json = await resp.json();
          scanPayloadRecursively(json);
          if (store.byShortcode.has(shortcode)) {
            const found = store.byShortcode.get(shortcode);
            if (found && (found.videoUrl || found.thumbnailUrl)) return found;
          }
        }
      } catch (err) {}
    }

    // 4. Varre tags <script type="application/json"> já presentes na página
    try {
      const scriptTags = document.querySelectorAll('script[type="application/json"]');
      for (let i = 0; i < scriptTags.length; i++) {
        const txt = scriptTags[i].textContent;
        if (txt && txt.includes(shortcode) && (txt.includes('video_versions') || txt.includes('video_url'))) {
          const parsed = JSON.parse(txt);
          scanPayloadRecursively(parsed);
          if (store.byShortcode.has(shortcode)) {
            const found = store.byShortcode.get(shortcode);
            if (found && found.videoUrl) return found;
          }
        }
      }
    } catch (e) {}

    // 5. Fallback endpoint embed / info
    try {
      const resp2 = await nativeFetch(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
        headers: {
          'X-IG-App-ID': appId,
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'include'
      });
      if (resp2.ok) {
        const json2 = await resp2.json();
        scanPayloadRecursively(json2);
        if (store.byShortcode.has(shortcode)) {
          return store.byShortcode.get(shortcode);
        }
      }
    } catch (err) {}

    return store.byShortcode.get(shortcode) || null;
  }

  // 6. ESCUTA REQUISIÇÕES DO CONTENT SCRIPT
  window.addEventListener('instasaver_request', async (e) => {
    const { requestId, action, shortcode, domSelector } = e.detail || {};

    if (action === 'GET_MEDIA_FOR_SHORTCODE') {
      let item = null;

      // A. Cache em memória por shortcode
      if (shortcode && store.byShortcode.has(shortcode)) {
        item = store.byShortcode.get(shortcode);
      }

      // B. Resolução ativa (Media ID Info API + GraphQL)
      if ((!item || !item.videoUrl) && shortcode) {
        item = await fetchMediaByShortcode(shortcode);
      }

      // C. React Fiber no elemento clicado ou próximo
      if ((!item || !item.videoUrl) && domSelector) {
        const el = document.querySelector(domSelector);
        if (el) {
          const fromFiber = searchFiberForMedia(el);
          if (fromFiber) {
            registerMediaItem(fromFiber);
            item = fromFiber;
          }
        }
      }

      // D. Se estiver em página de post/reel e temos itens na lista recente
      if ((!item || !item.videoUrl) && store.recentVideos.length > 0) {
        if (shortcode) {
          const match = store.recentVideos.find(v => v.code === shortcode);
          if (match) item = match;
        }
        if (!item && (window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/'))) {
          item = store.recentVideos[0];
        }
      }

      window.dispatchEvent(new CustomEvent('instasaver_response', {
        detail: {
          requestId,
          success: Boolean(item && (item.videoUrl || item.thumbnailUrl)),
          item
        }
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

  console.log('[InstaSaver Pro v2.1.0] In-Page Engine inicializado com suporte a Media ID Info API e H.264.');
})();
