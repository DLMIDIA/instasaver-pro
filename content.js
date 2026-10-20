/**
 * InstaSaver Pro - Content Script
 * Injeta botão flutuante preciso diretamente sobre cada vídeo ou foto do Instagram ao passar o mouse.
 * Garante que apenas o arquivo selecionado seja baixado, sem acumular lixo ou arquivos corrompidos.
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

  // Toast Flutuante Discreto
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
    }, 3200);
  }

  // Resolve a URL limpa do vídeo (contornando blob:)
  async function getCleanVideoUrl(videoEl) {
    if (!videoEl) return null;

    let direct = videoEl.src || videoEl.currentSrc;
    if (direct && !direct.startsWith('blob:') && direct.startsWith('http')) {
      return sanitizeUrl(direct);
    }

    // 1. Tenta tag <source>
    const srcTag = videoEl.querySelector('source');
    if (srcTag && srcTag.src && !srcTag.src.startsWith('blob:')) {
      return sanitizeUrl(srcTag.src);
    }

    // 2. Tenta Meta OpenGraph (quando em tela de post /p/ ou /reel/)
    const og = document.querySelector('meta[property="og:video"]');
    if (og && og.content) {
      return sanitizeUrl(og.content);
    }

    // 3. Consulta Performance API por requisições .mp4 da CDN
    try {
      const resources = performance.getEntriesByType('resource');
      const mp4s = resources.filter(r => 
        (r.name.includes('cdninstagram.com') || r.name.includes('fbcdn.net')) &&
        (r.name.includes('.mp4') || r.name.includes('/v/t50.'))
      );
      if (mp4s.length > 0) {
        return sanitizeUrl(mp4s[mp4s.length - 1].name);
      }
    } catch (e) {}

    // 4. Consulta cache do background
    try {
      const bg = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'GET_RECENT_MEDIA' }, resolve);
      });
      if (bg && bg.media && bg.media.length > 0) {
        const v = bg.media.find(m => m.type === 'video');
        if (v) return sanitizeUrl(v.url);
      }
    } catch (e) {}

    return direct ? sanitizeUrl(direct) : null;
  }

  // Remove range truncado de bytes para baixar o arquivo completo
  function sanitizeUrl(url) {
    try {
      const u = new URL(url);
      u.searchParams.delete('bytestart');
      u.searchParams.delete('byteend');
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  // ==========================================
  // 1. INJEÇÃO DE BOTÃO EM VÍDEOS (Feed & Reels)
  // ==========================================
  function injectButtonsOnVideos() {
    const videos = document.querySelectorAll('video');

    videos.forEach(video => {
      // Ignora se já estiver com botão
      if (video.dataset.instasaverInjected === 'true') return;

      // Encontra o container direto ou mais próximo que envolve o vídeo
      let container = video.parentElement;
      while (container && container.tagName !== 'ARTICLE' && container.tagName !== 'BODY') {
        const style = window.getComputedStyle(container);
        if (style.position === 'relative' || style.position === 'absolute' || container.getAttribute('role') === 'button') {
          break;
        }
        container = container.parentElement;
      }

      if (!container || container.querySelector('.instasaver-float-btn[data-type="video"]')) {
        video.dataset.instasaverInjected = 'true';
        return;
      }

      container.classList.add('instasaver-media-wrapper');

      const btn = document.createElement('button');
      btn.className = 'instasaver-float-btn';
      btn.dataset.type = 'video';
      btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
      btn.title = 'Clique para baixar este vídeo em MP4 (qualidade original da Meta)';

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        btn.classList.add('downloading');
        btn.innerHTML = `${CHECK_SVG}<span>Baixando...</span>`;

        const videoUrl = await getCleanVideoUrl(video);
        if (!videoUrl) {
          showToast('Não foi possível capturar o link deste vídeo.', false);
          btn.classList.remove('downloading');
          btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
          return;
        }

        const filename = `insta_video_${Date.now()}.mp4`;
        showToast('Baixando vídeo selecionado (MP4)...');

        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_MEDIA',
          url: videoUrl,
          filename: filename
        }, (res) => {
          if (res && res.success) {
            btn.innerHTML = `${CHECK_SVG}<span>✓ Salvo!</span>`;
            setTimeout(() => {
              btn.classList.remove('downloading');
              btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
            }, 3000);
          } else {
            showToast('Erro ao iniciar o download.', false);
            btn.classList.remove('downloading');
            btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Vídeo (MP4)</span>`;
          }
        });
      });

      container.appendChild(btn);
      video.dataset.instasaverInjected = 'true';
    });
  }

  // ==========================================
  // 2. INJEÇÃO DE BOTÃO EM FOTOS REAIS DE POST
  // ==========================================
  function injectButtonsOnPhotos() {
    // Apenas imagens grandes de posts (ignora avatares, stories e miniaturas < 300px)
    const images = document.querySelectorAll('article img[style*="object-fit"], div[role="dialog"] article img');

    images.forEach(img => {
      if (img.dataset.instasaverInjected === 'true') return;

      // Filtros estritos: se a imagem for pequena ou avatar, descarta
      const rect = img.getBoundingClientRect();
      if (rect.width < 280 || rect.height < 280) return;
      if (img.src.includes('s150x150') || img.src.includes('profile_pic')) return;

      // Se houver um vídeo no mesmo post/container, NÃO insere botão de foto
      const postArticle = img.closest('article') || img.parentElement;
      if (postArticle && postArticle.querySelector('video')) {
        img.dataset.instasaverInjected = 'true';
        return;
      }

      let container = img.parentElement;
      if (!container || container.querySelector('.instasaver-float-btn')) {
        img.dataset.instasaverInjected = 'true';
        return;
      }

      container.classList.add('instasaver-media-wrapper');

      const btn = document.createElement('button');
      btn.className = 'instasaver-float-btn';
      btn.dataset.type = 'image';
      btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Foto (HD)</span>`;
      btn.title = 'Clique para baixar esta imagem em alta resolução';

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        btn.classList.add('downloading');
        btn.innerHTML = `${CHECK_SVG}<span>Baixando...</span>`;

        const filename = `insta_foto_${Date.now()}.jpg`;
        showToast('Baixando foto selecionada...');

        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_MEDIA',
          url: img.src,
          filename: filename
        }, (res) => {
          if (res && res.success) {
            btn.innerHTML = `${CHECK_SVG}<span>✓ Salva!</span>`;
            setTimeout(() => {
              btn.classList.remove('downloading');
              btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Foto (HD)</span>`;
            }, 3000);
          } else {
            showToast('Erro ao baixar a imagem.', false);
            btn.classList.remove('downloading');
            btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar Foto (HD)</span>`;
          }
        });
      });

      container.appendChild(btn);
      img.dataset.instasaverInjected = 'true';
    });
  }

  // ==========================================
  // 3. INJEÇÃO EM STORIES E DESTAQUES
  // ==========================================
  function injectStoriesButton() {
    const isStories = window.location.pathname.startsWith('/stories/');
    if (!isStories) return;

    const isHighlight = window.location.pathname.includes('/highlights/');

    // Procura o cabeçalho superior ou diálogo do Story
    const storyContainer = document.querySelector('section:has(video), section:has(img[decoding="sync"]), div[role="dialog"]:has(video)');
    if (!storyContainer) return;

    if (document.querySelector('.instasaver-story-btn')) return; // já existe

    const btn = document.createElement('button');
    btn.className = 'instasaver-story-btn';
    btn.innerHTML = `${DOWNLOAD_SVG}<span>Baixar ${isHighlight ? 'Destaque' : 'Story'}</span>`;
    btn.title = 'Baixar exatamente a mídia que está sendo exibida agora';

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const activeVideo = document.querySelector('section video, div[role="dialog"] video');
      const activeImg = document.querySelector('section img[decoding="sync"], div[role="dialog"] img[style*="object-fit"]');

      let url = null;
      let isVideo = false;

      if (activeVideo) {
        isVideo = true;
        url = await getCleanVideoUrl(activeVideo);
      } else if (activeImg) {
        isVideo = false;
        url = activeImg.src;
      }

      if (!url) {
        showToast('Não foi possível identificar a mídia deste story.', false);
        return;
      }

      const ext = isVideo ? 'mp4' : 'jpg';
      const filename = `insta_${isHighlight ? 'destaque' : 'story'}_${Date.now()}.${ext}`;

      showToast(`Baixando ${isHighlight ? 'destaque' : 'story'} (${ext.toUpperCase()})...`);

      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_MEDIA',
        url: url,
        filename: filename
      });
    });

    storyContainer.appendChild(btn);
  }

  // Loop de escaneamento suave
  let isScanning = false;
  function runScan() {
    if (isScanning) return;
    isScanning = true;
    requestAnimationFrame(() => {
      injectButtonsOnVideos();
      injectButtonsOnPhotos();
      injectStoriesButton();
      isScanning = false;
    });
  }

  const observer = new MutationObserver(runScan);
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  runScan();

  // Escuta requisição do Popup: devolve APENAS o vídeo atualmente em foco/reprodução
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'GET_FOCUSED_MEDIA') {
      const videos = Array.from(document.querySelectorAll('video'));
      let focusedVideo = null;

      // 1. Procura vídeo que esteja tocando no momento
      focusedVideo = videos.find(v => !v.paused && v.currentTime > 0);

      // 2. Se nenhum estiver tocando, pega o vídeo mais centralizado na tela do usuário
      if (!focusedVideo && videos.length > 0) {
        const center = window.innerHeight / 2;
        let closestDist = Infinity;

        videos.forEach(v => {
          const rect = v.getBoundingClientRect();
          // Ignora se estiver fora da tela
          if (rect.bottom < 0 || rect.top > window.innerHeight) return;
          const vCenter = rect.top + rect.height / 2;
          const dist = Math.abs(vCenter - center);
          if (dist < closestDist) {
            closestDist = dist;
            focusedVideo = v;
          }
        });
      }

      if (focusedVideo) {
        getCleanVideoUrl(focusedVideo).then(url => {
          sendResponse({
            success: true,
            hasMedia: Boolean(url),
            type: 'video',
            url: url,
            isStory: window.location.pathname.startsWith('/stories/')
          });
        });
        return true;
      }

      sendResponse({ success: true, hasMedia: false });
      return true;
    }
  });

})();
