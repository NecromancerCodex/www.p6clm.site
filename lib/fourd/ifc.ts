/**
 * 클라이언트 IFC 파서 (web-ifc WASM) → three.js 지오메트리 + 요소 메타.
 *
 * 성능: 16k+ 요소를 개별 Mesh로 만들면 draw call 폭발 → 단일 BufferGeometry +
 * 정점색상(vertexColors) 으로 합치고, 요소별 정점 범위(vStart/vCount)를 기록해
 * 타임라인 변경 시 해당 범위 색만 갱신한다 (1 draw call).
 *
 * web-ifc wasm 은 /public/web-ifc/ 에서 서빙 (SetWasmPath).
 * 'use client' 컴포넌트에서만 동적 import 로 사용 (SSR 불가).
 */
import * as THREE from "three";
import { IfcAPI, IFCRELCONTAINEDINSPATIALSTRUCTURE } from "web-ifc";

import type { IfcElementMeta } from "./match";

export interface ParsedElement extends IfcElementMeta {
  vStart: number; // 정점 시작 인덱스
  vCount: number; // 정점 개수
  cx: number; // bbox 중심 X (월드)
  cy: number; // bbox 중심 Y (월드, 수직)
  cz: number; // bbox 중심 Z (월드)
}

export interface ParsedIfc {
  geometry: THREE.BufferGeometry; // position + normal + color(동적)
  elements: ParsedElement[];
  center: THREE.Vector3;
  radius: number;
}

let _api: IfcAPI | null = null;

async function getApi(): Promise<IfcAPI> {
  if (_api) return _api;
  const api = new IfcAPI();
  api.SetWasmPath("/web-ifc/", true); // absolute=true → origin 루트(/web-ifc/web-ifc.wasm)에서 로드. false면 JS 청크 상대경로(_next/static/chunks/web-ifc/)로 붙어 404
  await api.Init();
  _api = api;
  return api;
}

/**
 * IFC STEP 문자열 디코드. web-ifc 는 한글을 \X2\<UTF-16BE hex>\X0\ 로 raw 반환한다.
 *   예: "502_1\X2\CE35\X0\ SL" → "502_1층 SL"  (CE35 = U+CE35 "층")
 * \X2\…\X0\ (UTF-16BE) 와 \X\HH (latin1) 만 처리. 인코딩 없으면 원본 그대로.
 */
function decodeIfcString(s: string): string {
  if (!s || s.indexOf("\\X") === -1) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("\\X2\\", i)) {
      i += 4;
      let hex = "";
      while (i < s.length && !s.startsWith("\\X0\\", i)) hex += s[i++];
      i += 4; // \X0\ 스킵
      for (let j = 0; j + 4 <= hex.length; j += 4) {
        out += String.fromCharCode(parseInt(hex.slice(j, j + 4), 16));
      }
    } else if (s.startsWith("\\X\\", i)) {
      out += String.fromCharCode(parseInt(s.slice(i + 3, i + 5), 16));
      i += 5;
    } else {
      out += s[i++];
    }
  }
  return out;
}

/** 요소 expressID → 소속 층 이름 (IfcRelContainedInSpatialStructure). */
function buildStoreyMap(api: IfcAPI, modelID: number): Map<number, string> {
  const map = new Map<number, string>();
  const RELS = api.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
  for (let i = 0; i < RELS.size(); i++) {
    const rel = api.GetLine(modelID, RELS.get(i));
    const struct = rel.RelatingStructure;
    let name = "";
    try {
      const s = api.GetLine(modelID, struct.value);
      name = decodeIfcString(s.Name?.value ?? "");
    } catch {
      name = "";
    }
    const related = rel.RelatedElements ?? [];
    for (const r of related) {
      map.set(r.value, name);
    }
  }
  return map;
}

const WANTED_TYPES = new Set([
  "IFCWALL",
  "IFCWALLSTANDARDCASE",
  "IFCSLAB",
  "IFCBEAM",
  "IFCCOLUMN",
  "IFCFOOTING",
  "IFCBUILDINGELEMENTPROXY",
  "IFCCOVERING",
  "IFCRAILING",
  "IFCMEMBER",
  "IFCPLATE",
]);

function toPascalIfc(upper: string): string {
  // "IFCWALLSTANDARDCASE" → "IfcWallStandardCase" (match.ts classify 와 호환)
  const map: Record<string, string> = {
    IFCWALL: "IfcWall",
    IFCWALLSTANDARDCASE: "IfcWallStandardCase",
    IFCSLAB: "IfcSlab",
    IFCBEAM: "IfcBeam",
    IFCCOLUMN: "IfcColumn",
    IFCFOOTING: "IfcFooting",
    IFCBUILDINGELEMENTPROXY: "IfcBuildingElementProxy",
    IFCCOVERING: "IfcCovering",
    IFCRAILING: "IfcRailing",
    IFCMEMBER: "IfcMember",
    IFCPLATE: "IfcPlate",
  };
  return map[upper] ?? upper;
}

/**
 * IFC ArrayBuffer → 파싱 결과.
 * onProgress: 0~1 진행률 콜백.
 */
export async function parseIfc(
  buffer: ArrayBuffer,
  onProgress?: (p: number, msg: string) => void,
): Promise<ParsedIfc> {
  const api = await getApi();
  onProgress?.(0.05, "모델 여는 중…");
  const modelID = api.OpenModel(new Uint8Array(buffer));

  onProgress?.(0.15, "층 구조 분석 중…");
  const storeyMap = buildStoreyMap(api, modelID);

  // 누적 버퍼
  const positions: number[] = [];
  const normals: number[] = [];
  const elements: ParsedElement[] = [];
  const tmp = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();

  onProgress?.(0.25, "지오메트리 스트리밍 중… (대용량 IFC는 1~2분)");

  // 요소별 메타 캐시 (globalId/type) — GetLine 호출 최소화
  const metaCache = new Map<number, { globalId: string; ifcType: string } | null>();
  function meta(expressID: number) {
    if (metaCache.has(expressID)) return metaCache.get(expressID)!;
    let out: { globalId: string; ifcType: string } | null = null;
    try {
      const line = api.GetLine(modelID, expressID);
      const typeCode = api.GetLineType(modelID, expressID);
      const typeName = api.GetNameFromTypeCode(typeCode) as unknown as string;
      out = {
        globalId: line.GlobalId?.value ?? String(expressID),
        ifcType: toPascalIfc(String(typeName).toUpperCase()),
      };
    } catch {
      out = null;
    }
    metaCache.set(expressID, out);
    return out;
  }

  let count = 0;
  api.StreamAllMeshes(modelID, (flatMesh: any) => {
    const expressID = flatMesh.expressID;
    const m = meta(expressID);
    if (!m) return;
    if (!WANTED_TYPES.has(m.ifcType.toUpperCase())) return;

    const vStart = positions.length / 3;
    const placed = flatMesh.geometries;
    for (let i = 0; i < placed.size(); i++) {
      const pg = placed.get(i);
      const geom = api.GetGeometry(modelID, pg.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const mat = pg.flatTransformation as number[];
      tmp.fromArray(mat);
      normalMat.getNormalMatrix(tmp);
      // web-ifc 정점 = [px,py,pz,nx,ny,nz] interleaved. 인덱스로 삼각형 전개(비인덱스).
      for (let k = 0; k < idx.length; k++) {
        const base = idx[k] * 6;
        v.set(verts[base], verts[base + 1], verts[base + 2]).applyMatrix4(tmp);
        n.set(verts[base + 3], verts[base + 4], verts[base + 5]).applyMatrix3(normalMat).normalize();
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
      }
    }
    const vCount = positions.length / 3 - vStart;
    if (vCount > 0) {
      // bbox 중심 (월드) — 그리드 베이 배정용
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      for (let i = vStart * 3; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (x < mnx) mnx = x;
        if (x > mxx) mxx = x;
        if (y < mny) mny = y;
        if (y > mxy) mxy = y;
        if (z < mnz) mnz = z;
        if (z > mxz) mxz = z;
      }
      elements.push({
        globalId: m.globalId,
        expressID,
        ifcType: m.ifcType,
        storeyName: storeyMap.get(expressID) ?? null,
        vStart,
        vCount,
        cx: (mnx + mxx) / 2,
        cy: (mny + mxy) / 2,
        cz: (mnz + mxz) / 2,
      });
    }
    count++;
    if (count % 1000 === 0) onProgress?.(Math.min(0.9, 0.25 + count / 20000), `요소 ${count}개…`);
  });

  api.CloseModel(modelID);
  onProgress?.(0.92, "버퍼 구성 중…");

  const geometry = new THREE.BufferGeometry();
  const posArr = new Float32Array(positions);
  geometry.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  // 색상 attribute (동적 갱신) — 초기 회색
  const colArr = new Float32Array(positions.length).fill(0.6);
  geometry.setAttribute("color", new THREE.BufferAttribute(colArr, 3));

  geometry.computeBoundingSphere();
  const bs = geometry.boundingSphere!;
  onProgress?.(1, `완료 — 요소 ${elements.length}개`);

  return {
    geometry,
    elements,
    center: bs.center.clone(),
    radius: bs.radius,
  };
}
