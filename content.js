/**
 * InstaSaver Pro - Content Script (Mecanismo de Download Direto e Infalível)
 * Garante que o clique no botão em cima do vídeo dispare o download imediatamente,
 * seja resolvendo a URL real do CDN da Meta ou baixando o buffer blob nativamente no navegador.
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

  // Toast flutuante
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

  // Remove parâmetros que cortam o arquivo por pedaços (bytestart/byteend)
  function stripRangeParams(url) {
    if (!url) return url;
    try {
      const u = new URL(url);
      u.searchParams.delete('bytestart');
      u.searchParams.delete('byteend');
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  // Busca a URL CDN real e completa do vídeo
  async function resolveBestVideoUrl(videoEl) {
    if (!videoEl) return null;

    // 1. Verifica se a tag <video> tem um src HTTP direto
    const directSrc = videoEl.src || videoEl.currentSrc;
    if (directSrc && directSrc.startsWith('http') && !directSrc.startsWith('blob:')) {
      return stripRangeParams(directSrc);
    }

    // 2. Procura em tags filhas <source>
    const sourceEl = videoEl.querySelector('source');
    if (sourceEl && sourceEl.src && sourceEl.src.startsWith('http') && !sourceEl.src.startsWith('blob:')) {
      return stripRangeParams(sourceEl.src);
    }

    // 3. Procura no OpenGraph da página (se for página /p/ ou /reel/)
    const og = document.querySelector('meta[property="og:video"]');
    if (og && og.content) {
      return stripRangeParams(og.content);
    }

    // 4. Procura no log de recursos de rede do navegador (Performance API)
    // Na Meta, 't50' é o identificador de arquivos de VÍDEO
    try {
      const resources = performance.getEntriesByType('resource');
      const videoResources = resources.filter(r => 
        (r.name.includes('cdninstagram.com') || r.name.includes('fbcdn.net')) &&
        (r.name.includes('/t50.') || r.name.includes('/v/t50.') || r.name.includes('.mp4'))
      );
      if (videoResources.length > 0) {
        return stripRangeParams(videoResources[videoResources.length - 1].name);
      }
    } catch (e) {}

    // 5. Consulta vídeos capturados em background
    try {
      const bg = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'GET_RECENT_VIDEOS' }, resolve);
      });
      if (bg && bg.videos && bg.videos.length > 0) {
        return stripRangeParams(bg.videos[0].url);
      }
    } catch (e) {}

    // 6. Se nada acima funcionar, retorna o próprio src (mesmo que seja blob)
    return directSrc || null;
  }

  // Disparo de download à prova de falhas
  async function triggerDownload(url, filename) {
    if (!url) return false;

    // Se for URL HTTP da CDN, usamos o serviço de download nativo do Chrome
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_MEDIA',
          url: url,
          filename: filename
        }, res => {
          if (res && res.success) resolve(true);
          else resolve(false);
        });
      });
    }

    // Se for um 'blob:', fazemos o download direto na página através da memória do navegador!
    if (url.startsWith('blob:')) {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(blobUrl);
        }, 2000);
        return true;
      } catch (err) {
        console.error('[InstaSaver] Falha ao baixar blob localmente:', err);
        return false;
      }
    }

    return false;
  }

  // ===============================================
  // INJEÇÃO DO BOTÃO EM CADA VÍDEO (Feed, Reels, Posts)
  // ===============================================
  function injectButtonsOnVideos() {
    const videos = document.querySelectorAll('video');

    videos.forEach(video => {
      if (video.dataset.instasaverInjected === 'true') return;

      // Localiza o container de posicionamento
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

      // Evita duplicatas
      if (container.querySelector('.instasaver-float-btn')) {
        video.dataset.instasaverInjected = 'true';
        return;
      }

      container.classList.add('instasaver-media-wrapper');

      const btn = document.createElement('button');
      btn.className = 'instasaver-float-btn';
      btn.type = 'button';
      btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
      btn.title = 'Clique para baixar este vídeo em MP4 agora';

      // Executa no click E no mousedown para garantir que nenhum overlay do Instagram intercepte
      const handleAction = async (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (btn.classList.contains('downloading')) return;

        btn.classList.add('downloading');
        btn.innerHTML = `${CHECK_SVG}<span>Baixando...</span>`;
        showToast('Localizando vídeo em alta qualidade...');

        // Tenta resolver a melhor URL
        const videoUrl = await resolveBestVideoUrl(video);

        if (!videoUrl) {
          showToast('Não foi possível obter o link do vídeo.', false);
          btn.classList.remove('downloading');
          btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
          return;
        }

        const filename = `insta_video_${Date.now()}.mp4`;
        showToast('Iniciando download do vídeo (MP4)...');

        const success = await triggerDownload(videoUrl, filename);

        if (success) {
          btn.innerHTML = `${CHECK_SVG}<span>✓ Salvo!</span>`;
          showToast('✓ Vídeo salvo com sucesso!', true);
          setTimeout(() => {
            btn.classList.remove('downloading');
            btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
          }, 3000);
        } else {
          showToast('Erro ao baixar o vídeo.', false);
          btn.classList.remove('downloading');
          btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
        }
      };

      btn.addEventListener('click', handleAction);
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });

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
    btn.title = 'Baixar exatamente a mídia em exibição agora';

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const activeVideo = document.querySelector('section video, div[role="dialog"] video');
      const activeImg = document.querySelector('section img[decoding="sync"], div[role="dialog"] img[style*="object-fit"]');

      let url = null;
      let isVideo = false;

      if (activeVideo) {
        isVideo = true;
        url = await resolveBestVideoUrl(activeVideo);
      } else if (activeImg) {
        isVideo = false;
        url = activeImg.src;
      }

      if (!url) {
        showToast('Mídia não encontrada neste Story.', false);
        return;
      }

      const ext = isVideo ? 'mp4' : 'jpg';
      const filename = `insta_${isHighlight ? 'destaque' : 'story'}_${Date.now()}.${ext}`;

      showToast(`Baixando ${isHighlight ? 'Destaque' : 'Story'} (${ext.toUpperCase()})...`);
      await triggerDownload(url, filename);
    });

    storyContainer.appendChild(btn);
  }

  // Observer contínuo para detectar novos vídeos carregados pelo scroll
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

  // Escuta requisição do Popup da extensão
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'GET_FOCUSED_MEDIA') {
      const videos = Array.from(document.querySelectorAll('video'));
      let target = videos.find(v => !v.paused && v.currentTime > 0);

      if (!target && videos.length > 0) {
        const center = window.innerHeight / 2;
        let minDist = Infinity;
        videos.forEach(v => {
          const r = v.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) return;
          const dist = Math.abs(r.top + r.height / 2 - center);
          if (dist < minDist) {
            minDist = dist;
            target = v;
          }
        });
      }

      if (target) {
        resolveBestVideoUrl(target).then(url => {
          sendResponse({
            success: true,
            hasMedia: Boolean(url),
            url: url
          });
        });
        return true;
      }

      sendResponse({ success: true, hasMedia: false });
      return true;
    }
  });

})();
