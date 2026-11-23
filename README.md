# study-mode

CS 면접 대비 학습 도구. 질문 하나를 codex `gpt-6-luna` 단일 모델로 수집·정리해 주제별 화면으로 보여준다. 같은 주제에 꼬리질문을 하면 Q2, Q3… 로 이어 붙는다. Electron 데스크톱 앱(`app/`)과 파이프라인(`study.py`)으로 구성된다.

## 주요 기능

- **병렬 독립 질문**: 시작 화면·새 채팅에서 연속으로 던진 질문은 각각 독립 주제로 동시에 수집한다. 진행 카드는 현재 단계(수집 중 → 정리 중 → ✓완료)만 보여주고, 카드에 마우스를 올리면 나타나는 ✕로 취소할 수 있다. 완료된 카드를 누르면 답변이 열리고, ← 버튼으로 시작 화면에 돌아온다(카드는 최대 10개, 나머지는 사이드바 이력).
- **꼬리질문**: 열린 주제의 하단 입력란이 꼬리질문이다. 답변 끝에 "알아두면 좋은 질문" 3개가 링크로 나오고, 누르면 그 질문으로 이어서 수집한다.
- **질문 범위 제한**: 개념 질문은 정의·특징·종류만, 방법 질문은 단계와 이유만 답한다. 표·그림은 질문에 요청 단어("표로", "그림으로" 등)가 있을 때만 만든다. "표/그림으로 나타내줘" 후속 요청은 새 라운드 없이 직전 답변 아래에 덧붙는다.
- **토큰 표시**: 답변 하단에 수집·정리 단계별 토큰과 합계를 보여준다(캐시된 입력은 제외).
- **사이드바·목차**: 주제·폴더 관리(우클릭 메뉴, 드래그 이동, 삭제 모드), 접기 버튼, 오른쪽 깊이별 목차. 소제목에는 이모지가 붙는다.

## 앱 실행

```bash
cd app
npm install
npm run dev        # 개발 실행 (study.py·data 는 app/ 의 상위 폴더)
npm run dist       # dist/mac-arm64/Study Mode.app 생성 (서명 없음)
codesign --force --deep -s - "dist/mac-arm64/Study Mode.app"   # 빌드 후 ad-hoc 재서명 필수
```

- 패키징한 앱은 첫 실행 때 `study.py` 가 있는 폴더를 묻고 `~/Library/Application Support/` 의 settings.json 에 저장한다. 환경변수 `STUDY_HOME` 이 있으면 우선한다.
- 서명하지 않은 앱이라 처음 열 때 우클릭 → 열기가 필요할 수 있다.
- 구성: electron-vite + React + TypeScript. 메인 프로세스(`src/main`)가 `study.py` 를 하위 프로세스로 실행하고(`jobs.ts`), 렌더러는 IPC(`window.study`)로 주제·진행 상태를 받는다.
- 데이터는 `data/` 평문 파일이며 `index.json` 은 `{folders, topics}` 구조다. 주제 삭제는 휴지통으로 이동한다.

## 파이프라인 (`study.py`)

```
질문
 ├─ prepare  key 발급(새 주제) 또는 기존 key 확인, data/<key>/rounds/NN/ 생성
 ├─ collect  codex exec -m gpt-6-luna 1회 (빈 작업 폴더, 웹검색·플러그인·툴 off)
 │            출력: TITLE → "## 이모지 소제목" 섹션들 → NEXT(관련 질문 3개)  → codex.md
 └─ render
      ├─ 일반 질문: 모델 호출 없이 md_to_chunks 로 HTML 변환 (fast path)
      └─ 표·그림 요청 / merge: 모델이 <visual>(표→SVG)·<diagram>(Mermaid) 포함 chunk 생성
```

- codex 는 전용 `CODEX_HOME`(`$TMPDIR/study-codex-home`, 인증만 심볼릭 링크)으로 실행해 고정 입력을 줄였다(약 15.9k → 8.7k 토큰).
- `split_meta` 가 TITLE·NEXT 를 파싱해 `title.txt`, `suggest.json` 에 저장하고, 단계별 토큰은 `tokens.json` 에 쌓인다.
- 다이어그램은 `vendor/mermaid.min.js`(오프라인)로 렌더링하고, `mmdc` 가 있으면 문법을 실제 렌더링으로 검사한다.

### CLI

```bash
python3 study.py run "<질문>"               # 새 주제
python3 study.py run "<key> <후속 질문>"     # 기존 주제에 이어서
python3 study.py list                       # 저장된 주제와 key 목록
python3 study.py rebuild [key]              # 저장된 chunk 로 HTML 재생성 (모델 호출 없음)
```

| 옵션 | 설명 |
|---|---|
| `--new` | 첫 단어가 기존 key 와 같아도 새 주제로 만든다 (앱의 새 채팅) |
| `--no-html` | 통합 HTML(`html/`) 생성 생략 (앱이 사용) |
| `--no-open` | 완료 후 브라우저를 열지 않는다 |
| `--keep` | 중간 산출물을 지우지 않는다 |

### 요구 사항

| 도구 | 용도 |
|---|---|
| Python 3 | `study.py` (표준 라이브러리만) |
| codex CLI | 수집·정리 (`gpt-6-luna`) |
| Node.js | 앱 빌드·실행 |
| `mmdc` (선택) | Mermaid 문법 검사 (`npm i -g @mermaid-js/mermaid-cli`) |

## 저장소 구조

```
study.py         수집·정리 파이프라인
SKILL.md         VISUAL-RULES(표·그림 규칙). study.py 가 읽으므로 삭제 금지
template.html    통합 HTML 템플릿
vendor/          mermaid.min.js
app/             Electron 앱
data/, html/     질문별 생성 파일 (git 제외)
```
