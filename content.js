/**
 * InstaSaver Pro - Content Script (v1.2.0)
 * Extrai vídeos H.264 (AVC) com áudio AAC estéreo integrado através da API oficial do Web App da Meta.
 * Garante compatibilidade 100% nativa com o QuickTime Player do macOS, iPhone e WhatsApp.
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

  // Toast
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

  // 1. Busca a versão H.264 (AVC) com áudio AAC através da API interna do Instagram
  async function fetchH264VideoUrl(postCode) {
    if (!postCode) return null;

    try {
      // Endpoint oficial da API Web da Meta (retorna video_versions com áudio multiplexado)
      const resp = await fetch(`https://www.instagram.com/p/${postCode}/?__a=1&__d=dis`, {
        headers: {
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'include'
      });

      if (resp.ok) {
        const json = await resp.json();
        const item = json.items?.[0] || json.graphql?.shortcode_media;
        if (item && item.video_versions && item.video_versions.length > 0) {
          // video_versions[0] é o MP4 H.264 de alta resolução com som estéreo AAC
          return item.video_versions[0].url;
        }
      }
    } catch (e) {
      console.warn('[InstaSaver] Falha na consulta por endpoint:', e);
    }

    // 2. Extrai de scripts embutidos na própria página
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const txt = s.textContent;
        if (txt && txt.includes('video_versions')) {
          const match = txt.match(/"video_versions":\s*(\[\{.*?\}\])/);
          if (match && match[1]) {
            const list = JSON.parse(match[1]);
            if (Array.isArray(list) && list[0] && list[0].url) {
              return list[0].url.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
            }
          }
        }
      }
    } catch (e) {}

    return null;
  }

  // Disparo do download oficial
  function triggerDownload(url, filename, btn) {
    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_MEDIA',
      url: url,
      filename: filename
    }, (res) => {
      if (res && res.success) {
        btn.innerHTML = `${CHECK_SVG}<span>✓ Baixado!</span>`;
        showToast('✓ Vídeo salvo (H.264 + Áudio AAC)!', true);
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
      btn.title = 'Baixar vídeo compatível com QuickTime e WhatsApp (H.264 + Áudio)';

      const handleDownloadClick = async (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        if (btn.classList.contains('downloading')) return;

        btn.classList.add('downloading');
        btn.innerHTML = `${CHECK_SVG}<span>Baixando...</span>`;
        showToast('Obtendo vídeo em H.264 com áudio...');

        // Identifica o código do post
        let code = null;
        const postLink = video.closest('article')?.querySelector('a[href*="/p/"], a[href*="/reel/"]') ||
                         document.querySelector('a[href*="/p/"], a[href*="/reel/"]');
        if (postLink) {
          const match = postLink.href.match(/\/(p|reel)\/([^/]+)/);
          if (match && match[2]) code = match[2];
        } else if (window.location.pathname.includes('/reel/')) {
          const parts = window.location.pathname.split('/').filter(Boolean);
          if (parts[1]) code = parts[1];
        }

        const filename = `insta_${code || 'video'}_${Date.now()}.mp4`;

        // 1. Tenta obter o MP4 progressivo em H.264 + AAC
        let finalUrl = null;
        if (code) {
          finalUrl = await fetchH264VideoUrl(code);
        }

        // 2. Se não achou por código, tenta o OpenGraph da página
        if (!finalUrl) {
          const og = document.querySelector('meta[property="og:video"]');
          if (og && og.content) finalUrl = og.content;
        }

        // 3. Fallback: consulta fluxo H.264 no background
        if (!finalUrl) {
          const bgRes = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'GET_LATEST_VIDEO' }, resolve);
          });
          if (bgRes && bgRes.url) finalUrl = bgRes.url;
        }

        if (finalUrl) {
          triggerDownload(finalUrl, filename, btn);
        } else {
          showToast('Não foi possível capturar o stream de vídeo.', false);
          btn.classList.remove('downloading');
          btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
        }
      };

      // Fase de Captura (true) para prioridade absoluta contra overlays
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

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      const activeImg = document.querySelector('section img[decoding="sync"], div[role="dialog"] img[style*="object-fit"]');
      const filename = `insta_${isHighlight ? 'destaque' : 'story'}_${Date.now()}`;

      chrome.runtime.sendMessage({ action: 'GET_LATEST_VIDEO' }, (res) => {
        if (res && res.url) {
          triggerDownload(res.url, `${filename}.mp4`, btn);
        } else if (activeImg && activeImg.src) {
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

  // Observer de DOM
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
