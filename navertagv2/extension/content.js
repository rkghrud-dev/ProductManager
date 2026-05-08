(() => {
  const ATTR = 'data-navertagv2';

  function injectPanel() {
    if (document.querySelector(`[${ATTR}]`)) return;

    const panel = document.createElement('div');
    panel.setAttribute(ATTR, 'panel');
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'width:320px',
      'background:#fbfcf7',
      'border:1px solid #dce2c8',
      'border-radius:8px',
      'box-shadow:0 12px 32px rgba(18,27,31,.16)',
      'font:13px/1.45 "Malgun Gothic",Arial,sans-serif',
      'color:#121b1f',
      'padding:12px'
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <strong>NaverTag V2</strong>
        <button type="button" data-close style="border:1px solid #dce2c8;background:#fff;border-radius:6px;height:28px;padding:0 8px;cursor:pointer;">닫기</button>
      </div>
      <div style="color:#5c686b;margin-bottom:10px;">F12 Network 분석 후 아래 셀렉터/요청 로직을 content.js에 연결하세요.</div>
      <button type="button" data-scan style="width:100%;height:34px;border:0;border-radius:6px;background:#f96900;color:white;cursor:pointer;">현재 페이지 태그 영역 탐색</button>
      <pre data-log style="max-height:160px;overflow:auto;background:#fff;border:1px solid #dce2c8;border-radius:6px;padding:8px;margin:10px 0 0;white-space:pre-wrap;"></pre>
    `;

    panel.querySelector('[data-close]').addEventListener('click', () => panel.remove());
    panel.querySelector('[data-scan]').addEventListener('click', () => {
      const log = panel.querySelector('[data-log]');
      const inputs = [...document.querySelectorAll('input, textarea')]
        .filter(el => /태그|검색|tag|keyword/i.test([
          el.placeholder,
          el.name,
          el.id,
          el.getAttribute('aria-label'),
          el.closest('label')?.textContent
        ].join(' ')))
        .slice(0, 20)
        .map((el, index) => `${index + 1}. ${el.tagName.toLowerCase()} name=${el.name || '-'} id=${el.id || '-'} placeholder=${el.placeholder || '-'}`);

      const buttons = [...document.querySelectorAll('button, a')]
        .filter(el => /검색에 적용|태그 확인|확인|적용/i.test(el.textContent || ''))
        .slice(0, 20)
        .map((el, index) => `${index + 1}. ${el.tagName.toLowerCase()} text="${(el.textContent || '').trim().slice(0, 60)}"`);

      log.textContent = [
        '[입력 후보]',
        inputs.join('\n') || '없음',
        '',
        '[버튼 후보]',
        buttons.join('\n') || '없음'
      ].join('\n');
    });

    document.documentElement.appendChild(panel);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'OPEN_PANEL') {
      injectPanel();
      sendResponse({ ok: true });
    }
    return false;
  });

  injectPanel();
})();
