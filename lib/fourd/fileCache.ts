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
  ifc: File;
  savedAt: number; // epoch ms
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

/** 분석 성공 시 원본 두 파일을 저장(덮어쓰기). 실패해도 분석 흐름은 막지 않음. */
export async function saveFourdFiles(schedule: File, ifc: File): Promise<void> {
  if (!available()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      // File 은 structured clone 으로 그대로 저장된다(이름·타입·바이트 보존).
      tx.objectStore(STORE).put({ schedule, ifc, savedAt: Date.now() } satisfies CachedFourd, KEY);
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
