"use client";

/**
 * 4D 뷰어 — three.js 씬 + 타임라인 슬라이더.
 * use4DSchedule.js 로직 이식: 슬라이더 날짜 vs 요소 활동범위 → 정점색상 갱신.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

// three-mesh-bvh — 레이캐스트 O(삼각형수)→O(log) 가속. 대용량 단일 지오메트리 hover 렉 해소.
type BvhGeom = THREE.BufferGeometry & { computeBoundsTree: () => void; disposeBoundsTree: () => void };
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: unknown }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: unknown }).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as unknown as { raycast: unknown }).raycast = acceleratedRaycast;

import type { ParsedIfc, ParsedElement } from "../../lib/fourd/ifc";
import { statusAt, type MatchResult } from "../../lib/fourd/match";

// IFC 타입 → 한글 부재명
const TYPE_KO: Record<string, string> = {
  IfcWall: "벽",
  IfcWallStandardCase: "벽",
  IfcColumn: "기둥",
  IfcSlab: "슬래브",
  IfcBeam: "보",
  IfcFooting: "기초",
  IfcBuildingElementProxy: "부재",
  IfcCovering: "마감",
  IfcRailing: "난간",
  IfcMember: "부재",
  IfcPlate: "판",
};

/** "502_3층 SL" → "3층" (블록코드·공종코드 제거). */
function cleanStorey(name: string | null): string {
  if (!name) return "—";
  return name.replace(/^[A-Za-z0-9]+_/, "").replace(/\s+[A-Z]{1,3}$/, "").trim() || name;
}

/**
 * 표시용 층 — 공정 태그(storey4d)는 zone 도 있거나 높이보정된 경우만 신뢰(PT/RF 명시).
 * zone 없는 불완전 PT 태그(주차장지붕 등)는 공간 층 이름을 보여 사유와 일치시킨다.
 */
function storeyDisplay(el: ParsedElement): string {
  if (el.storey4d && (el.zone || el.recalibrated)) {
    return el.storey4d === "PT" ? "기초(PT)" : el.storey4d === "RF" ? "지붕(RF)" : `${Number(el.storey4d)}층`;
  }
  return cleanStorey(el.storeyName);
}

/** 공종코드 → 한글. */
function workKo(wt: string | undefined, via: string): string {
  const w = wt ?? "";
  if (w === "FT" || via.startsWith("FT")) return "기초";
  if (w === "CR" || via.startsWith("CR")) return "코어·골조(벽·기둥)";
  if (w === "PR") return "파라펫";
  if (w === "MD" || via.startsWith("MO")) return "모듈/마감";
  return w;
}

/** 부재의 공정 라벨 — 공정PSet(zone) 있으면 "ZA 3층 코어", 없으면 층 근사. */
function procLabel(el: ParsedElement, via: string): string {
  if (el.zone && el.storey4d) {
    const st = el.storey4d === "PT" ? "기초" : el.storey4d === "RF" ? "지붕" : `${Number(el.storey4d)}층`;
    // via 가 유닛 키(…|숫자)면 유닛 단위 매칭, …|MD 면 구역단위 묶음(공정표에 유닛 활동 없음)
    const isUnit = /\|\d+$/.test(via);
    const unit = el.unit ? (isUnit ? ` ${el.unit}호` : ` ${el.unit}호(구역단위 묶음)`) : "";
    return `${el.zone} ${st} ${workKo(el.wt, via)}${unit}`;
  }
  return `${cleanStorey(el.storeyName)} ${workKo(el.wt, via)}`;
}

/** 정점 인덱스 → 소속 요소 (elements 는 vStart 오름차순 → 이진탐색). */
function findElementByVertex(els: ParsedElement[], vIdx: number): ParsedElement | null {
  let lo = 0;
  let hi = els.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = els[mid];
    if (vIdx < e.vStart) hi = mid - 1;
    else if (vIdx >= e.vStart + e.vCount) lo = mid + 1;
    else return e;
  }
  return null;
}

/** 미매칭 사유 → 정확한 한글 설명 (via + 공간 층이름 기반). */
function unmatchedReason(via: string, storeyName: string | null): string {
  if (storeyName && storeyName.includes("주차장"))
    return "주차장지붕(별도/포디움 구조) — 공정표에 전용 일정 없음 (정책 매칭 대상)";
  if (via === "no_meta") return "BIM 공정 속성·층 정보 없음";
  if (via === "no_storey") return "층 인식 불가 (GL·기계실 등 비시공 레벨)";
  if (via.includes("PT")) return "기초(PT)층 — 공정표에 해당 공종 일정 없음";
  if (via.includes("RF")) return "지붕(RF) — 공정표에 해당 공종 일정 없음";
  return "공정표에 해당 공정단위 일정 없음";
}

// use4DSchedule.js 팔레트 (상태 모드)
const C_DONE = [0.063, 0.725, 0.506]; // green
const C_ACTIVE = [0.133, 0.827, 0.933]; // cyan
const C_PLANNED = [0.376, 0.647, 0.98]; // blue
const C_GHOST = [0.32, 0.34, 0.4]; // 미매칭 (어두운 회색)
const C_HILITE = [1.0, 0.85, 0.2]; // hover 공정단위 강조 (황색)

function colorFor(status: number): number[] {
  if (status === 2) return C_DONE;
  if (status === 1) return C_ACTIVE;
  if (status === 0) return C_PLANNED;
  return C_GHOST;
}

/** 실사 모드 — 부재 종류별 재질색 (콘크리트·유리·목재 등). */
function materialColor(ifcType: string): number[] {
  if (ifcType === "IfcFooting") return [0.40, 0.40, 0.38]; // 기초 — 진한 콘크리트
  if (ifcType === "IfcWall" || ifcType === "IfcWallStandardCase" || ifcType === "IfcColumn")
    return [0.70, 0.70, 0.67]; // 코어 — 콘크리트 회색
  if (ifcType === "IfcSlab" || ifcType === "IfcBeam") return [0.62, 0.62, 0.59]; // 슬래브·보
  if (ifcType === "IfcWindow" || ifcType === "IfcCurtainWall") return [0.42, 0.66, 0.82]; // 유리 — 청색
  if (ifcType === "IfcDoor") return [0.55, 0.40, 0.26]; // 문 — 목재 갈색
  if (ifcType === "IfcStair" || ifcType === "IfcStairFlight") return [0.66, 0.66, 0.63]; // 계단
  if (ifcType === "IfcRailing" || ifcType === "IfcMember") return [0.55, 0.56, 0.58]; // 난간·부재 — 금속
  if (ifcType === "IfcFurnishingElement") return [0.72, 0.66, 0.55]; // 가구
  if (ifcType === "IfcFlowTerminal") return [0.78, 0.78, 0.80]; // 설비
  if (ifcType === "IfcCovering") return [0.80, 0.76, 0.66]; // 마감 — 베이지
  return [0.78, 0.74, 0.66]; // 모듈/기타 — 프리캐스트 베이지
}

const C_CONTEXT = [0.52, 0.52, 0.52]; // 미매칭(공정無) 정적 컨텍스트 회색

/**
 * 요소의 표시 색·투명도.
 *  실사 ON: 완료=재질색 / 미매칭(공정無)=정적 회색(항상 보임, 컨텍스트) / 미착수·진행중=투명
 *  실사 OFF: 상태색 + 전체 불투명
 */
function elemColor(el: ParsedElement, status: number, realistic: boolean): { c: number[]; a: number } {
  if (realistic) {
    if (status === -1) return { c: C_CONTEXT, a: 1 }; // 공정 없는 실제 형상 → 정적 컨텍스트
    return { c: materialColor(el.ifcType), a: status === 2 ? 1 : 0 }; // 완료=재질, 미완성=투명
  }
  return { c: colorFor(status), a: 1 };
}

/** 요소 정점 범위에 RGBA 채우기. */
function paintElement(arr: Float32Array, el: ParsedElement, c: number[], a: number) {
  const end = (el.vStart + el.vCount) * 4;
  for (let i = el.vStart * 4; i < end; i += 4) {
    arr[i] = c[0];
    arr[i + 1] = c[1];
    arr[i + 2] = c[2];
    arr[i + 3] = a;
  }
}

interface Props {
  parsed: ParsedIfc;
  ranges: Map<string, MatchResult>;
  minDate: number;
  maxDate: number;
  activities?: { name: string; start: number; end: number }[];
  codeToName?: Map<string, string>; // 4D 코드 → 실제 활동명 (툴팁에 표시)
  /** '이 날짜 공사일보 생성' — 현재 슬라이더 날짜(ms)를 부모에 전달. 부모가 보유한 XER로 생성. */
  onGenerateDaily?: (dateMs: number) => void;
  dailyBusy?: boolean; // 공사일보 생성 진행 중
  /** 슬라이더 날짜 변경 통지 — 하단 공정표(간트) 세로선 동기용. */
  onDateChange?: (dateMs: number) => void;
}

/** 부재 PSet → 4D 활동코드 재구성 (pmisx ID 와 동일 형식). 예 502HGMOZB013607MDIN */
function reconstructCode(el: ParsedElement): string | null {
  if (!el.trade || !el.zone || !el.storey4d) return null;
  const ph = el.phase ?? "IN";
  if (el.trade === "MO") {
    if (!el.mtype || !el.unit) return null;
    return `502HGMO${el.zone}${el.storey4d}${el.mtype}${el.unit.padStart(2, "0")}MD${ph}`;
  }
  return `502HGST${el.zone}${el.storey4d}${el.wt ?? ""}${ph}`;
}

const DAY = 86400000;
function fmt(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FourDViewer({ parsed, ranges, minDate, maxDate, activities = [], codeToName, onGenerateDaily, dailyBusy = false, onDateChange }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const hiliteViaRef = useRef<string | null>(null); // 현재 강조 키 (유닛=via / 객체=globalId)
  const hiliteModeRef = useRef<"unit" | "object">("unit");
  const [hiliteMode, setHiliteMode] = useState<"unit" | "object">("unit"); // 강조 단위 토글
  // 슬라이더는 정수 day-index(0..numDays)로 구동한다. epoch ms 격자로 돌리면
  // value↔step 불일치로 controlled input 이 onChange 무한 재발화(React #185)를 일으킨다.
  const tMin = useMemo(() => Math.floor(minDate / DAY) * DAY, [minDate]);
  const numDays = useMemo(
    () => Math.max(1, Math.ceil((maxDate - minDate) / DAY)),
    [minDate, maxDate],
  );
  // 초기: 오늘(공기 범위 안으로 clamp). 범위 밖이면 가까운 끝. → 공사일보 '금일' 디폴트와 일치.
  const [dayIdx, setDayIdx] = useState<number>(() =>
    Math.min(Math.max(Math.round((Date.now() - tMin) / DAY), 0), numDays),
  );
  const dateMs = tMin + dayIdx * DAY;
  // 슬라이더 날짜를 부모로 통지 → 하단 공정표 세로선 동기
  useEffect(() => {
    onDateChange?.(dateMs);
  }, [dateMs, onDateChange]);
  const [kpi, setKpi] = useState({ done: 0, active: 0, planned: 0, ghost: 0 });
  // 마우스 오버한 요소 (툴팁) — 화면 좌표 + 요소
  const [hover, setHover] = useState<{ x: number; y: number; el: ParsedElement } | null>(null);
  // 실사 모드 (재질색 + 미완성 투명) — ref 로 효과에서 즉시 참조
  const [realistic, setRealistic] = useState(false);
  const realisticRef = useRef(false);
  realisticRef.current = realistic;
  // 자유시점(WASD 이동) 모드
  const [fly, setFly] = useState(false);
  const flyRef = useRef(false);
  flyRef.current = fly;

  // ── three.js 씬 1회 셋업 ──
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1116);
    sceneRef.current = scene;

    const w = mount.clientWidth;
    const h = mount.clientHeight;
    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, parsed.radius * 50);
    const r = parsed.radius || 50;
    camera.position.set(parsed.center.x + r * 1.4, parsed.center.y + r * 1.2, parsed.center.z + r * 1.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(parsed.center);
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 2, 1);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-1, 1, -1);
    scene.add(dir2);

    // alphaTest: 정점 alpha 0(미완성)인 조각은 버려 완전 투명·깊이미기록 → 깔끔한 성장 효과
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(parsed.geometry, material);
    scene.add(mesh);
    colorAttrRef.current = parsed.geometry.getAttribute("color") as THREE.BufferAttribute;
    // BVH 빌드(1회) — 이후 hover 레이캐스트가 즉시 응답
    try {
      (parsed.geometry as BvhGeom).computeBoundsTree();
    } catch {
      /* BVH 빌드 실패 시 일반 레이캐스트 폴백 */
    }

    // 바닥 그리드 — 건물 실제 바닥(bbox.min.y)에 맞춰 띄움 방지. radius(구 반지름)는 넓은 U자에서
    // 높이보다 훨씬 커 바닥이 한참 내려감 → 건물이 떠 보이던 원인.
    parsed.geometry.computeBoundingBox();
    const groundY = parsed.geometry.boundingBox?.min.y ?? parsed.center.y - parsed.radius;
    const gridSize = parsed.radius * 4;
    const grid = new THREE.GridHelper(gridSize, 40, 0x4ade80, 0x15803d); // 초원 그린
    grid.position.set(parsed.center.x, groundY, parsed.center.z);
    scene.add(grid);
    // 초원 바닥면 (그리드 살짝 아래 — z-fighting 방지)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(gridSize, gridSize),
      new THREE.MeshLambertMaterial({ color: 0x14532d, side: THREE.DoubleSide }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(parsed.center.x, groundY - 0.3, parsed.center.z);
    scene.add(ground);

    // ── WASD 자유시점 ── 누른 키 추적 → 카메라+타겟 함께 이동(마우스 회전 유지)
    const keys: Record<string, boolean> = {};
    const moveCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ControlLeft", "KeyQ", "KeyE"]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (!flyRef.current) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      keys[e.code] = true;
      if (moveCodes.has(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys[e.code] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    const clock = new THREE.Clock();
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const move = new THREE.Vector3();

    let raf = 0;
    const animate = () => {
      const dt = clock.getDelta();
      if (flyRef.current) {
        const spd = (parsed.radius || 50) * 1.4 * dt;
        camera.getWorldDirection(fwd);
        right.crossVectors(fwd, camera.up).normalize();
        move.set(0, 0, 0);
        if (keys["KeyW"]) move.add(fwd);
        if (keys["KeyS"]) move.addScaledVector(fwd, -1);
        if (keys["KeyD"]) move.add(right);
        if (keys["KeyA"]) move.addScaledVector(right, -1);
        if (keys["Space"] || keys["KeyE"]) move.y += 1;
        if (keys["ShiftLeft"] || keys["ControlLeft"] || keys["KeyQ"]) move.y -= 1;
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(spd);
          camera.position.add(move);
          controls.target.add(move);
        }
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const nw = mount.clientWidth;
      const nh = mount.clientHeight;
      if (nw === 0 || nh === 0) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);
    // 컨테이너 크기 변화(공정표·토글로 뷰어 높이 변동)에도 캔버스 동기 → 레이캐스트 좌표 언싱크 방지
    const ro = new ResizeObserver(() => onResize());
    ro.observe(mount);

    // ── 마우스 오버 → 레이캐스트로 요소 식별 (70ms 스로틀) ──
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let lastRC = 0;
    const onMove = (ev: PointerEvent) => {
      if (ev.timeStamp - lastRC < 70) return;
      lastRC = ev.timeStamp;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObject(mesh, false);
      const hit = hits[0];
      if (!hit) {
        setHover(null);
        return;
      }
      // three-mesh-bvh 가 BVH 생성 시 geometry 에 index 를 추가 → faceIndex*3 은 더 이상
      // position 인덱스가 아님(언싱크 원인). face.a 는 index 해석된 실제 정점 인덱스라 안전.
      const vPos = hit.face ? hit.face.a : (hit.faceIndex ?? 0) * 3;
      const el = findElementByVertex(parsed.elements, vPos);
      setHover(el ? { x: ev.clientX - rect.left, y: ev.clientY - rect.top, el } : null);
    };
    const onLeave = () => setHover(null);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      renderer.dispose();
      try {
        (parsed.geometry as BvhGeom).disposeBoundsTree();
      } catch {
        /* noop */
      }
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [parsed]);

  // ── 날짜 변경 → 색상 갱신 (RAF 스로틀) ──
  // 드래그 중 onChange 가 프레임당 수십 번 발생하면 10,890개 정점색 재계산이 동기로
  // 쌓여 React 19 가 업데이트 폭주(#185)로 판단할 수 있다. 직전 프레임을 취소하고
  // 마지막 값만 계산해 프레임당 1회로 합친다.
  useEffect(() => {
    const attr = colorAttrRef.current;
    if (!attr) return;
    const raf = requestAnimationFrame(() => {
      const arr = attr.array as Float32Array;
      const realistic = realisticRef.current;
      const hk = hiliteViaRef.current;
      const hmode = hiliteModeRef.current;
      const counts = { done: 0, active: 0, planned: 0, ghost: 0 };
      // 전체 재색칠 (정확성 우선 — 부분 업로드는 정합성 버그로 폐기)
      for (const el of parsed.elements) {
        const mr = ranges.get(el.globalId);
        const st = statusAt(dateMs, mr?.range ?? null);
        if (st === 2) counts.done++;
        else if (st === 1) counts.active++;
        else if (st === 0) counts.planned++;
        else counts.ghost++;
        const isHi = hk != null && (hmode === "object" ? el.globalId === hk : mr?.via === hk);
        if (isHi) paintElement(arr, el, C_HILITE, 1);
        else {
          const { c, a } = elemColor(el, st, realistic);
          paintElement(arr, el, c, a);
        }
      }
      attr.needsUpdate = true;
      setKpi((prevK) =>
        prevK.done === counts.done &&
        prevK.active === counts.active &&
        prevK.planned === counts.planned &&
        prevK.ghost === counts.ghost
          ? prevK
          : counts,
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [dateMs, parsed, ranges, realistic]);

  // ── hover 한 공정단위 실제 부재를 황색 강조 (증분: 그룹이 바뀔 때만 재색칠) ──
  // 박스(AABB)는 U자 형상에서 겹쳐 부정확 → 실제 부재를 칠해 정확한 공정 범위를 보인다.
  const [hiliteCount, setHiliteCount] = useState(0);
  useEffect(() => {
    const attr = colorAttrRef.current;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    const mode = hiliteMode;
    const mr = hover ? ranges.get(hover.el.globalId) : undefined;
    // 유닛 모드 = via 그룹 강조 / 객체 모드 = 그 부재 1개만 강조
    const newKey = !hover ? null : mode === "object" ? hover.el.globalId : mr?.range ? mr.via : null;
    const prevKey = hiliteViaRef.current;
    const prevMode = hiliteModeRef.current;
    if (newKey === prevKey && mode === prevMode) return; // 변화 없음

    const realistic = realisticRef.current;
    const matches = (el: ParsedElement, key: string, m: "unit" | "object") =>
      m === "object" ? el.globalId === key : ranges.get(el.globalId)?.via === key;

    // 1) 이전 강조 → 원래 색·투명도 복원
    if (prevKey) {
      for (const el of parsed.elements) {
        if (!matches(el, prevKey, prevMode)) continue;
        const st = statusAt(dateMs, ranges.get(el.globalId)?.range ?? null);
        const { c, a } = elemColor(el, st, realistic);
        paintElement(arr, el, c, a);
      }
    }
    // 2) 새 강조 → 황색 (항상 보이게)
    let count = 0;
    if (newKey) {
      for (const el of parsed.elements) {
        if (!matches(el, newKey, mode)) continue;
        paintElement(arr, el, C_HILITE, 1);
        count++;
      }
    }
    hiliteViaRef.current = newKey;
    hiliteModeRef.current = mode;
    attr.needsUpdate = true;
    setHiliteCount(count);
  }, [hover, parsed, ranges, dateMs, hiliteMode]);

  const pct = Math.round((dayIdx / numDays) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{ position: "relative", flex: 1, minHeight: 360 }}>
        <div
          ref={mountRef}
          style={{ position: "absolute", inset: 0, borderRadius: 8, overflow: "hidden", background: "#0e1116" }}
        />
        {hover &&
          (() => {
            const mr = ranges.get(hover.el.globalId);
            const range = mr?.range ?? null;
            const st = statusAt(dateMs, range);
            const code4d = reconstructCode(hover.el); // 4D 활동코드 (pmisx ID 형식)
            const actName = code4d ? codeToName?.get(code4d) : undefined; // 실제 활동명
            const stMeta =
              st === 2
                ? { t: "완료", c: "#10b981" }
                : st === 1
                  ? { t: "진행중", c: "#22d3ee" }
                  : st === 0
                    ? { t: "미착수", c: "#60a5fa" }
                    : { t: "미매칭", c: "#9ca3af" };
            return (
              <div
                style={{
                  position: "absolute",
                  left: Math.min(hover.x + 14, 9999),
                  top: hover.y + 14,
                  maxWidth: 280,
                  padding: "8px 10px",
                  background: "rgba(15,17,22,0.95)",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  fontSize: 12,
                  lineHeight: 1.6,
                  pointerEvents: "none",
                  zIndex: 10,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                }}
              >
                <div style={{ fontWeight: 600, maxWidth: 320, wordBreak: "break-all" }}>
                  {hover.el.name || (TYPE_KO[hover.el.ifcType] ?? hover.el.ifcType)}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  {TYPE_KO[hover.el.ifcType] ?? hover.el.ifcType} · {storeyDisplay(hover.el)}
                  {hover.el.zone ? ` · ${hover.el.zone}` : ""}
                </div>
                {range && mr ? (
                  <>
                    <div>공정: {actName || procLabel(hover.el, mr.via)}</div>
                    {code4d && (
                      <div style={{ fontSize: 10, color: "#64748b", fontFamily: "monospace" }}>ID: {code4d}</div>
                    )}
                    {hover.el.recalibrated && (
                      <div style={{ color: "#fbbf24", fontSize: 11 }}>
                        ⚙ BIM PT태그 → 높이로 {storeyDisplay(hover.el)} 보정 (시공순서 정합)
                      </div>
                    )}
                    <div
                      style={{
                        color: mr.via.startsWith("policy")
                          ? "#c4b5fd"
                          : mr.via.startsWith("seq")
                            ? "#f0abfc"
                            : mr.via.includes("|")
                              ? "#34d399"
                              : "#94a3b8",
                        fontSize: 11,
                      }}
                    >
                      {mr.via.startsWith("policy")
                        ? "◇ 정책(AI) 매칭 — 시공순서 추론"
                        : mr.via.startsWith("seq")
                          ? "▷ 순서기반(규칙) — 선후행 보간 날짜"
                          : mr.via.includes("|")
                            ? "✓ 구역 정확 매칭"
                            : "○ 층 단위 매칭 (구역 미상)"}
                    </div>
                    {hiliteCount > 0 && (
                      <div style={{ color: "#fbbf24" }}>
                        {hiliteMode === "object"
                          ? "이 부재 1개 강조 (객체 모드)"
                          : `이 공정단위 부재 ${hiliteCount.toLocaleString()}개 강조 중`}
                      </div>
                    )}
                    <div style={{ color: "#94a3b8" }}>
                      기간: {fmt(range.start)} ~ {fmt(range.end)}
                    </div>
                    <div style={{ color: stMeta.c, fontWeight: 600 }}>상태: {stMeta.t}</div>
                  </>
                ) : (
                  <div style={{ color: "#fbbf24" }}>
                    미매칭 — {unmatchedReason(ranges.get(hover.el.globalId)?.via ?? "", hover.el.storeyName)}
                  </div>
                )}
              </div>
            );
          })()}
      </div>

      {/* KPI + 실사 모드 토글 */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13, alignItems: "center" }}>
        <span style={{ color: "#10b981" }}>● 완료 {kpi.done.toLocaleString()}</span>
        <span style={{ color: "#22d3ee" }}>● 진행중 {kpi.active.toLocaleString()}</span>
        <span style={{ color: "#60a5fa" }}>● 미착수 {kpi.planned.toLocaleString()}</span>
        <span style={{ color: "#6b7280" }}>● 미매칭 {kpi.ghost.toLocaleString()}</span>
        <button
          onClick={() => setHiliteMode((v) => (v === "unit" ? "object" : "unit"))}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid " + (hiliteMode === "object" ? "#f59e0b" : "#475569"),
            background: hiliteMode === "object" ? "#f59e0b" : "transparent",
            color: hiliteMode === "object" ? "#fff" : "#94a3b8",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
          title="유닛 = 같은 공정단위 전체 강조 / 객체 = 호버한 부재 1개만 강조"
        >
          {hiliteMode === "object" ? "🔍 객체로 보기" : "📦 유닛으로 보기"}
        </button>
        <button
          onClick={() => setFly((v) => !v)}
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid " + (fly ? "#3b82f6" : "#475569"),
            background: fly ? "#3b82f6" : "transparent",
            color: fly ? "#fff" : "#94a3b8",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
          title="WASD 이동 · Space/E 위 · Shift/Q 아래 · 마우스 드래그 회전"
        >
          {fly ? "🎮 자유시점 ON (WASD)" : "자유시점 OFF"}
        </button>
        <button
          onClick={() => setRealistic((v) => !v)}
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid " + (realistic ? "#10b981" : "#475569"),
            background: realistic ? "#10b981" : "transparent",
            color: realistic ? "#fff" : "#94a3b8",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
          title="재질색(콘크리트 등) + 완성된 부재만 표시 (미완성 투명)"
        >
          {realistic ? "🏗 실사 모드 ON" : "실사 모드 OFF"}
        </button>
      </div>
      {fly && (
        <div style={{ fontSize: 11, color: "#93c5fd", marginTop: -4 }}>
          🎮 자유시점: W/A/S/D 이동 · Space·E 위 · Shift·Q 아래 · 마우스 드래그 시점 회전
        </div>
      )}

      {/* 타임라인 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <strong style={{ minWidth: 96 }}>{fmt(dateMs)}</strong>
        <input
          type="range"
          min={0}
          max={numDays}
          step={1}
          value={dayIdx}
          onChange={(e) => setDayIdx(Number(e.target.value))}
          style={{ flex: 1 }}
          aria-label="공정 시뮬레이션 날짜"
        />
        <span style={{ minWidth: 44, textAlign: "right" }}>{pct}%</span>
        {onGenerateDaily && (
          <button
            type="button"
            onClick={() => onGenerateDaily(dateMs)}
            disabled={dailyBusy}
            title={`${fmt(dateMs)} 기준 공사일보를 작성합니다`}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: "none",
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              color: "#fff",
              background: dailyBusy ? "#64748b" : "#2563eb",
              cursor: dailyBusy ? "default" : "pointer",
            }}
          >
            {dailyBusy ? "작성 중…" : "📄 이 날짜 공사일보"}
          </button>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af" }}>
        <span>{fmt(tMin)}</span>
        <span>{fmt(tMin + numDays * DAY)}</span>
      </div>

      {/* 공정표(간트)는 페이지 하단 DashboardSchedule(frappe-gantt)로 분리 — 이전 공정표 스타일 */}
    </div>
  );
}
