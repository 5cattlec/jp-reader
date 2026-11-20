// jp-reader 관리자 — 로그인 + 조회수 통계 + 기사 숨김/삭제
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const C = window.JPR_CONFIG || {};
let sb = null, articles = [], titleOf = {}, hidden = new Set(), daily = [], q = '', feedbackData = [];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY || !window.supabase) {
  app.innerHTML = '<div class="login"><h2>설정 필요</h2><p class="muted">config.js 에 Supabase URL/anon 키를 먼저 넣어주세요.</p></div>';
} else {
  sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  start();
}

async function start() {
  const { data } = await sb.auth.getSession();
  if (data.session) dashboard(); else loginView();
  sb.auth.onAuthStateChange((_e, s) => { if (s) dashboard(); else loginView(); });
}

// ---- 로그인 ----
function loginView() {
  app.innerHTML = `
    <div class="login">
      <h2>🔒 관리자 로그인</h2>
      <input id="em" type="email" placeholder="이메일" autocomplete="username" />
      <input id="pw" type="password" placeholder="비밀번호" autocomplete="current-password" />
      <button class="btn primary" id="go" style="width:100%">로그인</button>
      <p class="err" id="err"></p>
      <p class="muted">계정은 Supabase → Authentication → Users 에서 추가</p>
    </div>`;
  const go = async () => {
    $('#err').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) $('#err').textContent = error.message;
  };
  $('#go').onclick = go;
  $('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ---- 대시보드 ----
async function dashboard() {
  app.innerHTML = '<main><p class="muted">불러오는 중…</p></main>';
  // 데이터 로드
  try {
    const res = await fetch('data/articles.json?_=' + Date.now());
    articles = (await res.json()).articles || [];
    titleOf = {}; articles.forEach((a) => { titleOf[a.id] = a.title; });
  } catch (e) { articles = []; }
  const since = new Date(Date.now() - 730 * 864e5).toISOString();
  const [d, top, site, hid, fb] = await Promise.all([
    sb.rpc('views_daily', { since }),
    sb.rpc('views_top', { since, lim: 20 }),
    sb.rpc('site_total'),
    sb.from('hidden').select('article_id'),
    sb.from('feedback').select('*').order('created_at', { ascending: false }).limit(200),
  ]);
  daily = (d.data || []).map((r) => ({ day: r.day, cnt: Number(r.cnt) }));
  hidden = new Set((hid.data || []).map((r) => r.article_id));
  feedbackData = fb.data || [];
  render(top.data || [], site.data == null ? 0 : Number(site.data));
}

function sumSince(days) {
  const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return daily.filter((r) => r.day >= cut).reduce((s, r) => s + r.cnt, 0);
}
function rollup(fmt) {
  const m = {};
  daily.forEach((r) => { const k = r.day.slice(0, fmt); m[k] = (m[k] || 0) + r.cnt; });
  return Object.entries(m).sort().reverse();
}

function render(top, siteTotal) {
  const today = new Date().toISOString().slice(0, 10);
  const totalArticleViews = daily.reduce((s, r) => s + r.cnt, 0);
  // 최근 30일 차트
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const hit = daily.find((r) => r.day === day);
    last30.push({ day, cnt: hit ? hit.cnt : 0 });
  }
  const max = Math.max(1, ...last30.map((r) => r.cnt));
  const bars = last30.map((r) =>
    `<div class="bar" style="height:${(r.cnt / max * 100).toFixed(1)}%"><span>${r.day.slice(5)}: ${r.cnt}</span></div>`).join('');

  const months = rollup(7), years = rollup(4);
  const monthRows = months.slice(0, 12).map(([k, v]) => `<tr><td>${k}</td><td class="num">${v.toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">데이터 없음</td></tr>';
  const yearRows = years.map(([k, v]) => `<tr><td>${k}</td><td class="num">${v.toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">데이터 없음</td></tr>';
  const topRows = top.map((r) => `<tr><td>${esc(titleOf[r.article_id] || r.article_id)}</td><td class="num">${Number(r.cnt).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">아직 조회 기록 없음</td></tr>';

  app.innerHTML = `
    <header>
      <h1>jp-reader <span>관리자</span></h1>
      <a class="home" href="./">← 사이트</a>
      <button class="btn" id="refresh">새로고침</button>
      <button class="btn" id="logout">로그아웃</button>
    </header>
    <main>
      <div class="cards">
        <div class="stat"><div class="n">${siteTotal.toLocaleString()}</div><div class="l">사이트 총 방문</div></div>
        <div class="stat"><div class="n">${totalArticleViews.toLocaleString()}</div><div class="l">기사 총 조회</div></div>
        <div class="stat"><div class="n">${sumSince(1).toLocaleString()}</div><div class="l">오늘</div></div>
        <div class="stat"><div class="n">${sumSince(7).toLocaleString()}</div><div class="l">최근 7일</div></div>
        <div class="stat"><div class="n">${sumSince(30).toLocaleString()}</div><div class="l">최근 30일</div></div>
      </div>

      <section>
        <h3>일별 조회수 (최근 30일)</h3>
        <div class="chart">${bars}</div>
      </section>

      <section class="roll">
        <div><h3>월별</h3><table><tr><th>월</th><th class="num">조회</th></tr>${monthRows}</table></div>
        <div><h3>연도별</h3><table><tr><th>연도</th><th class="num">조회</th></tr>${yearRows}</table></div>
      </section>

      <section>
        <h3>인기 기사 TOP 20</h3>
        <table><tr><th>제목</th><th class="num">조회</th></tr>${topRows}</table>
      </section>

      <section>
        <h3>기사 관리 (${articles.length}건) — 숨김/복원</h3>
        <input class="search" id="asearch" placeholder="제목 검색…" value="${esc(q)}" />
        <table id="atable"></table>
      </section>

      <section>
        <h3>피드백 (${feedbackData.length}건)</h3>
        <div id="fbadmin"></div>
      </section>
    </main>`;

  $('#logout').onclick = () => sb.auth.signOut();
  $('#refresh').onclick = () => dashboard();
  $('#asearch').addEventListener('input', (e) => { q = e.target.value.toLowerCase(); renderArticleTable(); });
  renderArticleTable();
  renderFeedback();
}

function renderFeedback() {
  const box = $('#fbadmin');
  if (!feedbackData.length) { box.innerHTML = '<p class="muted">아직 피드백이 없습니다.</p>'; return; }
  box.innerHTML = feedbackData.map((f) =>
    `<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px">
       <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--muted);margin-bottom:5px">
         <b style="color:var(--ink)">${esc(f.nickname || '익명')}</b>
         <span>${new Date(f.created_at).toLocaleString('ko-KR')}
           <button class="hidebtn" data-fid="${f.id}" style="margin-left:8px">삭제</button></span>
       </div>
       <div style="font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(f.message)}</div>
     </div>`).join('');
  box.querySelectorAll('[data-fid]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 피드백을 삭제할까요?')) return;
      const { error } = await sb.from('feedback').delete().eq('id', b.dataset.fid);
      if (error) { alert('삭제 실패: ' + error.message); return; }
      feedbackData = feedbackData.filter((x) => String(x.id) !== String(b.dataset.fid));
      renderFeedback();
    };
  });
}

function renderArticleTable() {
  const rows = articles
    .filter((a) => !q || a.title.toLowerCase().includes(q))
    .slice(0, 200)
    .map((a) => {
      const on = hidden.has(a.id);
      return `<tr>
        <td>${esc(a.date || '')}</td>
        <td>${esc(a.source)}</td>
        <td style="${on ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(a.title)}</td>
        <td class="num"><button class="hidebtn ${on ? 'on' : ''}" data-id="${esc(a.id)}">${on ? '복원' : '숨김'}</button></td>
      </tr>`;
    }).join('');
  $('#atable').innerHTML = `<tr><th>날짜</th><th>출처</th><th>제목</th><th class="num">관리</th></tr>${rows}`;
  $('#atable').querySelectorAll('.hidebtn').forEach((b) => {
    b.onclick = () => toggleHide(b.dataset.id);
  });
}

async function toggleHide(id) {
  if (hidden.has(id)) {
    const { error } = await sb.from('hidden').delete().eq('article_id', id);
    if (!error) hidden.delete(id);
  } else {
    const { error } = await sb.from('hidden').insert({ article_id: id });
    if (!error) hidden.add(id);
    else alert('권한 오류: ' + error.message);
  }
  renderArticleTable();
}
