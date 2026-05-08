const statusEl = document.getElementById('status');

document.getElementById('pingBtn').addEventListener('click', () => {
  statusEl.textContent = '확인 중';
  chrome.runtime.sendMessage({ type: 'PING_LOCAL' }, response => {
    if (!response?.ok) {
      statusEl.textContent = response?.error || '로컬 서버 연결 실패';
      return;
    }
    const ready = response.json?.status;
    statusEl.textContent = [
      `커머스API: ${ready?.commerce?.ready ? '준비됨' : '대기'}`,
      `검색광고: ${ready?.searchAd?.ready ? '준비됨' : '대기'}`,
      `데이터랩: ${ready?.datalab?.ready ? '준비됨' : '대기'}`
    ].join('\n');
  });
});

document.getElementById('panelBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL' }, response => {
    statusEl.textContent = response?.ok ? '패널을 열었습니다.' : '패널 열기 실패. 셀러센터 페이지에서 다시 시도하세요.';
  });
});
