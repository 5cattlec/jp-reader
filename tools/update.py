# -*- coding: utf-8 -*-
"""
日本語ニュース リーダー — 업데이트 스크립트 (v2)
  RSS -> 기사 전문 추출 -> 후리가나(MeCab/fugashi) -> 단어 span(사전링크용)
      -> edge-tts 다중 음성(mp3) -> site/data/articles.json 저장

실행:  python tools/update.py
"""
import os, sys, re, json, html, hashlib, asyncio, time
from datetime import datetime, timezone, timedelta

import feedparser
import requests
from bs4 import BeautifulSoup
import edge_tts

# ---- 경로 ---------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SITE = os.path.join(ROOT, "site")
DATA = os.path.join(SITE, "data")
AUDIO = os.path.join(SITE, "audio")
ARTICLES_JSON = os.path.join(DATA, "articles.json")
SOURCES_JSON = os.path.join(HERE, "sources.json")
os.makedirs(DATA, exist_ok=True)
os.makedirs(AUDIO, exist_ok=True)

def log(*a):
    msg = " ".join(str(x) for x in a)
    try:
        sys.stdout.write(msg + "\n")
    except UnicodeEncodeError:
        sys.stdout.buffer.write((msg + "\n").encode("utf-8", "replace"))
    sys.stdout.flush()

# ---- 형태소 분석기 (fugashi 우선, 실패 시 pykakasi) ----------------------
KATA_TO_HIRA = {c: chr(ord(c) - 0x60) for c in map(chr, range(0x30A1, 0x30F7))}
def kata2hira(s):
    return "".join(KATA_TO_HIRA.get(ch, ch) for ch in s)

_engine = None
def get_engine():
    global _engine
    if _engine is not None:
        return _engine
    try:
        import fugashi
        tagger = fugashi.Tagger()
        _engine = ("fugashi", tagger)
        log("형태소: fugashi(MeCab/unidic)")
    except Exception as e:
        import pykakasi
        _engine = ("pykakasi", pykakasi.kakasi())
        log("형태소: pykakasi (fugashi 미사용:", e, ")")
    return _engine

def tokenize(text):
    """[(surface, reading_hira|None, lemma|None), ...]"""
    kind, eng = get_engine()
    out = []
    if kind == "fugashi":
        for w in eng(text):
            f = w.feature
            kana = getattr(f, "kana", None)
            reading = kata2hira(kana) if kana and kana != "*" else None
            lemma = getattr(f, "lemma", None)
            if not lemma or lemma == "*":
                lemma = None
            elif "-" in lemma:            # unidic 借用어 어휘소 "チップ-chip" → 앞부분만
                lemma = lemma.split("-")[0] or None
            out.append((w.surface, reading, lemma))
    else:
        for t in eng.convert(text):
            out.append((t["orig"], t["hira"], None))
    return out

# ---- 후리가나/단어 span --------------------------------------------------
KANJI = re.compile(r"[一-龯㐀-䶿豈-﫿々〆ヶ]")
WORDISH = re.compile(r"[0-9A-Za-zぁ-ヿ一-龯々〆ヶ]")
def has_kanji(s): return bool(KANJI.search(s))
def is_kana(ch): return ("぀" <= ch <= "ゟ") or ("゠" <= ch <= "ヿ")
def esc(s): return html.escape(s, quote=True)

def ruby_html(surface, reading):
    """한자에 ruby. 오쿠리가나(양끝 일치 가나)는 ruby 밖으로."""
    if not reading or not has_kanji(surface) or surface == reading:
        return esc(surface)
    i = 0
    while i < len(surface) and i < len(reading) and surface[-1-i] == reading[-1-i] and is_kana(surface[-1-i]):
        i += 1
    suffix = surface[len(surface)-i:] if i else ""
    o = surface[:len(surface)-i] if i else surface
    h = reading[:len(reading)-i] if i else reading
    j = 0
    while j < len(o) and j < len(h) and o[j] == h[j] and is_kana(o[j]):
        j += 1
    prefix = o[:j]; o2, h2 = o[j:], h[j:]
    if not o2:
        return esc(prefix + suffix)
    return f"{esc(prefix)}<ruby>{esc(o2)}<rt>{esc(h2)}</rt></ruby>{esc(suffix)}"

def token_html(surface, reading, lemma):
    inner = ruby_html(surface, reading)
    if not WORDISH.search(surface):        # 구두점/기호/공백 -> 클릭 대상 아님
        return inner
    attrs = ' class="w"'
    if lemma and lemma != surface:
        attrs += f' data-l="{esc(lemma)}"'
    if reading:
        attrs += f' data-r="{esc(reading)}"'
    return f"<span{attrs}>{inner}</span>"

def line_to_html(text):
    # MeCab이 토큰 사이 공백을 버리므로, 공백을 보존하며 조각별로 토큰화(영단어 붙음 방지)
    out = []
    for part in re.split(r"(\s+)", text):
        if not part:
            continue
        if part.isspace():
            out.append(esc(part))
        else:
            out.append("".join(token_html(s, r, l) for s, r, l in tokenize(part)))
    return "".join(out)

def paragraphs_html(paras):
    return "".join(f"<p>{line_to_html(p)}</p>" for p in paras if p.strip())

SENT_SPLIT = re.compile(r"(?<=[。！？])")

def flat_sentences(paras):
    """[(para_index, sentence_text)] — 화면 문장 spans / 타이밍 공통 기준."""
    out = []
    for pi, p in enumerate(paras):
        for s in SENT_SPLIT.split(p):
            s = s.strip()
            if s:
                out.append((pi, s))
    return out

def sentences_html(sents):
    """문단별로 묶고, 각 문장을 <span class="s" data-i>로 감싸 클릭·하이라이트 가능하게."""
    parts = []
    cur_pi = None
    for i, (pi, s) in enumerate(sents):
        if pi != cur_pi:
            if cur_pi is not None:
                parts.append("</p>")
            parts.append("<p>")
            cur_pi = pi
        parts.append(
            f'<span class="s" data-i="{i}">'
            f'<button class="sp" data-i="{i}" aria-label="이 문장 재생">▶</button>'
            f'{line_to_html(s)}</span>'
        )
    if cur_pi is not None:
        parts.append("</p>")
    return "".join(parts)

def sentence_offsets(sents, paras, base):
    """각 문장의 speak_text 내 문자 위치. base=본문 시작 오프셋."""
    body = "\n".join(paras)
    offs = []; cur = 0
    for _, s in sents:
        pos = body.find(s, cur)
        if pos < 0:
            pos = cur
        offs.append(base + pos)
        cur = pos + len(s)
    return offs

# ---- 본문 추출 ----------------------------------------------------------
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "ja,en;q=0.8",
}
DOMAIN_SELECTORS = {
    "gigazine.net": ["#article"],
    "itmedia.co.jp": ["#cmsBody", "#contentBody"],
    "japan.cnet.com": ["div.article_body"],
}
# 본문 뒤 잘라낼 경계 문구(이 줄부터 끝까지 버림)
CUT_MARKERS = [
    "関連記事", "あわせて読みたい", "この記事を", "この記事は海外", "Source:", "・関連", "続きを読む",
    "Copyright", "All Rights Reserved", "優先ソース", "タイトルとURLをコピー", "アソシエイト",
    "Amazonで開催", "セールを見る", "4Xが日本", "ZiffDavis", "この記事に関連する", "外部サイト",
]
# 정확히 이 줄이면 버림(SNS 공유 버튼 등)
SOCIAL = {"X", "Facebook", "Bluesky", "Discord", "Threads", "Google", "Clipboard", "LINE",
          "Pocket", "はてな", "はてなブックマーク", "note", "Tumblr", "Pinterest", "Instagram",
          "YouTube", "RSS", "Feedly", "Mastodon", "LinkedIn", "WhatsApp", "Telegram", "mixi"}
DROP_EXACT = SOCIAL | {"シェア", "ツイート", "印刷", "PR", "Sponsored", "提供", "コメント",
                       "もっと見る", "広告", "スポンサーリンク", "目次", "画像"}
DROP_PREFIX = ("提供:", "提供：", "写真=", "写真：", "画像=", "画像：", "出典", "(c)", "（c）", "©", "撮影")
JP = re.compile(r"[぀-ヿ一-龯]")
DATE_LINE = re.compile(r"^\d{4}年\d{1,2}月\d{1,2}日(\d{1,2}時\d{1,2}分)?$")
URL_RE = re.compile(r"https?://\S+")
END_PUNC = re.compile(r"[。！？」）]")

def _norm(s):
    return re.sub(r"\s+", "", s)

def scrub(s):
    """문단 내부의 URL·출처링크 꼬리 제거. 문장 끝(일본어 구두점) 뒤 비일본어 꼬리를 잘라냄."""
    s = URL_RE.sub("", s)
    marks = list(END_PUNC.finditer(s))
    if marks:
        tail = s[marks[-1].end():]
        if tail.strip() and not JP.search(tail):      # 마지막 문장부호 뒤가 비일본어면 버림
            s = s[:marks[-1].end()]
    s = re.sub(r"[!-~]{20,}", "", s)                   # 남은 20+ ASCII 덩어리 제거
    return re.sub(r"\s{2,}", " ", s).strip()

def _junk_line(l):
    if l in DROP_EXACT or l.startswith(DROP_PREFIX):
        return True
    if re.fullmatch(r"[\W_]+", l):                       # 기호만 있는 줄
        return True
    if not JP.search(l) and len(l) > 6:                  # 일본어 0 = 캡션/영문 alt/URL/제휴 보일러플레이트
        return True
    return False

def to_paragraphs(text, title=""):
    lines = [re.sub(r"[ \t　]+", " ", l).strip() for l in re.split(r"\n+", text)]
    lines = [l for l in lines if l]
    # 1) 꼬리 경계 컷
    for i, l in enumerate(lines):
        if any(m in l for m in CUT_MARKERS):
            lines = lines[:i]; break
    # 2) URL/꼬리 스크럽 + 쓰레기 줄 제거
    cleaned = []
    for l in lines:
        l = scrub(l)
        if l and not _junk_line(l):
            cleaned.append(l)
    lines = cleaned
    # 3) 상단 헤더 컷 — 본문에 제목이 그대로 반복되면(예: GIGAZINE) 그 줄까지 버림(날짜·카테고리 포함)
    nt = _norm(title)
    if nt:
        for i, l in enumerate(lines[:6]):
            if _norm(l) == nt:
                lines = lines[i + 1:]; break
    # 4) 남은 선두의 날짜줄 제거
    while lines and DATE_LINE.match(_norm(lines[0])):
        lines = lines[1:]
    return lines

def node_text(node):
    """컨테이너에서 문단 단위 텍스트. <p>/<li> 등 블록을 이어붙여 인라인 링크로 문장이 끊기지 않게."""
    blocks = [b for b in node.find_all(["p", "h2", "h3", "h4", "li", "blockquote"])
              if not b.find(["p", "li", "blockquote"])]     # 최하위 블록만(중복 방지)
    if len(blocks) >= 2:
        return "\n".join(b.get_text(" ", strip=True) for b in blocks)
    return node.get_text("\n", strip=True)

def pick_generic(soup):
    """<p> 밀집 컨테이너를 본문으로 추정."""
    best = None
    for t in soup.find_all(["article", "section", "div"]):
        ps = t.find_all("p", recursive=False)
        txt = "\n".join(p.get_text(" ", strip=True) for p in ps)
        if len(txt) > 250 and (best is None or len(txt) > best[0]):
            best = (len(txt), txt)
    return best[1] if best else ""

def fetch_body(url, fallback, title=""):
    try:
        r = requests.get(url, headers=UA, timeout=15)
        r.encoding = r.apparent_encoding or "utf-8"
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form"]):
            tag.decompose()
        # 외부 참조/영문 링크·캡션 제거(본문 아님) — 일본어 없는 것만
        for tag in soup.find_all(["a", "b", "strong", "cite", "figcaption", "figure"]):
            txt = tag.get_text(" ", strip=True)
            if tag.name == "a":
                if txt and not JP.search(txt):          # 일본어 앵커는 유지
                    tag.decompose()
            elif txt and not JP.search(txt) and len(txt) > 8:
                tag.decompose()
        raw = ""
        for host, sels in DOMAIN_SELECTORS.items():
            if host in url:
                for sel in sels:
                    n = soup.select_one(sel)
                    if n and len(n.get_text(strip=True)) > 200:
                        raw = node_text(n); break
            if raw:
                break
        if not raw:
            raw = pick_generic(soup)
        paras = to_paragraphs(raw, title)
        if paras and sum(len(p) for p in paras) >= 120:
            return paras
    except Exception as e:
        log("  ! 본문 추출 실패, 요약 사용:", e)
    return to_paragraphs(fallback or "", title)

# ---- 한국어 번역 (deep-translator / Google, 키 불필요) -------------------
_translator = None
_tr_cache = {}
def _get_tr():
    global _translator
    if _translator is None:
        from deep_translator import GoogleTranslator
        _translator = GoogleTranslator(source="ja", target="ko")
    return _translator

def to_ko(text):
    text = (text or "").strip()
    if not text:
        return ""
    if text in _tr_cache:
        return _tr_cache[text]
    try:
        ko = _get_tr().translate(text[:4900]) or ""
    except Exception as e:
        log("   ! 번역 실패:", e); ko = ""
    _tr_cache[text] = ko
    return ko

# ---- TTS ----------------------------------------------------------------
async def _synth_marks(text, path, voice, rate, pitch):
    """음성 저장 + SentenceBoundary 마크 [(문자위치, 초)] 반환."""
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    marks = []; cur = 0
    with open(path, "wb") as f:
        async for ch in comm.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "SentenceBoundary":
                t = ch.get("text", "")
                pos = text.find(t, cur) if t else cur
                if pos < 0:
                    pos = cur
                marks.append((pos, ch["offset"] / 1e7))
                cur = pos + len(t)
    return marks

def make_audio_marks(text, path, voice, rate, pitch):
    return asyncio.run(_synth_marks(text, path, voice, rate, pitch))

def times_for(offsets, marks):
    """각 문장 문자위치를 마크(문자위치→시각)로 매핑 → 문장별 재생 시작초."""
    times = []
    for off in offsets:
        t = 0.0
        for c, sec in marks:
            if c <= off:
                t = sec
            else:
                break
        times.append(round(t, 2))
    return times

# ---- 메인 ---------------------------------------------------------------
def load_existing():
    if os.path.exists(ARTICLES_JSON):
        with open(ARTICLES_JSON, encoding="utf-8") as f:
            return json.load(f)
    return {"updated": None, "articles": []}

def make_id(source, url):
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    tag = re.sub(r"[^a-zA-Z0-9]", "", source)[:6] or "src"
    return f"{tag}_{h}"

def clean(s):
    return re.sub(r"[ \t　]+", " ", (s or "")).strip()

def entry_date(entry):
    """기사 날짜 YYYY-MM-DD (RSS published 우선, 없으면 오늘)."""
    pp = entry.get("published_parsed") or entry.get("updated_parsed")
    if pp:
        try:
            return time.strftime("%Y-%m-%d", pp)
        except Exception:
            pass
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def main():
    with open(SOURCES_JSON, encoding="utf-8") as f:
        cfg = json.load(f)
    voices = cfg.get("voices", [{"key": "f", "label": "女性", "voice": "ja-JP-NanamiNeural"}])
    rate = cfg.get("rate", "+0%")
    pitch = cfg.get("pitch", "+0Hz")
    max_per = int(cfg.get("max_per_feed", 4))
    do_translate = cfg.get("translate", True)

    store = load_existing()
    seen = {a["url"] for a in store["articles"]}
    added = 0

    for feed in cfg.get("feeds", []):
        log(f"# {feed['name']}  ({feed['url']})")
        parsed = feedparser.parse(feed["url"])
        if not parsed.entries:
            log("  ! 빈 피드/파싱 실패"); continue
        for entry in parsed.entries[:max_per]:
            url = entry.get("link")
            if not url or url in seen:
                continue
            seen.add(url)
            title = clean(entry.get("title", "(제목 없음)"))
            summary = clean(BeautifulSoup(entry.get("summary", ""), "html.parser").get_text(" "))
            published = entry.get("published", "") or entry.get("updated", "")
            log("  +", title[:40])

            paras = fetch_body(url, summary, title)
            aid = make_id(feed["name"], url)

            # 한국어 해석 (문단별)
            title_ko = to_ko(title) if do_translate else ""
            paras_ko = [to_ko(p) for p in paras] if do_translate else []

            # 문장 단위(화면·타이밍 공통 기준)
            sents = flat_sentences(paras)
            base = len(title) + 2                 # "제목" + "。\n"
            offsets = sentence_offsets(sents, paras, base)

            # 음성 생성 + 문장별 타임스탬프
            speak = title + "。\n" + "\n".join(paras)
            audio = {}; sent_times = {}
            for v in voices:
                rel = f"audio/{aid}.{v['key']}.mp3"
                try:
                    marks = make_audio_marks(speak, os.path.join(SITE, rel), v["voice"], rate, pitch)
                    audio[v["key"]] = rel
                    sent_times[v["key"]] = times_for(offsets, marks)
                except Exception as e:
                    log("   ! TTS 실패", v["key"], ":", e)

            store["articles"].insert(0, {
                "id": aid,
                "source": feed["name"],
                "url": url,
                "published": published,
                "title": title,
                "date": entry_date(entry),
                "title_html": line_to_html(title),
                "title_ko": title_ko,
                "summary": summary,
                "body_html": sentences_html(sents),
                "body_ko": paras_ko,
                "sent_times": sent_times,
                "chars": sum(len(p) for p in paras),
                "audio": audio,
            })
            added += 1

    # 보관 정책: 최근 keep_days일 유지(지난 기사도 날짜별 보관), max_articles 안전상한
    # 날짜 없는 기존 기사엔 published 파싱 백필
    for a in store["articles"]:
        if not a.get("date"):
            m = re.search(r"\d{1,2} \w{3} \d{4}", a.get("published", ""))
            try:
                a["date"] = datetime.strptime(m.group(0), "%d %b %Y").strftime("%Y-%m-%d") if m else "0000-00-00"
            except Exception:
                a["date"] = "0000-00-00"
    keep_days = int(cfg.get("keep_days", 30))
    max_articles = int(cfg.get("max_articles", 500))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=keep_days)).strftime("%Y-%m-%d")
    store["articles"].sort(key=lambda a: (a.get("date", ""), a.get("published", "")), reverse=True)
    store["articles"] = [a for a in store["articles"] if a.get("date", "") >= cutoff][:max_articles]
    keep = {os.path.basename(rel) for a in store["articles"] for rel in (a.get("audio") or {}).values()}
    for fn in os.listdir(AUDIO):
        if fn.endswith(".mp3") and fn not in keep:
            try:
                os.remove(os.path.join(AUDIO, fn))
            except OSError:
                pass

    store["updated"] = datetime.now(timezone.utc).isoformat()
    store["voices"] = [{"key": v["key"], "label": v.get("label", v["key"])} for v in voices]
    with open(ARTICLES_JSON, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)

    log(f"\n완료: 새 기사 {added}건, 전체 {len(store['articles'])}건")
    log(f"저장: {ARTICLES_JSON}")

if __name__ == "__main__":
    main()
