/**
 * InstaSaver Pro - Content Script (v1.3.0)
 * Injeta botões com prioridade máxima e consulta o script inject.js (mundo MAIN)
 * para obter o arquivo MP4 em H.264 com áudio direto do React Fiber da Meta.
 */

(function () {
  'use strict';

  let videoCounter = 0;

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
    }, 3800);
  }

  // Consulta o script no mundo MAIN para ler o React Fiber
  function queryMainWorldVideoUrl(videoId, postCode) {
    return new Promise((resolve) => {
      let resolved = false;

      const handler = (e) => {
        if (e.detail && e.detail.videoId === videoId) {
          window.removeEventListener('instasaver_video_response', handler);
          resolved = true;
          resolve(e.detail.url || null);
        }
      };

      window.addEventListener('instasaver_video_response', handler);

      window.dispatchEvent(new CustomEvent('instasaver_query_video', {
        detail: { videoId, postCode }
      }));

      // Timeout de segurança de 300ms
      setTimeout(() => {
        if (!resolved) {
          window.removeEventListener('instasaver_video_response', handler);
          resolve(null);
        }
      }, 300);
    });
  }

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
  // INJEÇÃO NOS VÍDEOS
  // ===============================================
  function injectButtonsOnVideos() {
    const videos = document.querySelectorAll('video');

    videos.forEach(video => {
      if (video.dataset.instasaverInjected === 'true') return;

      const vidId = 'is_vid_' + (++videoCounter);
      video.dataset.instasaverId = vidId;

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
      btn.title = 'Baixar vídeo completo em MP4 com áudio';

      const handleDownloadClick = async (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        if (btn.classList.contains('downloading')) return;

        btn.classList.add('downloading');
        btn.innerHTML = `${CHECK_SVG}<span>Baixando...</span>`;
        showToast('Localizando arquivo de vídeo...');

        // Identifica o código do post
        let code = null;
        const postLink = video.closest('article')?.querySelector('a[href*="/p/"], a[href*="/reel/"]') ||
                         document.querySelector('a[href*="/p/"], a[href*="/reel/"]');
        if (postLink) {
          const match = postLink.href.match(/\/(p|reel)\/([^/]+)/);
          if (match && match[2]) code = match[2];
        } else if (window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/')) {
          const parts = window.location.pathname.split('/').filter(Boolean);
          if (parts[1]) code = parts[1];
        }

        const filename = `insta_${code || 'video'}_${Date.now()}.mp4`;

        // 1. Tenta pegar a URL H.264 diretamente do React Fiber / Cache da página
        let finalUrl = await queryMainWorldVideoUrl(vidId, code);

        // 2. Se não achou no Fiber, tenta OpenGraph
        if (!finalUrl) {
          const og = document.querySelector('meta[property="og:video"]');
          if (og && og.content) finalUrl = og.content;
        }

        // 3. Se não achou, consulta as URLs capturadas pelo Background Service Worker
        if (!finalUrl) {
          const bgRes = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'GET_LATEST_VIDEO' }, resolve);
          });
          if (bgRes && bgRes.url) finalUrl = bgRes.url;
        }

        // 4. Último recurso: URL direta do elemento
        if (!finalUrl && video.src && video.src.startsWith('http') && !video.src.startsWith('blob:')) {
          finalUrl = video.src;
        }

        if (finalUrl) {
          triggerDownload(finalUrl, filename, btn);
        } else {
          showToast('Dê play no vídeo por 1 segundo e clique novamente.', false);
          btn.classList.remove('downloading');
          btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
        }
      };

      // Prioridade máxima de captura
      btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }, true);
      btn.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }, true);
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

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      const activeVideo = document.querySelector('section video, div[role="dialog"] video');
      const activeImg = document.querySelector('section img[decoding="sync"], div[role="dialog"] img[style*="object-fit"]');
      const filename = `insta_${isHighlight ? 'destaque' : 'story'}_${Date.now()}`;

      let url = null;
      if (activeVideo) {
        url = await queryMainWorldVideoUrl(activeVideo.dataset.instasaverId, null);
      }

      if (!url) {
        const bgRes = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'GET_LATEST_VIDEO' }, resolve);
        });
        if (bgRes && bgRes.url) url = bgRes.url;
      }

      if (url) {
        triggerDownload(url, `${filename}.mp4`, btn);
      } else if (activeImg && activeImg.src) {
        triggerDownload(activeImg.src, `${filename}.jpg`, btn);
      } else {
        showToast('Mídia não encontrada neste Story.', false);
      }
    }, true);

    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
    btn.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);

    storyContainer.appendChild(btn);
  }

  // Observer
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
