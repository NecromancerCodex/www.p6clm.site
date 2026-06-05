"use client";

/**
 * 토공/지반 3D 뷰어 — 층별 입체 슬랩(상면+하면+측벽) + 시추공 기둥.
 * three.js. 좌표 매핑: three.x=로컬X, three.z=로컬Y, three.y=표고(EL).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { BOREHOLES, LAYERS, interfaceElevations, type GridModel } from "../../lib/earthwork/model";

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

interface Props {
  model: GridModel;
  visible: Record<string, boolean>; // 층key → 표시 여부
}

export function EarthworkViewer({ model, visible }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const meshesRef = useRef<Record<string, THREE.Mesh>>({});

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
    for (const b of BOREHOLES) {
      const px = b.x - model.minX;
      const pz = b.y - model.minY;
      const eIf = interfaceElevations(b);
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
      void eIf;
    }
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
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, [model, bounds]);

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
