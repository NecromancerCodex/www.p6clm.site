/**
 * scheduleStore — CLM DB(schedule_snapshots)에 저장된 공정표 스냅샷을 공유.
 *
 * 영속화 모드: 업로드 1회 → DB 저장 → 공정표·진도율 화면이 저장된 스냅샷을 조회.
 * 재업로드 불필요. 여러 업로드는 스냅샷 목록으로 누적되어 드롭다운으로 전환.
 */
import { create } from "zustand";

import {
  getSnapshot,
  listSnapshots,
  uploadSchedule,
  type GanttTask,
  type ScheduleSummary,
  type SnapshotMeta,
} from "../lib/api/schedule";

interface ScheduleState {
  snapshots: SnapshotMeta[];
  selectedId: number | null;
  tasks: GanttTask[];
  summary: ScheduleSummary | null;
  projectName: string | null;
  loading: boolean;
  uploading: boolean;
  error: string | null;
  loadedOnce: boolean;
  /** 스냅샷 목록 로드 + (미선택 시) 최신 자동 로드. */
  loadSnapshots: () => Promise<void>;
  /** 특정 스냅샷 선택 → tasks/summary 로드. */
  selectSnapshot: (id: number) => Promise<void>;
  /** 업로드 → DB 저장 → 현재 선택으로 반영. */
  upload: (file: File, projectName?: string) => Promise<void>;
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  snapshots: [],
  selectedId: null,
  tasks: [],
  summary: null,
  projectName: null,
  loading: false,
  uploading: false,
  error: null,
  loadedOnce: false,

  loadSnapshots: async () => {
    set({ loading: true, error: null });
    try {
      const items = await listSnapshots();
      set({ snapshots: items, loadedOnce: true });
      if (get().selectedId == null && items.length > 0) {
        await get().selectSnapshot(items[0].id);
      } else {
        set({ loading: false });
      }
    } catch (e) {
      set({ error: String(e), loading: false, loadedOnce: true });
    }
  },

  selectSnapshot: async (id) => {
    set({ loading: true, error: null });
    try {
      const snap = await getSnapshot(id);
      set({
        selectedId: id,
        tasks: snap.tasks,
        summary: snap.summary,
        projectName: snap.project_name,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  upload: async (file, projectName) => {
    set({ uploading: true, error: null });
    try {
      const snap = await uploadSchedule(file, projectName);
      const meta: SnapshotMeta = {
        id: snap.id,
        project_name: snap.project_name,
        data_date: snap.data_date,
        file_name: snap.file_name,
        source_format: snap.source_format,
        activity_count: snap.activity_count,
        created_at: snap.created_at,
      };
      set((s) => ({
        snapshots: [meta, ...s.snapshots.filter((x) => x.id !== meta.id)],
        selectedId: snap.id,
        tasks: snap.tasks,
        summary: snap.summary,
        projectName: snap.project_name,
        uploading: false,
      }));
    } catch (e) {
      set({ error: String(e), uploading: false });
      throw e;
    }
  },
}));
