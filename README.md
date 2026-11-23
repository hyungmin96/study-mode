# study-mode

CS 면접 대비 학습 도구. 질문 하나를 haiku·codex·agy 3개 소스에서 수집하고 Sonnet 5.5가 검수·요약해 주제별 화면으로 정리한다. 같은 주제에 후속 질문을 하면 새 라운드가 이어 붙는다.

## 앱 (Electron)

`app/` 에 데스크톱 앱이 있다. 첫 화면 입력란에 질문하면 주제가 생성되고(백그라운드 수집, 소스별 진행 표시), 왼쪽 사이드바에 주제가 쌓인다. 우클릭으로 폴더 생성·이름 변경·이동·삭제, 드래그로 이동, 오른쪽에 깊이별 목차가 있다. 앱은 아래 `study.py` 를 그대로 호출한다.

```
cd app
npm install
npm run dev        # 개발 실행 (study.py·data 는 app/ 의 상위 폴더)
npm run dist       # dist/mac-arm64/Study Mode.app 생성 (서명 없음)
```

- 패키징한 앱은 첫 실행 때 `study.py` 가 있는 폴더를 묻고 `~/Library/Application Support/` 아래 settings.json 에 저장한다. 환경변수 `STUDY_HOME` 이 있으면 그것을 우선한다.
- 서명하지 않은 앱이라 처음 열 때 우클릭 → 열기가 필요할 수 있다.
- 데이터는 `data/` 평문 파일이며 `index.json` 은 `{folders, topics}` 구조다(원본은 `data/index.json.bak`).
- 설계·진행 기록: `docs/design-electron.md`

아래는 `study.py` CLI 상세다. 슬래시 스킬(`/study-mode`)은 제거되어 직접 `python3 study.py run <질문>` 으로 호출한다.

---

## 1. 전체 흐름

```
질문
 │
 ├─ prepare ── key 발급(새 주제) 또는 기존 key 확인, data/<key>/rounds/NN/ 생성
 │
 ├─ 수집기 3개를 백그라운드 하위 프로세스로 실행 (기본, 화면·포커스 변화 없음, 로그는 rounds/NN/<src>.log)
 │  (--panes: herdr 탭 1개 + pane 4개로 표시, 포커스는 옮기지 않음)
 │    ├─ pane 1: haiku   (claude-haiku-5-5)   ─┐   (실패 시 agy Sonnet 예비)
 │    ├─ pane 2: codex   (exec, read-only)     ├─ 병렬 수집 → <src>.md / <src>.done
 │    ├─ pane 3: agy     (claude-sonnet-4-6)  ─┘   (실패 시 Haiku 예비)
 │    └─ pane 4: finish  ── 최대 120초 대기 → 끝난 소스의 원문을 그대로 Opus에 전달
 │
 ├─ render (claude-opus-5-5, 별도 요약 단계 없음)
 │    ├─ 원문 3개를 직접 요약하고 출처 간 모순·오류를 걸러냄
 │    ├─ 기존 섹션 "제목만" 읽고 중복 회피
 │    ├─ 3~5개 chunk로 그룹핑, 틀린 내용 교정·빠진 내용 보완 (교정 흔적은 남기지 않음)
 │    ├─ 표 → <visual>{JSON}</visual>      → svg_table() 이 SVG로 그림
 │    └─ 그림 → <diagram kind=..>Mermaid</diagram> → 문법 검사 후 <pre class="mermaid">
 │
 └─ html/<key>_<주제>.html 에 라운드 추가 → 브라우저로 열기
```

수집 원문은 모델 간에 공유되지 않는다. Opus는 수집 원문과 **기존 섹션 제목 목록**만 받는다. HTML 전체를 다시 읽지 않으므로 라운드가 늘어나도 Opus 입력이 커지지 않는다.

---

## 2. 요구 사항

| 도구 | 용도 | 비고 |
|---|---|---|
| Python 3 | `study.py` | 표준 라이브러리만 사용 |
| herdr (선택) | `--panes`일 때 탭·pane 생성과 명령 실행 | `tab create`, `pane split`, `pane run`, `pane rename`, `pane close` |
| codex CLI | 수집 2 | `codex exec -s read-only --skip-git-repo-check --ephemeral` |
| agy (Antigravity CLI) | 수집 3 | `agy -p ... --mode plan --model claude-sonnet-4-6` |
| claude CLI | 수집 1(Haiku), Mermaid 문법 수정(Sonnet), Opus 정리 | `claude -p`를 도구 없이 호출 |
| `vendor/mermaid.min.js` | 다이어그램 렌더링 | Mermaid 11.17.2, 로컬 파일이라 오프라인 동작 |
| `mmdc` | 다이어그램 실제 렌더링 검사 | `npm i -g @mermaid-js/mermaid-cli`. 없으면 머리말 검사만 한다 |

---

## 3. 사용법

```bash
python3 study.py run "<질문>"                 # 새 주제
python3 study.py run "<key> <후속 질문>"       # 기존 주제에 이어서
python3 study.py list                         # 저장된 주제와 key 목록
python3 study.py rebuild [key]                # 저장된 chunk로 HTML만 재생성 (모델 호출 없음)
```

스킬로 쓸 때는 `/study-mode <인자>`가 위 `run`을 그대로 호출한다. 스킬 정의는 `SKILL.md`에 있다.

### 옵션

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--panes` | 꺼짐 | 수집 과정을 herdr pane 4개로 보여 준다. 탭은 `--no-focus`로 만들고 포커스를 옮기지 않는다. 기본은 pane 없이 백그라운드로 수집한다 |
| `--keep` | 꺼짐 | `--panes`일 때 끝난 뒤 pane을 닫지 않고 남긴다 (디버깅용) |
| `--reuse <key>` | 없음 | 그 주제의 수집 결과를 재사용하고 수집을 건너뛴다. 프롬프트나 템플릿을 바꾼 뒤 Opus 정리만 다시 해 볼 때 쓴다 |

### key 규칙

- 영문 소문자 + 숫자 6자리, 숫자와 문자가 최소 1개씩 들어간다.
- `run` 인자의 첫 단어가 저장된 key면 후속 질문, 아니면 인자 전체가 새 주제의 첫 질문이다.

### 실행 결과

마지막 줄에 JSON 한 줄을 출력한다.

```json
{"key": "4q0h6w", "round": 2, "html": ".../html/4q0h6w_자바-JVM-핵심-정리.html",
 "sections": ["..."], "dropped": "", "backup_src": "", "metrics": {...}}
```

- `dropped`: 120초 안에 끝나지 않았거나 실패해서 정리에서 빠진 소스
- `backup_src`: 예비 단계가 쓰인 수집기와 그 단계 (예: `agy→claude-haiku-5-5`)

---

## 4. 수집

### 4.1 수집기

| 소스 | 명령 | 실측 시간 |
|---|---|---|
| haiku | `claude -p --model claude-haiku-5-5 --tools "" --setting-sources "" ...` | 4~14초 |
| codex | `codex exec -s read-only --skip-git-repo-check --ephemeral -o <file>` | 15~23초 |
| agy | `agy -p <prompt> --mode plan --model claude-sonnet-4-6` | 14~50초 |

수집 프롬프트(`collect_prompt`)는 세 부분으로 이뤄진다.

- **가드 (`GUARD_TEXT`)**: 파일 읽기·수정과 명령 실행 금지, 한국어로 답하기, 한자·일본어 금지, **영어 기술 용어(ARP, NAT, DHCP 등)는 풀어 쓰지 말고 그대로 쓰기**.
- **목적 (`INTERVIEW`)**: CS 기술 면접 대비 자료라는 점과 답의 순서(정의 → 원리 → 비교·트레이드오프 → 꼬리 질문 → 오해 → 실무 예시). Opus 정리 프롬프트에도 같은 문구가 들어간다.
- **요청**: 핵심 개념, 동작 원리, 비교·트레이드오프, 예상 꼬리 질문과 답의 요지, 흔한 오해, **실무에서 겪는 문제와 해결**, 실무 예시. 700~1000자. 되묻거나 계획을 세우지 말고 신입~주니어 기준으로 바로 본문만 쓴다.

Haiku는 도구를 아예 끄고 시스템 프롬프트(`HAIKU_SYSTEM`)만으로 지식 기반 답을 쓴다.

### 4.2 예비 단계

haiku와 agy는 서로를 예비로 쓴다. agy는 한도 그룹이 둘로 나뉘고(`Gemini Models`, `Claude and GPT models`) 소진된 뒤 호출하면 오래 기다리므로, 호출 전에 잔여량을 먼저 확인한다.

```
haiku 수집기                              agy 수집기
  1) Haiku                                  1) agy /usage 로 Claude·GPT 잔여 확인 (토큰 소모 없음, 약 5초)
  2) 실패 → agy 잔여 확인 → agy Sonnet       2) 15% 이상이면 agy Sonnet 수집
  3) 둘 다 실패 → 소스 제외                  3) 실패·부족·되묻기 응답 → Haiku 예비
                                            4) 둘 다 실패 → 소스 제외
```

- agy plan 모드가 본문을 자기 작업 폴더(`~/.gemini/antigravity-cli/brain/…`)의 `.md` 파일에 쓰고 링크만 돌려주면 그 파일을 읽어 본문으로 쓴다 (`_agy_text`).
- 본문 대신 짧은 계획·확인 요청("진행해 주세요", "기본값으로…")이나 파일 안내만 남으면 실패로 본다 (`_not_answer`).
- 쓰인 단계는 `rounds/NN/<src>.src`에 남는다.
- 제한 시간 합계(확인 15 + agy 60 + Haiku 40 = 115초)는 `WAIT_LIMIT` 120초 안에 들어오도록 맞췄다.

### 4.3 제외한 선택지

| 후보 | 제외 이유 |
|---|---|
| agy 기본 모델 (Gemini Flash) | 수집에 60~300초가 걸려 대기 한도를 넘는다 |
| agy `gpt-oss-120b` | plan 모드에서 답 대신 계획서 파일을 쓴다 |
| ollama `qwen3.5:9b` | 2026-11-21 제외. 사실 오류("DHCP가 고정 IP 배정", "폐쇄망은 해킹에서 자유롭다" 등)가 잦고, 요약에서는 한자 잡음과 오류 전파가 있었다. Haiku로 교체 |

---

## 5. 요약

별도 요약 단계는 없다. `finish` 단계는 수집을 최대 `WAIT_LIMIT`(120초) 기다리고, 그때까지 끝난 소스의 원문을 그대로 Opus에 넘긴다. Opus가 요약·교정·정리를 한 번에 한다 (`summary.src` = `opus(원문 직접)`).

예전에는 로컬 qwen이 먼저 요약했지만 같은 원문으로 비교한 결과 qwen 요약은 한자 잡음, 틀린 원리 설명, 수집 단계 오류의 전파가 있었다. Opus가 원문을 직접 보면 출처 간 모순을 대조해 걸러 낸다. 비용은 늘지만 품질을 우선했다.

---

## 6. 정리와 HTML (Opus)

### 6.1 chunk 구조

인지과학의 chunking 원리(작업기억은 한 번에 약 4개 덩어리를 다룬다)에 따라 답변을 3~5개 chunk로 묶는다. chunk마다 HTML 구조가 고정이다.

```html
<section class="chunk" data-title="chunk 제목(15자 이내)">
  <h2>이모지 + 제목</h2>
  <p class="gist">한 문장 핵심</p>
  <ul><li>핵심 포인트 (최대 4개)</li></ul>
  <p class="hook">기억 고리: 비유나 연상 한 줄</p>
</section>
```

- 요약의 오류는 바로잡고 빠진 핵심은 보완하되, **본문에 교정·보완 표시를 남기지 않는다.** 처음부터 올바른 내용처럼 쓴다.
- Opus 출력에서 `script/iframe/object/embed`와 `on*=` 속성은 제거한다. Mermaid 코드는 이 정리에 망가지지 않게 잠시 빼 두었다가 되돌린다.

### 6.2 시각화

원칙은 **"그림은 모델이 그리지 않는다"**이다. 모델은 짧은 텍스트 명세만 내고 렌더링은 코드와 브라우저가 한다. 이미지 생성 모델은 구조를 지어내고 검증할 텍스트 원본이 남지 않아서 쓰지 않는다.

규칙 원본은 `SKILL.md`의 `<!-- VISUAL-RULES:BEGIN -->` ~ `<!-- VISUAL-RULES:END -->` 구간이다. `render()`가 이 구간만 잘라 Opus 프롬프트에 넣는다. 규칙을 바꾸려면 이 구간만 고치면 된다.

| 내용 | 형식 | 태그 |
|---|---|---|
| 대상 2개+ × 기준 2개+ 비교 | SVG 표 | `<visual>{json}</visual>` |
| 시간 순서의 주고받기 (TLS 핸드셰이크) | Mermaid `sequenceDiagram` | `<diagram kind="sequence">` |
| 상태 전이 (프로세스·TCP 상태) | Mermaid `stateDiagram-v2` | `<diagram kind="state">` |
| 처리 단계·분기 (GC 판정) | Mermaid `flowchart` | `<diagram kind="flow">` |
| 구성 요소의 포함·배치 (JVM 메모리) | Mermaid `flowchart` + `subgraph` | `<diagram kind="structure">` |
| 자료구조 (트리, 해시 버킷) | Mermaid `flowchart TD` | `<diagram kind="ds">` |

규칙 요약:

- **개수 제한 없음.** 필요한 만큼 쓰되 그림 하나에 개념 하나.
- **요소 설명 필수.** 그림에 나오는 모든 노드·참여자·상태와 생소한 화살표 동사를 그림 바로 아래 `<ul class="legend">`에서 "무엇이고 어떤 역할인지" 한 줄씩 설명한다. Eden이 무엇인지 모르면 JVM 힙 그림을 읽을 수 없기 때문이다. `<strong>` 안의 이름은 그림 속 라벨과 똑같이, 노드 하나에 항목 하나로 쓴다 (클릭 메모의 짝짓기 기준).
- 노드 12개 이하, 노드 라벨 12자 이하, 화살표마다 동사 라벨.
- flowchart는 기본 `TD`. 한 줄 노드 4개 이하이고 subgraph가 없을 때만 `LR`.
- 모든 노드는 화살표로 연결한다. "없음·비어 있음"은 노드로 그리지 않는다.
- 그림 아래 순서: 요소 설명 목록 → 자기설명 질문(`<p class="ask">`).

#### 표 (`<visual>`)

```html
<visual>{"title":"웹서버 vs WAS","corner":"구분","cols":["웹서버","WAS"],
         "rows":[["처리 대상","정적 파일","동적 요청"],["예시","Nginx","Tomcat"]]}</visual>
```

- `svg_table()`이 글자 폭을 계산해 줄바꿈하고 SVG로 그린다. 색은 template의 CSS 변수(`--vhd`, `--vlab`, `--vz`, `--vln`)라 다크/라이트 테마를 따른다.
- `cols`에 기준 열 제목까지 넣은 경우(행 길이 == cols 길이)도 받아 준다.
- JSON이 깨진 명세는 버리고 `metrics.visuals_bad`에 센다.
- 실측: JSON 명세는 약 168토큰, 같은 표를 SVG로 직접 쓰면 약 1587토큰. 로컬 qwen은 SVG와 JSON 모두 깨뜨려서 시각화는 Opus가 맡는다.

#### 다이어그램 (`<diagram>`)

```html
<diagram kind="structure" title="JVM 메모리">
flowchart LR
  subgraph heap["Heap (공유)"]
    eden["Eden"] -->|생존 복사| s0["Survivor"] -->|승격| old["Old"]
  end
  t1["스레드 Stack"] -->|객체 접근| heap
</diagram>
```

처리 순서 (`inject_diagrams`):

1. 코드펜스 제거, `kind` 확인
2. 첫 줄 머리말이 `sequenceDiagram / stateDiagram / flowchart / graph` 중 하나인지 검사
3. `mmdc`가 있으면 `rounds/NN/diagrams/dN.mmd`를 실제로 렌더링해 검사
4. 실패하면 `claude-sonnet-5-5`가 **문법만** 1회 수정하고 다시 검사
5. 그래도 실패하면 버린다
6. flowchart에서 화살표와 연결되지 않은 노드를 찾아 지운다 (`_orphans`, `_drop_nodes`). 본문에 없는 관계를 지어낼 수 있어서 모델로 고치지 않는다. 지운 수는 `diagram_orphans`
7. 그림 바로 뒤에 `<ul class="legend">`가 없으면 `diagrams_no_legend`에 센다 (그림은 유지)
8. 통과하면 `<figure class="viz diagram"><pre class="mermaid">`로 넣는다

브라우저에서는 `template.html`이 `../vendor/mermaid.min.js`로 그린다. `securityLevel:'strict'`이고, 다크 모드면 `dark`, 아니면 `neutral` 테마다. 스크립트를 못 읽으면 Mermaid 코드가 글자로 남는다.

표시 방식 (`template.html`):

- flowchart·상태도는 `useMaxWidth:false`로 원래 크기로 그린다. 폭에 맞춰 줄이면 글자가 10px 수준까지 작아졌기 때문이다.
- 그림이 본문보다 넓으면 70% 이상으로 줄여서 맞을 때만 줄이고, 더 넓으면 원래 크기로 두고 가로 스크롤과 "← 옆으로 밀어서 보기 →" 안내를 붙인다.
- 화살표 라벨은 테두리 있는 상자(안쪽 여백 4px 10px)에 12px 글자로 그린다. 노드 글자보다 살짝 작다. 배경은 카드 색에 맞춰 다크 테마에서 회색 덩어리로 보이지 않게 했다.
- 라벨 없는 화살표에 생기는 빈 상자는 렌더링 후 숨긴다.

클릭 메모 (`tips()`):

- 그림이 그려진 뒤, 그림 바로 다음의 `ul.legend` 항목을 읽어 이름 → 설명 표를 만든다. 모델 호출은 없다.
- 그림 속 노드, subgraph 제목, 화살표 라벨, 시퀀스 참여자·메시지 글자를 이름과 짝지어 누를 수 있게 한다. 마우스를 올리면 밝아지고, 누르면 그 아래(공간이 없으면 위)에 메모가 뜬다. 다른 곳 클릭, `×`, Esc로 닫힌다. 키보드(Tab → Enter)로도 열린다.
- 짝짓기: 라벨과 이름이 같으면 우선, 라벨이 이름을 포함하면 이름이 라벨 글자의 40% 이상일 때만 ("SYN 연결 요청" → SYN은 짝, "유효하면 응답" → 응답은 짝 아님). 여럿이 맞으면 가장 긴 이름을 쓴다. "Survivor 0 / 1", "A와 B", "A·B" 같은 이름은 나눠서 별칭으로도 찾는다.
- 짝지은 단어가 하나라도 있으면 그림 오른쪽 아래에 "그림 속 단어를 누르면 설명이 나와요"를 붙이고, 목록은 `설명 전체 보기 (N)`로 접는다. 스크립트가 안 돌거나 짝이 하나도 없으면 목록이 그대로 보인다.
- 요소 설명 목록이 없는 예전 결과는 그림만 보인다 (오류 없음).

> 렌더링 성공은 문법 통과일 뿐 내용이 맞다는 뜻이 아니다. 노드·간선과 본문의 일치는 Opus 정리 단계의 책임이다.

다이어그램 지원 이전 템플릿으로 만든 HTML에 처음 그림이 들어가면 `rebuild(key)`로 현재 템플릿에 맞춰 다시 만든다.

### 6.3 HTML 템플릿 (`template.html`)

- 파일 하나로 완결 (Mermaid만 `vendor/` 참조)
- 라이트/다크 테마 자동 (`prefers-color-scheme`)
- 왼쪽 고정 사이드바: 질문(라운드)별 접이식 메뉴와 chunk 링크, 스크롤 위치에 따라 현재 항목 강조, 마지막 라운드는 펼친 상태
- 820px 이하에서는 사이드바가 서랍으로 바뀌고 오른쪽 아래 `☰ 목차` 버튼으로 연다
- 질문(Q1, Q2…) 제목은 1.5rem 크기에 배경 띠와 왼쪽 굵은 선을 둬서 라운드 경계가 바로 보인다
- 사이드바 상단에 후속 질문 명령(`/study-mode <key> <질문>`)을 보여 준다

---

## 7. 데이터 구조

```
study-mode/
├── study.py              # 오케스트레이터 (수집·요약·정리·HTML)
├── template.html         # HTML 틀
├── SKILL.md              # 스킬 정의 + 시각화 규칙 원본 (VISUAL-RULES 구간)
├── vendor/mermaid.min.js # Mermaid 11.17.2
├── spike/                # 다이어그램 시험용 (정식 파이프라인과 무관, 아래 9절)
├── data/
│   ├── index.json        # key → {topic, html, rounds, sections}
│   └── <key>/rounds/NN/
│       ├── question.txt, prompt.txt, new.flag
│       ├── haiku.md / codex.md / agy.md (+ .done, .src)
│       ├── summary.md, summary.src
│       ├── chunks.html   # 이 라운드의 Opus 결과 (rebuild 원본)
│       ├── diagrams/     # mmdc 검사용 .mmd/.svg (mmdc가 있을 때만)
│       ├── metrics.json, dropped.txt, finish.done
└── html/<key>_<주제>.html
```

### metrics.json

| 필드 | 의미 |
|---|---|
| Opus 토큰·비용·시간 | `claude -p --output-format json`의 usage |
| `visuals_ok` / `visuals_bad` | 표 명세 성공·실패 수 |
| `diagrams_ok` / `diagrams_bad` / `diagrams_fixed` | 다이어그램 통과·버림·수정 후 통과 수 |
| `diagram_orphans` | 지운 연결 없는 노드 수 |
| `diagrams_no_legend` | 요소 설명 목록이 빠진 그림 수 |
| `diagram_check` | `mmdc` 또는 `head-only` |

---

## 8. 설정 상수 (`study.py` 상단)

| 상수 | 값 | 설명 |
|---|---|---|
| `SOURCES` | `haiku`, `codex`, `agy` | 수집기 3개 |
| `SUMMARY_MODEL` | `claude-sonnet-5-5` | Mermaid 문법 수정 (`DIAG_FIX_MODEL`) |
| `CHUNK_MODEL` | `claude-opus-5-5` | chunk 정리 + HTML |
| `COLLECT_TIMEOUT` | 300 | 수집 1건 제한(초) |
| `WAIT_LIMIT` | 120 | 정리 단계가 수집을 기다리는 최대 시간 |
| `HAIKU_MODEL` / `HAIKU_TIMEOUT` | `claude-haiku-5-5` / 40 | Haiku 수집 |
| `AGY_CLAUDE_MODEL` / `AGY_TIMEOUT` | `claude-sonnet-4-6` / 60 | agy 수집 |
| `AGY_USAGE_TIMEOUT` | 15 | `/usage` 확인 제한 |
| `AGY_MIN_REMAINING` | 0.15 | 이 비율 미만이면 agy 건너뜀 |
| `CLAUDE_TIMEOUT` | 420 | Opus 호출 제한 |
| `DIAG_FIX_MODEL` / `DIAG_FIX_TIMEOUT` | Sonnet / 90 | Mermaid 문법 수정 |
| `MMDC_TIMEOUT` | 60 | mmdc 검사 1건 제한 |

---

## 9. spike/ (시험용)

`spike/diagram_spike.py`는 Mermaid 도입 전에 만든 손 배치 SVG 렌더러 시험이다. 중첩 패널(Heap > Young(Eden, S0, S1) / Old, Metaspace, 스레드별 Stack·PC·Native), 3D 큐브 아이콘, 라벨 붙은 곡선 화살표를 다크 테마로 그린다. 결과는 `spike/jvm_spike.html`.

영역 간격과 화살표 위치를 손으로 정했기 때문에 자동 생성에는 그대로 쓸 수 없다. 정식 파이프라인은 Mermaid를 쓰고, 이 폴더는 참고용으로 남겨 두었다.

---

## 10. 알려진 한계

- codex는 한도 사전 확인과 예비 수집기가 없다.
- agy 한도가 실제로 바닥났을 때의 오류 형태는 확인하지 못했다. 잔여량 사전 확인으로 피해 간다.
- agy Claude 호출 1회의 한도 소모는 대략 3%p로 추정했고 정밀하게 재지 않았다.
- `mmdc`가 없으면 다이어그램은 머리말만 검사한다. 문법 오류는 브라우저에서 `suppressErrors`로 숨겨진다.
- Haiku 수집은 Claude 사용량을 쓴다. 로컬 모델을 뺀 대신 질문당 비용이 늘었다.
