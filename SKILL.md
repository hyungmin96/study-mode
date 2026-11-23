# study-mode 시각화 규칙

> CLI 스킬(`/study-mode`)은 Electron 앱(`app/`)으로 대체되어 제거했다. 이 파일은 `study.py render()`가 아래 VISUAL-RULES 구간을 정리 모델 프롬프트에 주입하는 규칙 원본이므로 삭제하지 않는다.

<!-- VISUAL-RULES:BEGIN (study.py render()가 이 구간을 정리 모델 프롬프트에 주입) -->
## 시각화 규칙
원칙: 그림은 모델이 그리지 않는다. 짧은 텍스트 명세만 내고, 렌더링은 코드·브라우저가 한다.
- 이미지 생성 모델은 쓰지 않는다. 구조를 지어내고, 검증할 텍스트 원본이 남지 않는다.
- 검증·보완을 마친 내용만 그린다. 본문 bullet에 없는 노드·관계는 그리지 않는다.
- 그림만으로 더 빨리 이해되는 내용에만 쓴다. 장식용 그림 금지.

내용 유형 → 형식
| 내용 | 형식 | 태그 |
|---|---|---|
| 대상 2개+ × 기준 2개+ 비교 | 표 | `<visual>{json}</visual>` (기존 규칙 유지) |
| 시간 순서의 주고받기 (TCP·TLS 핸드셰이크, 요청 흐름) | Mermaid `sequenceDiagram` | `<diagram kind="sequence">` |
| 상태 전이 (프로세스 상태, TCP 상태) | Mermaid `stateDiagram-v2` | `<diagram kind="state">` |
| 처리 단계·분기 (GC 판정, 빌드 파이프라인) | Mermaid `flowchart` | `<diagram kind="flow">` |
| 구성 요소의 포함·배치 (JVM 메모리, K8s 클러스터, 웹서버-WAS-DB) | Mermaid `flowchart` + `subgraph` | `<diagram kind="structure">` |
| 자료구조 (트리, 그래프, 해시 버킷) | Mermaid `flowchart TD` | `<diagram kind="ds">` |

개수
- 그림 개수 제한은 없다. 주제가 필요로 하는 만큼 쓰되, 그림 하나에는 개념 하나만 담는다.

그림 요소 설명 (필수)
- 그림에 나오는 모든 노드·참여자·상태는 그림 바로 아래에서 "무엇이고 어떤 역할인지"를 한 줄씩 설명한다. 이름만 보고는 모르는 사람도 그림을 읽을 수 있어야 한다 (예: Eden이 무엇인지 모르면 JVM 힙 그림을 이해할 수 없다).
- 생소한 화살표 동사(승격, 디스패치 등)도 같은 목록에서 설명한다.
- 형식: `<ul class="legend"><li><strong>Eden</strong>: 새 객체가 처음 할당되는 Young 영역의 공간</li>...</ul>`
- 본문 bullet에서 이미 설명했더라도 목록에서 짧게 다시 적는다.
- `<strong>` 안의 이름은 그림 속 라벨 글자와 똑같이 쓴다. 노드 하나에 항목 하나로, "Survivor 0 / 1"처럼 묶지 않는다. 화면에서는 그림 속 단어를 누르면 이 설명이 메모로 뜨고, 목록은 접혀 있다.
- 설명은 한 줄(40자 안팎)로 쓴다. 메모 상자에 들어간다.

그리기
- 노드 12개 이하, 노드 라벨 12자 이하. 화살표마다 동사 라벨(요청, 복사, 승격, 검증).
- flowchart 방향: 기본은 `TD`. 한 줄로 이어지는 노드가 4개 이하이고 subgraph가 없을 때만 `LR`. 가로로 길면 본문 폭을 넘어 잘리거나 글자가 작아진다.
- 모든 노드는 화살표로 최소 하나와 연결한다. 관계가 없는 노드는 그리지 않는다.
- "없음·비어 있음" 같은 값이나 상태는 노드로 그리지 않는다.
- 형식: `<diagram kind="flow" title="그림 제목">Mermaid 코드</diagram>` (title은 15자 이내, 생략 가능).
- `<diagram>` 안에는 Mermaid 코드만. 코드펜스·색·스타일·이모지 지정 금지(템플릿이 정한다).
- 노드 ID는 영문(`A`, `heap`), 표시 라벨은 한국어(`heap["Heap 영역"]`).

그림 아래 순서
1. 요소 설명 목록 `<ul class="legend">`
2. 자기설명 질문 한 줄: `<p class="ask">이 그림에서 ○○가 왜 △△인지 설명해 보세요</p>`
<!-- VISUAL-RULES:END -->

## 렌더링·검증 (study.py)
- `<diagram>`은 `<pre class="mermaid">`로 넣고, template.html이 로컬 `vendor/mermaid.min.js`로 브라우저에서 그린다(다크/라이트 테마 자동).
- 넣기 전 문법 검사: 첫 줄 머리말 확인 + `mmdc`가 있으면 실제 렌더링 검사. 실패하면 Sonnet이 문법만 1회 수정, 그래도 실패하면 버린다.
- 결과는 metrics.json의 `diagrams_ok/bad/fixed/check`(check=`mmdc`|`head-only`)에 남는다.
- 렌더링 성공은 문법 통과일 뿐 내용이 맞다는 뜻이 아니다. 노드·간선과 본문 대조는 정리 단계(Sonnet)의 책임.
