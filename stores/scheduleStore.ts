/**
 * scheduleStore — 업로드된 공정표 파싱 결과를 공정관리 하위 페이지(공정표·진도율)가 공유.
 *
 * stateless 아키텍처(Option A): CLM 은 스케줄을 영속화하지 않고, 업로드 1회 결과를
 * 클라이언트 메모리(이 스토어)에 담아 여러 뷰가 재사용한다. 새로고침 시 비워짐.
 */
import { create } from "zustand";

import type { GanttTask, ScheduleSummary } from "../lib/api/schedule";

interface ScheduleState {
  fileName: string | null;
  projectName: string | null;
  tasks: GanttTask[];
  summary: ScheduleSummary | null;
  setResult: (r: {
    fileName: string;
    projectName: string | null;
    tasks: GanttTask[];
    summary: ScheduleSummary | null;
  }) => void;
  clear: () => void;
}

export const useScheduleStore = create<ScheduleState>((set) => ({
  fileName: null,
  projectName: null,
  tasks: [],
  summary: null,
  setResult: (r) =>
    set({
      fileName: r.fileName,
      projectName: r.projectName,
      tasks: r.tasks,
      summary: r.summary,
    }),
  clear: () => set({ fileName: null, projectName: null, tasks: [], summary: null }),
}));
