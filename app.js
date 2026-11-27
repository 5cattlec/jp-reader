// 日本語ニュース リーダー — 메인(페이징) + 읽기 (정적, 백엔드 없음 / 조회수는 추후 DB)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const PAGE_SIZE = 12;

const LS = {
  favs: JSON.parse(localStorage.getItem('jpr_favs') || '[]'),
  voice: localStorage.getItem('jpr_voice') || 'f',
  ko: localStorage.getItem('jpr_ko') === '1',
  theme: localStorage.getItem('jpr_theme') || '',
  read: new Set(JSON.parse(localStorage.getItem('jpr_read') || '[]')),
};
if (LS.theme === 'dark') document.body.classList.add('dark');   // 다크모드 즉시 적용(깜빡임 방지)
const markRead = (id) => {
  if (LS.read.has(id)) return;
  LS.read.add(id);
  localStorage.setItem('jpr_read', JSON.stringify([...LS.read]));
};
const saveFavs = () => localStorage.setItem('jpr_favs', JSON.stringify(LS.favs));

// ---- 단어장 + SRS 복습 (개인용 · localStorage) ----
LS.words = JSON.parse(localStorage.getItem('jpr_words') || '[]');
// Leitner 간격(ms): box 0~5 → 10분·1·3·7·16·35일
const SRS_INTERVALS = [10 * 60e3, 1 * 864e5, 3 * 864e5, 7 * 864e5, 16 * 864e5, 35 * 864e5];
const ensureSrs = (x) => {
  if (x.box == null) x.box = 0;
  if (x.due == null) x.due = x.ts || Date.now();
  if (x.reps == null) x.reps = 0;
  return x;
};
LS.words.forEach(ensureSrs);   // 기존 단어 마이그레이션
const saveWords = () => localStorage.setItem('jpr_words', JSON.stringify(LS.words));
const isWordSaved = (w) => LS.words.some((x) => x.w === w);
function toggleWord(w, r, mean) {
  const i = LS.words.findIndex((x) => x.w === w);
  if (i >= 0) LS.words.splice(i, 1);
  else LS.words.unshift(ensureSrs({ w, r: r || '', mean: mean || '', mlang: mean ? 'ko' : '', ts: Date.now() }));
  saveWords();
}
const dueWords = () => { const now = Date.now(); return LS.words.filter((x) => ensureSrs(x).due <= now); };
function rateWord(w, grade) {           // grade: 0 몰라요 · 1 애매 · 2 알아요
  const x = LS.words.find((y) => y.w === w);
  if (!x) return;
  ensureSrs(x);
  if (grade === 2) x.box = Math.min(5, x.box + 1);
  else if (grade === 0) x.box = 0;
  x.reps++;
  x.due = Date.now() + SRS_INTERVALS[x.box];
  saveWords();
}
const isFav = (id) => LS.favs.includes(id);
function toggleFav(id) {
  const i = LS.favs.indexOf(id);
  if (i >= 0) LS.favs.splice(i, 1); else LS.favs.push(id);
  saveFavs();
}

const state = { articles: [], voices: [], current: null, favOnly: false, q: '', page: 1, source: '', sort: 'new' };
const isMobile = () => window.matchMedia('(max-width:820px)').matches;

// 공유 Supabase 클라이언트 (설정 없으면 null → DB 기능 조용히 비활성)
let SB = null;
function initSB() {
  if (SB) return SB;
  const c = window.JPR_CONFIG || {};
  if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY || !window.supabase) return null;
  SB = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
  return SB;
}

async function load() {
  try {
    const res = await fetch('data/articles.json?_=' + Date.now());
    const data = await res.json();
    state.articles = data.articles || [];
    // 본문 검색용 텍스트 미리 계산 (제목+출처+한글번역+본문)
    state.articles.forEach((a) => {
      a._s = (a.title + ' ' + a.source + ' ' + (a.title_ko || '') + ' '
        + (a.body_ko || []).join(' ') + ' '
        + String(a.body_html || '').replace(/<[^>]+>/g, '')).toLowerCase();
    });
    state.voices = data.voices || [{ key: 'f', label: '女性' }];
    if (data.updated) $('#updated').textContent = '업데이트: ' + new Date(data.updated).toLocaleString('ko-KR');
    if (!state.voices.some((v) => v.key === LS.voice)) LS.voice = state.voices[0].key;
    if (LS.ko) { document.body.classList.add('show-ko'); $('#toggleKo').setAttribute('aria-pressed', 'true'); }
    buildVoiceSeg();
    buildSourceFilter();
    Views.init(state.articles.map((a) => a.id));   // DB 연결 시 조회수 채움
    route();
  } catch (e) {
    $('#cards').innerHTML = '<div class="empty">기사가 없습니다. tools/update.py 를 실행하세요.</div>';
  }
}

// ---- 라우팅: '' → 기사, '#feedback' → 피드백, '#a/<id>' → 읽기 ----
function hideViews() { $$('.view').forEach((v) => { v.hidden = true; }); }
function setActiveNav(view) {
  $$('.navitem[data-view]').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
}
function closeNav() { document.body.classList.remove('nav-open'); }
function route() {
  const h = location.hash;
  const m = h.match(/^#a\/(.+)$/);
  if (m) openArticle(decodeURIComponent(m[1]));
  else if (h === '#feedback') showFeedback();
  else if (h === '#words') showWords();
  else if (h === '#review') showReview();
  else showHome();
  if (isMobile()) closeNav();
}
window.addEventListener('hashchange', route);
function showFeedback() {
  hideViews(); $('#feedback').hidden = false; state.current = null;
  setActiveNav('feedback'); Feedback.load(); window.scrollTo(0, 0);
}
// ---- 단어장 화면 ----
function showWords() {
  hideViews(); $('#words').hidden = false; state.current = null;
  setActiveNav('words'); renderWords(); window.scrollTo(0, 0);
}
// ---- 개인 학습 통계 ----
function statsHTML() {
  const read = LS.read.size;
  const total = state.articles.length;
  const saved = LS.words.length;
  const learned = LS.words.filter((x) => (x.box || 0) >= 4).length;   // Lv.4+ = 익힘
  const due = dueWords().length;
  const cell = (n, label) => `<div class="stat"><span class="stat-n">${n}</span><span class="stat-l">${label}</span></div>`;
  return '<div class="stats">'
    + cell(`${read}<small>/${total}</small>`, '읽은 기사')
    + cell(saved, '저장 단어')
    + cell(learned, '익힘(Lv.4+)')
    + cell(due, '복습 대기')
    + '</div>';
}
function renderWords() {
  const box = $('#words');
  if (!LS.words.length) {
    box.innerHTML = '<h2 class="fb-title">🗂 단어장</h2>'
      + '<p class="fb-desc">기사에서 단어를 클릭하고 <b>☆</b>를 누르면 여기에 모입니다.</p>';
    return;
  }
  const due = dueWords().length;
  box.innerHTML = '<h2 class="fb-title">🗂 단어장 <span class="wcount">' + LS.words.length + '</span></h2>'
    + '<p class="fb-desc">클릭한 단어 모음 (이 브라우저에 저장). 뜻은 저장 시점 기준입니다.</p>'
    + statsHTML()
    + '<div class="revbar">'
    + (due ? `<button class="btn primary" id="startReview">🔁 복습 시작 <b>${due}</b></button>` : '<span class="fb-desc">지금 복습할 단어 없음 · 모두 대기 중 👍</span>')
    + '</div>'
    + '<div class="wlist">' + LS.words.map((x) => `
      <div class="witem" data-w="${escapeAttr(x.w)}">
        <div class="wtop"><span class="ww">${escapeHtml(x.w)}</span>
          <span class="wr">${escapeHtml(x.r || '')}</span>
          <span class="wlv" title="복습 단계">Lv.${x.box}</span>
          <button class="wdel" data-w="${escapeAttr(x.w)}" title="삭제">✕</button></div>
        <div class="wmean">${(x.mean && x.mlang === 'ko') ? escapeHtml(x.mean) : '<span class="wmean-load">뜻 불러오는 중…</span>'}</div>
        <div class="wacts">
          <a href="https://ja.dict.naver.com/#/search?query=${encodeURIComponent(x.w)}" target="_blank" rel="noopener">네이버</a>
          <a href="https://www.weblio.jp/content/${encodeURIComponent(x.w)}" target="_blank" rel="noopener">Weblio</a>
        </div>
      </div>`).join('') + '</div>';
  fillWordMeanings();          // 뜻 없는 단어는 실시간으로 채움
}
// 단어장에서 뜻 없는 단어를 Jotoba로 불러와 표시 + 저장
async function fillWordMeanings() {
  const items = $$('#words .witem');
  for (const it of items) {
    const load = it.querySelector('.wmean-load');
    if (!load) continue;                          // 이미 뜻 있음
    const w = it.dataset.w;
    const m = await lookupMeaning(w);
    if ($('#words').hidden) return;               // 화면 벗어나면 중단
    const meanEl = it.querySelector('.wmean');
    if (meanEl) meanEl.textContent = (m == null) ? '(불러오기 실패 · 사전 확인)' : (m || '(뜻 없음 · 사전 확인)');
    if (m) { const wx = LS.words.find((y) => y.w === w); if (wx) { wx.mean = m; wx.mlang = 'ko'; saveWords(); } }
  }
}
$('#words').addEventListener('click', (e) => {
  if (e.target.closest('#startReview')) { goHash('#review'); return; }
  const del = e.target.closest('.wdel');
  if (del) { toggleWord(del.dataset.w); renderWords(); }
});

// ---- 복습 (SRS 플래시카드) ----
function showReview() {
  hideViews(); $('#review').hidden = false; state.current = null;
  setActiveNav('words');
  state.reviewQueue = dueWords().slice();
  state.reviewIdx = 0;
  renderReviewCard(); window.scrollTo(0, 0);
}
function renderReviewCard() {
  const box = $('#review');
  const q = state.reviewQueue || [], i = state.reviewIdx || 0;
  if (!q.length) {
    box.innerHTML = '<div class="rev-done"><div class="rev-emoji">🎉</div><h2>복습할 단어가 없어요</h2>'
      + '<p class="fb-desc">기사에서 단어를 더 저장하거나 나중에 다시 오세요.</p>'
      + '<button class="btn" id="revBack">← 단어장</button></div>';
    return;
  }
  if (i >= q.length) {
    box.innerHTML = '<div class="rev-done"><div class="rev-emoji">🎉</div><h2>복습 완료!</h2>'
      + `<p class="fb-desc">${q.length}개 단어를 복습했어요. 다음 복습 시점에 다시 나옵니다.</p>`
      + '<button class="btn primary" id="revBack">← 단어장</button></div>';
    return;
  }
  const x = q[i];
  box.innerHTML = `
    <div class="rev-top"><button class="btn" id="revBack">← 단어장</button><span class="rev-prog">${i + 1} / ${q.length}</span></div>
    <div class="rev-card">
      <div class="rev-word">${escapeHtml(x.w)}</div>
      <div class="rev-answer" hidden>
        <div class="rev-read">${escapeHtml(x.r || '')}</div>
        <div class="rev-mean">${x.mean ? escapeHtml(x.mean) : '(뜻 미저장 — 아래 사전 확인)'}</div>
        <div class="rev-dic"><a href="https://ja.dict.naver.com/#/search?query=${encodeURIComponent(x.w)}" target="_blank" rel="noopener">네이버</a>
          <a href="https://www.weblio.jp/content/${encodeURIComponent(x.w)}" target="_blank" rel="noopener">Weblio</a></div>
      </div>
      <button class="btn rev-show" id="revShow">뜻 보기</button>
      <div class="rev-rate" hidden>
        <button class="btn" data-g="0">😵 몰라요</button>
        <button class="btn" data-g="1">🤔 애매</button>
        <button class="btn" data-g="2">😀 알아요</button>
      </div>
    </div>`;
}
$('#review').addEventListener('click', (e) => {
  if (e.target.closest('#revBack')) { goHash('#words'); return; }
  if (e.target.closest('#revShow')) {
    $('#review .rev-answer').hidden = false;
    $('#review .rev-show').hidden = true;
    $('#review .rev-rate').hidden = false;
    return;
  }
  const g = e.target.closest('[data-g]');
  if (g) {
    const x = state.reviewQueue[state.reviewIdx];
    if (x) rateWord(x.w, +g.dataset.g);
    state.reviewIdx++;
    renderReviewCard();
  }
});

// ---- 공통 ----
function articleDate(a) {
  if (a.date && a.date !== '0000-00-00') return a.date;
  const d = new Date(a.published);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
function filtered() {
  return state.articles.filter((a) => {
    if (state.favOnly && !isFav(a.id)) return false;
    if (state.source && a.source !== state.source) return false;
    if (state.q && !(a._s || '').includes(state.q)) return false;   // 본문까지 검색
    return true;
  });
}
// ---- 소스(출처) 필터 칩 ----
function buildSourceFilter() {
  const el = $('#srcFilter');
  if (!el) return;
  const srcs = [...new Set(state.articles.map((a) => a.source))];
  el.innerHTML = ['', ...srcs].map((s) =>
    `<button class="src-chip${state.source === s ? ' on' : ''}" data-src="${escapeAttr(s)}">${s ? escapeHtml(s) : '전체'}</button>`
  ).join('');
}

// ================= 메인 페이지 =================
function showHome() {
  hideViews();
  $('#home').hidden = false;
  state.current = null;
  setActiveNav('articles');
  renderHome();
}
function sortItems(items) {
  if (state.sort === 'views') {
    items.sort((a, b) => (Views.counts[b.id] || 0) - (Views.counts[a.id] || 0));
  } else if (state.sort === 'source') {
    items.sort((a, b) => (a.source || '').localeCompare(b.source || '')
      || (articleDate(b) > articleDate(a) ? 1 : -1));
  } // 'new' = 기본 배열 순서(최신순) 유지
  return items;
}
function renderHome() {
  const items = sortItems(filtered());            // 기본 배열 순서 = 최신순(update.py 보장)
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;
  const slice = items.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  $('#cards').innerHTML = slice.length
    ? '<div class="bhead"><span>출처</span><span>제목</span><span>조회</span><span>날짜</span></div>'
      + slice.map(rowHTML).join('')
    : '<div class="empty">해당 기사가 없습니다.</div>';
  renderPager(pages, items.length);
  Views.paint();
  window.scrollTo(0, 0);
}
function rowHTML(a) {
  const d = articleDate(a);
  const short = d ? d.slice(5) : '';
  const ko = a.title_ko ? `<span class="b-ko ko">${escapeHtml(a.title_ko)}</span>` : '';
  return `<div class="brow${LS.read.has(a.id) ? ' read' : ''}" data-id="${escapeAttr(a.id)}">
      <span class="b-src">${escapeHtml(a.source)}</span>
      <span class="b-title">${isFav(a.id) ? '<span class="b-star">★</span>' : ''}<span class="b-t">${escapeHtml(a.title)}</span>${ko}</span>
      <span class="b-views c-views" data-id="${escapeAttr(a.id)}"></span>
      <span class="b-date" title="${escapeHtml(d)}">${escapeHtml(short)}</span>
    </div>`;
}
function setSiteCount() {
  const el = $('#sitecount');
  if (!el) return;
  el.textContent = `전체 ${state.lastTotal || 0}건`
    + (Views.siteTotal != null ? ` · 방문 ${Views.siteTotal.toLocaleString()}` : '');
}
function renderPager(pages, total) {
  state.lastTotal = total;
  setSiteCount();
  const p = state.page;
  if (pages <= 1) { $('#pager').innerHTML = ''; return; }
  const win = [];
  const from = Math.max(1, p - 2), to = Math.min(pages, p + 2);
  if (from > 1) win.push(1, from > 2 ? '…' : null);
  for (let i = from; i <= to; i++) win.push(i);
  if (to < pages) win.push(to < pages - 1 ? '…' : null, pages);
  const nums = win.filter((x) => x !== null).map((x) =>
    x === '…' ? '<span class="pg-dots">…</span>'
      : `<button class="pg num${x === p ? ' on' : ''}" data-p="${x}">${x}</button>`
  ).join('');
  $('#pager').innerHTML =
    `<button class="pg" data-p="${p - 1}" ${p <= 1 ? 'disabled' : ''}>← 이전</button>` +
    nums +
    `<button class="pg" data-p="${p + 1}" ${p >= pages ? 'disabled' : ''}>다음 →</button>`;
}
$('#cards').addEventListener('click', (e) => {
  const c = e.target.closest('.brow');
  if (c) location.hash = '#a/' + encodeURIComponent(c.dataset.id);
});
$('#pager').addEventListener('click', (e) => {
  const b = e.target.closest('.pg');
  if (b && !b.disabled) { state.page = parseInt(b.dataset.p, 10); renderHome(); }
});
// 읽기 화면: 이전/다음 기사 · 목록 (위임 — 재렌더돼도 유지)
$('#reader').addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { location.hash = '#a/' + encodeURIComponent(g.dataset.go); return; }
  if (e.target.closest('[data-golist]')) location.hash = '';
});

// ================= 읽기 =================
// 현재 목록(필터·정렬) 순서 기준 이전/다음 기사
function orderedList() {
  const items = sortItems(filtered());
  return items.some((a) => a.id === state.current) ? items : state.articles;
}
function neighbors(id) {
  const list = orderedList();
  const i = list.findIndex((a) => a.id === id);
  return {
    prev: i > 0 ? list[i - 1] : null,           // 위(더 최신)
    next: (i >= 0 && i < list.length - 1) ? list[i + 1] : null,  // 아래(더 이전)
  };
}
function anavBtn(art, dir) {
  const label = dir === 'prev' ? '← 이전 기사' : '다음 기사 →';
  if (!art) return `<span class="anav-btn disabled"><span class="anav-dir">${label}</span></span>`;
  const t = art.title || '';
  const short = t.length > 30 ? t.slice(0, 30) + '…' : t;
  return `<button class="anav-btn ${dir}" data-go="${escapeAttr(art.id)}" title="${escapeAttr(t)}">`
    + `<span class="anav-dir">${label}</span>`
    + `<span class="anav-t">${escapeHtml(short)}</span></button>`;
}
function anavHTML(id) {
  const { prev, next } = neighbors(id);
  return `<nav class="anav">${anavBtn(prev, 'prev')}`
    + `<button class="anav-list" data-golist="1">목록</button>`
    + `${anavBtn(next, 'next')}</nav>`;
}

function openArticle(id) {
  const a = state.articles.find((x) => x.id === id);
  if (!a) { location.hash = ''; return; }
  state.current = id;
  markRead(id);            // 읽음 표시
  hideViews();
  $('#reader').hidden = false;
  setActiveNav('articles');

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

  const { prev, next } = neighbors(id);
  const topNav = `<div class="rtop-nav">`
    + (prev ? `<button class="rnav" data-go="${escapeAttr(prev.id)}" title="${escapeAttr(prev.title)}">← 이전</button>` : `<span class="rnav disabled">← 이전</span>`)
    + (next ? `<button class="rnav" data-go="${escapeAttr(next.id)}" title="${escapeAttr(next.title)}">다음 →</button>` : `<span class="rnav disabled">다음 →</span>`)
    + `</div>`;

  $('#reader').innerHTML =
    `<div class="rtop"><button class="back" id="backBtn">← 목록</button>
       ${topNav}
       <span class="c-views big" data-id="${escapeAttr(id)}"></span></div>` +
    `<div class="src">${escapeHtml(a.source)}</div>` +
    `<div class="rhead"><h2>${a.title_html || escapeHtml(a.title)}</h2>` +
    `<span class="bigstar ${isFav(id) ? 'on' : ''}" title="즐겨찾기">★</span></div>` +
    (a.title_ko ? `<div class="title-ko ko">${escapeHtml(a.title_ko)}</div>` : '') +
    `<div class="meta">${escapeHtml(a.published || '')}` +
    (a.chars ? ` · ${a.chars}字` : '') +
    (a.url ? ` · <a href="${escapeAttr(a.url)}" target="_blank" rel="noopener">原文リンク</a>` : '') +
    `</div>` + player +
    `<div class="body">${renderBody(a)}</div>` +
    anavHTML(id);

  $('#backBtn').addEventListener('click', () => { location.hash = ''; });
  const rs = $('.rateSel');
  if (rs) rs.addEventListener('change', () => { $('#reader audio').playbackRate = parseFloat(rs.value); });
  $('.bigstar').addEventListener('click', () => { toggleFav(id); syncBigStar(id); });

  curTimes = (a.sent_times && a.sent_times[LS.voice]) || null;
  playStopAt = null;
  const audio = $('#reader audio');
  if (audio) {
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('pause', () => { playStopAt = null; });
  }
  window.scrollTo(0, 0);
  paintSavedWords();  // 저장한 단어 본문 하이라이트
  Views.log(id);      // 조회수 +1 (DB 연결 시)
  Views.paint();
}
function syncBigStar(id) {
  const b = $('.bigstar');
  if (b && state.current === id) b.classList.toggle('on', isFav(id));
}
function renderBody(a) {
  const jp = (a.body_html || '').match(/<p>[\s\S]*?<\/p>/g) || [];
  const ko = a.body_ko || [];
  if (!jp.length) return '<p>(本文なし)</p>';
  return jp.map((p, i) => p + (ko[i] ? `<p class="ko">${escapeHtml(ko[i])}</p>` : '')).join('');
}

// ---- 저장 단어 본문 하이라이트 (LingQ 스타일) ----
function wordLemma(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('rt').forEach((rt) => rt.remove());
  const surface = clone.textContent.trim();
  return ((el.dataset.l || surface).split('-')[0] || surface);
}
function paintSavedWords() {
  const saved = new Set(LS.words.map((x) => x.w));
  $$('#reader .w').forEach((el) => {
    el.classList.toggle('w-saved', saved.has(wordLemma(el)));
  });
}

// ---- 문장별 재생 + 하이라이트 ----
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
  playStopAt = (i + 1 < curTimes.length) ? curTimes[i + 1] : null;
  audio.play();
  highlightSentence(i);
}

// ---- 단어 팝업(사전) ----
const popup = $('#popup');
function showPopup(el) {
  $$('.w.sel').forEach((w) => w.classList.remove('sel'));
  el.classList.add('sel');
  const clone = el.cloneNode(true);
  clone.querySelectorAll('rt').forEach((rt) => rt.remove());
  const surface = clone.textContent.trim();
  let lemma = el.dataset.l || surface;
  lemma = lemma.split('-')[0] || surface;
  const read = el.dataset.r || '';
  popup.querySelector('.pop-word').textContent = lemma;
  popup.querySelector('.pop-read').textContent = read;
  popup.querySelector('.pop-naver').href = 'https://ja.dict.naver.com/#/search?query=' + encodeURIComponent(lemma);
  popup.querySelector('.pop-weblio').href = 'https://www.weblio.jp/content/' + encodeURIComponent(lemma);
  // 단어장 저장 버튼 상태 + 인라인 뜻
  popup._word = { w: lemma, r: read };
  const sb = popup.querySelector('.pop-save');
  const saved = isWordSaved(lemma);
  sb.textContent = saved ? '★' : '☆'; sb.classList.toggle('on', saved);
  fetchMeaning(lemma, popup.querySelector('.pop-mean'));
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

// 한국어 뜻: Google(gtx) JP→KO 번역 + Jotoba로 JLPT 태그 (둘 다 CORS 지원)
async function gtxKorean(word) {
  try {
    const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=ko&dt=t&q=' + encodeURIComponent(word));
    const j = await r.json();
    return (j[0] || []).map((seg) => seg[0]).join('').trim();
  } catch (e) { return null; }
}
async function jotobaJlpt(word) {
  try {
    const r = await fetch('https://jotoba.de/api/search/words', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: word, language: 'English', no_english: false }),
    });
    const j = await r.json();
    const w = (j.words || [])[0];
    return w && w.jlpt_lvl ? 'N' + w.jlpt_lvl : '';
  } catch (e) { return ''; }
}
async function lookupMeaning(word) {                     // 한국어 뜻(+JLPT) 반환, 실패 시 null
  const [ko, jlpt] = await Promise.all([gtxKorean(word), jotobaJlpt(word)]);
  if (ko == null) return null;
  return ko + (jlpt ? '  [' + jlpt + ']' : '');
}
let _meanReq = 0;
async function fetchMeaning(word, into) {               // 팝업용
  if (!into) return;
  const my = ++_meanReq;
  into.textContent = '뜻 불러오는 중…';
  const m = await lookupMeaning(word);
  if (my !== _meanReq) return;                          // 최신 클릭만 반영
  into.textContent = (m == null) ? '' : m;
  if (m) {                                              // 저장된 단어면 한국어 뜻 백필
    const wx = LS.words.find((y) => y.w === word);
    if (wx && (!wx.mean || wx.mlang !== 'ko')) { wx.mean = m; wx.mlang = 'ko'; saveWords(); }
  }
}
// 단어장 저장 버튼
popup.querySelector('.pop-save').addEventListener('click', (e) => {
  e.stopPropagation();
  const wd = popup._word; if (!wd) return;
  let mean = (popup.querySelector('.pop-mean').textContent || '').trim();
  if (mean === '뜻 불러오는 중…') mean = '';           // 아직 로딩 중이면 뜻 없이 저장(단어장서 채워짐)
  toggleWord(wd.w, wd.r, mean);
  const on = isWordSaved(wd.w);
  const b = popup.querySelector('.pop-save');
  b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on);
  if (state.current) paintSavedWords();                 // 본문 하이라이트 즉시 갱신
});
document.addEventListener('click', (e) => {
  const sp = e.target.closest('.sp');
  if (sp) { e.stopPropagation(); playSentence(+sp.dataset.i); return; }
  const w = e.target.closest('.w');
  if (w) { e.stopPropagation(); showPopup(w); return; }
  if (!e.target.closest('#popup')) hidePopup();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePopup(); });

// ---- 조회수 (Supabase 연결 시 동작, 없으면 조용히 no-op) ----
const Views = {
  ready: false, sb: null, counts: {}, siteTotal: null, hidden: new Set(),
  async init(ids) {
    const sb = initSB();
    if (!sb) return;
    try {
      this.sb = sb;
      this.ready = true;
      // 숨김 목록 → 기사에서 제거
      const { data: h } = await this.sb.from('hidden').select('article_id');
      (h || []).forEach((r) => this.hidden.add(r.article_id));
      if (this.hidden.size) state.articles = state.articles.filter((a) => !this.hidden.has(a.id));
      await this.loadCounts(state.articles.map((a) => a.id));
      this.logSite();
      route();               // 카운트/숨김 반영해 다시 렌더
    } catch (e) { /* 연결 실패 시 정적 사이트로 계속 */ }
  },
  async loadCounts(ids) {
    if (!this.ready || !ids.length) return;
    try {
      const { data } = await this.sb.rpc('view_counts', { ids });
      this.counts = {};
      (data || []).forEach((r) => { this.counts[r.article_id] = Number(r.cnt); });
      const { data: s } = await this.sb.rpc('site_total');
      this.siteTotal = (s == null) ? null : Number(s);
    } catch (e) { /* ignore */ }
  },
  async _insert(id) {
    try { await this.sb.from('views').insert({ article_id: id }); } catch (e) { /* ignore */ }
  },
  logSite() {
    if (!this.ready) return;
    const day = new Date().toISOString().slice(0, 10);
    const k = 'jpr_site_' + day;
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, '1');
    this._insert('_site');
    if (this.siteTotal != null) this.siteTotal++;
    this.paintSite();
  },
  log(id) {
    if (!this.ready) return;
    const day = new Date().toISOString().slice(0, 10);
    const k = 'jpr_v_' + id + '_' + day;
    if (!localStorage.getItem(k)) {
      localStorage.setItem(k, '1');
      this._insert(id);
      this.counts[id] = (this.counts[id] || 0) + 1;
    }
    this.paint();
  },
  paint() {
    $$('.c-views').forEach((el) => {
      const n = this.counts[el.dataset.id];
      el.textContent = (n != null) ? n.toLocaleString() : '';
    });
    this.paintSite();
  },
  paintSite() { setSiteCount(); },
};

// ---- 피드백 ----
const Feedback = {
  async load() {
    const box = $('#fbList');
    const sb = initSB();
    if (!sb) { box.innerHTML = '<p class="fb-empty">DB 연결 후 표시됩니다.</p>'; return; }
    const { data, error } = await sb.from('feedback')
      .select('*').order('created_at', { ascending: false }).limit(100);
    if (error) { box.innerHTML = '<p class="fb-empty">불러오기 실패</p>'; return; }
    box.innerHTML = (data || []).map((f) =>
      `<div class="fb-item">
         <div class="fb-ihead"><b>${escapeHtml(f.nickname || '익명')}</b>
           <span>${new Date(f.created_at).toLocaleString('ko-KR')}</span></div>
         <div class="fb-ibody">${escapeHtml(f.message)}</div>
       </div>`).join('') || '<p class="fb-empty">첫 피드백을 남겨보세요!</p>';
  },
  async send() {
    const note = $('#fbNote'), sb = initSB();
    if (!sb) { note.textContent = '아직 DB가 연결되지 않았습니다.'; return; }
    const msg = $('#fbMsg').value.trim(), nick = $('#fbNick').value.trim();
    if (!msg) { note.textContent = '내용을 입력하세요.'; return; }
    $('#fbSend').disabled = true;
    const { error } = await sb.from('feedback').insert({ nickname: nick || null, message: msg });
    $('#fbSend').disabled = false;
    if (error) { note.textContent = '실패: ' + error.message; return; }
    $('#fbMsg').value = ''; note.textContent = '감사합니다! 등록됐어요.';
    this.load();
  },
};

// ---- 상단 컨트롤 ----
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
      if (state.current) openArticle(state.current);
    });
    seg.appendChild(b);
  });
}
$('#brand').addEventListener('click', (e) => { e.preventDefault(); goHash(''); });
// 사이드바 네비
$$('.navitem[data-view]').forEach((n) => n.addEventListener('click', (e) => {
  e.preventDefault();
  goHash(n.dataset.view === 'feedback' ? '#feedback' : n.dataset.view === 'words' ? '#words' : '');
  if (isMobile()) closeNav();
}));
function goHash(h) {
  if (location.hash === h || (h === '' && location.hash === '')) route();  // 같은 해시면 직접 호출
  else location.hash = h;
}
$('#navToggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#scrim').addEventListener('click', closeNav);
$('#fbSend').addEventListener('click', () => Feedback.send());
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
  state.page = 1; renderHome();
});
$('#search').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); state.page = 1; renderHome(); });
$('#sortSel')?.addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; renderHome(); });

// 소스(출처) 필터 클릭
$('#srcFilter').addEventListener('click', (e) => {
  const b = e.target.closest('.src-chip');
  if (!b) return;
  state.source = b.dataset.src || '';
  state.page = 1;
  buildSourceFilter();
  renderHome();
});

// 다크모드 토글
(function () {
  const btn = $('#toggleTheme');
  if (!btn) return;
  const paint = () => {
    const on = document.body.classList.contains('dark');
    btn.textContent = on ? '☀️' : '🌙';
    btn.setAttribute('aria-pressed', String(on));
  };
  paint();
  btn.addEventListener('click', () => {
    const on = document.body.classList.toggle('dark');
    LS.theme = on ? 'dark' : '';
    localStorage.setItem('jpr_theme', LS.theme);
    paint();
  });
})();

// ---- utils ----
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return String(s).replace(/["&<>]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

load();
