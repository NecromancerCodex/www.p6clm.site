/**
 * 최소 DXF(ASCII) 파서 — 의존성 0. group-code 쌍을 읽어 토공에 필요한 엔티티만 추출.
 * 지원: LWPOLYLINE / POLYLINE+VERTEX / LINE / POINT / TEXT·MTEXT / INSERT / CIRCLE.
 * (DWG는 미지원 — DXF로 내보내서 사용. 아크 bulge·스플라인은 꼭짓점만 취함.)
 */

export interface DxfVertex { x: number; y: number; z: number; }
export interface DxfEntity {
  type: string;            // LWPOLYLINE, LINE, POINT, TEXT, INSERT, CIRCLE ...
  layer: string;
  verts: DxfVertex[];      // 폴리라인/선/점 꼭짓점 (INSERT·TEXT·POINT·CIRCLE 은 [기준점])
  text?: string;           // TEXT/MTEXT 내용, INSERT 블록명
  radius?: number;         // CIRCLE 반지름
  elevation?: number;      // LWPOLYLINE 표고(code 38) 또는 정점 z
  closed?: boolean;        // LWPOLYLINE 닫힘(flag 70 & 1)
}

export interface DxfDoc {
  entities: DxfEntity[];
  layers: string[];        // 등장한 레이어 목록(중복 제거)
}

/** DXF 텍스트 → (code, value) 쌍 배열. */
function tokenize(text: string): { code: number; value: string }[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: { code: number; value: string }[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { i -= 1; continue; }  // 홀수 정렬 깨짐 방지(관대)
    out.push({ code, value: lines[i + 1] });
  }
  return out;
}

const NUM = (s: string) => { const v = parseFloat(String(s).trim()); return Number.isFinite(v) ? v : 0; };

export function parseDxf(text: string): DxfDoc {
  const toks = tokenize(text);
  // ENTITIES 섹션만 대상. (SECTION/ENTITIES … ENDSEC)
  let start = 0;
  for (let i = 0; i < toks.length - 1; i++) {
    if (toks[i].code === 2 && toks[i].value.trim().toUpperCase() === "ENTITIES") { start = i + 1; break; }
  }
  const entities: DxfEntity[] = [];
  const layerSet = new Set<string>();

  let cur: DxfEntity | null = null;
  let poly: DxfEntity | null = null;       // POLYLINE 진행 중(VERTEX 수집)
  let pendingX: number | null = null;      // LWPOLYLINE 정점 x 대기

  const flush = () => { if (cur) { entities.push(cur); if (cur.layer) layerSet.add(cur.layer); } cur = null; pendingX = null; };

  for (let i = start; i < toks.length; i++) {
    const { code, value } = toks[i];
    if (code === 0) {
      const t = value.trim().toUpperCase();
      if (t === "ENDSEC") { flush(); if (poly) { entities.push(poly); if (poly.layer) layerSet.add(poly.layer); poly = null; } break; }
      // 새 엔티티 시작
      if (t === "VERTEX" && poly) { flush(); cur = { type: "VERTEX", layer: poly.layer, verts: [] }; continue; }
      if (t === "SEQEND") { flush(); if (poly) { entities.push(poly); if (poly.layer) layerSet.add(poly.layer); poly = null; } continue; }
      flush();
      if (t === "POLYLINE") { poly = { type: "POLYLINE", layer: "0", verts: [] }; cur = null; continue; }
      cur = { type: t, layer: "0", verts: [] };
      continue;
    }
    const target = cur ?? poly;
    if (!target) continue;
    switch (code) {
      case 8: target.layer = value.trim(); break;
      case 10:
        if (target.type === "LWPOLYLINE") { pendingX = NUM(value); }
        else { target.verts.push({ x: NUM(value), y: 0, z: 0 }); }
        break;
      case 20:
        if (target.type === "LWPOLYLINE" && pendingX !== null) { target.verts.push({ x: pendingX, y: NUM(value), z: 0 }); pendingX = null; }
        else if (target.verts.length) { target.verts[target.verts.length - 1].y = NUM(value); }
        break;
      case 30:
        if (target.verts.length) target.verts[target.verts.length - 1].z = NUM(value);
        break;
      case 11: target.verts.push({ x: NUM(value), y: 0, z: 0 }); break;   // LINE 끝점 x
      case 21: if (target.verts.length) target.verts[target.verts.length - 1].y = NUM(value); break;
      case 31: if (target.verts.length) target.verts[target.verts.length - 1].z = NUM(value); break;
      case 38: target.elevation = NUM(value); break;                       // LWPOLYLINE 표고
      case 40: if (target.type === "CIRCLE") target.radius = NUM(value); break;
      case 70: if (target.type === "LWPOLYLINE" && (parseInt(value, 10) & 1)) target.closed = true; break;
      case 1: target.text = value; break;                                  // TEXT/MTEXT 내용
      case 2: if (target.type === "INSERT") target.text = value.trim(); break;  // INSERT 블록명
      default: break;
    }
    // VERTEX → POLYLINE 로 흡수
    if (cur && cur.type === "VERTEX" && poly && cur.verts.length) {
      // 다음 0 코드에서 flush 되며 poly.verts 에 합쳐짐
    }
  }
  // VERTEX 들을 POLYLINE.verts 로 병합 (flush 로 entities 에 들어간 VERTEX 회수)
  const merged: DxfEntity[] = [];
  let polyAcc: DxfEntity | null = null;
  for (const e of entities) {
    if (e.type === "POLYLINE") { polyAcc = e; merged.push(e); }
    else if (e.type === "VERTEX") { if (polyAcc && e.verts[0]) polyAcc.verts.push(e.verts[0]); }
    else { polyAcc = null; merged.push(e); }
  }
  return { entities: merged, layers: [...layerSet] };
}
