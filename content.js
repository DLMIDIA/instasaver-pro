/**
 * InstaSaver Pro - Content Script (v2.1.0)
 * Injeta botões LATERAIS nativos (Fora do vídeo):
 * 1. Barra de Ações do Post (ao lado do botão de Salvar/Bookmark)
 * 2. Coluna Lateral dos Reels (empilhado com Curtir, Comentar, Compartilhar)
 * 3. Cabeçalho de Controles nos Stories e Destaques
 * 4. Miniaturas da Grade de Perfis (Lote)
 *
 * Comunica-se com o inject.js (mundo MAIN) para obter o arquivo MP4 (H.264 + Áudio AAC)
 * através da API oficial de Media ID e GraphQL.
 */

(function () {
  'use strict';

  let reqIdCounter = 0;
  let sectionIdCounter = 0;

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

  // Ponte assíncrona com o inject.js (Mundo MAIN)
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

      // Timeout de segurança de 4 segundos
      setTimeout(() => {
        window.removeEventListener('instasaver_response', listener);
        resolve({ success: false, timeout: true });
      }, 4000);
    });
  }

  // Extrai o shortcode de um elemento do DOM ou da URL atual
  function detectShortcode(element) {
    // 1. Se a URL atual já for de um post ou reel específico
    const urlMatch = window.location.pathname.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
    if (urlMatch && urlMatch[2]) return urlMatch[2];

    // 2. Procura em links <a> dentro ou ao redor do elemento
    if (element) {
      const container = element.closest('article') ||
                        element.closest('div[role="dialog"]') ||
                        element.closest('main') ||
                        element;

      const postLink = container.querySelector('a[href*="/p/"], a[href*="/reel/"]');
      if (postLink && postLink.href) {
        const m = postLink.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
        if (m && m[2]) return m[2];
      }
    }

    // 3. Fallback em links visíveis no modal atual
    const modalLink = document.querySelector('div[role="dialog"] a[href*="/p/"], div[role="dialog"] a[href*="/reel/"]');
    if (modalLink && modalLink.href) {
      const m2 = modalLink.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
      if (m2 && m2[2]) return m2[2];
    }

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
          btn.classList.remove('downloading');
          btn.classList.add('downloaded');
          const originalHTML = btn.innerHTML;
          btn.innerHTML = `${SVG_CHECK}<span>✓ Baixado!</span>`;
          setTimeout(() => {
            btn.classList.remove('downloaded');
            btn.innerHTML = originalHTML;
          }, 3500);
        }
        showToast('✓ Download iniciado: MP4 original com áudio!', true);
      } else {
        showToast('Erro no download: ' + (res?.error || 'Tente novamente'), false);
        if (btn) {
          btn.classList.remove('downloading');
        }
      }
    });
  }

  // ==============================================================
  // 1. BOTÃO NA BARRA DE AÇÕES DO POST (Feed, Modal e Página Única)
  // Posicionado ao lado do botão de Salvar/Bookmark (FORA DO VÍDEO)
  // ==============================================================
  function findBookmarkContainer(section) {
    // 1. Busca pelo SVG de salvar/bookmark
    const bookmarkSvg = section.querySelector(
      'svg[aria-label*="Salvar"], svg[aria-label*="Save"], svg[aria-label*="Remover"], svg[aria-label*="Remove"], ' +
      'polygon[points="20 21 12 13.44 4 21 4 3 20 3 20 21"], ' +
      'path[d^="M20 22"], path[d^="m20 22"], svg:has(polygon)'
    );

    if (bookmarkSvg) {
      let cur = bookmarkSvg;
      while (cur && cur.parentElement && cur.parentElement !== section) {
        if (cur.tagName === 'DIV' || cur.tagName === 'SPAN' || cur.tagName === 'BUTTON' || cur.getAttribute('role') === 'button') {
          if (cur.parentElement.tagName === 'SECTION' || cur.parentElement.parentElement?.tagName === 'SECTION') {
            return cur;
          }
        }
        cur = cur.parentElement;
      }
      return bookmarkSvg.closest('div[role="button"]') || bookmarkSvg.closest('button') || bookmarkSvg.parentElement;
    }

    // 2. Se não achar o SVG, no layout do Instagram o Bookmark fica no último filho de section
    if (section.children.length > 1) {
      return section.children[section.children.length - 1];
    }

    return null;
  }

  function injectPostActionBarButtons() {
    // Localiza todas as seções de ações (em feed <article>, modais div[role="dialog"] ou páginas /p/)
    const sections = document.querySelectorAll('article section, div[role="dialog"] section, main[role="main"] section');

    sections.forEach(section => {
      // Ignora se não for uma barra de ações típica (precisa ter curtida, comentário ou salvar)
      const hasActionIcons = section.querySelector('svg[aria-label*="Curtir"], svg[aria-label*="Like"], svg[aria-label*="Salvar"], svg[aria-label*="Save"], svg[aria-label*="Comentar"]');
      if (!hasActionIcons) return;

      // Se já injetamos nesta seção, não duplica
      if (section.querySelector('.instasaver-action-btn')) return;

      const sectionId = 'is_sec_' + (++sectionIdCounter);
      section.dataset.instasaverSectionId = sectionId;

      const btn = document.createElement('button');
      btn.className = 'instasaver-action-btn';
      btn.type = 'button';
      btn.title = 'Baixar Vídeo Original (MP4 com som estéreo AAC)';
      btn.setAttribute('aria-label', 'Baixar Vídeo');
      btn.innerHTML = `
        <div class="instasaver-action-icon">${SVG_DOWNLOAD}</div>
        <span class="instasaver-action-label">Baixar</span>
      `;

      // Evento de clique seguro e independente (não pausa o vídeo)
      const handleClick = async (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        if (btn.classList.contains('downloading')) return;

        btn.classList.add('downloading');
        const labelSpan = btn.querySelector('.instasaver-action-label');
        if (labelSpan) labelSpan.textContent = 'Buscando...';
        showToast('Localizando arquivo original com som...');

        const shortcode = detectShortcode(section);

        // Consulta o inject.js com o shortcode
        const response = await callInjectEngine('GET_MEDIA_FOR_SHORTCODE', {
          shortcode,
          domSelector: `[data-instasaver-section-id="${sectionId}"]`
        });

        if (response && response.success && response.item && response.item.videoUrl) {
          const item = response.item;
          const userPrefix = item.username ? `insta_${item.username}_` : 'insta_';
          const codePart = item.code || shortcode || 'video';
          const filename = `${userPrefix}${codePart}_${Date.now()}.mp4`;

          if (labelSpan) labelSpan.textContent = 'Baixando...';
          requestDownload(item.videoUrl, filename, btn);
        } else if (response && response.item && response.item.thumbnailUrl && !response.item.isVideo) {
          // Caso seja uma foto em alta resolução
          const item = response.item;
          const userPrefix = item.username ? `insta_${item.username}_` : 'insta_';
          const filename = `${userPrefix}${shortcode || Date.now()}.jpg`;
          if (labelSpan) labelSpan.textContent = 'Baixando...';
          requestDownload(item.thumbnailUrl, filename, btn);
        } else {
          showToast('Não foi possível obter o MP4 deste post.', false);
          btn.classList.remove('downloading');
          if (labelSpan) labelSpan.textContent = 'Baixar';
        }
      };

      btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
      btn.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);
      btn.addEventListener('click', handleClick, true);

      // Encaixa o botão ao lado do Bookmark/Salvar
      const bookmarkContainer = findBookmarkContainer(section);
      if (bookmarkContainer && bookmarkContainer.parentElement) {
        bookmarkContainer.parentElement.insertBefore(btn, bookmarkContainer);
      } else {
        section.appendChild(btn);
      }
    });
  }

  // ==============================================================
  // 2. BOTÃO NA COLUNA LATERAL DOS REELS (Reels Feed e /reels/)
  // Empilhado com Curtir, Comentar e Compartilhar no lado direito
  // ==============================================================
  function injectReelsSidebarButtons() {
    // Procura elementos de ação na barra lateral vertical do Reels
    const likeSvgs = document.querySelectorAll('svg[aria-label*="Curtir"], svg[aria-label*="Like"]');

    likeSvgs.forEach(likeSvg => {
      // Localiza o container vertical do Reels (flex column)
      let columnContainer = likeSvg.closest('div');
      while (columnContainer && columnContainer !== document.body) {
        const style = window.getComputedStyle(columnContainer);
        if (style.display === 'flex' && (style.flexDirection === 'column' || style.flexDirection === 'column-reverse')) {
          break;
        }
        columnContainer = columnContainer.parentElement;
      }

      if (!columnContainer || columnContainer === document.body) return;
      if (columnContainer.querySelector('.instasaver-reels-btn')) return;

      // Valida se esta coluna possui outros botões típicos de Reels (comentar, compartilhar ou salvar)
      const hasOtherReelsActions = columnContainer.querySelector(
        'svg[aria-label*="Comentar"], svg[aria-label*="Comment"], svg[aria-label*="Compartilhar"], svg[aria-label*="Share"], svg[aria-label*="Salvar"], svg[aria-label*="Save"]'
      );
      if (!hasOtherReelsActions) return;

      const reelsBtnWrap = document.createElement('div');
      reelsBtnWrap.className = 'instasaver-reels-btn-wrap';

      const reelsBtn = document.createElement('button');
      reelsBtn.className = 'instasaver-reels-btn';
      reelsBtn.type = 'button';
      reelsBtn.title = 'Baixar Reel Original (MP4 com áudio)';
      reelsBtn.innerHTML = `
        <div class="instasaver-reels-icon">${SVG_DOWNLOAD}</div>
        <span class="instasaver-reels-label">Baixar</span>
      `;

      const handleReelsClick = async (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        if (reelsBtn.classList.contains('downloading')) return;

        reelsBtn.classList.add('downloading');
        const label = reelsBtn.querySelector('.instasaver-reels-label');
        if (label) label.textContent = 'Buscando...';
        showToast('Localizando Reel com som original...');

        const shortcode = detectShortcode(columnContainer);
        const res = await callInjectEngine('GET_MEDIA_FOR_SHORTCODE', { shortcode });

        if (res && res.success && res.item && res.item.videoUrl) {
          const item = res.item;
          const userPrefix = item.username ? `insta_${item.username}_` : 'insta_';
          const filename = `${userPrefix}${shortcode || 'reel'}_${Date.now()}.mp4`;

          if (label) label.textContent = 'Baixando...';
          requestDownload(item.videoUrl, filename, reelsBtn);
        } else {
          showToast('Não foi possível obter o vídeo deste Reel.', false);
          reelsBtn.classList.remove('downloading');
          if (label) label.textContent = 'Baixar';
        }
      };

      reelsBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
      reelsBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);
      reelsBtn.addEventListener('click', handleReelsClick, true);

      reelsBtnWrap.appendChild(reelsBtn);

      // Injeta logo após o botão de salvar ou no final da coluna
      const saveSvg = columnContainer.querySelector('svg[aria-label*="Salvar"], svg[aria-label*="Save"]');
      const saveItem = saveSvg ? (saveSvg.closest('div[role="button"]') || saveSvg.closest('button') || saveSvg.parentElement) : null;
      if (saveItem && saveItem.parentElement === columnContainer) {
        columnContainer.insertBefore(reelsBtnWrap, saveItem.nextSibling);
      } else {
        columnContainer.appendChild(reelsBtnWrap);
      }
    });
  }

  // ==============================================================
  // 3. BOTÃO NOS STORIES E DESTAQUES (Barra Superior de Controles)
  // Fora da área de toque da imagem/vídeo para não avançar o story
  // ==============================================================
  function injectStoriesButton() {
    const isStories = window.location.pathname.startsWith('/stories/');
    if (!isStories) return;

    const isHighlight = window.location.pathname.includes('/highlights/');

    // Localiza o cabeçalho superior onde ficam o fechar (X), som e play/pause
    const header = document.querySelector('section > header, div[role="dialog"] header, section div:has(> svg[aria-label*="Fechar"]), section div:has(> svg[aria-label*="Close"])');
    const storyContainer = header || document.querySelector('section:has(video), div[role="dialog"]:has(video), section:has(img[decoding="sync"])');
    if (!storyContainer) return;

    if (document.querySelector('.instasaver-story-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'instasaver-story-btn';
    btn.type = 'button';
    btn.innerHTML = `${SVG_DOWNLOAD}<span>Baixar ${isHighlight ? 'Destaque' : 'Story'}</span>`;
    btn.title = 'Baixar Story ou Destaque em exibição com áudio original';

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
  // 4. BOTÕES COMPACTOS NA GRADE DE PERFIL E REELS (LOTE / GRID)
  // ==============================================================
  function injectGridDownloadButtons() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const isProfile = pathParts.length >= 1 && !['explore', 'stories', 'direct', 'reels', 'p'].includes(pathParts[0]);
    if (!isProfile) return;

    const gridLinks = document.querySelectorAll('a[href*="/p/"]:not(.is-grid-processed), a[href*="/reel/"]:not(.is-grid-processed)');

    gridLinks.forEach(link => {
      link.classList.add('is-grid-processed');

      const match = link.href.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
      if (!match || !match[2]) return;
      const shortcode = match[2];

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

  // Loop de escaneamento contínuo otimizado com requestAnimationFrame
  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      injectPostActionBarButtons();
      injectReelsSidebarButtons();
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
  // 5. COMUNICAÇÃO COM O POPUP DA EXTENSÃO
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
      window.scrollBy({ top: window.innerHeight * 1.5, behavior: 'smooth' });
      setTimeout(() => {
        sendResponse({ success: true });
      }, 700);
      return true;
    }
  });

})();
