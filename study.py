#!/usr/bin/env python3
"""study-mode 오케스트레이터.

run      : key 해석 → herdr 탭/pane 4개 → 수집(codex gpt-6-luna) → 같은 모델이 원문을 직접 요약·정리 → HTML
collect  : (pane 내부용) 소스 하나 수집
finish   : (pane 내부용) 요약 → 정리
list     : 저장된 주제 key 목록
"""
import html, json, os, random, re, shutil, signal, string, subprocess, sys, time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
HTML = ROOT / "html"
INDEX = DATA / "index.json"
SELF = str(Path(__file__).resolve())
NO_OPEN = False   # --no-open: 완료 후 브라우저로 열지 않음 (앱용)
NEW_TOPIC = False  # --new: 첫 단어가 기존 key 와 같아도 새 주제로 만든다 (앱의 새 채팅)
NO_HTML = False   # --no-html: 통합 HTML(html/) 생성 생략 (앱용)

CODEX_MODEL = "gpt-6-luna"            # 2026-11-23 수집·요약·정리 모두 codex 단일 모델(luna)로 통일
SOURCES = ["codex"]                   # 수집기 1개 (haiku·agy는 제외)
SUMMARY_MODEL = "claude-sonnet-5-5"   # Mermaid 문법 수정용
CHUNK_MODEL = os.environ.get("STUDY_CHUNK_MODEL", "claude-sonnet-5-5")  # 2026-11-22 비용 절감으로 Opus→Sonnet. 환경변수로 교체 가능. chunk 그룹핑 + 보완 + HTML
COLLECT_TIMEOUT = 300
WAIT_LIMIT = 300                      # 정리 단계가 수집을 기다리는 최대 시간(초). 넘으면 끝난 소스만으로 진행
HAIKU_MODEL = "claude-haiku-5-5"      # 1번째 수집기: 가장 가볍고 빠른 Claude (실측 4~10초)
HAIKU_TIMEOUT = 120                   # 분량 제한 없는 답변도 끝나도록. WAIT_LIMIT 안에 예비 단계까지 (확인15+agy150+Haiku120=285초)
HAIKU_SYSTEM = ("당신은 CS 기술 면접 대비 자료 수집가다. 주어진 질문에 대해 면접관이 확인하려는 핵심 개념, 동작 원리, "
                "비교·트레이드오프, 예상 꼬리 질문, 흔한 오해, 실무 예시를 한국어로 정확하게 정리한다. "
                "모르는 것은 추측하지 말고 생략한다. 한자·일본어를 섞지 않는다.")
GUARD_TEXT = ("[규칙] 파일을 읽거나 수정하지 말고, 명령도 실행하지 마세요. "
              "아는 지식만으로 한국어로 답하세요. 한자·일본어를 섞지 마세요. "
              "영어 기술 용어(ARP, NAT, DHCP, TCP 등)는 풀어 쓰지 말고 그대로 쓰세요.\n")
# 모든 수집·요약·정리 단계에 공통으로 붙는 목적. 사용자는 CS 기술 면접을 준비한다.
INTERVIEW = ("[목적] CS 기술 면접 대비 자료다. 면접에서 말로 설명할 수 있어야 한다: "
             "한 문장 정의 → 동작 원리 → 비교·트레이드오프(왜 그렇게 하는가) → 예상 꼬리 질문과 답의 요지 → 흔한 오해 → 실무 예시.\n")


def collect_prompt(question, ctx=""):
    head = GUARD_TEXT + ctx + f"질문: {question}\n"
    if wants_visual(question):
        return (head + "질문은 표·이미지·정리를 요청하고 있습니다. 요청한 정리에 필요한 항목과 값을 빠짐없이, 정확하게 작성하세요"
                "(표의 행·열 항목, 그림의 구성 요소와 관계). 요청과 상관없는 새 주제나 부연 설명은 덧붙이지 마세요. "
                "그림·표 자체는 다음 단계가 만드니, 그 재료가 되는 내용을 소제목과 목록으로 정리하세요. "
                "되묻거나 계획·확인 요청을 하지 말고 바로 본문만 작성하세요.")
    return (head + "위 질문에 대한 답만 작성하세요. 질문이 묻지 않은 내용(면접 꼬리 질문, 흔한 오해, 실무 예시 등)은 덧붙이지 마세요. "
            "다만 질문 범위 안의 내용은 빠뜨리지 말고 깊이 있게 쓰세요. 다음 순서를 따르세요: "
            "(1) 이것이 왜 필요한지·어떤 문제를 해결하는지, (2) 핵심 용어 정의(처음 보는 사람도 알 수 있게), "
            "(3) 동작 과정을 단계별로 그리고 각 단계가 그렇게 동작하는 이유, (4) 관련된 상태·값·종류와 그 의미, "
            "(5) 대안·비슷한 것과의 차이, (6) 주의할 점과 한계. 질문에 직접 닿는 것은 모두 포함합니다. "
            "한두 문단으로 끝내지 말고 소제목과 목록으로 충분히 상세하게 설명하세요. "
            "되묻거나 계획·확인 요청을 하지 말고 바로 본문만 작성하세요.")

# Haiku 실패 시 예비: agy의 Claude·GPT 한도 그룹 (agy 기본 Gemini는 60~300초라 제외, gpt-oss는 plan 모드에서 계획서만 써서 제외)
AGY_CLAUDE_MODEL = "claude-sonnet-4-6"
AGY_TIMEOUT = 150
AGY_USAGE_TIMEOUT = 15                # /usage 확인 제한 (실측 약 5초)
AGY_MIN_REMAINING = 0.15              # Claude·GPT 그룹 잔여가 이 비율 미만이면 예비 단계를 건너뜀
CLAUDE_TIMEOUT = 900
SKILL = ROOT / "SKILL.md"             # 시각화 규칙 원본 (VISUAL-RULES 구간만 Opus 프롬프트에 주입)
DIAG_FIX_MODEL = SUMMARY_MODEL        # Mermaid 문법 수정 1회 (의미 판단이 아닌 기계적 수정이라 Sonnet)
DIAG_FIX_TIMEOUT = 90
MMDC_TIMEOUT = 60                     # mmdc 문법 검사 1건 제한 (Chromium 기동 포함)


def sources_for(rd):
    return list(SOURCES)

GUARD = GUARD_TEXT


# ---------- 공통 ----------
def _read_index_file():
    return json.loads(INDEX.read_text()) if INDEX.exists() else {}


def load_index():
    """주제 맵(key→meta). 앱이 폴더를 추가한 {folders, topics} 구조와 기존 평면 구조를 모두 읽는다."""
    raw = _read_index_file()
    return raw["topics"] if isinstance(raw.get("topics"), dict) and "folders" in raw else raw


LOCK = DATA / "index.lock"   # 앱(main)과 공유하는 index.json 쓰기 잠금(디렉터리 생성이 원자적)


class _IndexLock:
    def __enter__(self):
        DATA.mkdir(parents=True, exist_ok=True)
        end = time.time() + 10
        while True:
            try:
                LOCK.mkdir()
                return self
            except FileExistsError:
                try:  # 비정상 종료로 남은 잠금은 10초 지나면 회수
                    if time.time() - LOCK.stat().st_mtime > 10:
                        LOCK.rmdir()
                        continue
                except OSError:
                    pass
                if time.time() > end:
                    raise RuntimeError("index.json 잠금 대기 초과")
                time.sleep(0.05)

    def __exit__(self, *a):
        try:
            LOCK.rmdir()
        except OSError:
            pass


def save_index(idx, keys=None):
    """주제 맵을 저장한다. 잠금 안에서 파일을 다시 읽어 앱이 바꾼 folders·topic.folder 는 보존하고,
    파일에만 있는 주제도 유지한다(오래된 스냅샷이 앱의 변경을 덮어쓰지 않게)."""
    with _IndexLock():
        raw = _read_index_file()
        if "folders" in raw and isinstance(raw.get("topics"), dict):
            cur = raw["topics"]
            merged = {**cur}
            for k in (keys if keys is not None else idx):   # keys: 이번에 바꾼 주제만 쓴다 (병렬 실행이 서로의 변경을 덮지 않게)
                m = idx[k]
                merged[k] = {**m, "folder": cur[k].get("folder")} if k in cur and "folder" in cur[k] else m
            idx = {"folders": raw["folders"], "topics": merged}
        elif keys is not None and raw:
            idx = {**raw, **{k: idx[k] for k in keys}}
        tmp = INDEX.with_suffix(".tmp")
        tmp.write_text(json.dumps(idx, ensure_ascii=False, indent=2))
        tmp.replace(INDEX)


def new_key(idx):
    while True:
        k = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
        # 숫자·영문이 모두 있어야 일반 단어와 구분된다
        if re.search(r"\d", k) and re.search(r"[a-z]", k) and k not in idx:
            return k


def slugify(s):
    s = re.sub(r"[^\w가-힣]+", "-", s, flags=re.U).strip("-")
    return s[:40] or "topic"


def clean(text):
    text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)   # ANSI
    text = re.sub(r"[⠀-⣿]", "", text)          # 스피너
    return text.strip()


def run_cmd(cmd, timeout, stdin=None, cwd=None):
    try:
        # 입력이 없으면 빈 입력(DEVNULL)을 준다. 터미널 없이 실행하면 codex 등이 stdin을 기다리며 멈춘다
        kw = {"input": stdin} if stdin is not None else {"stdin": subprocess.DEVNULL}
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=str(cwd or ROOT), **kw)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout {timeout}s"
    except FileNotFoundError as e:
        return 127, "", str(e)


def claude(model, system, prompt, timeout=None):
    cmd = ["claude", "-p", "--model", model, "--tools", "", "--setting-sources", "",
           "--disable-slash-commands", "--no-session-persistence",
           "--strict-mcp-config", "--system-prompt", system]
    return run_cmd(cmd, timeout or CLAUDE_TIMEOUT, stdin=prompt)


# ---------- prepare ----------
def claude_json(model, system, prompt, timeout=None):
    """claude -p --output-format json 호출. 반환: (rc, 본문, stderr, 사용량 dict)."""
    cmd = ["claude", "-p", "--model", model, "--tools", "", "--setting-sources", "",
           "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config",
           "--output-format", "json", "--system-prompt", system]
    rc, out, se = run_cmd(cmd, timeout or CLAUDE_TIMEOUT, stdin=prompt)
    try:
        d = json.loads(out)
        u = d.get("usage", {}) or {}
        meta = {"input": u.get("input_tokens"), "cache_create": u.get("cache_creation_input_tokens"),
                "cache_read": u.get("cache_read_input_tokens"), "output": u.get("output_tokens"),
                "cost_usd": d.get("total_cost_usd"), "sec": round((d.get("duration_ms") or 0) / 1000, 1)}
        return rc, d.get("result", ""), se, meta
    except ValueError:
        return rc, out, se, {}


WANT_VISUAL = re.compile(r"표|이미지|그림|도식|도해|다이어그램|차트|그래프|시각|비교|정리|그려|도표")


def wants_visual(question):
    """질문이 표·이미지 등 시각 정리를 요청했는지 (요청 없는 질문에는 표·그림을 만들지 않는다)."""
    return bool(WANT_VISUAL.search(question))


def codex_json(system, prompt, timeout=None):
    """codex exec(CODEX_MODEL) 호출. 반환: (rc, 본문, stderr, 사용량 dict) — claude_json 과 같은 형태."""
    tmp = Path(f"{os.getpid()}-{random.randrange(10**6)}.codex.out")
    tmp = Path(os.environ.get("TMPDIR", "/tmp")) / tmp
    t0 = time.time()
    cmd = ["codex", "exec", "-m", CODEX_MODEL, "-s", "read-only", "--skip-git-repo-check", "--ephemeral",
           "-c", "model_reasoning_effort=high", "-c", "project_doc_max_bytes=0", "-o", str(tmp), "-"]
    # 단순 검색 호출: 프로젝트 파일이 없는 빈 폴더에서 실행해 질문 외 자료를 읽지 않게 한다
    empty = Path(os.environ.get("TMPDIR", "/tmp")) / "study-codex-empty"
    empty.mkdir(parents=True, exist_ok=True)
    rc, so, se = run_cmd(cmd, timeout or CLAUDE_TIMEOUT, stdin=f"{system}\n\n{prompt}", cwd=empty)
    try:
        text = tmp.read_text() if tmp.exists() else ""
    finally:
        tmp.unlink(missing_ok=True)
    return rc, text, se, {"model": CODEX_MODEL, "sec": round(time.time() - t0, 1)}


# ---------- 시각화: Opus는 JSON 명세만 내고, 그리기는 코드가 한다 (토큰 절약 + 레이아웃 안정) ----------
def _cw(ch):
    return 14.0 if ord(ch) >= 0x1100 else 7.6      # 14px 기준 글자 폭(한글·전각 / 영문)


def _wrap(text, max_px):
    lines, cur, w = [], "", 0.0
    for ch in str(text):
        c = _cw(ch)
        if w + c > max_px and cur:
            lines.append(cur)
            cur, w = "", 0.0
        cur += ch
        w += c
    if cur:
        lines.append(cur)
    return lines or [""]


def _x(t):
    return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def svg_table(spec):
    cols = [str(c) for c in spec["cols"]]
    corner = str(spec.get("corner", ""))
    longest = max(len(r) for r in spec["rows"])
    if len(cols) >= 2 and longest == len(cols):
        corner, cols = cols[0], cols[1:]      # 행 길이가 cols 와 같다 = cols 첫 항목이 라벨 열 제목
    n = len(cols)
    rows = [(([str(x) for x in r]) + [""] * (n + 1))[: n + 1] for r in spec["rows"]]
    W, LH, PAD, LAB = 760, 20, 12, 150
    cw = (W - LAB) / n
    def lines_of(t, w):
        return _wrap(t, w - 2 * PAD)
    hd_lines = [lines_of(c, cw) for c in cols]
    hh = max(len(x) for x in hd_lines) * LH + 2 * PAD
    out, y = [], hh
    out.append(f'<rect class="hd" x="0" y="0" width="{W}" height="{hh}"/>')
    if corner:
        cl = lines_of(corner, LAB)
        for k, l in enumerate(cl):
            out.append(f'<text class="hdt" x="{LAB / 2:.1f}" y="{(hh - len(cl) * LH) / 2 + 15 + k * LH:.1f}" text-anchor="middle">{_x(l)}</text>')
    for i, ls in enumerate(hd_lines):
        top = (hh - len(ls) * LH) / 2 + 15
        for k, l in enumerate(ls):
            out.append(f'<text class="hdt" x="{LAB + cw * (i + .5):.1f}" y="{top + k * LH:.1f}" text-anchor="middle">{_x(l)}</text>')
    for ri, r in enumerate(rows):
        cell_ls = [lines_of(r[0], LAB)] + [lines_of(r[j + 1], cw) for j in range(n)]
        rh = max(len(x) for x in cell_ls) * LH + 2 * PAD
        out.append(f'<rect class="lab" x="0" y="{y}" width="{LAB}" height="{rh}"/>')
        out.append(f'<rect class="c{ri % 2}" x="{LAB}" y="{y}" width="{W - LAB}" height="{rh}"/>')
        for j, ls in enumerate(cell_ls):
            cx = LAB / 2 if j == 0 else LAB + cw * (j - .5)
            top = y + (rh - len(ls) * LH) / 2 + 15
            for k, l in enumerate(ls):
                out.append(f'<text class="{"labt" if j == 0 else "ct"}" x="{cx:.1f}" y="{top + k * LH:.1f}" text-anchor="middle">{_x(l)}</text>')
        y += rh
        out.append(f'<line class="ln" x1="0" y1="{y}" x2="{W}" y2="{y}"/>')
    for j in range(n):
        x = LAB + cw * j
        out.append(f'<line class="ln" x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{y}"/>')
    out.append(f'<rect class="bd" x="0.5" y="0.5" width="{W - 1}" height="{y - 1}" rx="8"/>')
    return f'<svg viewBox="0 0 {W} {y}" xmlns="http://www.w3.org/2000/svg" role="img">{"".join(out)}</svg>'


def inject_visuals(body):
    """<visual>{json}</visual> 을 SVG figure 로 바꾼다. 깨진 명세는 버린다. 반환: (본문, 성공 수, 실패 수)."""
    cnt = {"ok": 0, "bad": 0}
    def sub(m):
        try:
            spec = json.loads(m.group(1).strip())
            assert spec["cols"] and spec["rows"]
            svg = svg_table(spec)
            title = str(spec.get("title", "")).strip()
            cnt["ok"] += 1
            return f'<figure class="viz">{"<figcaption>" + _x(title) + "</figcaption>" if title else ""}{svg}</figure>'
        except Exception:
            cnt["bad"] += 1
            return ""
    out = re.sub(r"<visual>(.*?)</visual>", sub, body, flags=re.S)
    out = re.sub(r"</?visual>", "", out)   # 닫힘이 없는 잔여 태그 제거
    return out, cnt["ok"], cnt["bad"]


def visual_rules():
    """SKILL.md 의 VISUAL-RULES 구간. 없거나 읽기 실패면 빈 문자열(기존 표 규칙만 적용)."""
    try:
        m = re.search(r"<!-- VISUAL-RULES:BEGIN.*?-->\n(.*?)<!-- VISUAL-RULES:END -->", SKILL.read_text(), re.S)
        return m.group(1).strip() if m else ""
    except OSError:
        return ""


DIAG_HEADS = ("sequenceDiagram", "stateDiagram", "flowchart", "graph")
DIAG_KINDS = ("sequence", "state", "flow", "structure", "ds")


def _strip_fence(code):
    code = re.sub(r"^\s*```[\w-]*\s*\n", "", code)
    return re.sub(r"\n\s*```\s*$", "", code).strip()


def _diag_error(code, kind, rd, n):
    """빈 문자열 = 통과. mmdc 가 없으면 머리말 검사만 한다."""
    if kind not in DIAG_KINDS:
        return f"알 수 없는 kind: {kind}"
    first = next((l.strip() for l in code.splitlines() if l.strip() and not l.strip().startswith("%%")), "")
    if not first.startswith(DIAG_HEADS):
        return f"첫 줄이 {'/'.join(DIAG_HEADS)} 중 하나로 시작해야 한다: {first[:40]}"
    exe = shutil.which("mmdc")
    if not exe:
        return ""
    d = Path(rd) / "diagrams"
    d.mkdir(exist_ok=True)
    src, out = d / f"d{n}.mmd", d / f"d{n}.svg"
    src.write_text(code)
    out.unlink(missing_ok=True)
    rc, so, se = run_cmd([exe, "-q", "-i", str(src), "-o", str(out)], MMDC_TIMEOUT)
    if rc == 0 and out.exists():
        return ""
    msg = "\n".join(l for l in clean(se or so).splitlines() if not l.strip().startswith("at "))
    return msg[:600] or f"mmdc rc={rc}"   # 스택 트레이스를 빼고 파싱 오류 본문만 수정기에 넘긴다


def _fix_diagram(code, err):
    sysmsg = ("당신은 Mermaid 문법 수정기다. 노드·관계·라벨의 의미는 바꾸지 말고 문법 오류만 고친다. "
              "Mermaid 코드만 출력하고 설명이나 코드펜스는 쓰지 않는다.")
    rc, so, se, _ = codex_json(sysmsg, f"[오류]\n{err}\n\n[코드]\n{code}", DIAG_FIX_TIMEOUT)
    return _strip_fence(clean(so)) if rc == 0 else ""


_EDGE = re.compile(r"-->|---|-\.->|==>|--[ox]|<-->")
_NODE_DECL = re.compile(r"^\s*([A-Za-z_]\w*)\s*(?:\[|\(|\{|>)")
_FLOW_KW = {"subgraph", "end", "direction", "classDef", "class", "style", "linkStyle", "click"}


def _orphans(code):
    """flowchart 에서 화살표와 하나도 연결되지 않은 노드 ID 목록. flowchart/graph 가 아니면 빈 목록."""
    lines = code.splitlines()
    first = next((l.strip() for l in lines if l.strip() and not l.strip().startswith("%%")), "")
    if not first.startswith(("flowchart", "graph")):
        return []
    declared, linked = [], set()
    for l in lines[1:]:
        s = l.strip()
        if not s or s.startswith("%%") or s.split()[0] in _FLOW_KW:
            continue
        if _EDGE.search(s):   # 라벨·괄호 안 글자를 지우고 남은 영문 식별자를 연결된 노드로 본다
            t = re.sub(r'"[^"]*"|\|[^|]*\||\[[^\]]*\]|\([^)]*\)|\{[^}]*\}', " ", s)
            linked.update(re.findall(r"[A-Za-z_]\w*", t))
        else:
            m = _NODE_DECL.match(s)
            if m:
                declared.append(m.group(1))
    return [d for d in declared if d not in linked]


def _drop_nodes(code, ids):
    keep = [l for l in code.splitlines()
            if not ((m := _NODE_DECL.match(l.strip())) and m.group(1) in ids and not _EDGE.search(l))]
    return "\n".join(keep)


def inject_diagrams(body, rd):
    """<diagram kind=.. title=..>mermaid</diagram> 을 검사(→실패 시 1회 수정)한 뒤 <pre class="mermaid"> figure 로 바꾼다.
    연결 없는 노드는 지운다(본문에 없는 관계를 지어내지 않도록 모델로 고치지 않는다).
    렌더링은 template.html 의 로컬 mermaid.min.js 가 브라우저에서 한다(다크/라이트 테마 자동).
    반환: (본문, 통계 dict)."""
    st = {"ok": 0, "bad": 0, "fixed": 0, "orphans": 0, "no_legend": 0,
          "check": "mmdc" if shutil.which("mmdc") else "head-only"}
    n = [0]
    def sub(m):
        n[0] += 1
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        kind, title = attrs.get("kind", "flow"), html.unescape(attrs.get("title", "")).strip()
        code = _strip_fence(html.unescape(m.group(2)))
        err = _diag_error(code, kind, rd, n[0])
        if err and kind in DIAG_KINDS:
            print(f"[그림] {n[0]}번 문법 오류 → 수정 1회: {err[:120]}", flush=True)
            fixed = _fix_diagram(code, err)
            if fixed and not _diag_error(fixed, kind, rd, n[0]):
                code, err = fixed, ""
                st["fixed"] += 1
        if err:
            st["bad"] += 1
            print(f"[그림] {n[0]}번 버림: {err[:120]}", flush=True)
            return ""
        lone = _orphans(code)
        if lone:
            dropped = _drop_nodes(code, set(lone))
            if not _diag_error(dropped, kind, rd, n[0]):
                code = dropped
                st["orphans"] += len(lone)
                print(f"[그림] {n[0]}번 연결 없는 노드 제거: {', '.join(lone)}", flush=True)
        if 'class="legend"' not in m.string[m.end():m.end() + 300]:
            st["no_legend"] += 1
            print(f"[그림] {n[0]}번 요소 설명 목록 없음", flush=True)
        st["ok"] += 1
        cap = f"<figcaption>{_x(title)}</figcaption>" if title else ""
        return f'<figure class="viz diagram" data-kind="{kind}">{cap}<pre class="mermaid">{_x(code)}</pre></figure>'
    out = re.sub(r"<diagram\b([^>]*)>(.*?)</diagram>", sub, body, flags=re.S)
    out = re.sub(r"</?diagram\b[^>]*>", "", out)   # 닫힘이 없는 잔여 태그 제거
    return out, st


def prepare(text):
    idx = load_index()
    parts = text.strip().split(None, 1)
    key = parts[0] if parts else ""
    if key in idx and not NEW_TOPIC:
        if len(parts) < 2:
            sys.exit(f"질문이 없습니다. 사용법: /study-mode {key} <질문>")
        question, new = parts[1], False
    else:
        key, question, new = new_key(idx), text.strip(), True
        if not question:
            sys.exit("주제/질문이 비었습니다.")
        idx[key] = {"topic": question[:60], "created": datetime.now().isoformat(timespec="seconds"),
                    "rounds": 0, "html": None, "sections": []}
    meta = idx[key]
    meta["rounds"] += 1
    rd = DATA / key / "rounds" / f"{meta['rounds']:02d}"
    rd.mkdir(parents=True, exist_ok=True)
    ctx = "" if new else f"(이 대화의 주제: {meta['topic']})\n"
    (rd / "prompt.txt").write_text(collect_prompt(question, ctx))
    (rd / "question.txt").write_text(question)
    (rd / "new.flag").write_text("1" if new else "0")
    save_index(idx, [key])
    return key, rd, new


# ---------- collect ----------
def agy_quota():
    """`agy -p /usage`(모델 호출·토큰 소모 없음, 약 5초)로 그룹별 잔여 비율을 읽는다.
    반환: {"gemini": 0~1 또는 None, "claude": 0~1 또는 None}. 그룹 이름으로 구분하고,
    확인 실패·그룹 없음은 None(알 수 없음 → 막지 않고 시도)."""
    q = {"gemini": None, "claude": None}
    rc, so, se = run_cmd(["agy", "-p", "/usage", "--output-format", "json"], AGY_USAGE_TIMEOUT)
    if rc != 0:
        return q
    try:
        for g in json.loads(so)["command"]["data"]["groups"]:
            name = str(g.get("name", "")).lower()
            fr = [b["remaining_fraction"] for b in g.get("buckets", [])
                  if isinstance(b.get("remaining_fraction"), (int, float))]
            for key in q:
                if key in name and fr:
                    q[key] = min(fr)
    except (ValueError, KeyError, TypeError):
        pass
    return q


def collect_haiku(prompt, rd):
    """1순위 Claude Haiku → 실패 시 예비로 agy Claude Sonnet(Claude·GPT 한도 그룹, 잔여 확인).
    반환: (rc, text, 사유). 1순위가 성공하면 haiku.src 를 만들지 않는다.
    agy 기본 모델(Gemini)은 수집이 60~300초 걸려 대기 한도(WAIT_LIMIT)를 넘기므로 쓰지 않는다."""
    rc, so, se = claude(HAIKU_MODEL, HAIKU_SYSTEM, prompt, HAIKU_TIMEOUT)
    text = clean(so)
    if rc == 0 and text:
        return 0, text, ""
    why = f"{HAIKU_MODEL} 실패 rc={rc} {clean(se)[:100]}"
    print(f"[haiku] {why} → 예비: agy {AGY_CLAUDE_MODEL}", flush=True)
    rem = agy_quota()["claude"]
    if rem is not None and rem < AGY_MIN_REMAINING:
        why += f" / agy 잔여 {rem:.0%} < 기준 {AGY_MIN_REMAINING:.0%}"
        print(f"[haiku] agy Claude·GPT 잔여 {rem:.0%} → 건너뜀", flush=True)
        return 1, "", why
    rc, so, se = run_cmd(["agy", "-p", prompt, "--mode", "plan", "--model", AGY_CLAUDE_MODEL], AGY_TIMEOUT)
    text = _agy_text(clean(so))
    if rc == 0 and text and not _not_answer(text):
        (rd / "haiku.src").write_text(f"agy {AGY_CLAUDE_MODEL}")
        return 0, text, ""
    return rc or 1, "", f"{why} / agy {AGY_CLAUDE_MODEL} 실패 rc={rc} {clean(se)[:100]}"


def _agy_text(text):
    """agy plan 모드는 본문을 자기 작업 폴더(~/.gemini/antigravity-cli/brain/...)의 .md 파일에 쓰고
    "[x.md](file://...) 에 정리했습니다"만 돌려줄 때가 있다. 그 파일이 있으면 내용을 본문으로 쓴다."""
    m = re.search(r"\(file://(/[^)\s]+\.md)\)", text)
    if m:
        f = Path(m.group(1))
        brain = Path.home() / ".gemini" / "antigravity-cli" / "brain"
        try:
            if brain in f.resolve().parents and f.exists():
                body = clean(f.read_text())
                if len(body) > len(text):
                    return body
        except OSError:
            pass
    return text


def _not_answer(text):
    """agy plan 모드가 본문 대신 계획·되묻기·파일 안내만 돌려준 경우 (짧고 '계획'·'확인해'·'정리했습니다' 같은 말이 있음)."""
    return len(text) < 600 and bool(re.search(r"계획|진행해|확인해 주|기본값으로|열린 질문|정리했습니다|file://", text))


def collect_agy(prompt, rd):
    """agy `--model claude-sonnet-4-6`(Claude·GPT 한도 그룹, 잔여 확인) → 실패 시 Haiku 예비.
    반환: (rc, text, 사유). 예비가 쓰이면 agy.src 에 기록."""
    rem = agy_quota()["claude"]
    if rem is not None and rem < AGY_MIN_REMAINING:
        why = f"agy Claude·GPT 잔여 {rem:.0%} < 기준 {AGY_MIN_REMAINING:.0%}"
        print(f"[agy] {why} → 건너뜀", flush=True)
    else:
        print(f"[agy] agy {AGY_CLAUDE_MODEL} 시도 (잔여 {'확인 불가' if rem is None else f'{rem:.0%}'})", flush=True)
        rc, so, se = run_cmd(["agy", "-p", prompt, "--mode", "plan", "--model", AGY_CLAUDE_MODEL], AGY_TIMEOUT)
        text = _agy_text(clean(so))
        if rc == 0 and text and not _not_answer(text):
            return 0, text, ""
        why = (f"agy {AGY_CLAUDE_MODEL} 본문 대신 계획·되묻기 응답" if rc == 0 and text
               else f"agy {AGY_CLAUDE_MODEL} 실패 rc={rc} {clean(se)[:100]}")
        print(f"[agy] {why} → 예비: {HAIKU_MODEL}", flush=True)
    rc, so, se = claude(HAIKU_MODEL, HAIKU_SYSTEM, prompt, HAIKU_TIMEOUT)
    text = clean(so)
    if rc == 0 and text:
        (rd / "agy.src").write_text(HAIKU_MODEL)
        return 0, text, ""
    return rc or 1, "", f"{why} / {HAIKU_MODEL} 실패 rc={rc} {clean(se)[:100]}"


def collect(src, rd):
    rd = Path(rd)
    prompt = (rd / "prompt.txt").read_text()
    out = rd / f"{src}.md"
    print(f"[{src}] 수집 시작", flush=True)
    t = time.time()
    if src == "codex":
        rc, text, se, _ = codex_json("", prompt, COLLECT_TIMEOUT)
        text = clean(text)
        so = ""
    elif src == "haiku":
        rc, text, se = collect_haiku(prompt, rd)
        so = ""
    elif src == "agy":
        rc, text, se = collect_agy(prompt, rd)
        so = ""
    else:
        sys.exit(f"unknown source {src}")
    if rc == 0 and text:
        out.write_text(text)
        (rd / f"{src}.done").write_text("ok")
        print(f"[{src}] 완료 {time.time()-t:.0f}s, {len(text)}자", flush=True)
    else:
        (rd / f"{src}.done").write_text("fail")
        print(f"[{src}] 실패 rc={rc} {clean(se)[:200]}", flush=True)


# ---------- finish (summarize + render) ----------
def wait_collected(rd, limit=WAIT_LIMIT):
    # 기준 시간 안에 끝난 소스만 쓰고 나머지는 버린다 (실측: haiku 4~14s, codex 15~23s, agy Sonnet 14~50s)
    t = time.time()
    while time.time() - t < limit:
        if all((rd / f"{s}.done").exists() for s in sources_for(rd)):
            break
        time.sleep(1)
    return [s for s in sources_for(rd) if (rd / f"{s}.done").exists() and (rd / f"{s}.done").read_text() == "ok"]


def finish(rd):
    rd = Path(rd)
    try:
        ok = wait_collected(rd)
        late = [s for s in sources_for(rd) if s not in ok]
        print(f"[요약] 수집 성공: {ok or '없음'}" + (f" / 제외(실패 또는 {WAIT_LIMIT}초 초과): {late}" if late else ""),
              flush=True)
        if late:
            (rd / "dropped.txt").write_text(",".join(late))
        if not ok:
            raise RuntimeError("수집 결과가 하나도 없습니다.")
        question = (rd / "question.txt").read_text()
        def label(s):
            f = rd / f"{s}.src"
            return f"{s} (대체 수집: {f.read_text()})" if f.exists() else s
        blocks = "\n\n".join(f"### 출처: {label(s)}\n{(rd / f'{s}.md').read_text()}" for s in ok)
        # 별도 요약 단계 없이 원문을 그대로 Opus에 넘긴다 (로컬 요약은 오류가 섞여 제외)
        (rd / "summary.md").write_text(blocks)
        (rd / "summary.src").write_text("opus(원문 직접)")
        print(f"[정리] {CODEX_MODEL}이 원문을 직접 요약·정리 시작", flush=True)
        t_op = time.time()
        om, vok, vbad, dst = render(rd)
        (rd / "metrics.json").write_text(json.dumps({"summary_by": "opus(원문 직접)",
                                                    "opus": om, "opus_total_sec": round(time.time() - t_op, 1),
                                                    "visuals_ok": vok, "visuals_bad": vbad,
                                                    "diagrams_ok": dst["ok"], "diagrams_bad": dst["bad"],
                                                    "diagrams_fixed": dst["fixed"], "diagram_orphans": dst["orphans"],
                                                    "diagrams_no_legend": dst["no_legend"], "diagram_check": dst["check"]},
                                                   ensure_ascii=False))
        (rd / "finish.done").write_text("ok")
        print("[정리] 완료", flush=True)
    except Exception as e:
        (rd / "finish.done").write_text(f"fail: {e}")
        print(f"[오류] {e}", flush=True)


TEMPLATE = (ROOT / "template.html")


def render(rd):
    idx = load_index()
    key = rd.parent.parent.name
    meta = idx[key]
    new = (rd / "new.flag").read_text() == "1"
    question = (rd / "question.txt").read_text()
    summary = (rd / "summary.md").read_text()
    raw = (rd / "summary.src").read_text().startswith("opus")
    src_label = ("[수집 원문 - 질문에 답하는 내용을 빠짐없이 살리고, 오류·중복만 걸러낸다]" if raw
                 else "[수집 내용을 요약한 자료 - 틀리거나 빠진 게 있을 수 있음]")
    titles = "\n".join(f"- {t}" for t in meta["sections"]) or "(없음 - 첫 질문)"
    rules = visual_rules()
    want_vis = wants_visual(question)
    rules_block = (f"\n[시각화 규칙 - 도식(diagram)을 그릴 때만 아래를 따른다]\n{rules}\n" if rules and want_vis else "")
    vis_rule = ("이번 질문은 표·이미지·정리를 요청했다. 요청에 맞게 표(<visual>)나 도식(<diagram>)을 section 안에 만들어 넣는다. 요청한 정리의 내용이 소스에 부족하면 당신의 지식으로 정확히 채운다."
                if want_vis else "이번 질문은 표·이미지를 요청하지 않았다. <visual>, <diagram>, <ul class=\"legend\">, <p class=\"ask\">를 절대 쓰지 않고 글(gist, 목록)로만 답한다.")
    sys_chunk = (
        "당신은 학습 설계자다. 관련 개념끼리 묶는 chunking 원리로 내용을 정리하되, 요약하려고 내용을 버리지 않는다. "
        "사용자가 질문한 내용에 대한 답만 쓰고, 묻지 않은 내용(꼬리 질문, 오해, 실무 예시 등)은 추가하지 않는다. "
        "출력은 지정된 형식만, 설명이나 코드펜스 없이.")
    prompt = f"""주제: {meta['topic']}
이번 질문: {question}

[이미 문서에 있는 섹션 제목 - 중복 서술 금지, 필요하면 '앞의 ○○ 참고'로 연결]
{titles}

{src_label}
{summary}

작업:
1. 이번 질문에 답하는 내용만 의미적으로 가까운 것끼리 chunk로 묶는다. 질문이 묻지 않은 내용은 넣지 않는다. chunk 개수 제한은 없다: 질문 범위가 넓으면 그만큼 많이 만든다. 수집 원문의 소제목(##)마다 최소 chunk 하나를 만들고, 원문의 목록 항목·용어 정의·예외·주의점·비교는 하나도 빠뜨리거나 합쳐 지우지 않는다(요약이 아니라 재구성이다). 결과가 원문보다 눈에 띄게 짧아지면 안 된다.
2. 요약에서 틀린 내용은 바로잡고, 빠진 핵심은 당신의 지식으로 보완한다. HTML 본문에는 정정/보완 표시를 남기지 말고 처음부터 올바른 내용인 것처럼 자연스럽게 쓴다. 무엇을 고쳤는지는 어디에도 적지 않는다.
3. 각 chunk는 정확히 이 구조의 HTML이다 (섹션 하나당):
<section class="chunk" data-title="chunk 제목(15자 이내)">
  <h2>이모지 하나 + chunk 제목</h2>
  <p class="gist">한 문장 핵심</p>
  <ul><li>핵심 포인트 (개수 제한 없음, 필요한 만큼)</li></ul>
</section>
[표·이미지 규칙] {vis_rule}
표는 <table> 대신 아래 형식을 section 안에 그대로 쓴다. 스크립트가 이미지로 그려 준다. 표의 행·열 개수 제한은 없다. 셀은 짧은 구절로 쓴다(자동 줄바꿈된다).
<visual>{{"title":"제목","corner":"구분","cols":["대상A","대상B"],"rows":[["기준1","A의 값","B의 값"],["기준2","...","..."]]}}</visual>
cols에는 값 열의 제목만 넣는다(맨 왼쪽 기준 열의 제목은 corner에 넣는다). rows의 각 행 길이는 반드시 cols 길이 + 1이다(맨 앞이 기준 이름).
JSON은 한 줄이고 반드시 유효해야 한다. 사용할 수 있는 태그는 section,h2,p,ul,li,code,strong,span,visual,diagram 이다.
{rules_block}4. 출력 형식: 첫 줄은 'TITLE: 이 주제의 짧은 이름(20자 이내)', 둘째 줄부터 section들만. 수정·보완 내역, 메모, 설명은 출력하지 않는다."""
    rc, so, se, ometa = codex_json(sys_chunk, prompt)
    if rc != 0 or not so.strip():
        raise RuntimeError(f"{CODEX_MODEL} 정리 실패 rc={rc} {clean(se)[:200]}")
    body = re.sub(r"^```\w*\n|\n```$", "", so.strip())
    body, _, notes = body.partition("\nNOTES:")
    (rd / "notes.txt").write_text(notes.strip())
    m = re.match(r"TITLE:\s*(.+)\n", body)
    title = m.group(1).strip() if m else meta["topic"]
    body = body[m.end():] if m else body
    if not want_vis:
        body = re.sub(r"<visual>.*?</visual>|<diagram\b[^>]*>.*?</diagram>|<ul class=\"legend\">.*?</ul>|<p class=\"ask\">.*?</p>",
                      "", body, flags=re.S)
    stash = []   # Mermaid 코드가 아래 정리용 정규식(on*=)에 망가지지 않게 잠시 빼 둔다
    def _keep(mm):
        stash.append(mm.group(0))
        return f"\x00D{len(stash) - 1}\x00"
    body = re.sub(r"<diagram\b[^>]*>.*?</diagram>", _keep, body, flags=re.S)
    body = re.sub(r"<(script|iframe|object|embed)\b.*?</\1>", "", body, flags=re.S | re.I)
    body = re.sub(r"\son\w+\s*=", " data-x=", body)
    body = re.sub(r"\x00D(\d+)\x00", lambda mm: stash[int(mm.group(1))], body)
    new_titles = re.findall(r'<section[^>]*data-title="([^"]+)"', body)
    if not new_titles:
        raise RuntimeError(f"{CODEX_MODEL} 출력에서 section을 찾지 못했습니다.")
    body, vok, vbad = inject_visuals(body)
    body, dst = inject_diagrams(body, rd)
    (rd / "chunks.html").write_text(body)

    if NO_HTML:
        if new:
            meta["topic"] = title
        meta["sections"] += new_titles
        save_index({**idx, key: meta}, [key])
        return ometa, vok, vbad, dst
    HTML.mkdir(parents=True, exist_ok=True)
    if new or not meta["html"]:
        meta["topic"] = title
        meta["html"] = f"{key}_{slugify(title)}.html"
        page = TEMPLATE.read_text().replace("{{TITLE}}", esc(title)).replace("{{KEY}}", key)
        (HTML / meta["html"]).write_text(page)
    path = HTML / meta["html"]
    n = meta["rounds"]
    block = (f'<div class="round" id="r{n}"><h3 class="q"><span>Q{n}</span> {esc(question)}</h3>\n'
             f'{body}\n</div>\n')
    page = path.read_text()
    page = page.replace("<!--ROUNDS-->", block + "<!--ROUNDS-->")
    path.write_text(page)
    meta["sections"] += new_titles
    save_index({**idx, key: meta}, [key])
    if dst["ok"] and "mermaid.min.js" not in page:
        rebuild(key)   # 다이어그램 지원 이전 템플릿으로 만든 페이지 → 현재 템플릿으로 다시 만든다
    return ometa, vok, vbad, dst


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def rebuild(key):
    """저장된 중간 산출물로 HTML을 다시 만든다 (모델 호출 없음). 템플릿을 바꿨을 때 사용."""
    idx = load_index()
    if key not in idx:
        sys.exit(f"없는 key: {key}")
    meta = idx[key]
    page = TEMPLATE.read_text().replace("{{TITLE}}", esc(meta["topic"])).replace("{{KEY}}", key)
    blocks = ""
    for rd in sorted((DATA / key / "rounds").glob("*")):
        ch = rd / "chunks.html"
        if not ch.exists():
            continue
        body = re.sub(r'<span class="fix">[^<]*</span>\s*', "", ch.read_text())  # 구버전 배지 제거
        blocks += (f'<div class="round" id="r{int(rd.name)}"><h3 class="q"><span>Q{int(rd.name)}</span> '
                   f'{esc((rd / "question.txt").read_text())}</h3>\n{body}\n</div>\n')
    page = page.replace("<!--ROUNDS-->", blocks + "<!--ROUNDS-->")
    (HTML / meta["html"]).write_text(page)
    print(f"{key}: {meta['html']} 재생성")


# ---------- herdr ----------
def herdr(*args):
    p = subprocess.run(["herdr", *args], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"herdr {' '.join(args[:3])} 실패: {p.stderr.strip() or p.stdout.strip()}")
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return {}


def find(o, k):
    if isinstance(o, dict):
        if k in o and isinstance(o[k], str):
            return o[k]
        for v in o.values():
            r = find(v, k)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, k)
            if r:
                return r
    return None


def emit(key, rd, srcs, result):
    if result != "ok":
        sys.exit(f"실패: {result}\n로그/중간산출물: {rd}")
    meta = load_index()[key]
    html = HTML / (meta["html"] or "")
    if not NO_OPEN and meta["html"]:
        subprocess.run(["open", str(html)])
    dropped = (rd / "dropped.txt").read_text() if (rd / "dropped.txt").exists() else ""
    src = ", ".join(f"{s}→{(rd / f'{s}.src').read_text()}" for s in srcs if (rd / f"{s}.src").exists())
    mf = rd / "metrics.json"
    print(json.dumps({"key": key, "round": rd.name, "html": str(html), "sections": meta["sections"],
                      "dropped": dropped, "backup_src": src,
                      "metrics": json.loads(mf.read_text()) if mf.exists() else {}}, ensure_ascii=False))


WANT_MERGE = re.compile(r"표|이미지|그림|도식|도해|다이어그램|차트|그래프|시각|그려|도표|정리")


def merge_target(text):
    """기존 주제에 대한 '표·그림으로 나타내줘' 후속 요청이면 (key, question, 대상 round 폴더). 아니면 None.
    이런 요청은 새 질문(라운드)이 아니라 직전 답변 아래에 덧붙인다."""
    idx = load_index()
    parts = text.strip().split(None, 1)
    if NEW_TOPIC or len(parts) < 2 or parts[0] not in idx or not WANT_MERGE.search(parts[1]):
        return None
    meta = idx[parts[0]]
    rd = DATA / parts[0] / "rounds" / f"{meta['rounds']:02d}"
    return (parts[0], parts[1], rd) if meta["rounds"] >= 1 and (rd / "chunks.html").exists() else None


def run_merge(key, question, rd):
    """직전 답변(chunks.html)을 근거로 표·도식 section만 만들어 같은 라운드의 chunks.html 아래에 덧붙인다."""
    print(f"key={key} round={rd.name} new=False merge=1", flush=True)
    (rd / "finish.done").unlink(missing_ok=True)
    try:
        meta = load_index()[key]
        base = re.sub(r"<(svg|pre)\b.*?</\1>", "", (rd / "chunks.html").read_text(), flags=re.S)
        base = re.sub(r"<[^>]+>", " ", base)
        base = re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", html.unescape(base))).strip()
        rules = visual_rules()
        sysm = ("당신은 학습 자료 시각화 담당이다. [기존 답변]을 근거로 사용자의 요청에 맞는 표나 도식만 만든다. "
                "새 설명 문단을 쓰지 말고, 기존 답변에 있는 내용(필요하면 정확한 일반 지식)으로 표·그림을 채운다. "
                "출력은 section들만, 설명이나 코드펜스 없이.")
        prompt = f"""주제: {meta['topic']}
사용자 요청: {question}

[기존 답변]
{base}

작업: 요청에 맞게 표(<visual>) 또는 도식(<diagram>)을 만든다. 요청이 표이면 표, 그림·이미지·도식이면 도식(필요하면 표 병행)을 만든다. 기존 답변의 핵심 항목이 빠지지 않게 한다.
각 결과는 이 구조의 HTML 하나다:
<section class="chunk" data-title="제목(15자 이내)">
  <h2>이모지 하나 + 제목</h2>
  <p class="gist">이 표/그림이 보여 주는 것 한 문장</p>
  <visual>또는 <diagram> (아래 형식)
</section>
표 형식(스크립트가 이미지로 그린다, 셀은 짧은 구절): <visual>{{"title":"제목","corner":"구분","cols":["대상A","대상B"],"rows":[["기준1","A값","B값"]]}}</visual>
rows 각 행 길이는 cols 길이 + 1, JSON은 한 줄이고 유효해야 한다.
사용할 수 있는 태그는 section,h2,p,ul,li,code,strong,span,visual,diagram 이다.
{('[도식 규칙]' + chr(10) + rules) if rules else ''}
출력: section들만. 첫 줄에 TITLE 같은 머리말을 쓰지 않는다."""
        rc, so, se, om = codex_json(sysm, prompt)
        if rc != 0 or not so.strip():
            raise RuntimeError(f"{CODEX_MODEL} 시각화 실패 rc={rc} {clean(se)[:200]}")
        print("[정리] 표·그림 생성 시작", flush=True)
        body = re.sub(r"^```\w*\n|\n```$", "", so.strip())
        stash = []
        def _keep(mm):
            stash.append(mm.group(0))
            return f"\x00D{len(stash) - 1}\x00"
        body = re.sub(r"<diagram\b[^>]*>.*?</diagram>", _keep, body, flags=re.S)
        body = re.sub(r"<(script|iframe|object|embed)\b.*?</\1>", "", body, flags=re.S | re.I)
        body = re.sub(r"\son\w+\s*=", " data-x=", body)
        body = re.sub(r"\x00D(\d+)\x00", lambda mm: stash[int(mm.group(1))], body)
        titles = re.findall(r'<section[^>]*data-title="([^"]+)"', body)
        if not titles:
            raise RuntimeError(f"{CODEX_MODEL} 출력에서 section을 찾지 못했습니다.")
        body, vok, vbad = inject_visuals(body)
        body, dst = inject_diagrams(body, rd)
        if not (vok or dst["ok"]):
            raise RuntimeError("표·그림이 하나도 만들어지지 않았습니다.")
        cur = (rd / "chunks.html").read_text()
        (rd / "chunks.html").write_text(cur.rstrip("\n") + "\n\n" + body + "\n")
        with open(rd / "extras.txt", "a") as f:
            f.write(question + "\n")
        idx = load_index()
        idx[key]["sections"] += titles
        save_index(idx, [key])
        (rd / "metrics.json").write_text(json.dumps({"merge": True, "model": om, "visuals_ok": vok, "visuals_bad": vbad,
                                                    "diagrams_ok": dst["ok"], "diagrams_bad": dst["bad"]}, ensure_ascii=False))
        (rd / "finish.done").write_text("ok")
        print("[정리] 완료", flush=True)
    except Exception as e:
        (rd / "finish.done").write_text(f"fail: {e}")
        print(f"[오류] {e}", flush=True)
    emit(key, rd, [], (rd / "finish.done").read_text())


def run(text, keep=False, reuse=None, panes=False):
    mt = None if reuse else merge_target(text)
    if mt:
        return run_merge(*mt)
    key, rd, new = prepare(text)
    if reuse:
        # 같은 수집 결과를 재사용해 정리만 다시 한다 (수집 단계 생략, pane 없음)
        src_rd = DATA / reuse / "rounds" / "01"
        if not src_rd.exists():
            sys.exit(f"재사용할 수집 결과가 없다: {src_rd}")
        names = {f"{s}.{e}" for s in SOURCES for e in ("md", "done", "src")}
        for f in src_rd.iterdir():
            if f.name in names:
                shutil.copy2(f, rd / f.name)
        srcs = sources_for(rd)
        print(f"key={key} round={rd.name} new={new} (수집 재사용: {reuse})", flush=True)
        finish(rd)
        f = rd / "finish.done"
        return emit(key, rd, srcs, f.read_text() if f.exists() else "fail: finish.done 없음")
    srcs = sources_for(rd)
    print(f"key={key} round={rd.name} new={new}", flush=True)
    if not panes:
        return run_background(key, rd, srcs)

    tab = herdr("tab", "create", "--label", f"study-{key}", "--cwd", str(ROOT), "--no-focus")
    tab_id = find(tab, "tab_id")
    p1 = find(tab, "pane_id")
    if not p1:
        raise RuntimeError(f"tab create 응답에서 pane_id를 찾지 못했습니다: {tab}")
    p2 = find(herdr("pane", "split", p1, "--direction", "right", "--no-focus"), "pane_id")
    p3 = find(herdr("pane", "split", p1, "--direction", "down", "--no-focus"), "pane_id")
    p4 = find(herdr("pane", "split", p2, "--direction", "down", "--no-focus"), "pane_id")
    panes = [p1, p2, p3, p4]
    for p, name in zip(panes, srcs + ["finish"]):
        try:
            herdr("pane", "rename", p, name)
        except RuntimeError:
            pass
    for p, s in zip(panes[:3], srcs):
        herdr("pane", "run", p, f"python3 {SELF} collect {s} {rd}")
    herdr("pane", "run", p4, f"python3 {SELF} finish {rd}")
    # 탭으로 포커스를 옮기지 않는다 (사용자가 다른 작업 중일 때 방해됨). 보려면 herdr에서 직접 study-<key> 탭을 연다

    done = rd / "finish.done"
    limit = COLLECT_TIMEOUT + 2 * CLAUDE_TIMEOUT + 60
    t = time.time()
    while not done.exists() and time.time() - t < limit:
        time.sleep(2)
    result = done.read_text() if done.exists() else "fail: 시간 초과"
    if not keep:
        for p in reversed(panes):
            try:
                herdr("pane", "close", p)
            except RuntimeError:
                pass
    emit(key, rd, srcs, result)


def run_background(key, rd, srcs):
    """herdr 탭·pane 없이 수집기 3개를 하위 프로세스로 띄우고, 정리는 이 프로세스에서 한다 (화면·포커스 변화 없음).
    수집기 출력은 rounds/NN/<src>.log 에 남는다."""
    procs = []
    for s in srcs:
        log = open(rd / f"{s}.log", "w")
        procs.append((subprocess.Popen([sys.executable, SELF, "collect", s, str(rd)], stdout=log,
                                       stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, cwd=str(ROOT),
                                       start_new_session=True), log))
    print(f"[수집] 백그라운드 시작: {', '.join(srcs)} (로그: {rd}/<src>.log)", flush=True)
    finish(rd)   # 수집을 최대 WAIT_LIMIT 기다린 뒤 끝난 소스로 정리
    for p, log in procs:   # 늦은 수집기는 결과가 버려지므로 정리한다
        if p.poll() is None:
            try:
                os.killpg(p.pid, signal.SIGTERM)   # claude·codex·agy 자식 프로세스까지 함께 종료
            except ProcessLookupError:
                pass
        log.close()
    done = rd / "finish.done"
    emit(key, rd, srcs, done.read_text() if done.exists() else "fail: finish.done 없음")


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    cmd = a[0]
    if cmd == "run":
        global NO_OPEN, NO_HTML, NEW_TOPIC
        NO_OPEN, NO_HTML, NEW_TOPIC = "--no-open" in a, "--no-html" in a, "--new" in a
        keep, panes = "--keep" in a, "--panes" in a
        rest = [x for x in a[1:] if x not in ("--keep", "--panes", "--no-open", "--no-html", "--new")]
        opt = {"--reuse": None}
        for name in list(opt):
            if name in rest:
                i = rest.index(name)
                opt[name] = rest[i + 1]
                rest = rest[:i] + rest[i + 2:]
        run(" ".join(rest), keep, opt["--reuse"], panes)
    elif cmd == "collect":
        collect(a[1], a[2])
    elif cmd == "finish":
        finish(a[1])
    elif cmd == "rebuild":
        for k in (a[1:] or load_index()):
            rebuild(k)
    elif cmd == "list":
        for k, m in load_index().items():
            print(f"{k}  {m['topic']}  (질문 {m['rounds']}개)  {m['html']}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
