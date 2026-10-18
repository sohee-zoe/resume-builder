/* 이력서 빌더 — 상태 관리 · 편집 UI · A4 미리보기 */

const STORE_KEY = 'resume-builder:v1';
const MM = 96 / 25.4;          // 1mm → px
const PAPER_W = 210 * MM;      // A4 폭

/* ───────────────────────── 기본 데이터 ───────────────────────── */
/* style: 'normal' | 'bold' | 'block'
   block 행은 바로 위 행에 붙어서 렌더링된다(사이에 줄이 그어지지 않음). */

/* 기본 예시 데이터는 default-data.json 에 있다 (처음 열 때·초기화할 때 불러온다). */
let defaultDataPromise = null;
function getDefaultData() {
  if (!defaultDataPromise) {
    defaultDataPromise = fetch('default-data.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(() => ({ title: '이력서', name: '', sections: [] }));
  }
  return defaultDataPromise.then(d => structuredClone(d));
}

/* ───────────────────────── 상태 ───────────────────────── */

let state = load();   // 저장된 내용이 없으면 시작할 때 기본 데이터로 채운다
const collapsed = new Set();
/* 항목·행을 추가한 뒤 그 자리로 스크롤하기 위한 표식 (다시 그린 뒤 찾아간다) */
let pendingFocus = null;

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

let saveTimer = null;
function scheduleSave() {
  setSaveState('저장 중…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      setSaveState('저장됨');
    } catch (e) {
      setSaveState('저장 실패');
    }
  }, 400);
}
function setSaveState(t) { document.getElementById('saveState').textContent = t; }

/* ───────────────────────── 유틸 ───────────────────────── */

const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* **굵게**, __밑줄__, [텍스트](주소), "- "로 시작하는 줄은 불릿 */
function inlineMarkup(raw) {
  const lines = String(raw).split('\n');
  const bullet = lines.map(l => /^\s*-\s+/.test(l));
  const parts = lines.map(line => {
    const isBullet = /^\s*-\s+/.test(line);
    let t = escapeHtml(isBullet ? line.replace(/^\s*-\s+/, '') : line);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      (m, a, b) => `<a href="${b}" target="_blank" rel="noopener">${a}</a>`);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<u>$1</u>');
    return isBullet ? `<span class="bul">• ${t}</span>` : t;
  });
  /* 불릿은 block 요소라 앞뒤의 줄바꿈 문자가 빈 줄로 한 번 더 그려진다 — 붙어 있는 곳에서는 뺀다 */
  return parts.reduce((out, part, i) =>
    out + (i && !bullet[i] && !bullet[i - 1] ? '\n' : '') + part, '');
}

function move(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
}

const newRow = () => ({ label: '', text: '', style: 'normal' });
const newEntry = () => ({ period: '', rows: [newRow()] });

/* ───────── 카테고리 틀 ─────────
   shape = 행 구성만 정해 둔 것. label은 왼쪽 작은 칸,
   style은 일반/굵게/본문. 내용은 비워서 만든다. */
const SECTION_PRESETS = [
  { name: '학력사항', desc: '학교 · 전공 · 학위',
    shape: [{}, {}] },
  { name: '경력사항', desc: '회사 · 직책 · 성과',
    shape: [{ label: '회사' }, { label: '직책' }, { style: 'bold' }, { style: 'block' }] },
  { name: '교육사항', desc: '교육기관 · 과정 · 프로젝트',
    shape: [{ label: '교육기관' }, { label: '교 육 명' }, { style: 'bold' }, { style: 'block' }] },
  { name: '강사경력', desc: '교육기관 · 과정 · 역할',
    shape: [{ label: '교육기관' }, { label: '교 육 명' }, {}] },
  { name: '프로젝트', desc: '제목 · 설명',
    shape: [{ style: 'bold' }, { style: 'block' }] },
  { name: '연구실적', desc: '구분 · 논문 · 특허',
    shape: [{ style: 'bold' }, {}] },
  { name: '수상내역', desc: '수상명 · 작품/논문',
    shape: [{}, { style: 'bold' }] },
  { name: '자격증', desc: '자격명 · 발급기관',
    shape: [{ label: '자격명' }, { label: '발급기관' }] },
  { name: '어학', desc: '시험명 · 점수',
    shape: [{ label: '시험명' }, { label: '점수' }] },
  { name: '대외활동', desc: '기관 · 활동 · 설명',
    shape: [{ label: '기관' }, { style: 'bold' }, { style: 'block' }] },
  { name: '보유기술', desc: '분야별 나열',
    shape: [{ label: '분야' }] },
  { name: '인적사항', desc: '이름 · 연락처',
    shape: [{ label: '성명' }, { label: '생년월일' }, { label: '휴대전화' },
            { label: 'Email' }, { label: 'Linkedin' }] }
];

const entryFromShape = shape => ({
  period: '',
  rows: (shape && shape.length ? shape : [{}])
    .map(s => ({ label: s.label || '', text: '', style: s.style || 'normal' }))
});

/* 같은 섹션 안에서는 첫 항목의 행 구성을 그대로 물려받는다 —
   경력을 하나 더 넣을 때 회사·직책 칸을 매번 다시 만들 필요가 없게. */
const shapeOfEntry = ent =>
  (ent && ent.rows && ent.rows.length)
    ? ent.rows.map(r => ({ label: r.label || '', style: r.style || 'normal' }))
    : [{}];

const newSection = preset => ({
  label: preset ? preset.name : '새 섹션',
  entries: [entryFromShape(preset ? preset.shape : null)]
});

/* ───────────────────────── 미리보기 렌더링 ───────────────────────── */

function renderPaper() {
  const paper = document.getElementById('paper');
  const viewer = document.getElementById('viewer');
  const prevTop = viewer.scrollTop;   /* 비웠다 채우는 동안 밀리지 않게 */
  paper.innerHTML = '';

  paper.appendChild(el('div', 'doc-title', state.title || ''));
  paper.appendChild(el('div', 'doc-name', state.name || ''));

  state.sections.forEach(sec => {
    const g = el('div', 'sec');

    const head = el('div', 'sec-head');
    head.append(el('div', 'sec-h-l', sec.label || ''), el('div', 'sec-h-r'));
    g.appendChild(head);

    sec.entries.forEach((ent, ei) => {
      /* 항목 하나 = 격자 한 덩어리. 이래야 페이지 경계에서 통째로 넘어간다. */
      const box = el('div', 'sec-ent' +
        (ei > 0 ? ' gap' : '') +
        (ent.pageBreak ? ' forced' : ''));

      const left = el('div', 'ent-l');
      left.textContent = ent.period || '';
      const right = el('div', 'ent-r');

      ent.rows.forEach((row, ri) => {
        const next = ent.rows[ri + 1];
        const style = row.style || 'normal';
        const hasLabel = !!(row.label && row.label.trim());

        const r = el('div', 'prow ' + style + (hasLabel ? '' : ' nolabel') +
          (next && next.style === 'block' ? ' norule' : ''));

        if (hasLabel) r.appendChild(el('div', 'p-label', row.label));
        const t = el('div', 'p-text');
        t.innerHTML = inlineMarkup(row.text || '');
        r.appendChild(t);
        right.appendChild(r);
      });

      box.append(left, right);
      g.appendChild(box);
    });

    paper.appendChild(g);
  });

  paper.appendChild(el('div', 'foot-rule'));
  markTallBlocks();
  drawPageGuides();
  fitPaper();
  viewer.scrollTop = prevTop;
}

/* 한 페이지에 안 들어가는 덩어리는 "쪼개도 됨"으로 풀어 준다.
   풀어 주지 않으면 브라우저가 통째로 다음 장으로 밀어 큰 공백이 생긴다. */
const PAGE_CONTENT_H = (297 - 19 - 16) * MM;   // 인쇄 시 실제 본문 높이

function markTallBlocks() {
  document.querySelectorAll('#paper .sec-ent').forEach(n => {
    n.classList.toggle('tall', n.offsetHeight > PAGE_CONTENT_H * 0.88);
  });
  document.querySelectorAll('#paper .prow').forEach(n => {
    n.classList.toggle('tall', n.offsetHeight > PAGE_CONTENT_H * 0.6);
  });
}

/* 화면에서 페이지가 어디서 끊길지 점선으로 보여 준다(인쇄 시 숨김).
   인쇄 CSS와 같은 규칙(항목은 통째로 넘김 · tall 항목은 분할 · forced는 강제 개행)으로
   계산하지만, 연속 흐름 좌표를 쓰기 때문에 아래로 갈수록 오차가 쌓인다 — 어디까지나 예상선이다. */
function drawPageGuides() {
  const paper = document.getElementById('paper');
  const old = paper.querySelector('.page-guides');
  if (old) old.remove();

  const topPad = 19 * MM;
  const yOf = n => n.offsetTop - topPad;            // 본문 기준 좌표
  const blocks = [...paper.querySelectorAll('.sec-head, .sec-ent')];
  const breaks = [];
  let pageTop = 0;

  blocks.forEach((b, i) => {
    const bTop = yOf(b);
    const bH = b.offsetHeight;
    const tall = b.classList.contains('tall');

    if (b.classList.contains('forced')) {
      if (bTop > pageTop) { breaks.push(bTop); pageTop = bTop; }
    } else if (!tall && bTop + bH - pageTop > PAGE_CONTENT_H) {
      /* 섹션 제목만 페이지 끝에 남지 않도록 제목부터 함께 넘긴다 */
      const prev = blocks[i - 1];
      let start = (prev && prev.classList.contains('sec-head')) ? yOf(prev) : bTop;
      if (start > pageTop) { breaks.push(start); pageTop = start; }
    }

    if (tall) {
      while (bTop + bH - pageTop > PAGE_CONTENT_H) {
        pageTop += PAGE_CONTENT_H;
        breaks.push(pageTop);
      }
    }
  });

  /* 마지막 페이지 뒤로 남은 흐름도 채워 준다 */
  const total = paper.scrollHeight - topPad - 16 * MM;
  while (total - pageTop > PAGE_CONTENT_H) {
    pageTop += PAGE_CONTENT_H;
    breaks.push(pageTop);
  }

  if (!breaks.length) return;
  const layer = el('div', 'page-guides');
  breaks.forEach((b, i) => {
    const line = el('div', 'page-guide');
    line.style.top = (topPad + b) + 'px';
    line.appendChild(el('span', null, `예상 ${i + 2}페이지 시작`));
    layer.appendChild(line);
  });
  paper.appendChild(layer);
}

function fitPaper() {
  const viewer = document.getElementById('viewer');
  const scaler = document.getElementById('scaler');
  const paper = document.getElementById('paper');
  const avail = viewer.clientWidth - 32;
  const s = Math.min(1, avail / PAPER_W);
  scaler.style.transform = `scale(${s})`;
  scaler.style.width = PAPER_W + 'px';
  scaler.style.height = (paper.offsetHeight * s) + 'px';
}

/* ───────────────────────── 편집 UI 렌더링 ───────────────────────── */

function autoGrow(ta) {
  /* height를 auto로 줄였다 늘리는 사이 스크롤 높이가 줄어 위치가 밀리므로 되돌려 놓는다 */
  const pane = document.getElementById('editor');
  const top = pane.scrollTop;
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';
  pane.scrollTop = top;
}

function renderEditor() {
  const root = document.getElementById('editor');
  const prevTop = root.scrollTop;   /* 다시 그려도 보던 자리를 유지한다 */
  root.innerHTML = '';

  /* 문서 제목 · 이름 */
  const head = el('div', 'card');
  const hb = el('div', 'card-body');
  const hf = el('div', 'head-fields');
  [['title', '문서 제목'], ['name', '이름']].forEach(([key, cap]) => {
    const wrap = el('div');
    wrap.appendChild(el('label', null, cap));
    const inp = el('input');
    inp.value = state[key] || '';
    inp.addEventListener('input', () => { state[key] = inp.value; renderPaper(); scheduleSave(); });
    wrap.appendChild(inp);
    hf.appendChild(wrap);
  });
  hb.appendChild(hf);
  hb.appendChild(el('p', 'hint',
    '행 텍스트에 **굵게**, __밑줄__, [보이는 글자](링크주소) 를 쓸 수 있고, ' +
    '- 로 시작하는 줄은 불릿이 됩니다.'));
  head.appendChild(hb);
  root.appendChild(head);

  /* 섹션 */
  state.sections.forEach((sec, si) => {
    const card = el('div', 'card');
    card.dataset.key = `s${si}`;
    const isCollapsed = collapsed.has(si);

    const ch = el('div', 'card-head' + (isCollapsed ? ' collapsed' : ''));
    const disc = el('button', 'disclose', isCollapsed ? '▶' : '▼');
    disc.title = isCollapsed ? '펼치기' : '접기';
    disc.onclick = () => { isCollapsed ? collapsed.delete(si) : collapsed.add(si); renderEditor(); };

    const title = el('input', 'sec-title');
    title.dataset.focus = '';
    title.value = sec.label || '';
    title.addEventListener('input', () => { sec.label = title.value; renderPaper(); scheduleSave(); });

    ch.append(disc, title,
      opBtn('↑', '위로', () => { if (move(state.sections, si, -1)) { collapsed.clear(); refresh(); } }),
      opBtn('↓', '아래로', () => { if (move(state.sections, si, 1)) { collapsed.clear(); refresh(); } }),
      opBtn('✕', '섹션 삭제', () => {
        if (!confirm(`"${sec.label}" 섹션을 삭제할까요?`)) return;
        state.sections.splice(si, 1); collapsed.clear(); refresh();
      }, true));
    card.appendChild(ch);

    if (!isCollapsed) {
      const body = el('div', 'card-body');

      sec.entries.forEach((ent, ei) => {
        const box = el('div', 'entry');
        box.dataset.key = `s${si}e${ei}`;

        const eh = el('div', 'entry-head');
        const per = el('input', 'period');
        per.dataset.focus = '';
        per.placeholder = '기간 / 왼쪽 칸 (예: 2019. 03 - 2021. 02)';
        per.value = ent.period || '';
        per.addEventListener('input', () => { ent.period = per.value; renderPaper(); scheduleSave(); });
        const brk = opBtn('⤓', '이 항목부터 새 페이지에서 시작', () => {
          ent.pageBreak = !ent.pageBreak; refresh();
        });
        if (ent.pageBreak) brk.classList.add('on');

        eh.append(per, brk,
          opBtn('↑', '위로', () => { if (move(sec.entries, ei, -1)) refresh(); }),
          opBtn('↓', '아래로', () => { if (move(sec.entries, ei, 1)) refresh(); }),
          opBtn('✕', '항목 삭제', () => { sec.entries.splice(ei, 1); refresh(); }, true));
        box.appendChild(eh);

        ent.rows.forEach((row, ri) => {
          const style = row.style || 'normal';
          const line = el('div', 'row-item is-' + style);
          line.dataset.key = `s${si}e${ei}r${ri}`;

          const lab = el('input', 'r-label');
          lab.placeholder = '라벨';
          lab.value = row.label || '';
          lab.addEventListener('input', () => { row.label = lab.value; renderPaper(); scheduleSave(); });

          const ta = el('textarea', 'r-text');
          ta.dataset.focus = '';
          ta.placeholder = '내용';
          ta.value = row.text || '';
          ta.addEventListener('input', () => {
            row.text = ta.value; autoGrow(ta); renderPaper(); scheduleSave();
          });

          const ops = el('div', 'row-ops');
          const sel = el('select', 'style-sel');
          [['normal', '일반'], ['bold', '굵게'], ['block', '본문']].forEach(([v, t]) => {
            const o = el('option', null, t); o.value = v;
            if (v === style) o.selected = true;
            sel.appendChild(o);
          });
          sel.title = '행 스타일 (본문 = 바로 위 행에 붙는 설명 문단)';
          sel.onchange = () => { row.style = sel.value; refresh(); };

          ops.append(sel,
            opBtn('↑', '위로', () => { if (move(ent.rows, ri, -1)) refresh(); }),
            opBtn('↓', '아래로', () => { if (move(ent.rows, ri, 1)) refresh(); }),
            opBtn('✕', '행 삭제', () => { ent.rows.splice(ri, 1); refresh(); }, true));

          line.append(lab, ta, ops);
          box.appendChild(line);
          requestAnimationFrame(() => autoGrow(ta));
        });

        /* 행은 아래로 붙인다 */
        const addRow = el('button', 'add-row', '+ 행');
        addRow.onclick = () => {
          ent.rows.push(newRow());
          pendingFocus = `s${si}e${ei}r${ent.rows.length - 1}`;
          refresh();
        };
        box.appendChild(addRow);

        body.appendChild(box);
      });

      /* 항목은 맨 위에 붙인다 — 최근 이력이 위로 오는 편이 자연스럽다 */
      const addEnt = el('button', 'add-entry', '+ 항목 추가 (맨 위)');
      addEnt.onclick = () => {
        sec.entries.unshift(entryFromShape(shapeOfEntry(sec.entries[0])));
        pendingFocus = `s${si}e0`;
        refresh();
      };
      body.appendChild(addEnt);

      card.appendChild(body);
    }

    root.appendChild(card);
  });

  /* textarea 높이는 다음 프레임에 맞춰지므로, 지금과 그 뒤 두 번 위치를 되돌린다 */
  root.scrollTop = prevTop;
  requestAnimationFrame(() => { root.scrollTop = prevTop; });

  revealPending();
}

/* 방금 추가한 항목·행으로 스크롤하고 커서를 놓는다 */
function revealPending() {
  if (!pendingFocus) return;
  const key = pendingFocus;
  pendingFocus = null;
  requestAnimationFrame(() => {
    const node = document.querySelector(`#editor [data-key="${key}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    /* data-focus가 붙은 칸을 우선한다 — 행은 라벨이 아니라 내용 칸부터 */
    const field = node.querySelector('[data-focus]') || node.querySelector('input, textarea');
    if (field) field.focus({ preventScroll: true });
  });
}

function opBtn(glyph, title, fn, danger) {
  const b = el('button', 'iconbtn' + (danger ? ' danger' : ''), glyph);
  b.title = title;
  b.onclick = fn;
  return b;
}

function refresh() { renderEditor(); renderPaper(); scheduleSave(); }

/* ───────────────────────── 상단 바 동작 ───────────────────────── */

/* ── 카테고리 고르기 메뉴 ── */
const presetMenu = document.getElementById('presetMenu');
const btnAddSection = document.getElementById('btnAddSection');

function addSection(preset) {
  state.sections.push(newSection(preset));
  collapsed.clear();
  pendingFocus = `s${state.sections.length - 1}`;   /* 새 카테고리는 제목부터 */
  refresh();
}

function buildPresetMenu() {
  presetMenu.innerHTML = '';
  presetMenu.appendChild(el('div', 'menu-cap', '어떤 카테고리를 추가할까요?'));

  SECTION_PRESETS.forEach(p => {
    const b = el('button', 'preset-item');
    b.appendChild(document.createTextNode(p.name));
    b.appendChild(el('small', null, p.desc));
    b.onclick = () => { closePresetMenu(); addSection(p); };
    presetMenu.appendChild(b);
  });

  const blank = el('button', 'preset-item blank', '빈 카테고리');
  blank.onclick = () => { closePresetMenu(); addSection(null); };
  presetMenu.appendChild(blank);
}

function openPresetMenu() {
  buildPresetMenu();
  presetMenu.hidden = false;
  document.addEventListener('click', onOutsideClick, true);
  document.addEventListener('keydown', onMenuKey);
}
function closePresetMenu() {
  presetMenu.hidden = true;
  document.removeEventListener('click', onOutsideClick, true);
  document.removeEventListener('keydown', onMenuKey);
}
function onOutsideClick(ev) {
  if (!presetMenu.contains(ev.target) && ev.target !== btnAddSection &&
      !btnAddSection.contains(ev.target)) closePresetMenu();
}
function onMenuKey(ev) { if (ev.key === 'Escape') closePresetMenu(); }

btnAddSection.onclick = () => {
  presetMenu.hidden ? openPresetMenu() : closePresetMenu();
};

document.getElementById('btnPrint').onclick = () => window.print();

document.getElementById('btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.name || 'resume'}-이력서.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

document.getElementById('btnImport').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = ev => {
  const f = ev.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      if (!data || !Array.isArray(data.sections)) throw new Error('형식 오류');
      state = data; collapsed.clear(); refresh();
    } catch (e) {
      alert('불러오기 실패: 올바른 이력서 JSON 파일이 아닙니다.');
    }
  };
  rd.readAsText(f);
  ev.target.value = '';
};

document.getElementById('btnReset').onclick = async () => {
  if (!confirm('입력한 내용을 모두 지우고 기본 예시로 되돌릴까요?')) return;
  state = await getDefaultData();
  collapsed.clear();
  refresh();
};

document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
    document.body.classList.toggle('show-editor', t.dataset.view === 'editor');
    document.body.classList.toggle('show-viewer', t.dataset.view === 'viewer');
    if (t.dataset.view === 'viewer') fitPaper();
  };
});

window.addEventListener('resize', fitPaper);

/* ───────────────────────── 시작 ───────────────────────── */

(async () => {
  if (!state) state = await getDefaultData();
  renderEditor();
  renderPaper();
  setSaveState('준비됨');
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
