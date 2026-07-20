# 日本語ニュース リーダー (jp-reader)

일본어 뉴스를 **전문(全文)** 으로 가져와 **후리가나(요미가나)** 를 자동으로 달고,
**AI 음성(edge-tts)** 으로 듣고, **단어를 클릭해 뜻**을 찾는 개인 일본어 학습용 정적 사이트.

## 기능
- 📰 **기사 전문 자동 수집** (ITmedia / CNET Japan / GIGAZINE — 로그인 게이트 없는 소스)
- 🔤 **후리가나** — MeCab(fugashi/unidic)로 정밀 생성 (미설치 시 pykakasi 폴백)
- 🔊 **AI 음성** — edge-tts, **여성(Nanami)/남성(Keita) 토글**, 재생속도 0.75~1.5x
- 🖱 **단어 클릭 → 뜻** — 읽기 표시 + 네이버 일본어사전 / Weblio 바로가기
- ⭐ **즐겨찾기** + 🔎 검색 + 글자 크기 조절 + ふりがな ON/OFF (설정은 브라우저에 저장)

## 구조
```
jp-reader/
├─ site/                 ← 웹사이트 (배포 대상)
│  ├─ index.html · style.css · app.js
│  ├─ data/articles.json    ← update.py 생성
│  └─ audio/<id>.<voice>.mp3 ← update.py 생성 (음성, 음성별)
├─ tools/
│  ├─ update.py          ← RSS→전문추출→후리가나→TTS
│  ├─ sources.json       ← 피드·음성·속도 설정
│  └─ requirements.txt
├─ update.cmd  · serve.cmd
```

## 사용법
```
python tools/update.py      # 또는 update.cmd 더블클릭 → 새 기사 수집·생성
cd site && python -m http.server 8777   # 또는 serve.cmd → http://localhost:8777/
```
이미 가져온 기사(같은 URL)는 건너뜁니다.

## 설정 (tools/sources.json)
- `voices`: 생성할 음성 목록. `key`(사이트 토글 코드)·`label`·`voice`(예 `ja-JP-NanamiNeural`/`ja-JP-KeitaNeural`)
- `rate` / `pitch`: 음성 속도·피치 (예 `-6%`, `+0Hz`) — 학습용은 약간 느리게 권장
- `max_per_feed`: 피드당 가져올 기사 수
- `feeds`: RSS 목록. **전문 추출은 소스별 셀렉터**(update.py `DOMAIN_SELECTORS`)로 처리.
  새 소스 추가 시 해당 도메인 셀렉터를 넣거나 자동 `<p>` 추정 폴백에 의존.

## 소스 참고 (전문 접근성)
| 소스 | 전문 | 비고 |
|------|------|------|
| ITmedia | ✅ `#cmsBody` | IT/테크 뉴스 |
| CNET Japan | ✅ `div.article_body` | IT 뉴스 |
| GIGAZINE | ✅ `#article` | 테크/컬처, 읽을거리 |
| NHK | ❌ | NHK ONE **로그인 게이트** → 요약만. 기본 제외 |

## 배포 (무료 · 인터넷 공개) — Netlify 드래그
1. https://app.netlify.com/drop 접속
2. **`jp-reader-site.zip`** 파일(또는 `site` 폴더째)을 페이지에 **드래그&드롭**
3. 몇 초 뒤 공개 URL 발급 (예: `random-name.netlify.app`)
   - 계정 없이도 즉시 됨. 로그인하면 URL 이름 변경·유지 가능.

### 기사 업데이트 후 공개 사이트 갱신
`python tools/update.py` 로 새 기사 받은 뒤 → **다시 zip 만들어 같은 Netlify 사이트에 드래그**(재배포).
> zip 다시 만들기(PowerShell):
> `Compress-Archive -Path site\* -DestinationPath jp-reader-site.zip -Force`

### (선택) 자동 갱신까지 원하면
GitHub 저장소 + Netlify 연동으로 바꾸면, 자동 업데이트가 커밋·푸시할 때 공개 사이트도 자동 재배포됩니다. (드래그 방식은 매번 수동 재드래그)

## 주의
- **후리가나 정확도**: MeCab 기준으로 크게 향상. 그래도 고유명사 등 오독 가능.
- **저작권**: 뉴스 전문/음성을 공개 사이트에 올리는 것은 회색지대. 인터넷 공개 시
  "발췌 + 원문 링크" 수준 유지 권장. (사이트에 원문 링크 항상 표기)
