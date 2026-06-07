"use client";

/**
 * 토공/지반 3D 뷰어 — 층별 입체 슬랩(상면+하면+측벽) + 시추공 기둥.
 * three.js. 좌표 매핑: three.x=로컬X, three.z=로컬Y, three.y=표고(EL).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { LAYERS, type Borehole, type GridModel } from "../../lib/earthwork/model";

/** 한 층(top/bot 표고격자) → 닫힌 슬랩 BufferGeometry (상면+하면+측벽). */
function buildSlab(g: GridModel, m: number): THREE.BufferGeometry {
  const { nx, ny, lx, ly, ifaces } = g;
  const top = ifaces[m];
  const bot = ifaces[m + 1];
  const pos: number[] = [];
  const idx: number[] = [];
  const N = nx * ny;
  // 정점: 상면(0..N-1) + 하면(N..2N-1)
  for (let iy = 0; iy < ny; iy++)
    for (let ix = 0; ix < nx; ix++) pos.push(lx[ix], top[iy][ix], ly[iy]);
  for (let iy = 0; iy < ny; iy++)
    for (let ix = 0; ix < nx; ix++) pos.push(lx[ix], bot[iy][ix], ly[iy]);
  const ti = (ix: number, iy: number) => iy * nx + ix;
  const bi = (ix: number, iy: number) => N + iy * nx + ix;
  // 상면/하면 (DoubleSide 라 winding 무관)
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      idx.push(ti(ix, iy), ti(ix + 1, iy), ti(ix + 1, iy + 1), ti(ix, iy), ti(ix + 1, iy + 1), ti(ix, iy + 1));
      idx.push(bi(ix, iy), bi(ix + 1, iy + 1), bi(ix + 1, iy), bi(ix, iy), bi(ix, iy + 1), bi(ix + 1, iy + 1));
    }
  }
  // 측벽 (4 둘레) — top↔bot quad
  const wall = (a0: number, a1: number, b0: number, b1: number) => idx.push(a0, a1, b1, a0, b1, b0);
  for (let ix = 0; ix < nx - 1; ix++) {
    wall(ti(ix, 0), ti(ix + 1, 0), bi(ix, 0), bi(ix + 1, 0)); // 앞
    wall(ti(ix, ny - 1), ti(ix + 1, ny - 1), bi(ix, ny - 1), bi(ix + 1, ny - 1)); // 뒤
  }
  for (let iy = 0; iy < ny - 1; iy++) {
    wall(ti(0, iy), ti(0, iy + 1), bi(0, iy), bi(0, iy + 1)); // 좌
    wall(ti(nx - 1, iy), ti(nx - 1, iy + 1), bi(nx - 1, iy), bi(nx - 1, iy + 1)); // 우
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
}

export function EarthworkViewer({ model, visible, boreholes, showLabels }: Props) {
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

    // 층별 슬랩 메시
    const meshes: Record<string, THREE.Mesh> = {};
    for (let m = 0; m < LAYERS.length; m++) {
      const L = LAYERS[m];
      const mat = new THREE.MeshLambertMaterial({ color: L.color, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(buildSlab(model, m), mat);
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
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [model, bounds, boreholes]);

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
