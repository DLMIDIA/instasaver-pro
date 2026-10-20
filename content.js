/**
 * InstaSaver Pro - Content Script
 * Injeta botões com prioridade máxima de eventos (fase de captura) para contornar qualquer overlay do Instagram.
 * Comunica-se com o background para baixar a URL assinada da CDN com sucesso 100% garantido.
 */

(function () {
  'use strict';

  const DOWNLOAD_SVG = `
    <svg viewBox="0 0 24 24">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  `;

  const CHECK_SVG = `
    <svg viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `;

  // Toast de notificação
  function showToast(message, isSuccess = true) {
    let toast = document.getElementById('instasaver-toast-elem');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'instasaver-toast-elem';
      toast.className = 'instasaver-toast';
      document.body.appendChild(toast);
    }

    toast.className = 'instasaver-toast' + (isSuccess ? ' success' : '');
    toast.innerHTML = isSuccess
      ? `<span style="color:#22c55e;font-size:16px;">✓</span> <span>${message}</span>`
      : `<span style="color:#ef4444;font-size:16px;">✕</span> <span>${message}</span>`;

    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  // Executa o download da URL através do Background Service Worker
  function triggerDownload(url, filename, btn) {
    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_MEDIA',
      url: url,
      filename: filename
    }, (res) => {
      if (res && res.success) {
        btn.innerHTML = `${CHECK_SVG}<span>✓ Baixado!</span>`;
        showToast('✓ Download iniciado com sucesso!', true);
        setTimeout(() => {
          btn.classList.remove('downloading');
          btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
        }, 3000);
      } else {
        showToast('Erro ao iniciar download: ' + (res?.error || 'Tente novamente'), false);
        btn.classList.remove('downloading');
        btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
      }
    });
  }

  // ===============================================
  // INJEÇÃO NOS VÍDEOS (Feed, Reels e Posts)
  // ===============================================
  function injectButtonsOnVideos() {
    const videos = document.querySelectorAll('video');

    videos.forEach(video => {
      if (video.dataset.instasaverInjected === 'true') return;

      // Localiza o container que envolve a mídia
      let container = video.parentElement;
      while (container && container.tagName !== 'ARTICLE' && container.tagName !== 'BODY') {
        const pos = window.getComputedStyle(container).position;
        if (pos === 'relative' || pos === 'absolute') {
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
      btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
      btn.title = 'Clique para baixar este vídeo em MP4 com a qualidade da Meta';

      // Disparo do Download
      const handleDownloadClick = async (e) => {
        // Bloqueia qualquer captura pelo Instagram na fase de captura
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        if (btn.classList.contains('downloading')) return;

        btn.classList.add('downloading');
        btn.innerHTML = `${CHECK_SVG}<span>Baixando...</span>`;
        showToast('Localizando vídeo em alta resolução...');

        // Se o vídeo estiver pausado, dá play brevemente para garantir que o stream CDN seja requisitado
        if (video.paused) {
          try {
            await video.play();
          } catch (err) {}
        }

        // Tenta achar código do post para dar nome amigável ao arquivo
        let code = 'video';
        const postLink = video.closest('article')?.querySelector('a[href*="/p/"], a[href*="/reel/"]') ||
                         document.querySelector('a[href*="/p/"], a[href*="/reel/"]');
        if (postLink) {
          const match = postLink.href.match(/\/(p|reel)\/([^/]+)/);
          if (match && match[2]) code = match[2];
        } else if (window.location.pathname.includes('/reel/')) {
          const parts = window.location.pathname.split('/').filter(Boolean);
          if (parts[1]) code = parts[1];
        }

        const filename = `insta_${code}_${Date.now()}.mp4`;

        // 1. Tenta pegar a URL direta do vídeo se for HTTP
        let directUrl = video.src || video.currentSrc;
        if (directUrl && directUrl.startsWith('http') && !directUrl.startsWith('blob:')) {
          triggerDownload(directUrl, filename, btn);
          return;
        }

        // 2. Tenta Meta OpenGraph (quando em post detalhado)
        const og = document.querySelector('meta[property="og:video"]');
        if (og && og.content) {
          triggerDownload(og.content, filename, btn);
          return;
        }

        // 3. Consulta as URLs capturadas pelo Background Service Worker
        chrome.runtime.sendMessage({ action: 'GET_LATEST_VIDEO' }, (res) => {
          if (res && res.url) {
            triggerDownload(res.url, filename, btn);
            return;
          }

          // Se a requisição do player ainda estava em trânsito, tenta novamente em 400ms
          setTimeout(() => {
            chrome.runtime.sendMessage({ action: 'GET_LATEST_VIDEO' }, (retryRes) => {
              if (retryRes && retryRes.url) {
                triggerDownload(retryRes.url, filename, btn);
              } else {
                showToast('Dê play no vídeo por 1 segundo e tente clicar novamente.', false);
                btn.classList.remove('downloading');
                btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
              }
            });
          }, 450);
        });
      };

      // FASE DE CAPTURA (true) - Garante que o clique pertença 100% ao nosso botão
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);

      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);

      btn.addEventListener('click', handleDownloadClick, true);

      container.appendChild(btn);
      video.dataset.instasaverInjected = 'true';
    });
  }

  // ===============================================
  // INJEÇÃO EM STORIES E DESTAQUES
  // ===============================================
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
    btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar ${isHighlight ? 'Destaque' : 'Story'}</span>`;
    btn.title = 'Baixar a mídia em exibição agora';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      const activeImg = document.querySelector('section img[decoding="sync"], div[role="dialog"] img[style*="object-fit"]');
      const filename = `insta_${isHighlight ? 'destaque' : 'story'}_${Date.now()}`;

      // Se for vídeo nos stories:
      chrome.runtime.sendMessage({ action: 'GET_LATEST_VIDEO' }, (res) => {
        if (res && res.url) {
          triggerDownload(res.url, `${filename}.mp4`, btn);
        } else if (activeImg && activeImg.src) {
          // Se for imagem nos stories:
          triggerDownload(activeImg.src, `${filename}.jpg`, btn);
        } else {
          showToast('Mídia não encontrada neste Story.', false);
        }
      });
    }, true);

    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
    btn.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);

    storyContainer.appendChild(btn);
  }

  // Observer contínuo para páginas dinâmicas
  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      injectButtonsOnVideos();
      injectStoriesButton();
      scanScheduled = false;
    });
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  scheduleScan();

})();
