/**
 * InstaSaver Pro - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('statusBadge');
  const outsideView = document.getElementById('outsideInstagramView');
  const instaView = document.getElementById('instagramView');
  const openInstaBtn = document.getElementById('openInstaBtn');

  const focusedMediaCard = document.getElementById('focusedMediaCard');
  const focusedVideoPreview = document.getElementById('focusedVideoPreview');
  const downloadFocusedBtn = document.getElementById('downloadFocusedBtn');

  const directLinkInput = document.getElementById('directLinkInput');
  const goLinkBtn = document.getElementById('goLinkBtn');

  let activeMediaUrl = null;

  if (openInstaBtn) {
    openInstaBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'OPEN_INSTAGRAM' });
      window.close();
    });
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs.length) return;

  const currentTab = tabs[0];
  const url = currentTab.url || '';

  if (!url.includes('instagram.com')) {
    outsideView.classList.remove('hidden');
    instaView.classList.add('hidden');
    statusBadge.textContent = 'Inativo';
    statusBadge.style.color = '#9e9eb0';
    statusBadge.style.borderColor = '#333345';
    return;
  }

  outsideView.classList.add('hidden');
  instaView.classList.remove('hidden');
  statusBadge.textContent = 'Ativo no Instagram';

  // Consulta o vídeo mais recente capturado pelo background
  chrome.runtime.sendMessage({ action: 'GET_LATEST_VIDEO', tabId: currentTab.id }, (res) => {
    if (res && res.url) {
      activeMediaUrl = res.url;
      focusedVideoPreview.src = res.url;
      focusedMediaCard.classList.remove('hidden');
    } else {
      focusedMediaCard.classList.add('hidden');
    }
  });

  if (downloadFocusedBtn) {
    downloadFocusedBtn.addEventListener('click', () => {
      if (!activeMediaUrl) return;

      downloadFocusedBtn.disabled = true;
      downloadFocusedBtn.textContent = 'Iniciando Download...';

      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_MEDIA',
        url: activeMediaUrl,
        filename: `insta_video_${Date.now()}.mp4`
      }, (res) => {
        if (res && res.success) {
          downloadFocusedBtn.textContent = '✓ Vídeo Salvo!';
          downloadFocusedBtn.style.background = '#16a34a';
          setTimeout(() => {
            downloadFocusedBtn.disabled = false;
            downloadFocusedBtn.textContent = 'Baixar Este Vídeo (MP4)';
            downloadFocusedBtn.style.background = '';
          }, 3000);
        } else {
          downloadFocusedBtn.disabled = false;
          downloadFocusedBtn.textContent = 'Erro ao baixar';
        }
      });
    });
  }

  if (goLinkBtn) {
    goLinkBtn.addEventListener('click', () => {
      const val = directLinkInput.value.trim();
      if (!val || !val.includes('instagram.com')) {
        alert('Por favor, cole um link válido do Instagram.');
        return;
      }
      chrome.tabs.create({ url: val });
      window.close();
    });
  }
});
