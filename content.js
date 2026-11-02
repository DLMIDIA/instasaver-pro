/**
 * InstaSaver Pro - Content Script (v2.0.0)
 * Injeta botões no Feed, Reels, Stories, Destaques e Grade de Perfis.
 * Comunica-se com o inject.js (mundo MAIN) para obter o vídeo H.264 original com som.
 */

(function () {
  'use strict';

  let reqIdCounter = 0;
  let elementIdCounter = 0;

  const SVG_DOWNLOAD = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  `;

  const SVG_CHECK = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `;

  // Toast flutuante de status
  function showToast(message, isSuccess = true) {
    let toast = document.getElementById('instasaver-toast-elem');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'instasaver-toast-elem';
      toast.className = 'instasaver-toast';
      document.body.appendChild(toast);
    }

    toast.className = 'instasaver-toast' + (isSuccess ? ' success' : ' error');
    toast.innerHTML = isSuccess
      ? `<span class="toast-icon">✓</span> <span>${message}</span>`
      : `<span class="toast-icon">✕</span> <span>${message}</span>`;

    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 4000);
  }

  // Ponte assíncrona com o inject.js
  function callInjectEngine(action, payload = {}) {
    return new Promise((resolve) => {
      const requestId = 'req_' + (++reqIdCounter) + '_' + Date.now();

      const listener = (e) => {
        if (e.detail && e.detail.requestId === requestId) {
          window.removeEventListener('instasaver_response', listener);
          resolve(e.detail);
        }
      };

      window.addEventListener('instasaver_response', listener);

      window.dispatchEvent(new CustomEvent('instasaver_request', {
        detail: { ...payload, action, requestId }
      }));

      // Timeout de segurança de 3 segundos
      setTimeout(() => {
        window.removeEventListener('instasaver_response', listener);
        resolve({ success: false, timeout: true });
      }, 3500);
    });
  }

  // Extrai o shortcode de um elemento do DOM ou da URL atual
  function detectShortcode(element) {
    // 1. Procura em links <a> próximos
    const postLink = element.closest('article')?.querySelector('a[href*="/p/"], a[href*="/reel/"]') ||
                     element.parentElement?.querySelector('a[href*="/p/"], a[href*="/reel/"]') ||
                     document.querySelector('div[role="dialog"] a[href*="/p/"], div[role="dialog"] a[href*="/reel/"]');

    if (postLink && postLink.href) {
      const m = postLink.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
      if (m && m[2]) return m[2];
    }

    // 2. Se a aba atual estiver em /p/ ou /reel/
    const urlMatch = window.location.pathname.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
    if (urlMatch && urlMatch[2]) return urlMatch[2];

    return null;
  }

  // Executa o download oficial através do background service worker
  function requestDownload(url, filename, btn) {
    if (!url) {
      showToast('URL de vídeo não encontrada.', false);
      if (btn) btn.classList.remove('downloading');
      return;
    }

    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_MEDIA',
      url: url,
      filename: filename
    }, (res) => {
      if (res && res.success) {
        if (btn) {
          btn.innerHTML = `${SVG_CHECK}<span>✓ Baixado!</span>`;
          setTimeout(() => {
            btn.classList.remove('downloading');
            btn.innerHTML = `${SVG_DOWNLOAD}<span>Baixar Vídeo (MP4)</span>`;
          }, 3500);
        }
        showToast('✓ Download iniciado (H.264 + Áudio AAC)!', true);
      } else {
        showToast('Erro no download: ' + (res?.error || 'Tente novamente'), false);
        if (btn) {
          btn.classList.remove('downloading');
          btn.innerHTML = `${SVG_DOWNLOAD}<span>Baixar Vídeo (MP4)</span>`;
        }
      }
    });
  }

  // ==============================================================
  // 1. BOTÃO FLUTUANTE EM VÍDEOS (Feed, Reels e Modal)
  // ==============================================================
  function injectFloatingButtonsOnVideos() {
    const videos = document.querySelectorAll('video');

    videos.forEach(video => {
      if (video.dataset.instasaverInjected === 'true') return;

      const elementId = 'is_elem_' + (++elementIdCounter);
      video.dataset.instasaverId = elementId;

      // Localiza o container mais adequado para fixar o botão relativo
      let container = video.parentElement;
      while (container && container.tagName !== 'ARTICLE' && container.tagName !== 'BODY') {
        const style = window.getComputedStyle(container);
        if (style.position === 'relative' || style.position === 'absolute') {
          break;
        }
        container = container.parentElement;
      }
      if (!container) container = video.parentElement;
      if (!container) return;

      if (container.querySelector('.instasaver-float-btn')) {
        video.dataset.instasaverInjected = 'true';
        return;
      }

      container.classList.add('instasaver-media-wrapper');

      const btn = document.createElement('button');
      btn.className = 'instasaver-float-btn';
      btn.type = 'button';
      btn.innerHTML = `${SVG_DOWNLOAD}<span>Baixar Vídeo (MP4)</span>`;
      btn.title = 'Baixar vídeo original completo com áudio estéreo (H.264 + AAC)';

      const handleClick = async (e) => {
        // Bloqueia qualquer captura e parada do Instagram
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        if (btn.classList.contains('downloading')) return;

        btn.classList.add('downloading');
        btn.innerHTML = `${SVG_DOWNLOAD}<span>Buscando MP4...</span>`;
        showToast('Localizando arquivo com áudio original...');

        const shortcode = detectShortcode(video);

        // Consulta a engine in-page (inject.js)
        const response = await callInjectEngine('GET_MEDIA_FOR_SHORTCODE', {
          shortcode,
          domSelector: `[data-instasaver-id="${elementId}"]`
        });

        if (response && response.success && response.item && response.item.videoUrl) {
          const item = response.item;
          const userPrefix = item.username ? `insta_${item.username}_` : 'insta_';
          const codePart = item.code || shortcode || 'video';
          const filename = `${userPrefix}${codePart}_${Date.now()}.mp4`;

          btn.innerHTML = `${SVG_CHECK}<span>Baixando...</span>`;
          requestDownload(item.videoUrl, filename, btn);
        } else {
          showToast('Não foi possível capturar o MP4 com som deste vídeo.', false);
          btn.classList.remove('downloading');
          btn.innerHTML = `${SVG_DOWNLOAD}<span>Baixar Vídeo (MP4)</span>`;
        }
      };

      // Prioridade máxima de evento
      btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }, true);
      btn.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }, true);
      btn.addEventListener('click', handleClick, true);

      container.appendChild(btn);
      video.dataset.instasaverInjected = 'true';
    });
  }

  // ==============================================================
  // 2. BOTÃO NOS STORIES E DESTAQUES
  // ==============================================================
  function injectStoriesButton() {
    const isStories = window.location.pathname.startsWith('/stories/');
    if (!isStories) return;

    const isHighlight = window.location.pathname.includes('/highlights/');
    const storyContainer = document.querySelector('section:has(video), section:has(img[decoding="sync"]), div[role="dialog"]:has(video)');
    if (!storyContainer) return;

    if (document.querySelector('.instasaver-story-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'instasaver-story-btn';
    btn.type = 'button';
    btn.innerHTML = `${SVG_DOWNLOAD}<span>Baixar ${isHighlight ? 'Destaque' : 'Story'}</span>`;
    btn.title = 'Baixar o Story ou Destaque em exibição com qualidade original';

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      btn.classList.add('downloading');
      showToast(`Localizando ${isHighlight ? 'Destaque' : 'Story'}...`);

      const activeVideo = document.querySelector('section video, div[role="dialog"] video');
      const activeImg = document.querySelector('section img[decoding="sync"], div[role="dialog"] img[style*="object-fit"]');

      let resolvedUrl = null;
      let isVideo = Boolean(activeVideo);

      if (activeVideo) {
        const res = await callInjectEngine('GET_ALL_VIDEOS');
        if (res && res.videos && res.videos.length > 0) {
          resolvedUrl = res.videos[0].videoUrl;
        }
      }

      if (!resolvedUrl && activeImg && activeImg.src) {
        resolvedUrl = activeImg.src;
        isVideo = false;
      }

      if (resolvedUrl) {
        const ext = isVideo ? 'mp4' : 'jpg';
        const filename = `insta_${isHighlight ? 'destaque' : 'story'}_${Date.now()}.${ext}`;
        requestDownload(resolvedUrl, filename, btn);
      } else {
        showToast('Mídia não encontrada neste Story.', false);
        btn.classList.remove('downloading');
      }
    }, true);

    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
    btn.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);

    storyContainer.appendChild(btn);
  }

  // ==============================================================
  // 3. BOTÕES RÁPIDOS NA GRADE DE PERFIL E REELS (LOTE / GRID)
  // ==============================================================
  function injectGridDownloadButtons() {
    // Detecta se estamos num perfil (/usuario/ ou /usuario/reels/)
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const isProfile = pathParts.length >= 1 && !['explore', 'stories', 'direct', 'reels', 'p'].includes(pathParts[0]);
    if (!isProfile) return;

    // Procura links de post na grade
    const gridLinks = document.querySelectorAll('a[href*="/p/"]:not(.is-grid-processed), a[href*="/reel/"]:not(.is-grid-processed)');

    gridLinks.forEach(link => {
      link.classList.add('is-grid-processed');

      const match = link.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
      if (!match || !match[2]) return;
      const shortcode = match[2];

      // Cria botão compacto de download na miniatura
      const gridBtn = document.createElement('button');
      gridBtn.className = 'instasaver-grid-btn';
      gridBtn.type = 'button';
      gridBtn.innerHTML = SVG_DOWNLOAD;
      gridBtn.title = 'Baixar este vídeo em 1 clique';

      gridBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        gridBtn.classList.add('downloading');
        showToast('Buscando vídeo da publicação...');

        const res = await callInjectEngine('GET_MEDIA_FOR_SHORTCODE', { shortcode });
        if (res && res.success && res.item && res.item.videoUrl) {
          const item = res.item;
          const user = item.username || pathParts[0] || 'perfil';
          const filename = `insta_${user}_${shortcode}_${Date.now()}.mp4`;
          requestDownload(item.videoUrl, filename, gridBtn);
        } else {
          showToast('Vídeo não disponível ou em formato de foto.', false);
          gridBtn.classList.remove('downloading');
        }
      }, true);

      gridBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
      gridBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);

      link.style.position = 'relative';
      link.appendChild(gridBtn);
    });
  }

  // Loop de escaneamento contínuo
  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      injectFloatingButtonsOnVideos();
      injectStoriesButton();
      injectGridDownloadButtons();
      scanScheduled = false;
    });
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  scheduleScan();

  // ==============================================================
  // 4. COMUNICAÇÃO COM O POPUP DA EXTENSÃO
  // ==============================================================
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'GET_PAGE_MEDIA_INFO') {
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      const isStories = window.location.pathname.startsWith('/stories/');
      const isReel = window.location.pathname.includes('/reel/');
      const isPost = window.location.pathname.includes('/p/');
      const isProfile = pathParts.length >= 1 && !['explore', 'stories', 'direct', 'reels', 'p'].includes(pathParts[0]);

      const currentShortcode = detectShortcode(document.body);
      const currentUsername = isProfile ? pathParts[0] : null;

      // Consulta inject.js para obter a lista atualizada
      callInjectEngine('GET_ALL_VIDEOS').then(res => {
        sendResponse({
          success: true,
          pageType: isStories ? 'stories' : (isReel ? 'reel' : (isPost ? 'post' : (isProfile ? 'profile' : 'feed'))),
          shortcode: currentShortcode,
          username: currentUsername,
          videos: (res && res.videos) || []
        });
      });
      return true;
    }

    if (req.action === 'AUTO_SCROLL_PROFILE') {
      // Rola a página para que o Instagram carregue mais vídeos via fetch
      window.scrollBy({ top: window.innerHeight * 1.5, behavior: 'smooth' });
      setTimeout(() => {
        sendResponse({ success: true });
      }, 700);
      return true;
    }
  });

})();
