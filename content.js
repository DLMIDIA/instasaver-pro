/**
 * InstaSaver Pro - Content Script
 * Injeta botões nativos de download em Stories, Destaques, Feed e Reels.
 * Escaneia mídias para a interface da extensão.
 */

(function () {
  'use strict';

  // SVG do ícone de Download
  const DOWNLOAD_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  `;

  // Toast Notification
  function showToast(message, isSuccess = true) {
    let toast = document.getElementById('instasaver-toast-elem');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'instasaver-toast-elem';
      toast.className = 'instasaver-toast';
      document.body.appendChild(toast);
    }

    const icon = isSuccess 
      ? '<span style="color:#4ade80;font-size:16px;">✓</span>' 
      : '<span style="color:#f87171;font-size:16px;">✕</span>';

    toast.innerHTML = `<span class="instasaver-toast-icon">${icon}</span> <span>${message}</span>`;
    toast.classList.add('show');

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  // Busca melhor URL de CDN para vídeos, contornando blob:
  async function resolveMediaUrl(element, isVideo) {
    if (!element) return null;

    let directSrc = element.src || element.currentSrc;
    if (directSrc && !directSrc.startsWith('blob:')) {
      return directSrc;
    }

    // Procura em tags <source>
    const source = element.querySelector('source');
    if (source && source.src && !source.src.startsWith('blob:')) {
      return source.src;
    }

    // Se for blob:, consulta o log de rede da página (Performance API)
    try {
      const resources = performance.getEntriesByType('resource');
      const videoResources = resources.filter(r => 
        (r.name.includes('cdninstagram.com') || r.name.includes('fbcdn.net')) &&
        (r.name.includes('.mp4') || r.name.includes('/v/t50.') || r.initiatorType === 'video' || r.initiatorType === 'fetch' || r.initiatorType === 'xmlhttprequest')
      );

      if (videoResources.length > 0) {
        // Pega a requisição mais recente compatível
        return videoResources[videoResources.length - 1].name;
      }
    } catch (e) {
      console.warn('[InstaSaver] Falha ao ler Performance API:', e);
    }

    // Fallback: consulta mídias interceptadas no background
    try {
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'GET_SNIFFED_MEDIA' }, resolve);
      });
      if (response && response.media && response.media.length > 0) {
        const match = response.media.find(m => isVideo ? m.type === 'video' : m.type === 'image');
        if (match) return match.url;
      }
    } catch (e) {}

    return directSrc || null;
  }

  // 1. Injeção em Stories e Destaques
  function injectStoriesButton() {
    const isStories = window.location.pathname.startsWith('/stories/');
    if (!isStories) return;

    // Procura o cabeçalho superior do Story onde ficam os botões de pause/áudio/fechar
    const storyHeader = document.querySelector('section header, div[role="dialog"] header, section div[class*="_ab3"]');
    if (!storyHeader) return;

    if (storyHeader.querySelector('.instasaver-btn-story')) return; // já injetado

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'instasaver-btn-story';
    const isHighlight = window.location.pathname.includes('/highlights/');
    downloadBtn.innerHTML = `${DOWNLOAD_ICON_SVG} <span>Baixar ${isHighlight ? 'Destaque' : 'Story'}</span>`;
    downloadBtn.title = 'Baixar este Story/Destaque agora com qualidade original';

    downloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      // Pausa o story momentaneamente se puder
      const videoEl = document.querySelector('section video, div[role="dialog"] video');
      const imgEl = document.querySelector('section img[decoding="sync"], section img[style*="object-fit"], div[role="dialog"] img');

      let mediaUrl = null;
      let isVideo = false;

      if (videoEl) {
        isVideo = true;
        mediaUrl = await resolveMediaUrl(videoEl, true);
      } else if (imgEl) {
        isVideo = false;
        mediaUrl = imgEl.src;
      }

      if (!mediaUrl) {
        showToast('Não foi possível capturar a mídia deste story.', false);
        return;
      }

      // Extrai usuário da URL ou do cabeçalho
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      let username = 'destaque';
      if (pathParts.length >= 2 && pathParts[0] === 'stories' && pathParts[1] !== 'highlights') {
        username = pathParts[1];
      }

      const ext = isVideo ? 'mp4' : 'jpg';
      const filename = `insta_${isHighlight ? 'destaque' : 'story'}_${username}_${Date.now()}.${ext}`;

      showToast(`Iniciando download do ${isHighlight ? 'Destaque' : 'Story'} de @${username}...`);

      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_MEDIA',
        url: mediaUrl,
        filename: filename
      }, (res) => {
        if (res && res.success) {
          showToast(`✓ Salvo: ${filename}`, true);
        } else {
          showToast('Erro ao salvar o arquivo.', false);
        }
      });
    });

    // Insere no início do bloco de controles do cabeçalho
    const controlsContainer = storyHeader.querySelector('div:last-child') || storyHeader;
    controlsContainer.prepend(downloadBtn);
  }

  // 2. Injeção no Feed e Posts Modais
  function injectFeedButtons() {
    const articles = document.querySelectorAll('article:not(.instasaver-processed), div[role="dialog"] article:not(.instasaver-processed)');

    articles.forEach(article => {
      article.classList.add('instasaver-processed');

      // Procura a barra de ações (Like, Comentar, Compartilhar, Salvar)
      // O botão de salvar (Bookmark) geralmente fica no lado direito da barra de botões
      const buttonsBar = article.querySelector('section:has(svg)');
      if (!buttonsBar) return;

      if (buttonsBar.querySelector('.instasaver-btn-feed')) return;

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'instasaver-btn-feed';
      downloadBtn.setAttribute('aria-label', 'Baixar Conteúdo');
      downloadBtn.title = 'Baixar Vídeo/Foto deste Post';
      downloadBtn.innerHTML = DOWNLOAD_ICON_SVG;

      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        // Localiza a mídia deste post específico
        const videoEl = article.querySelector('video');
        const imgEl = article.querySelector('div[role="button"] img, img[style*="object-fit"]');

        let isVideo = Boolean(videoEl);
        let mediaUrl = null;

        if (isVideo) {
          mediaUrl = await resolveMediaUrl(videoEl, true);
        } else if (imgEl) {
          mediaUrl = imgEl.src;
        }

        if (!mediaUrl) {
          showToast('Mídia não encontrada neste post.', false);
          return;
        }

        // Tenta achar código do post ou autor
        const postLink = article.querySelector('a[href*="/p/"], a[href*="/reel/"]');
        let code = 'post';
        if (postLink) {
          const match = postLink.href.match(/\/(p|reel)\/([^/]+)/);
          if (match && match[2]) code = match[2];
        }

        const ext = isVideo ? 'mp4' : 'jpg';
        const filename = `insta_${code}_${Date.now()}.${ext}`;

        showToast(`Baixando ${isVideo ? 'vídeo' : 'foto'} (${ext.toUpperCase()})...`);

        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_MEDIA',
          url: mediaUrl,
          filename: filename
        }, (res) => {
          if (res && res.success) {
            showToast(`✓ Salvo com sucesso!`, true);
          } else {
            showToast('Erro ao baixar mídia.', false);
          }
        });
      });

      // Adiciona ao lado do botão de salvar ou ao final da seção
      const saveBtn = buttonsBar.querySelector('div:last-child');
      if (saveBtn) {
        saveBtn.appendChild(downloadBtn);
      } else {
        buttonsBar.appendChild(downloadBtn);
      }
    });
  }

  // 3. Injeção na página de Reels (/reels/ ou /reel/)
  function injectReelsButton() {
    if (!window.location.pathname.includes('/reel')) return;

    // Procura os blocos de ação lateral nos Reels
    const reelActions = document.querySelectorAll('div[role="button"]:has(svg[aria-label*="Curtir"]), div:has(svg[aria-label*="Like"])');
    reelActions.forEach(actionBlock => {
      const parentCol = actionBlock.parentElement;
      if (parentCol && !parentCol.querySelector('.instasaver-btn-reel')) {
        const btn = document.createElement('button');
        btn.className = 'instasaver-btn-reel';
        btn.innerHTML = `${DOWNLOAD_ICON_SVG}<span>Baixar</span>`;
        btn.title = 'Baixar Reel em MP4';

        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const videoEl = document.querySelector('video');
          if (videoEl) {
            const mediaUrl = await resolveMediaUrl(videoEl, true);
            if (mediaUrl) {
              const code = window.location.pathname.split('/').filter(Boolean)[1] || 'reel';
              showToast('Baixando Reel...');
              chrome.runtime.sendMessage({
                action: 'DOWNLOAD_MEDIA',
                url: mediaUrl,
                filename: `insta_reel_${code}_${Date.now()}.mp4`
              });
            }
          }
        });

        parentCol.appendChild(btn);
      }
    });
  }

  // Observer contínuo para páginas dinâmicas (Single Page Application)
  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      injectStoriesButton();
      injectFeedButtons();
      injectReelsButton();
      scanScheduled = false;
    });
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Execução inicial
  scheduleScan();

  // Escuta requisições do Popup da Extensão
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_PAGE_MEDIA') {
      const isStories = window.location.pathname.startsWith('/stories/');
      const isReel = window.location.pathname.includes('/reel');
      const isPost = window.location.pathname.startsWith('/p/');
      const isHighlight = isStories && window.location.pathname.includes('/highlights/');

      let pageType = 'feed';
      if (isHighlight) pageType = 'highlight';
      else if (isStories) pageType = 'stories';
      else if (isReel) pageType = 'reel';
      else if (isPost) pageType = 'post';

      // Coleta mídias visíveis
      const mediaList = [];
      const seenUrls = new Set();

      // Vídeos
      document.querySelectorAll('video').forEach((vid, idx) => {
        let src = vid.src || vid.currentSrc;
        if (src && !seenUrls.has(src)) {
          seenUrls.add(src);
          mediaList.push({
            type: 'video',
            url: src,
            title: `Vídeo ${idx + 1} (${pageType.toUpperCase()})`,
            pageType: pageType
          });
        }
      });

      // Imagens de post
      document.querySelectorAll('article img[style*="object-fit"], div[role="dialog"] img, section img[decoding="sync"]').forEach((img, idx) => {
        if (img.src && !img.src.includes('profile_pic') && !seenUrls.has(img.src)) {
          seenUrls.add(img.src);
          mediaList.push({
            type: 'image',
            url: img.src,
            title: `Foto ${idx + 1}`,
            pageType: pageType
          });
        }
      });

      sendResponse({
        success: true,
        pageType: pageType,
        url: window.location.href,
        items: mediaList
      });
      return true;
    }
  });

})();
