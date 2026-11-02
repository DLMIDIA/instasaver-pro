/**
 * InstaSaver Pro - Popup Controller (v2.0.0)
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elementos UI
  const pageBadge = document.getElementById('pageBadge');
  const outsideView = document.getElementById('outsideInstagramView');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  const activeVideoCard = document.getElementById('activeVideoCard');
  const activeVideoPreview = document.getElementById('activeVideoPreview');
  const downloadActiveBtn = document.getElementById('downloadActiveBtn');

  const detectedCountBadge = document.getElementById('detectedCountBadge');
  const recentVideosList = document.getElementById('recentVideosList');

  const profileUserText = document.getElementById('profileUserText');
  const scrollMoreBtn = document.getElementById('scrollMoreBtn');
  const downloadAllProfileBtn = document.getElementById('downloadAllProfileBtn');
  const profileVideosGrid = document.getElementById('profileVideosGrid');

  const linkInput = document.getElementById('linkInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const fetchLinkBtn = document.getElementById('fetchLinkBtn');
  const openInstagramBtn = document.getElementById('openInstagramBtn');

  let currentTab = null;
  let activeVideoUrl = null;
  let allDetectedVideos = [];

  // 1. Navegação de Abas
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // 2. Botão Abrir Instagram
  if (openInstagramBtn) {
    openInstagramBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'OPEN_INSTAGRAM' });
      window.close();
    });
  }

  // 3. Consulta aba ativa
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs.length) return;

  currentTab = tabs[0];
  const url = currentTab.url || '';

  if (!url.includes('instagram.com')) {
    pageBadge.textContent = 'Fora do Instagram';
    pageBadge.style.background = '#252532';
    pageBadge.style.color = '#9a9ab0';
    pageBadge.style.borderColor = '#383848';
    outsideView.classList.remove('hidden');
    tabPanels.forEach(p => p.classList.add('hidden'));
    return;
  }

  // 4. Solicita estado de mídia do content.js
  chrome.tabs.sendMessage(currentTab.id, { action: 'GET_PAGE_MEDIA_INFO' }, (res) => {
    if (!res || !res.success) {
      pageBadge.textContent = '🟢 Instagram Aberto';
      return;
    }

    // Atualiza badge de status
    if (res.pageType === 'reel') {
      pageBadge.textContent = '🎬 Reels';
    } else if (res.pageType === 'post') {
      pageBadge.textContent = '📸 Publicação';
    } else if (res.pageType === 'profile') {
      pageBadge.textContent = `👤 @${res.username || 'perfil'}`;
      if (profileUserText) profileUserText.textContent = `@${res.username || 'perfil_da_empresa'}`;
    } else if (res.pageType === 'stories') {
      pageBadge.textContent = '🟣 Story / Destaque';
    } else {
      pageBadge.textContent = '🟢 Feed';
    }

    allDetectedVideos = res.videos || [];
    detectedCountBadge.textContent = allDetectedVideos.length;

    // Se houver vídeo recente ativo
    if (allDetectedVideos.length > 0) {
      const topVideo = allDetectedVideos[0];
      if (topVideo.videoUrl) {
        activeVideoUrl = topVideo.videoUrl;
        activeVideoPreview.src = topVideo.videoUrl;
        activeVideoCard.classList.remove('hidden');
      }
    }

    renderRecentVideos(allDetectedVideos);
    renderProfileGrid(allDetectedVideos, res.username);
  });

  // 5. Renderiza Lista de Vídeos Recentes
  function renderRecentVideos(videos) {
    recentVideosList.innerHTML = '';
    if (!videos || !videos.length) {
      recentVideosList.innerHTML = '<p style="color:#777;font-size:11px;text-align:center;padding:12px 0;">Nenhum vídeo detectado ainda nesta aba. Role a página para carregar vídeos.</p>';
      return;
    }

    videos.forEach((v, idx) => {
      const row = document.createElement('div');
      row.className = 'video-item-row';

      const thumb = document.createElement('img');
      thumb.className = 'video-item-thumb';
      thumb.src = v.thumbnailUrl || 'icons/icon48.png';

      const info = document.createElement('div');
      info.className = 'video-item-info';

      const title = document.createElement('div');
      title.className = 'video-item-title';
      title.textContent = v.caption || (v.username ? `@${v.username}` : `Vídeo ${idx + 1}`);

      const meta = document.createElement('div');
      meta.className = 'video-item-meta';
      meta.textContent = `MP4 • ${v.code || 'Reel'}`;

      info.appendChild(title);
      info.appendChild(meta);

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn btn-secondary btn-sm';
      dlBtn.textContent = 'Baixar';

      dlBtn.addEventListener('click', () => {
        dlBtn.disabled = true;
        dlBtn.textContent = 'Baixando...';

        const filename = `insta_${v.username || 'video'}_${v.code || idx + 1}_${Date.now()}.mp4`;
        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_MEDIA',
          url: v.videoUrl,
          filename: filename
        }, (dRes) => {
          if (dRes && dRes.success) {
            dlBtn.textContent = '✓ Salvo';
            dlBtn.style.background = '#16a34a';
            setTimeout(() => {
              dlBtn.disabled = false;
              dlBtn.textContent = 'Baixar';
              dlBtn.style.background = '';
            }, 3000);
          } else {
            dlBtn.disabled = false;
            dlBtn.textContent = 'Erro';
          }
        });
      });

      row.appendChild(thumb);
      row.appendChild(info);
      row.appendChild(dlBtn);

      recentVideosList.appendChild(row);
    });
  }

  // 6. Renderiza Grade do Perfil
  function renderProfileGrid(videos, username) {
    profileVideosGrid.innerHTML = '';
    if (!videos || !videos.length) {
      profileVideosGrid.innerHTML = '<p style="color:#777;font-size:11px;grid-column:span 3;text-align:center;padding:16px 0;">Role a página do perfil para que os reels sejam detectados na memória.</p>';
      return;
    }

    videos.forEach((v, idx) => {
      const card = document.createElement('div');
      card.className = 'grid-card';

      const img = document.createElement('img');
      img.src = v.thumbnailUrl || 'icons/icon48.png';

      const overlay = document.createElement('div');
      overlay.className = 'grid-card-overlay';

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn btn-gradient btn-sm';
      dlBtn.textContent = '⬇ MP4';

      dlBtn.addEventListener('click', () => {
        dlBtn.textContent = 'Baixando...';
        const filename = `insta_${username || v.username || 'perfil'}_${v.code || idx + 1}.mp4`;
        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_MEDIA',
          url: v.videoUrl,
          filename: filename
        }, () => {
          dlBtn.textContent = '✓';
        });
      });

      overlay.appendChild(dlBtn);
      card.appendChild(img);
      card.appendChild(overlay);

      profileVideosGrid.appendChild(card);
    });
  }

  // 7. Download do Vídeo Ativo em Foco
  if (downloadActiveBtn) {
    downloadActiveBtn.addEventListener('click', () => {
      if (!activeVideoUrl) return;

      downloadActiveBtn.disabled = true;
      downloadActiveBtn.textContent = 'Iniciando Download...';

      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_MEDIA',
        url: activeVideoUrl,
        filename: `insta_video_${Date.now()}.mp4`
      }, (res) => {
        if (res && res.success) {
          downloadActiveBtn.textContent = '✓ Vídeo Salvo (H.264 + Áudio)!';
          downloadActiveBtn.style.background = '#16a34a';
          setTimeout(() => {
            downloadActiveBtn.disabled = false;
            downloadActiveBtn.textContent = 'Baixar Este Vídeo (MP4 + Áudio)';
            downloadActiveBtn.style.background = '';
          }, 3500);
        } else {
          downloadActiveBtn.disabled = false;
          downloadActiveBtn.textContent = 'Erro ao baixar';
        }
      });
    });
  }

  // 8. Rolar Página do Perfil Automaticamente
  if (scrollMoreBtn) {
    scrollMoreBtn.addEventListener('click', () => {
      scrollMoreBtn.disabled = true;
      scrollMoreBtn.textContent = 'Rolando e Carregando...';

      chrome.tabs.sendMessage(currentTab.id, { action: 'AUTO_SCROLL_PROFILE' }, () => {
        setTimeout(() => {
          chrome.tabs.sendMessage(currentTab.id, { action: 'GET_PAGE_MEDIA_INFO' }, (res) => {
            scrollMoreBtn.disabled = false;
            scrollMoreBtn.textContent = '🔄 Rolar Página (Carregar Mais Vídeos)';
            if (res && res.videos) {
              allDetectedVideos = res.videos;
              detectedCountBadge.textContent = allDetectedVideos.length;
              renderRecentVideos(allDetectedVideos);
              renderProfileGrid(allDetectedVideos, res.username);
            }
          });
        }, 1000);
      });
    });
  }

  // 9. Baixar Todos os Vídeos do Perfil em Lote
  if (downloadAllProfileBtn) {
    downloadAllProfileBtn.addEventListener('click', () => {
      if (!allDetectedVideos || !allDetectedVideos.length) {
        alert('Nenhum vídeo detectado nesta página ainda. Role o perfil para carregar os vídeos.');
        return;
      }

      downloadAllProfileBtn.disabled = true;
      downloadAllProfileBtn.textContent = `Iniciando Lote (${allDetectedVideos.length} vídeos)...`;

      const items = allDetectedVideos.map((v, i) => ({
        url: v.videoUrl,
        filename: `insta_${v.username || 'perfil'}_${v.code || i + 1}_${Date.now()}.mp4`
      }));

      chrome.runtime.sendMessage({
        action: 'BATCH_DOWNLOAD',
        items: items
      }, () => {
        downloadAllProfileBtn.textContent = '✓ Fila de Downloads Disparada!';
        setTimeout(() => {
          downloadAllProfileBtn.disabled = false;
          downloadAllProfileBtn.textContent = '⬇ Baixar Todos os Vídeos Detectados';
        }, 4000);
      });
    });
  }

  // 10. Colar Link & Abrir
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) linkInput.value = text.trim();
      } catch (e) {
        linkInput.focus();
      }
    });
  }

  if (fetchLinkBtn) {
    fetchLinkBtn.addEventListener('click', () => {
      const val = linkInput.value.trim();
      if (!val || !val.includes('instagram.com')) {
        alert('Por favor, informe um link válido do Instagram (ex: https://www.instagram.com/reel/...)');
        return;
      }
      chrome.tabs.create({ url: val });
      window.close();
    });
  }
});
