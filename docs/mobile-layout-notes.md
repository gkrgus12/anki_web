# 모바일(iPhone) 레이아웃 노하우 — 이 포크에서 잡은 것들

2026-10-19 기준. 대상은 iPhone 17(402×874pt), iPhone SE 3세대(375×667), iOS 26 홈 화면 앱.
수정은 전부 `mine.css`(폰 미디어쿼리 `@media (max-width:759px)`)와 `sien-mine.js`(원본 함수 감싸기)에만 둔다.

## 1. 작업 방식

- 원본 파일은 건드리지 않고 **새 파일 + 로드 줄 1개**로 덮어쓴다. JS는 전역 함수를 감싸고(`const orig=g.fn; g.fn=function(){...orig.apply(...)}`), CSS는 더 높은 특이성(`body #id`)으로 이긴다.
- `mine.css` 링크는 원본 `<style>` **뒤**에 둔다. 앞에 두면 같은 특이성에서 원본이 이긴다.
- 원본이 초기화 때 `onclick`을 나중에 덮어쓰는 버튼은 **캡처 단계 리스너**(`addEventListener(..., true)` + `stopImmediatePropagation`)로 가로챈다.
- 모듈을 고치면 `?v=`와 `sien-app.js` 버전 문자열을 올린다. 홈 화면 앱은 완전히 닫았다 열어야 새 버전을 받는다.
- 매 작업 끝에 `node --test *.test.cjs`, 브라우저 시나리오, 버튼 측정을 돌리고 `git diff --stat origin/main -- . ':!sien-mine.js' ':!mine.css' ...`로 원본 변경량을 확인한다.

## 2. 검증 환경 (실기기 없이)

- Playwright + Chromium에 iPhone 프로필(`devices['iPhone SE (3rd gen)']`, `'iPhone 15 Pro'`), iPhone 17은 직접 정의(`viewport 402×874, deviceScaleFactor 3, isMobile, hasTouch`). WebKit은 이 컨테이너에서 설치가 막혀 있다.
- Chromium은 `env(safe-area-inset-*)`를 0으로 계산하므로, CSS에서 `env()`를 **변수로 한 번 감싼다**: `--sa-top:env(safe-area-inset-top); --sa-bottom:min(env(safe-area-inset-bottom),34px)`. 검사 때 `html:root{--sa-top:59px !important; --sa-bottom:34px !important}`를 주입하면 인셋이 있는 상태를 재현할 수 있다.
- 홈 화면 앱은 `html.sien-standalone` 클래스(JS가 `navigator.standalone`/display-mode로 판정)를 수동으로 붙여 재현한다.
- 버튼 측정 스크립트: 글자(텍스트 노드·svg)의 박스와 버튼 박스 거리 < 8px(문제 A), 텍스트 노드가 2줄 이상 또는 같은 줄 형제와 높이 다름(문제 B). 테두리·배경 없는 행(summary, 링크 행)은 A에서 제외.
- 글자 세로 중앙 문제는 iOS 시스템 글꼴(SF + Apple SD Gothic Neo) 메트릭 때문이라 **Chromium에서 재현되지 않는다**. 실기기 스크린샷(3× → 2000px 표시면 2.288px/pt)으로 수치를 재서 맞춘다.

## 3. safe-area와 홈 화면 앱

- 원본은 `body`에 네 방향 `env()` 패딩을 두었다. 그러면 스크롤 영역이 인셋 위에서 끝나 **빈 띠**가 생기고 "잘린" 것처럼 보인다. 폰에서는 body·#main 패딩을 0으로 하고, 각 스크롤 컨테이너(`.home-inner`, `.sub-body`, 설정 시트) 안쪽 패딩으로 옮긴다. 고정 요소(탭 막대, 채점 버튼)만 인셋 위에 둔다.
- 인셋 자리의 띠: 처음엔 `#main::before/::after`에 `backdrop-filter` 블러 띠를 깔았는데, 실기기(iOS 26)에서 **아래 띠가 탭 막대 윗선부터 화면 끝까지 전체 폭의 블록으로 그려졌고** 위 띠는 경계선이 칼같이 보였다(Chromium에선 34pt 띠로만 보여 재현 안 됨). 지금은 아래 띠를 없애 내용이 탭 막대 밑으로 화면 끝까지 흐르고, 위는 블러 없이 페이지 배경색 그라데이션(`linear-gradient(to bottom, var(--c-bg) calc(100% - 32px), transparent)`, 높이 `--sa-top + 24px`)만 둔다. 풀이 화면은 상단바가 흐름 안에 있으므로 위 띠를 끈다. 교훈: 홈 화면 앱에서 `backdrop-filter` 고정 띠는 피하고, 배경색 페이드로 충분하다.
- 원본의 홈 화면 앱용 `--sat-extra: 15px`(아이패드 iOS 27 블러 겹침 실측값)는 iPhone에서 불필요 → `!important`로 0.
- **iOS 26 버그 (WebKit 301108)**: `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style=black-translucent`인 홈 화면 앱은 뷰포트가 화면보다 **상태바 높이(약 60pt)만큼 짧다**. `100%`·`vh`·`dvh`가 전부 짧은 값을 주고, `position:fixed; bottom:0`도 그 위에서 멈춘다. 대응 두 겹:
  1. `html.sien-standalone{min-height:min(100lvh, calc(100% + env(safe-area-inset-top)))}` — frappe-ui가 iOS 26.2 시뮬레이터에서 `innerHeight` 812→874로 확인한 처방.
  2. (폐기) JS로 `screen.height - innerHeight`를 `--viewport-gap`에 기록해 인셋에서 빼는 방법. 아래 「해결 확인」 참고.
- **해결 확인(2026-10-19, iPhone 17 · iOS 26.6.1 · 크롬에서 홈 화면 추가)**: 1번 min-height 한 줄로 탭 막대가 화면 끝까지 내려왔다. 2번 측정은 **쓰면 안 됐다**: 스크립트가 처음 잴 때는 뷰포트가 아직 짧아 간격 60이 기록되고, min-height 덕에 뷰포트가 커진 뒤에도 resize가 오지 않아 60이 남는다. 그 값을 인셋에서 빼니 막대가 홈 인디케이터 위에 바짝 붙었다(8pt). 지금은 인셋을 그대로 쓰고(`--sa-bottom-eff: var(--sa-bottom)`), 간격 값은 설정 페이지 진단 줄에만 보여 준다. 교훈: **iOS 뷰포트 치수를 JS로 재서 레이아웃에 넣지 말 것**. 한 번 잰 값은 금방 낡는다.
- 설치 경로는 상관없다. 아이폰 크롬도 WebKit이고, iOS 16.4부터 크롬의 「홈 화면에 추가」도 사파리와 같은 시스템 웹 앱으로 열린다(iOS 26에서는 어느 브라우저든 기본이 웹 앱). 저장소만 브라우저와 분리된다.
- 설정 페이지 맨 아래 진단 줄(`.mine-diag`): 뷰포트·화면·문서 높이, 간격, 안전영역 위/아래(`env()`를 패딩으로 준 probe 요소의 computed 값. 커스텀 속성의 computed 값은 `env()`가 풀리지 않는다), standalone 여부, UA의 iOS 버전, `?v=`. 실기기 스크린샷 한 장으로 상태를 읽기 위한 것.
- 뷰포트 밖 영역은 iOS가 `theme-color`/배경색으로 칠한다. 색 맞추기는 임시방편이고, 근본은 위 min-height다.
- `body{overflow:hidden}`은 `html`이 `visible`일 때만 뷰포트로 전파된다. `html`에 `overflow-x:hidden`을 넣는 순간 iOS가 문서를 스크롤 가능으로 보고 고정 바 위에서 페이지가 밀린다. 가로 넘침은 컨테이너의 `min-width:0`과 `.sub-body{overflow-x:hidden}`로 막는다.
- `select`는 가장 긴 option 폭을 최소 폭으로 가진다. flex 안에서 `min-width:0; width:0; flex:1 1 0`을 주지 않으면 화면을 넘겨 옆으로 끌린다.

## 4. 버튼·칩·세그먼트

- 변수: `--btn-pad-y:.625em; --btn-pad-x:1em; --btn-min-h:44px; --btn-min-h-sm:36px; --btn-gap:8px`. `height` 대신 `min-height`, 글자는 flex 중앙.
- 짧은 라벨은 `white-space:nowrap`. 안 들어가면 순서대로 좌우 여백 .5em → 글자 `clamp(13px, 3.6vw, 15px)` → 2×2 grid → 더 짧은 라벨(「기기 설정」→「자동」은 사용자 확인 후 변경).
- 설명형 버튼(`.act-btn`)만 줄바꿈 허용 + `word-break:keep-all`, 제목 위·설명 아래 세로 배치.
- 같은 줄 버튼은 grid로 같은 너비·높이. 세그먼트의 한 칸만 2줄이 되면 그 칸만 높아진다.
- 원본의 덱 숫자 배지 규칙 `.ac-badge{padding:1px 0}`(≤600px)이 상태 배지(「Gist 연동」「동기화 켜짐」「1,012장」)에도 걸린다 → 시트·헤더 배지는 `.25em .7em`, nowrap, `flex:0 0 auto`.
- 필터 칩이 flex에서 찌그러져 글자 단위로 꺾이면 `flex:0 0 auto` + 가로 스크롤 행.
- 아이콘 전용 둥근 버튼(34px)에 글자를 넣으면 테두리에 닿는다 → `width:auto`, 알약 모양.
- 채점 버튼 4등분에서 간격 글자(「5분 30초 후」)가 칸보다 길면 375px에서는 버튼 간격 8→6px, 화면 좌우 16→12px로 폭을 번다.
- 터치 영역 44px: 보이는 크기는 34px로 두고 `::before{inset:-5px}`로 히트 영역만 키울 수 있다.
- 16px 미만 입력창은 iOS가 포커스 때 확대한다. 인라인 스타일이 많으면 `input,select,textarea{font-size:16px !important}`.

## 5. iOS 글자 세로 중앙 (optical centering)

- 증상: 시스템 글꼴로 한글 라벨이 박스 중앙보다 1~2pt 아래. select는 약 2pt.
- 대응: `@supports (-webkit-touch-callout: none)`(iOS WebKit 전용) 안에서 `--ios-nudge:1px`. **위 여백 −nudge, 아래 여백 +nudge**를 그룹별로 명시한다. 아래 여백만 `2px`로 **바꿔 쓰면** 위 여백이 컸던 버튼은 오히려 글자가 내려간다(실수했던 부분).
- `line-height`로 중앙을 잡는 칩은 `line-height: calc(H - 2n); padding-bottom: 2n`.
- min-height로 높이가 정해지는 버튼은 `padding-top:calc(6px - n); padding-bottom:calc(6px + n)`처럼 아무 대칭 쌍이나 쓰면 된다.

## 6. 카드 화면

- 원본은 카드 안을 윗칸 42 : 아랫칸 58로 고정 분할해 앞면이 위로 쏠린다. 폰에서는 두 칸을 `flex:0 0 auto`로 풀고 `#cSplit{min-height:100%; justify-content:center}`. 답 보기 전에는 답 영역을 `position:absolute; visibility:hidden`으로 빼서 자리를 차지하지 않게, 연 뒤에는 가림 면을 `display:none`.
- 가로 모드(높이 ≤500)는 작업 버튼 줄·진행 막대를 숨기고 답 글자를 줄여 카드 180px 안에 들어가게.
- 플러그인 카드가 아닌 앞면은 `lang="fr"`(하이픈·음성·글꼴 폴백). 뒷면 `[sound:…]`는 텍스트 노드에서 지운다.

## 7. 탭 막대와 설정 페이지

- 원본 탭 막대는 홈 화면 안에 있어 다른 화면에서 사라진다 → JS로 `#main`으로 옮기면 핸들러 그대로 유지되고 CSS로 모든 화면에 보인다. 활성 탭은 `go()`를 감싸서 맞춘다. 풀이 화면에서는 숨김.
- 설정은 원본의 데스크톱용 `page` 모드를 폰에서 켠다(`#ovlSettings.page`). 탭 막대가 위에 오도록 `body:has(#ovlSettings.show.page) #tabBar{z-index:61}`, 그 위에 다른 모달이 열리면 다시 20.

## 8. 참고 링크

- frappe-ui PR #1284 (iOS 26 설치형 PWA 하단 띠, WebKit 301108, `min(100lvh, 100% + env(top))` 처방): https://github.com/frappe/frappe-ui/pull/1284
- ander-gym PR #68 (런타임 `screen.height − innerHeight` 측정): https://github.com/anderboski/ander-gym/pull/68
- openchamber #2287 (`height:100%` 루트가 짧은 뷰포트에 묶이는 사례): https://github.com/openchamber/openchamber/issues/2287
- qui #2520 (iOS 26.1 black-translucent 상태바 그라데이션, WebKit 316008/301994): https://github.com/autobrr/qui/issues/2520
