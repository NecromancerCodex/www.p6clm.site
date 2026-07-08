/**
 * 클라이언트 XER 파서 — Primavera P6 .xer (탭 구분 텍스트)에서 4D 매칭에 필요한
 * 최소 필드만 추출. 백엔드 /schedule/upload 가 4D 코드(task_code/UDF)·target 날짜를
 * 돌려주지 않아 매칭이 0건이 되는 문제를 우회한다.
 *
 * XER 구조:
 *   %T <TABLE>      테이블 시작
 *   %F col1 col2 …  헤더(컬럼명)
 *   %R val1 val2 …  데이터 행 (다음 %T 까지 반복)
 *
 * 4D 코드 위치(둘 다 지원):
 *   - TASK.task_code 자체가 502HG… (ActID수정 XER)
 *   - UDFVALUE.udf_text (udf_type_id = "Act ID_4D" 타입, fk_id=task_id) (원본 XER)
 *
 * 인코딩: 파일은 CP949지만 코드·날짜는 ASCII라 UTF-8 디코드(File.text())로 충분.
 * (한글 task_name 은 깨지지만 매칭에 미사용.)
 */
import type { ScheduleTask } from "./match";

interface XerTable {
  cols: Map<string, number>; // 컬럼명 → 인덱스(0-base, %R 마커 제외 후)
  rows: string[][]; // 각 행의 값 배열
}

/** XER 텍스트 → 테이블맵. %R 행의 첫 토큰(%R)은 제거하여 cols 인덱스와 정렬. */
function parseTables(text: string): Map<string, XerTable> {
  const tables = new Map<string, XerTable>();
  let cur: XerTable | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("%T")) {
      const name = line.split("\t")[1]?.trim() ?? "";
      cur = { cols: new Map(), rows: [] };
      tables.set(name, cur);
    } else if (line.startsWith("%F") && cur) {
      const fields = line.split("\t").slice(1); // %F 제거
      fields.forEach((f, i) => cur!.cols.set(f.trim(), i));
    } else if (line.startsWith("%R") && cur) {
      cur.rows.push(line.split("\t").slice(1)); // %R 제거 → cols 인덱스와 정렬
    }
  }
  return tables;
}

const get = (row: string[], cols: Map<string, number>, name: string): string => {
  const i = cols.get(name);
  return i === undefined ? "" : (row[i] ?? "").trim();
};

/** "2026-01-23 08:00" → "2026-01-23T08:00" (Safari Date.parse 호환). 빈값/형식불일치는 null. */
function toIso(v: string): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/.exec(v);
  if (!m) return null;
  return m[2] ? `${m[1]}T${m[2]}` : m[1];
}

/** UDFTYPE 에서 "Act ID_4D"(또는 4D 라벨) udf_type_id 탐색. */
function find4dUdfTypeId(tables: Map<string, XerTable>): string | null {
  const t = tables.get("UDFTYPE");
  if (!t) return null;
  for (const row of t.rows) {
    const label = get(row, t.cols, "udf_type_label");
    const name = get(row, t.cols, "udf_type_name");
    if (/4d/i.test(label) || /act.?id/i.test(label) || /4d/i.test(name)) {
      return get(row, t.cols, "udf_type_id");
    }
  }
  return null;
}

/** UDFVALUE → Map<task_id, 4D 코드>. typeId 에 해당하는 udf_text 만. */
function buildUdfMap(tables: Map<string, XerTable>, typeId: string | null): Map<string, string> {
  const map = new Map<string, string>();
  const t = tables.get("UDFVALUE");
  if (!t || !typeId) return map;
  for (const row of t.rows) {
    if (get(row, t.cols, "udf_type_id") !== typeId) continue;
    const code = get(row, t.cols, "udf_text");
    if (code) map.set(get(row, t.cols, "fk_id"), code);
  }
  return map;
}


/** PROJWBS → wbs_id 별 (경로 문자열, 트리 DFS rank). P6 화면과 같은 WBS 순서(부모 seq_num 우선). */
function buildWbsIndex(tables: Map<string, XerTable>): Map<string, { path: string; rank: number }> {
  const out = new Map<string, { path: string; rank: number }>();
  const t = tables.get("PROJWBS");
  if (!t) return out;
  interface Node { id: string; parent: string; name: string; seq: number }
  const nodes = new Map<string, Node>();
  for (const row of t.rows) {
    const id = get(row, t.cols, "wbs_id");
    if (!id) continue;
    nodes.set(id, {
      id,
      parent: get(row, t.cols, "parent_wbs_id"),
      name: get(row, t.cols, "wbs_name") || id,
      seq: Number(get(row, t.cols, "seq_num")) || 0,
    });
  }
  const children = new Map<string, Node[]>();
  const roots: Node[] = [];
  for (const n of nodes.values()) {
    if (n.parent && nodes.has(n.parent)) {
      (children.get(n.parent) ?? children.set(n.parent, []).get(n.parent)!).push(n);
    } else roots.push(n);
  }
  const bySeq = (a: Node, b: Node) => a.seq - b.seq || (a.name < b.name ? -1 : 1);
  let rank = 0;
  const walk = (n: Node, path: string[]) => {
    const p = [...path, n.name];
    out.set(n.id, { path: p.slice(1).join(".") || n.name, rank: rank++ }); // 루트(프로젝트명) 생략 · "." = frappe 포크의 WBS 그룹 구분자
    for (const c of (children.get(n.id) ?? []).sort(bySeq)) walk(c, p);
  };
  for (const r of roots.sort(bySeq)) walk(r, []);
  return out;
}

/**
 * XER 텍스트 → ScheduleTask[].
 *  code  = UDF 4D 코드 우선, 없으면 task_code (502HG 형식이면)
 *  start = act_start_date → target_start_date → early_start_date
 *  end   = act_end_date  → target_end_date  → early_end_date
 */
export function parseXerTasks(text: string): ScheduleTask[] {
  const tables = parseTables(text);
  const task = tables.get("TASK");
  if (!task) return [];

  const udfMap = buildUdfMap(tables, find4dUdfTypeId(tables));
  const wbsIdx = buildWbsIndex(tables);

  // task_id → 활동명 (선후행 표시용 — 프론트는 EUC-KR 디코드라 한글 정상)
  const idToName = new Map<string, string>();
  for (const row of task.rows) {
    idToName.set(get(row, task.cols, "task_id"), get(row, task.cols, "task_name") || "");
  }
  // TASKPRED → 선행(pred_task_id) / 후행(task_id) 관계 채굴
  const predsOf = new Map<string, string[]>();
  const succsOf = new Map<string, string[]>();
  const tp = tables.get("TASKPRED");
  if (tp) {
    for (const row of tp.rows) {
      const tid = get(row, tp.cols, "task_id"); // 후행(이 활동)
      const pid = get(row, tp.cols, "pred_task_id"); // 선행
      if (!tid || !pid) continue;
      (predsOf.get(tid) ?? predsOf.set(tid, []).get(tid)!).push(pid);
      (succsOf.get(pid) ?? succsOf.set(pid, []).get(pid)!).push(tid);
    }
  }
  const names = (ids: string[] | undefined) =>
    [...new Set(ids ?? [])].map((id) => idToName.get(id) || id).filter(Boolean);

  const out: ScheduleTask[] = [];
  for (const row of task.rows) {
    const taskId = get(row, task.cols, "task_id");
    // UDF 4D 코드 우선(원본 XER), 없으면 task_code(ActID수정 XER 는 task_code 자체가 4D 코드)
    const code = udfMap.get(taskId) || get(row, task.cols, "task_code");

    const start =
      toIso(get(row, task.cols, "act_start_date")) ||
      toIso(get(row, task.cols, "target_start_date")) ||
      toIso(get(row, task.cols, "early_start_date"));
    const end =
      toIso(get(row, task.cols, "act_end_date")) ||
      toIso(get(row, task.cols, "target_end_date")) ||
      toIso(get(row, task.cols, "early_end_date"));

    out.push({
      code,
      name: get(row, task.cols, "task_name") || undefined,
      start,
      end,
      preds: names(predsOf.get(taskId)),
      succs: names(succsOf.get(taskId)),
      wbs: wbsIdx.get(get(row, task.cols, "wbs_id"))?.path,
      wbsRank: wbsIdx.get(get(row, task.cols, "wbs_id"))?.rank,
    });
  }
  return out;
}
