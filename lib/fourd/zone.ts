/**
 * 구역(zone) 분할 — 공정 그룹(같은 storey+공종)에 속한 부재들을 수평면(X,Z)에서
 * K개 구역으로 클러스터링한다. IFC 에 zone 속성이 없어 스케줄의 ZA/ZB/ZC 라벨을
 * 직접 매칭할 수 없으므로, 부재 위치만으로 공간 구역을 복원한다 (월드 공간 → 렌더와 정합 보장).
 *
 * 결정적(deterministic) k-means: 시드를 주축 정렬로 고정 → 매 hover 동일 결과.
 */

export interface Pt {
  x: number;
  z: number;
}

/** 결정적 k-means (2D). labels[i] = 0..k-1, 빈 입력/소수는 단일 군집. */
export function kmeans2d(pts: Pt[], k: number): number[] {
  const n = pts.length;
  if (n === 0) return [];
  k = Math.max(1, Math.min(k, n));
  if (k === 1) return new Array(n).fill(0);

  // 주축(분산 큰 축) 기준 정렬 → 균등 분위로 초기 중심 선정 (시드 고정)
  const meanX = pts.reduce((s, p) => s + p.x, 0) / n;
  const meanZ = pts.reduce((s, p) => s + p.z, 0) / n;
  const varX = pts.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  const varZ = pts.reduce((s, p) => s + (p.z - meanZ) ** 2, 0);
  const axis: keyof Pt = varX >= varZ ? "x" : "z";
  const order = pts.map((_, i) => i).sort((a, b) => pts[a][axis] - pts[b][axis]);
  const cx: number[] = [];
  const cz: number[] = [];
  for (let j = 0; j < k; j++) {
    const idx = order[Math.floor(((j + 0.5) / k) * n)];
    cx.push(pts[idx].x);
    cz.push(pts[idx].z);
  }

  const labels = new Array(n).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    // 할당
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < k; j++) {
        const d = (pts[i].x - cx[j]) ** 2 + (pts[i].z - cz[j]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        moved = true;
      }
    }
    if (!moved && iter > 0) break;
    // 갱신
    const sx = new Array(k).fill(0);
    const sz = new Array(k).fill(0);
    const cnt = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      sx[labels[i]] += pts[i].x;
      sz[labels[i]] += pts[i].z;
      cnt[labels[i]]++;
    }
    for (let j = 0; j < k; j++) {
      if (cnt[j]) {
        cx[j] = sx[j] / cnt[j];
        cz[j] = sz[j] / cnt[j];
      }
    }
  }
  return labels;
}
