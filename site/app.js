// 日本語ニュース リーダー — 메인(페이징) + 읽기 (정적, 백엔드 없음 / 조회수는 추후 DB)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const PAGE_SIZE = 12;

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

const state = { articles: [], voices: [], current: null, favOnly: false, q: '', page: 1 };
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
    state.voices = data.voices || [{ key: 'f', label: '女性' }];
    if (data.updated) $('#updated').textContent = '업데이트: ' + new Date(data.updated).toLocaleString('ko-KR');
    if (!state.voices.some((v) => v.key === LS.voice)) LS.voice = state.voices[0].key;
    if (LS.ko) { document.body.classList.add('show-ko'); $('#toggleKo').setAttribute('aria-pressed', 'true'); }
    buildVoiceSeg();
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
  else showHome();
  if (isMobile()) closeNav();
}
window.addEventListener('hashchange', route);
function showFeedback() {
  hideViews(); $('#feedback').hidden = false; state.current = null;
  setActiveNav('feedback'); Feedback.load(); window.scrollTo(0, 0);
}

// ---- 공통 ----
function articleDate(a) {
  if (a.date && a.date !== '0000-00-00') return a.date;
  const d = new Date(a.published);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
function filtered() {
  return state.articles.filter((a) => {
    if (state.favOnly && !isFav(a.id)) return false;
    if (state.q && !((a.title + a.source + (a.title_ko || '')).toLowerCase().includes(state.q))) return false;
    return true;
  });
}

// ================= 메인 페이지 =================
function showHome() {
  hideViews();
  $('#home').hidden = false;
  state.current = null;
  setActiveNav('articles');
  renderHome();
}
function renderHome() {
  const items = filtered();                       // 배열 순서 = 최신순(update.py 보장)
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
  return `<div class="brow" data-id="${escapeAttr(a.id)}">
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

// ================= 읽기 =================
function openArticle(id) {
  const a = state.articles.find((x) => x.id === id);
  if (!a) { location.hash = ''; return; }
  state.current = id;
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

  $('#reader').innerHTML =
    `<div class="rtop"><button class="back" id="backBtn">← 목록</button>
       <span class="c-views big" data-id="${escapeAttr(id)}"></span></div>` +
    `<div class="src">${escapeHtml(a.source)}</div>` +
    `<div class="rhead"><h2>${a.title_html || escapeHtml(a.title)}</h2>` +
    `<span class="bigstar ${isFav(id) ? 'on' : ''}" title="즐겨찾기">★</span></div>` +
    (a.title_ko ? `<div class="title-ko ko">${escapeHtml(a.title_ko)}</div>` : '') +
    `<div class="meta">${escapeHtml(a.published || '')}` +
    (a.chars ? ` · ${a.chars}字` : '') +
    (a.url ? ` · <a href="${escapeAttr(a.url)}" target="_blank" rel="noopener">原文リンク</a>` : '') +
    `</div>` + player +
    `<div class="body">${renderBody(a)}</div>`;

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
  goHash(n.dataset.view === 'feedback' ? '#feedback' : '');
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

// ---- utils ----
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return String(s).replace(/["&<>]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

load();
