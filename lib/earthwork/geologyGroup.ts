/**
 * 지질 지층을 three.js Group 으로 — /fourd(BIM) 씬에 이식용.
 * EarthworkViewer 의 슬랩 로직을 재사용 가능한 형태로 분리.
 * 그룹 로컬좌표: x=lx(m), z=ly(m), y=표고EL(m). 호출측이 scale·position 으로 BIM에 정합.
 */
import * as THREE from "three";

import { LAYERS, buildGridModel, type Borehole, type GridModel } from "./model";

/** 한 층(top/bot 표고격자) → 닫힌 슬랩 BufferGeometry. */
function buildSlab(g: GridModel, m: number): THREE.BufferGeometry {
  const { nx, ny, lx, ly, ifaces } = g;
  const top = ifaces[m];
  const bot = ifaces[m + 1];
  const pos: number[] = [];
  const idx: number[] = [];
  const N = nx * ny;
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) pos.push(lx[ix], top[iy][ix], ly[iy]);
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) pos.push(lx[ix], bot[iy][ix], ly[iy]);
  const ti = (ix: number, iy: number) => iy * nx + ix;
  const bi = (ix: number, iy: number) => N + iy * nx + ix;
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      idx.push(ti(ix, iy), ti(ix + 1, iy), ti(ix + 1, iy + 1), ti(ix, iy), ti(ix + 1, iy + 1), ti(ix, iy + 1));
      idx.push(bi(ix, iy), bi(ix + 1, iy + 1), bi(ix + 1, iy), bi(ix, iy), bi(ix, iy + 1), bi(ix + 1, iy + 1));
    }
  }
  const wall = (a0: number, a1: number, b0: number, b1: number) => idx.push(a0, a1, b1, a0, b1, b0);
  for (let ix = 0; ix < nx - 1; ix++) {
    wall(ti(ix, 0), ti(ix + 1, 0), bi(ix, 0), bi(ix + 1, 0));
    wall(ti(ix, ny - 1), ti(ix + 1, ny - 1), bi(ix, ny - 1), bi(ix + 1, ny - 1));
  }
  for (let iy = 0; iy < ny - 1; iy++) {
    wall(ti(0, iy), ti(0, iy + 1), bi(0, iy), bi(0, iy + 1));
    wall(ti(nx - 1, iy), ti(nx - 1, iy + 1), bi(nx - 1, iy), bi(nx - 1, iy + 1));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export interface GeologyBuild {
  group: THREE.Group;
  width: number; // X(m)
  depthY: number; // Y(m)
  maxEl: number; // 최상 표고(지표)
  minEl: number; // 최하 표고
  dispose: () => void;
}

/** 시추공 → 지층 슬랩 Group(반투명, 지하 BIM 비침). 로컬좌표·미터 단위. */
export function buildGeologyGroup(boreholes: Borehole[]): GeologyBuild {
  const model = buildGridModel(boreholes, 2);
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  let maxEl = -Infinity;
  let minEl = Infinity;
  for (const row of model.ifaces[0]) for (const v of row) maxEl = Math.max(maxEl, v);
  const bottom = model.ifaces[model.ifaces.length - 1];
  for (const row of bottom) for (const v of row) minEl = Math.min(minEl, v);

  for (let m = 0; m < LAYERS.length; m++) {
    const geo = buildSlab(model, m);
    const mat = new THREE.MeshLambertMaterial({
      color: LAYERS[m].color, side: THREE.DoubleSide,
      transparent: true, opacity: 0.65, depthWrite: false, // 지하 BIM 살짝 비치게
    });
    group.add(new THREE.Mesh(geo, mat));
    geos.push(geo);
    mats.push(mat);
  }

  return {
    group, width: model.width, depthY: model.depthY, maxEl, minEl,
    dispose: () => { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); },
  };
}
