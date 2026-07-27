-- ============================================================
-- jp-reader Supabase 스키마
-- Supabase 대시보드 → SQL Editor → 아래 전체 붙여넣고 Run
-- ============================================================

-- 1) 조회 기록 (기사 열람/사이트 방문 이벤트를 1행씩 저장)
create table if not exists public.views (
  id         bigint generated always as identity primary key,
  article_id text        not null,          -- 기사 id, 사이트 방문은 '_site'
  created_at timestamptz not null default now()
);
create index if not exists views_article_idx on public.views (article_id);
create index if not exists views_created_idx on public.views (created_at);

-- 2) 숨김(관리자 삭제) 목록 — 정적 기사 JSON은 유지하고 프론트에서 필터
create table if not exists public.hidden (
  article_id text primary key,
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS (행 수준 보안)
-- ============================================================
alter table public.views  enable row level security;
alter table public.hidden enable row level security;

-- views: 익명은 INSERT만 허용(조회 기록). 원시행 SELECT는 막고, 집계는 아래 함수로만.
drop policy if exists views_insert_anon on public.views;
create policy views_insert_anon on public.views
  for insert to anon, authenticated with check (true);

-- hidden: 누구나 읽기(공개 사이트가 숨김목록을 알아야 필터 가능), 쓰기는 로그인한 관리자만
drop policy if exists hidden_select_all on public.hidden;
create policy hidden_select_all on public.hidden
  for select to anon, authenticated using (true);
drop policy if exists hidden_write_admin on public.hidden;
create policy hidden_write_admin on public.hidden
  for all to authenticated using (true) with check (true);

-- ============================================================
-- 집계 함수 (security definer = RLS 우회하여 안전하게 카운트만 반환)
-- ============================================================

-- 여러 기사 조회수 한 번에
create or replace function public.view_counts(ids text[])
returns table(article_id text, cnt bigint)
language sql stable security definer set search_path = public as $$
  select article_id, count(*) from public.views
  where article_id = any(ids) group by article_id
$$;

-- 일자별 조회수(사이트 방문 제외) — 관리자 통계용. 월/년은 프론트에서 롤업
create or replace function public.views_daily(since timestamptz)
returns table(day date, cnt bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('day', created_at)::date as day, count(*)
  from public.views
  where article_id <> '_site' and created_at >= since
  group by 1 order by 1
$$;

-- 인기 기사 TOP N
create or replace function public.views_top(since timestamptz, lim int)
returns table(article_id text, cnt bigint)
language sql stable security definer set search_path = public as $$
  select article_id, count(*) from public.views
  where article_id <> '_site' and created_at >= since
  group by 1 order by 2 desc limit lim
$$;

-- 사이트 총 방문수
create or replace function public.site_total()
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.views where article_id = '_site'
$$;

grant execute on function public.view_counts(text[]) to anon, authenticated;
grant execute on function public.views_daily(timestamptz) to anon, authenticated;
grant execute on function public.views_top(timestamptz, int) to anon, authenticated;
grant execute on function public.site_total() to anon, authenticated;

-- ============================================================
-- 3) 피드백 (방문자 남기기 → 공개 목록, 관리자 삭제)
-- ============================================================
create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  nickname   text,
  message    text        not null,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

drop policy if exists feedback_insert_anon on public.feedback;
create policy feedback_insert_anon on public.feedback
  for insert to anon, authenticated
  with check (char_length(message) between 1 and 2000
              and char_length(coalesce(nickname,'')) <= 40);

drop policy if exists feedback_select_all on public.feedback;
create policy feedback_select_all on public.feedback
  for select to anon, authenticated using (true);

drop policy if exists feedback_delete_admin on public.feedback;
create policy feedback_delete_admin on public.feedback
  for delete to authenticated using (true);

-- 완료. (관리자 계정은 Authentication → Users → Add user 로 이메일 1개 추가)
