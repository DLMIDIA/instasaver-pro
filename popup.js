/**
 * InstaSaver Pro - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elementos da UI
  const pageBadge = document.getElementById('pageBadge');
  const notInstagramState = document.getElementById('notInstagramState');
  const mediaDetectedState = document.getElementById('mediaDetectedState');
  const mediaListContainer = document.getElementById('mediaListContainer');
  const noMediaFoundMsg = document.getElementById('noMediaFoundMsg');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const downloadAllText = document.getElementById('downloadAllText');
  const refreshScanBtn = document.getElementById('refreshScanBtn');
  const openInstagramBtn = document.getElementById('openInstagramBtn');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  const linkInput = document.getElementById('linkInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const goToLinkBtn = document.getElementById('goToLinkBtn');

  const toggleInPageBtns = document.getElementById('toggleInPageBtns');
  const prefixInput = document.getElementById('prefixInput');

  let currentTab = null;
  let detectedMediaItems = [];

  // 1. Gerenciamento de Abas Internas (Tabs)
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add('active');
    });
  });

  // 2. Carrega configurações salvas
  chrome.storage.local.get(['inPageButtons', 'filePrefix'], (result) => {
    if (result.inPageButtons !== undefined) {
      toggleInPageBtns.checked = result.inPageButtons;
    }
    if (result.filePrefix) {
      prefixInput.value = result.filePrefix;
    }
  });

  toggleInPageBtns.addEventListener('change', () => {
    chrome.storage.local.set({ inPageButtons: toggleInPageBtns.checked });
  });

  prefixInput.addEventListener('input', () => {
    chrome.storage.local.set({ filePrefix: prefixInput.value.trim() });
  });

  // 3. Botão de abrir Instagram
  if (openInstagramBtn) {
    openInstagramBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'OPEN_INSTAGRAM' });
      window.close();
    });
  }

  // 4. Detecção da Aba Ativa
  async function scanActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs.length) return;

    currentTab = tabs[0];
    const url = currentTab.url || '';

    if (!url.includes('instagram.com')) {
      pageBadge.textContent = 'Fora do Instagram';
      pageBadge.className = 'page-badge badge-neutral';
      notInstagramState.classList.remove('hidden');
      mediaDetectedState.classList.add('hidden');
      return;
    }

    notInstagramState.classList.add('hidden');
    mediaDetectedState.classList.remove('hidden');
    pageBadge.textContent = 'Carregando...';

    // Dispara coleta no Content Script
    chrome.tabs.sendMessage(currentTab.id, { action: 'GET_PAGE_MEDIA' }, async (response) => {
      detectedMediaItems = [];

      // 1. Itens da DOM do content script
      if (response && response.items && response.items.length) {
        detectedMediaItems = response.items;
        updateBadge(response.pageType);
      } else {
        updateBadgeFromUrl(url);
      }

      // 2. Mescla com mídias sniffadas na rede (Background)
      try {
        const bgRes = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'GET_SNIFFED_MEDIA', tabId: currentTab.id }, resolve);
        });
        if (bgRes && bgRes.media && bgRes.media.length) {
          bgRes.media.forEach(bgItem => {
            const exists = detectedMediaItems.some(i => i.url === bgItem.url);
            if (!exists) {
              detectedMediaItems.unshift({
                type: bgItem.type,
                url: bgItem.url,
                title: bgItem.type === 'video' ? 'Vídeo (Detectado no Player)' : 'Imagem (CDN)',
                pageType: 'stream'
              });
            }
          });
        }
      } catch (err) {}

      renderMediaList(detectedMediaItems);
    });
  }

  function updateBadge(pageType) {
    pageBadge.className = 'page-badge';
    if (pageType === 'stories') {
      pageBadge.textContent = '🟣 Story Ativo';
      pageBadge.classList.add('badge-story');
    } else if (pageType === 'highlight') {
      pageBadge.textContent = '⭐ Destaque';
      pageBadge.classList.add('badge-story');
    } else if (pageType === 'reel') {
      pageBadge.textContent = '🎬 Reel Aberto';
      pageBadge.classList.add('badge-reel');
    } else if (pageType === 'post') {
      pageBadge.textContent = '📸 Post Aberto';
      pageBadge.classList.add('badge-post');
    } else {
      pageBadge.textContent = '🟢 Instagram Feed';
      pageBadge.classList.add('badge-post');
    }
  }

  function updateBadgeFromUrl(url) {
    if (url.includes('/stories/highlights/')) updateBadge('highlight');
    else if (url.includes('/stories/')) updateBadge('stories');
    else if (url.includes('/reel/')) updateBadge('reel');
    else if (url.includes('/p/')) updateBadge('post');
    else updateBadge('feed');
  }

  // 5. Renderização dos cards de mídia
  function renderMediaList(items) {
    mediaListContainer.innerHTML = '';

    if (!items || !items.length) {
      noMediaFoundMsg.classList.remove('hidden');
      downloadAllBtn.parentElement.classList.add('hidden');
      return;
    }

    noMediaFoundMsg.classList.add('hidden');
    downloadAllBtn.parentElement.classList.remove('hidden');
    downloadAllText.textContent = `Baixar Todos (${items.length} ${items.length === 1 ? 'item' : 'itens'})`;

    const prefix = prefixInput.value || 'insta_';

    items.forEach((item, index) => {
      const isVideo = item.type === 'video';
      const ext = isVideo ? 'mp4' : 'jpg';

      const card = document.createElement('div');
      card.className = 'media-card';

      // Miniatura / Thumbnail
      const thumbWrapper = document.createElement('div');
      thumbWrapper.className = 'media-thumb-wrapper';

      if (isVideo) {
        const video = document.createElement('video');
        video.className = 'media-thumb';
        video.src = item.url;
        video.preload = 'metadata';
        video.muted = true;
        thumbWrapper.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.className = 'media-thumb';
        img.src = item.url;
        thumbWrapper.appendChild(img);
      }

      const tag = document.createElement('span');
      tag.className = 'thumb-tag';
      tag.textContent = isVideo ? 'MP4' : 'JPG';
      thumbWrapper.appendChild(tag);

      // Detalhes
      const details = document.createElement('div');
      details.className = 'media-details';

      const title = document.createElement('div');
      title.className = 'media-title';
      title.textContent = item.title || (isVideo ? `Vídeo ${index + 1}` : `Foto ${index + 1}`);

      const meta = document.createElement('div');
      meta.className = 'media-meta';
      meta.innerHTML = `<span>${isVideo ? '🎬 Vídeo Comprimido' : '📸 Imagem'}</span> • <span>Pronto</span>`;

      details.appendChild(title);
      details.appendChild(meta);

      // Ação de download
      const action = document.createElement('div');
      action.className = 'media-download-action';

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn btn-sm btn-gradient';
      dlBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Baixar
      `;

      dlBtn.addEventListener('click', () => {
        dlBtn.disabled = true;
        dlBtn.textContent = 'Baixando...';

        const filename = `${prefix}${item.type}_${Date.now()}_${index + 1}.${ext}`;
        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_MEDIA',
          url: item.url,
          filename: filename
        }, (res) => {
          if (res && res.success) {
            dlBtn.textContent = '✓ Salvo';
            dlBtn.style.background = '#22c55e';
            setTimeout(() => {
              dlBtn.disabled = false;
              dlBtn.innerHTML = 'Baixar';
              dlBtn.style.background = '';
            }, 3000);
          } else {
            dlBtn.disabled = false;
            dlBtn.textContent = 'Erro';
          }
        });
      });

      action.appendChild(dlBtn);

      card.appendChild(thumbWrapper);
      card.appendChild(details);
      card.appendChild(action);

      mediaListContainer.appendChild(card);
    });
  }

  // 6. Baixar Todos
  downloadAllBtn.addEventListener('click', () => {
    if (!detectedMediaItems.length) return;

    downloadAllBtn.disabled = true;
    downloadAllBtn.textContent = 'Iniciando Downloads...';

    const prefix = prefixInput.value || 'insta_';
    const batchItems = detectedMediaItems.map((item, idx) => ({
      url: item.url,
      type: item.type,
      filename: `${prefix}colecao_${Date.now()}_${idx + 1}.${item.type === 'video' ? 'mp4' : 'jpg'}`
    }));

    chrome.runtime.sendMessage({
      action: 'BATCH_DOWNLOAD',
      items: batchItems
    }, () => {
      downloadAllBtn.textContent = '✓ Downloads Disparados!';
      setTimeout(() => {
        downloadAllBtn.disabled = false;
        downloadAllBtn.textContent = `Baixar Todos (${detectedMediaItems.length} itens)`;
      }, 3500);
    });
  });

  if (refreshScanBtn) {
    refreshScanBtn.addEventListener('click', scanActiveTab);
  }

  // 7. Colar Link & Abrir
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) linkInput.value = text.trim();
    } catch (e) {
      linkInput.focus();
    }
  });

  goToLinkBtn.addEventListener('click', () => {
    const val = linkInput.value.trim();
    if (!val) {
      alert('Por favor, cole um link do Instagram válido.');
      return;
    }

    if (!val.includes('instagram.com')) {
      alert('O link informado precisa ser do Instagram (ex: https://www.instagram.com/reel/...)');
      return;
    }

    chrome.tabs.create({ url: val });
    window.close();
  });

  // Inicializa a varredura
  scanActiveTab();
});
