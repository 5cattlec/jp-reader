// 日本語ニュース リーダー — 프론트 (정적, 백엔드 없음)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const LS = {
  favs: JSON.parse(localStorage.getItem('jpr_favs') || '[]'),
  voice: localStorage.getItem('jpr_voice') || 'f',
  ko: localStorage.getItem('jpr_ko') === '1',
};
const saveFavs = () => localStorage.setItem('jpr_favs', JSON.stringify(LS.favs));
const isFav = (id) => LS.favs.includes(id);
function toggleFav(id) {
  const i = LS.favs.indexOf(id);
  if (i >= 0) LS.favs.splice(i, 1); else LS.favs.push(id);
  saveFavs();
}

const state = { articles: [], voices: [], current: null, favOnly: false, q: '' };
const isMobile = () => window.matchMedia('(max-width:760px)').matches;

async function load() {
  try {
    const res = await fetch('data/articles.json?_=' + Date.now());
    const data = await res.json();
    state.articles = data.articles || [];
    state.voices = data.voices || [{ key: 'f', label: '女性' }];
    if (data.updated) $('#updated').textContent = '업데이트: ' + new Date(data.updated).toLocaleString('ko-KR');
    if (!state.voices.some((v) => v.key === LS.voice)) LS.voice = state.voices[0].key;
    if (LS.ko) { document.body.classList.add('show-ko'); $('#toggleKo').setAttribute('aria-pressed', 'true'); }
    buildVoiceSeg();
    renderList();
    const first = filtered()[0];
    if (first) select(first.id);
  } catch (e) {
    $('#list').innerHTML = '<div class="card">기사가 없습니다. tools/update.py 를 실행하세요.</div>';
  }
}

// ---- voice segmented control ----
function buildVoiceSeg() {
  const seg = $('#voiceSeg');
  seg.innerHTML = '';
  state.voices.forEach((v) => {
    const b = document.createElement('button');
    b.textContent = v.label || v.key;
    b.className = v.key === LS.voice ? 'on' : '';
    b.addEventListener('click', () => {
      LS.voice = v.key;
      localStorage.setItem('jpr_voice', v.key);
      buildVoiceSeg();
      if (state.current) select(state.current, true);
    });
    seg.appendChild(b);
  });
}

// ---- list (제목만) ----
function filtered() {
  return state.articles.filter((a) => {
    if (state.favOnly && !isFav(a.id)) return false;
    if (state.q && !(a.title + a.source).toLowerCase().includes(state.q)) return false;
    return true;
  });
}
function renderList() {
  const box = $('#list');
  box.innerHTML = '';
  const items = filtered();
  if (!items.length) { box.innerHTML = '<div class="card">해당 없음</div>'; return; }
  items.forEach((a) => {
    const el = document.createElement('div');
    el.className = 'card' + (a.id === state.current ? ' active' : '') + (isFav(a.id) ? ' fav' : '');
    el.dataset.id = a.id;
    el.textContent = a.title;
    el.addEventListener('click', () => { select(a.id); if (isMobile()) setNav(false); });
    box.appendChild(el);
  });
}

// ---- reader ----
function renderBody(a) {
  const jp = (a.body_html || '').match(/<p>[\s\S]*?<\/p>/g) || [];
  const ko = a.body_ko || [];
  if (!jp.length) return '<p>(本文なし)</p>';
  return jp.map((p, i) =>
    p + (ko[i] ? `<p class="ko">${escapeHtml(ko[i])}</p>` : '')
  ).join('');
}

// ---- 문장별 음성 재생 + 하이라이트 ----
let curTimes = null, playStopAt = null;
function onTimeUpdate(e) {
  const audio = e.target, t = audio.currentTime;
  if (playStopAt != null && t >= playStopAt) { audio.pause(); return; }
  if (!curTimes) return;
  let cur = -1;
  for (let i = 0; i < curTimes.length; i++) { if (curTimes[i] <= t + 0.03) cur = i; else break; }
  highlightSentence(cur);
}
function highlightSentence(i) {
  const now = $('.s.playing');
  if (now && +now.dataset.i === i) return;
  $$('.s.playing').forEach((s) => s.classList.remove('playing'));
  if (i >= 0) { const el = document.querySelector(`.s[data-i="${i}"]`); if (el) el.classList.add('playing'); }
}
function playSentence(i) {
  const audio = $('#reader audio');
  if (!audio || !curTimes || curTimes[i] == null) return;
  audio.currentTime = curTimes[i] + 0.02;
  playStopAt = (i + 1 < curTimes.length) ? curTimes[i + 1] : null;   // 이 문장만(다음 문장 시작에서 정지)
  audio.play();
  highlightSentence(i);
}
function select(id, keepScroll) {
  const a = state.articles.find((x) => x.id === id);
  if (!a) return;
  const prevTop = keepScroll ? $('#reader').scrollTop : 0;
  state.current = id;
  $$('.card').forEach((c) => c.classList.toggle('active', c.dataset.id === id));

  const src = a.audio && (a.audio[LS.voice] || Object.values(a.audio)[0]);
  const player = src
    ? `<div class="player">
         <audio controls preload="none" src="${escapeAttr(src)}"></audio>
         <span class="rate">속도</span>
         <select class="rateSel">
           <option value="0.75">0.75x</option><option value="1" selected>1.0x</option>
           <option value="1.25">1.25x</option><option value="1.5">1.5x</option>
         </select>
       </div>` : '';

  $('#reader').innerHTML =
    `<div class="src">${escapeHtml(a.source)}</div>` +
    `<div class="rhead"><h2>${a.title_html || escapeHtml(a.title)}</h2>` +
    `<span class="bigstar ${isFav(id) ? 'on' : ''}" title="즐겨찾기">★</span></div>` +
    (a.title_ko ? `<div class="title-ko ko">${escapeHtml(a.title_ko)}</div>` : '') +
    `<div class="meta">${escapeHtml(a.published || '')}` +
    (a.chars ? ` · ${a.chars}字` : '') +
    (a.url ? ` · <a href="${escapeAttr(a.url)}" target="_blank" rel="noopener">原文リンク</a>` : '') +
    `</div>` + player +
    `<div class="body">${renderBody(a)}</div>`;

  const rs = $('.rateSel');
  if (rs) rs.addEventListener('change', () => { $('#reader audio').playbackRate = parseFloat(rs.value); });
  $('.bigstar').addEventListener('click', () => { toggleFav(id); renderList(); syncBigStar(id); });

  // 문장별 재생 준비
  curTimes = (a.sent_times && a.sent_times[LS.voice]) || null;
  playStopAt = null;
  const audio = $('#reader audio');
  if (audio) {
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('pause', () => { playStopAt = null; });
  }
  $('#reader').scrollTop = prevTop;
}
function syncBigStar(id) {
  const b = $('.bigstar');
  if (b && state.current === id) b.classList.toggle('on', isFav(id));
}

// 문장 끝(。！？)마다 줄바꿈
function breakSentences(html) {
  return html
    .replace(/([。！？]+[」』）】”’"]*)/g, '$1<br>')
    .replace(/<br>(?=<\/p>)/g, '');
}

// ---- word popup (dictionary) ----
const popup = $('#popup');
function showPopup(el) {
  $$('.w.sel').forEach((w) => w.classList.remove('sel'));
  el.classList.add('sel');
  const clone = el.cloneNode(true);              // 후리가나(rt) 제외한 표층형만
  clone.querySelectorAll('rt').forEach((rt) => rt.remove());
  const surface = clone.textContent.trim();
  let lemma = el.dataset.l || surface;
  lemma = lemma.split('-')[0] || surface;
  const read = el.dataset.r || '';
  popup.querySelector('.pop-word').textContent = lemma;
  popup.querySelector('.pop-read').textContent = read;
  popup.querySelector('.pop-naver').href = 'https://ja.dict.naver.com/#/search?query=' + encodeURIComponent(lemma);
  popup.querySelector('.pop-weblio').href = 'https://www.weblio.jp/content/' + encodeURIComponent(lemma);
  popup.hidden = false;
  const r = el.getBoundingClientRect();
  const pw = popup.offsetWidth, ph = popup.offsetHeight;
  let left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - pw - 8);
  let top = r.bottom + window.scrollY + 6;
  if (r.bottom + ph + 12 > window.innerHeight) top = r.top + window.scrollY - ph - 6;
  popup.style.left = Math.max(8, left) + 'px';
  popup.style.top = top + 'px';
}
function hidePopup() { popup.hidden = true; $$('.w.sel').forEach((w) => w.classList.remove('sel')); }
document.addEventListener('click', (e) => {
  const sp = e.target.closest('.sp');
  if (sp) { e.stopPropagation(); playSentence(+sp.dataset.i); return; }
  const w = e.target.closest('.w');
  if (w) { e.stopPropagation(); showPopup(w); return; }
  if (!e.target.closest('#popup')) hidePopup();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePopup(); });

// ---- hamburger / drawer ----
function setNav(open) { document.body.classList.toggle('nav-open', open); }
$('#hamburger').addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
$('#scrim').addEventListener('click', () => setNav(false));
if (isMobile()) setNav(false);   // 모바일은 기본 닫힘

// ---- controls ----
$('#toggleFuri').addEventListener('click', () => {
  const on = document.body.classList.toggle('show-furigana');
  $('#toggleFuri').setAttribute('aria-pressed', String(on));
});
$('#toggleKo').addEventListener('click', () => {
  const on = document.body.classList.toggle('show-ko');
  $('#toggleKo').setAttribute('aria-pressed', String(on));
  localStorage.setItem('jpr_ko', on ? '1' : '0');
});
$('#fontRange').addEventListener('input', (e) =>
  document.documentElement.style.setProperty('--reader-size', e.target.value + 'px'));
$('#favFilter').addEventListener('click', () => {
  state.favOnly = !state.favOnly;
  $('#favFilter').setAttribute('aria-pressed', String(state.favOnly));
  renderList();
});
$('#search').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); renderList(); });

// ---- utils ----
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return String(s).replace(/["&<>]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

load();
