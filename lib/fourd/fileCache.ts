/**
 * 4D 대시보드 — 업로드한 공정표·IFC를 브라우저 IndexedDB에 기억.
 *
 * 왜 IndexedDB?  IFC가 40~80MB+ 라 서버(Neon bytea) 저장은 비용·성능상 부적합하고
 * S3도 미구성. IndexedDB는 대용량 Blob/File 저장 전용이라 큰 IFC도 그대로 보관 가능.
 * 단점: 같은 브라우저/기기에서만 유지(기기 간 공유 X). 매번 끌어다 놓는 불편만 제거.
 *
 * 원본 File 만 저장(파싱 결과는 미저장) → '이어서 열기' 시 재파싱.
 */

const DB_NAME = "clm-fourd";
const STORE = "files";
const KEY = "last"; // 단일 슬롯 — 가장 최근 분석한 파일 한 쌍

export interface CachedFourd {
  schedule: File;
  ifc: File;        // 하위호환(첫 IFC) — 구버전 캐시 로드용
  ifcs?: File[];    // 멀티 디시플린 IFC(토목+구조…) — 통합 4D
  savedAt: number;  // epoch ms
}

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 분석 성공 시 원본 파일(공정표 + IFC 1~N개)을 저장(덮어쓰기). 실패해도 분석 흐름은 막지 않음. */
export async function saveFourdFiles(schedule: File, ifcs: File[]): Promise<void> {
  if (!available() || !ifcs.length) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      // File 은 structured clone 으로 그대로 저장된다(이름·타입·바이트 보존). ifc=첫개(구버전 호환)+ifcs 전체.
      tx.objectStore(STORE).put({ schedule, ifc: ifcs[0], ifcs, savedAt: Date.now() } satisfies CachedFourd, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 캐시는 편의 기능 — 저장 실패는 조용히 무시(분석은 이미 성공).
  }
}

/** 저장된 파일 한 쌍 로드. 없거나 손상 시 null. */
export async function loadFourdFiles(): Promise<CachedFourd | null> {
  if (!available()) return null;
  try {
    const db = await openDb();
    const rec = await new Promise<CachedFourd | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result as CachedFourd | undefined);
      r.onerror = () => reject(r.error);
    });
    db.close();
    if (rec && rec.schedule instanceof File && rec.ifc instanceof File) return rec;
    return null;
  } catch {
    return null;
  }
}

// ── 플랜 슬롯 IFC(공종 태그째) — 위저드 임포트 시점의 공종을 4D 로 전달(파일명 추측 X) ──
export interface PlanIfc { file: File; discipline: string }

/** 위저드 생성 시 슬롯 파일들을 plan_id 로 보관 — /fourd?plan=X 가 공종 태그째 읽어 통합. */
export async function savePlanIfcs(planId: string, ifcs: PlanIfc[]): Promise<void> {
  if (!available() || !ifcs.length) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ifcs, savedAt: Date.now() }, `plan:${planId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* 캐시 실패는 무시 — 4D 는 수동 드롭으로 폴백 */
  }
}

/** plan_id 의 슬롯 IFC(공종 태그) 로드. 없으면 빈 배열. */
export async function loadPlanIfcs(planId: string): Promise<PlanIfc[]> {
  if (!available()) return [];
  try {
    const db = await openDb();
    const rec = await new Promise<{ ifcs?: PlanIfc[] } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(`plan:${planId}`);
      r.onsuccess = () => resolve(r.result as { ifcs?: PlanIfc[] } | undefined);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return (rec?.ifcs ?? []).filter((x) => x.file instanceof File && x.discipline);
  } catch {
    return [];
  }
}

/** 저장된 파일 삭제. */
export async function clearFourdFiles(): Promise<void> {
  if (!available()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* 무시 */
  }
}
