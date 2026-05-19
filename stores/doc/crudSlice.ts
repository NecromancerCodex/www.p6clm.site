/**
 * docStore — CRUD 슬라이스
 *
 * RESTful /api/clm/documents 위에서 list/get/patch/delete 액션을 제공한다.
 * generateSlice는 *작성 흐름*(트리거→폴링)을 담당하고, 이 슬라이스는 *영속 데이터 관리*를 담당한다.
 */
import type { StateCreator } from "zustand";

import {
  deleteDocument,
  getDocument,
  listDocuments,
  patchDocument,
  DocumentApiError,
  type DocumentListFilters,
  type DocumentPatchBody,
  type DocumentRead,
} from "../../lib/api/documents";
import type { CrudSlice, DocStore } from "./types";

const INITIAL: Pick<CrudSlice, "items" | "loadStatus" | "loadError" | "lastNextOffset" | "selected"> = {
  items: [],
  loadStatus: "idle",
  loadError: "",
  lastNextOffset: null,
  selected: null,
};

export const createCrudSlice: StateCreator<DocStore, [], [], CrudSlice> = (set, get) => ({
  ...INITIAL,

  loadList: async (filters?: DocumentListFilters) => {
    set({ loadStatus: "loading", loadError: "" });
    try {
      const res = await listDocuments(filters);
      set({
        items: res.items,
        lastNextOffset: res.next_offset,
        loadStatus: "ready",
      });
    } catch (err) {
      set({
        loadStatus: "error",
        loadError:
          errorMessage(err, "조회 실패"),
      });
    }
  },

  loadOne: async (id: string): Promise<DocumentRead | null> => {
    try {
      const doc = await getDocument(id);
      set({ selected: doc });
      return doc;
    } catch (err) {
      set({
        loadError:
          errorMessage(err, "조회 실패"),
      });
      return null;
    }
  },

  patch: async (id: string, body: DocumentPatchBody): Promise<DocumentRead | null> => {
    const prev = get().items;
    // optimistic update — title/project_name 같은 가벼운 변경 즉시 반영
    set({
      items: prev.map((it) => (it.id === id ? { ...it, ...partialPreview(body) } : it)),
    });
    try {
      const updated = await patchDocument(id, body);
      set({
        items: get().items.map((it) => (it.id === id ? updated : it)),
        selected: get().selected?.id === id ? updated : get().selected,
      });
      return updated;
    } catch (err) {
      // 롤백
      set({
        items: prev,
        loadError:
          errorMessage(err, "수정 실패"),
      });
      return null;
    }
  },

  remove: async (id: string): Promise<boolean> => {
    const prev = get().items;
    // optimistic remove — 리스트에서 즉시 제거
    set({ items: prev.filter((it) => it.id !== id) });
    try {
      await deleteDocument(id);
      return true;
    } catch (err) {
      set({
        items: prev,
        loadError:
          errorMessage(err, "삭제 실패"),
      });
      return false;
    }
  },

  clearSelected: () => set({ selected: null }),
});

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof DocumentApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return fallback;
}

function partialPreview(body: DocumentPatchBody): Partial<DocumentRead> {
  const preview: Partial<DocumentRead> = {};
  if (body.title !== undefined) preview.title = body.title;
  if (body.project_name !== undefined) preview.project_name = body.project_name;
  if (body.status !== undefined) preview.status = body.status;
  return preview;
}
