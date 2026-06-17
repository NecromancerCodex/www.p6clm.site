"use client";

/**
 * 토공/지반 3D 뷰어 — 층별 입체 슬랩(상면+하면+측벽) + 시추공 기둥.
 * three.js. 좌표 매핑: three.x=로컬X, three.z=로컬Y, three.y=표고(EL).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { LAYERS, pointInPoly, type Borehole, type GridModel } from "../../lib/earthwork/model";

/**
 * 한 층(top/bot 표고격자) → 닫힌 슬랩 BufferGeometry (상면+하면+측벽).
 * inside(cx,cy) 주면 셀 중심이 그 안인 셀만 생성 → 땅이 대지경계선 모양으로 잘림. 경계엔 측벽 자동.
 */
function buildSlab(g: GridModel, m: number, inside?: (cx: number, cy: number) => boolean): THREE.BufferGeometry {
  const { nx, ny, lx, ly, ifaces } = g;
  const top = ifaces[m];
  const bot = ifaces[m + 1];
  const pos: number[] = [];
  const idx: number[] = [];
  let v = 0;
  const vert = (x: number, y: number, z: number) => { pos.push(x, y, z); return v++; };
  const cellIn = (ix: number, iy: number) => {
    if (ix < 0 || iy < 0 || ix >= nx - 1 || iy >= ny - 1) return false; // 격자 밖
    if (!inside) return true;
    return inside((lx[ix] + lx[ix + 1]) / 2, (ly[iy] + ly[iy + 1]) / 2);
  };
  const wall = (p0: number, p1: number, q0: number, q1: number) => idx.push(p0, p1, q1, p0, q1, q0);
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      if (!cellIn(ix, iy)) continue;
      const x0 = lx[ix], x1 = lx[ix + 1], y0 = ly[iy], y1 = ly[iy + 1];
      const tA = vert(x0, top[iy][ix], y0), tB = vert(x1, top[iy][ix + 1], y0);
      const tC = vert(x1, top[iy + 1][ix + 1], y1), tD = vert(x0, top[iy + 1][ix], y1);
      const bA = vert(x0, bot[iy][ix], y0), bB = vert(x1, bot[iy][ix + 1], y0);
      const bC = vert(x1, bot[iy + 1][ix + 1], y1), bD = vert(x0, bot[iy + 1][ix], y1);
      idx.push(tA, tB, tC, tA, tC, tD); // 상면
      idx.push(bA, bC, bB, bA, bD, bC); // 하면
      // 측벽 — 이웃 셀이 경계 밖(또는 격자 밖)인 변에만
      if (!cellIn(ix, iy - 1)) wall(tA, tB, bA, bB); // 앞(y0)
      if (!cellIn(ix, iy + 1)) wall(tD, tC, bD, bC); // 뒤(y1)
      if (!cellIn(ix - 1, iy)) wall(tD, tA, bD, bA); // 좌(x0)
      if (!cellIn(ix + 1, iy)) wall(tB, tC, bB, bC); // 우(x1)
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 공번 텍스트 → 빌보드 스프라이트 (캔버스 텍스처). span 으로 월드 크기 스케일. */
function makeTextSprite(text: string, span: number): THREE.Sprite {
  const fs = 48;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `bold ${fs}px sans-serif`;
  const tw = Math.ceil(ctx.measureText(text).width);
  canvas.width = tw + 24;
  canvas.height = fs + 18;
  ctx.font = `bold ${fs}px sans-serif`; // 리사이즈로 초기화 → 재설정
  ctx.fillStyle = "rgba(15,17,22,0.72)";
  roundRect(ctx, 0, 0, canvas.width, canvas.height, 10);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, canvas.height / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
  );
  sprite.renderOrder = 999; // 솔리드 위에 그림
  const h = span * 0.06;
  sprite.scale.set(h * (canvas.width / canvas.height), h, 1);
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

interface Props {
  model: GridModel;
  visible: Record<string, boolean>; // 층key → 표시 여부
  boreholes: Borehole[];
  showLabels: boolean; // 공번 라벨 표시
  terrain?: { x: number; y: number; z: number }[]; // 현황 지형 표고점 (CAD 좌표)
  boundary?: { x: number; y: number }[]; // 대지경계선
  piles?: { kind: string; x: number; y: number; dia: number; length: number }[];
  walls?: { kind: string; points: { x: number; y: number }[] }[]; // 흙막이 벽
  contours?: { z: number; major: boolean; points: { x: number; y: number }[] }[]; // 등고선
}

export function EarthworkViewer({
  model, visible, boreholes, showLabels,
  terrain = [], boundary = [], piles = [], walls = [], contours = [],
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const meshesRef = useRef<Record<string, THREE.Mesh>>({});
  const labelsRef = useRef<THREE.Sprite[]>([]);

  // 표고 범위(카메라/타겟용)
  const bounds = useMemo(() => {
    let minE = Infinity;
    let maxE = -Infinity;
    for (const row of model.ifaces[0]) for (const v of row) maxE = Math.max(maxE, v);
    const bottom = model.ifaces[model.ifaces.length - 1];
    for (const row of bottom) for (const v of row) minE = Math.min(minE, v);
    return { minE, maxE };
  }, [model]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1116);

    const w = mount.clientWidth;
    const h = mount.clientHeight;
    const cx = model.width / 2;
    const cz = model.depthY / 2;
    const cy = (bounds.minE + bounds.maxE) / 2;
    const span = Math.max(model.width, model.depthY, bounds.maxE - bounds.minE);

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.5, span * 20);
    camera.position.set(cx + span * 1.1, cy + span * 0.9, cz + span * 1.1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(cx, cy, cz);
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(1, 2, 1.5);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
    dir2.position.set(-1, 0.5, -1);
    scene.add(dir2);

    // 대지경계선 있으면 땅을 그 폴리곤 모양으로 클리핑 (로컬좌표 셀-중심 판정).
    const bLocal = boundary.length >= 3 ? boundary.map((p) => ({ x: p.x - model.minX, y: p.y - model.minY })) : null;
    const inside = bLocal ? (cx: number, cy: number) => pointInPoly(bLocal, cx, cy) : undefined;

    // 층별 슬랩 메시
    const meshes: Record<string, THREE.Mesh> = {};
    for (let m = 0; m < LAYERS.length; m++) {
      const L = LAYERS[m];
      const mat = new THREE.MeshLambertMaterial({ color: L.color, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(buildSlab(model, m, inside), mat);
      mesh.visible = true; // 초기 표시 — 직후 [visible] effect 가 정확히 동기
      scene.add(mesh);
      meshes[L.key] = mesh;
    }
    meshesRef.current = meshes;

    // 시추공 기둥 (지표→굴진심도) + 상단 점
    const boreGroup = new THREE.Group();
    const labels: THREE.Sprite[] = [];
    for (const b of boreholes) {
      const px = b.x - model.minX;
      const pz = b.y - model.minY;
      const topE = b.el;
      const botE = b.el - b.depth;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(px, topE, pz),
        new THREE.Vector3(px, botE, pz),
      ]);
      boreGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff })));
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(span * 0.006, 0.4), 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      dot.position.set(px, topE, pz);
      boreGroup.add(dot);
      // 공번 라벨 (캔버스 스프라이트 — 카메라 향함, 가려지지 않음)
      const label = makeTextSprite(b.id, span);
      label.position.set(px, topE + span * 0.04, pz);
      boreGroup.add(label);
      labels.push(label);
    }
    labelsRef.current = labels; // 표시여부는 아래 [showLabels] effect 가 동기
    scene.add(boreGroup);

    // ── 통합 데이터 오버레이: 대지경계선 + Pile + 지형 표고점 ──
    const overlay = new THREE.Group();
    const surfY = bounds.maxE; // 지표 근처 표고
    // 오버레이 라인 — depthTest off 로 불투명 지층에 가려지지 않고 항상 보이게.
    const ovLine = (pts: THREE.Vector3[], color: number) => {
      const ln = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
      );
      ln.renderOrder = 3;
      overlay.add(ln);
    };

    if (boundary.length >= 3) {
      const bpts = boundary.map((p) => new THREE.Vector3(p.x - model.minX, surfY + span * 0.01, p.y - model.minY));
      bpts.push(bpts[0].clone()); // 닫기
      ovLine(bpts, 0x22c55e);
    }

    if (piles.length) {
      const len = span * 0.08; // 위치 표시용 짧은 막대 (실제 심도 아님)
      for (const p of piles) {
        const px = p.x - model.minX, pz = p.y - model.minY;
        ovLine([new THREE.Vector3(px, surfY, pz), new THREE.Vector3(px, surfY - len, pz)], 0xf59e0b);
      }
    }

    if (terrain.length) {
      let tmin = Infinity, tmax = -Infinity;
      for (const t of terrain) { if (t.z < tmin) tmin = t.z; if (t.z > tmax) tmax = t.z; }
      const tspan = tmax - tmin || 1;
      const pos: number[] = [];
      const col: number[] = [];
      const c = new THREE.Color();
      for (const t of terrain) {
        pos.push(t.x - model.minX, t.z, t.y - model.minY);
        c.setHSL((1 - (t.z - tmin) / tspan) * 0.66, 0.85, 0.5); // 파랑(낮음)→빨강(높음)
        col.push(c.r, c.g, c.b);
      }
      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      tGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      overlay.add(new THREE.Points(tGeo, new THREE.PointsMaterial({ size: Math.max(span * 0.012, 0.5), vertexColors: true })));
    }

    if (walls.length) {
      for (const w of walls) {
        if (w.points.length < 2) continue;
        const wp = w.points.map((p) => new THREE.Vector3(p.x - model.minX, surfY + span * 0.005, p.y - model.minY));
        ovLine(wp, 0xe11d48); // 흙막이 벽 (적색)
      }
    }

    if (contours.length) {
      const minorMat = new THREE.LineBasicMaterial({ color: 0x9ca3af }); // 세곡선 회색
      const majorMat = new THREE.LineBasicMaterial({ color: 0xf8fafc }); // 주곡선 흰색
      for (const ct of contours) {
        if (ct.points.length < 2) continue;
        const pts3 = ct.points.map((p) => new THREE.Vector3(p.x - model.minX, ct.z, p.y - model.minY));
        overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts3), ct.major ? majorMat : minorMat));
      }
    }
    scene.add(overlay);

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const nw = mount.clientWidth;
      const nh = mount.clientHeight;
      if (!nw || !nh) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      controls.dispose();
      Object.values(meshes).forEach((m) => m.geometry.dispose());
      // 라벨 스프라이트 텍스처/재질 정리 (CSV 재업로드 시 누수 방지)
      boreGroup.traverse((o) => {
        const sp = o as THREE.Sprite;
        if (sp.isSprite) {
          const mat = sp.material as THREE.SpriteMaterial;
          mat.map?.dispose();
          mat.dispose();
        }
      });
      overlay.traverse((o) => {
        const any = o as THREE.Mesh;
        any.geometry?.dispose?.();
        const mat = any.material as THREE.Material | undefined;
        mat?.dispose?.();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [model, bounds, boreholes, terrain, boundary, piles, walls, contours]);

  // 공번 라벨 표시 토글
  useEffect(() => {
    const labels = labelsRef.current;
    for (let i = 0; i < labels.length; i++) {
      const sp = labels[i];
      sp.visible = showLabels;
    }
  }, [showLabels]);

  // 층 표시 토글 (메시 visible 만 갱신)
  useEffect(() => {
    for (const L of LAYERS) {
      const mesh = meshesRef.current[L.key];
      if (mesh) mesh.visible = visible[L.key] !== false;
    }
  }, [visible]);

  return (
    <div
      ref={mountRef}
      style={{ position: "absolute", inset: 0, borderRadius: 10, overflow: "hidden", background: "#0e1116" }}
    />
  );
}
