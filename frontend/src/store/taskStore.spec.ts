import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskJob } from "@/lib/api";
import { useTaskStore } from "@/store/taskStore";

const mockApi = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      listTasks: (...args: unknown[]) => mockApi.listTasks(...args),
      getTask: (...args: unknown[]) => mockApi.getTask(...args),
    },
  };
});

function makeJob(overrides: Partial<TaskJob>): TaskJob {
  return {
    id: "job_1",
    task_type: "series.asset.generate",
    status: "queued",
    queue_name: "image",
    priority: 100,
    attempt_count: 0,
    max_attempts: 2,
    created_at: "2026-04-05T10:00:00Z",
    ...overrides,
  };
}

describe("taskStore.fetchProjectJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskStore.setState({ jobsById: {}, jobIdsByProject: {} });
  });

  it("reconciles stale active jobs when active list no longer returns them", async () => {
    useTaskStore.setState({
      jobsById: {
        job_stale: makeJob({
          id: "job_stale",
          series_id: "series-1",
          resource_id: "char-1",
          status: "running",
        }),
      },
      jobIdsByProject: {
        "series-1": ["job_stale"],
      },
    });

    mockApi.listTasks.mockResolvedValue([]);
    mockApi.getTask.mockResolvedValue(
      makeJob({
        id: "job_stale",
        series_id: "series-1",
        resource_id: "char-1",
        status: "succeeded",
      }),
    );

    await useTaskStore.getState().fetchProjectJobs(
      undefined,
      ["queued", "claimed", "running", "retry_waiting", "cancel_requested"],
      { seriesId: "series-1", limit: 200 },
    );

    expect(mockApi.getTask).toHaveBeenCalledWith("job_stale");
    expect(useTaskStore.getState().jobsById.job_stale?.status).toBe("succeeded");
  });
});

describe("taskStore.waitForJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    useTaskStore.setState({ jobsById: {}, jobIdsByProject: {} });
  });

  it("waits beyond the old 6-minute window when timeout_seconds allows it", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    mockApi.getTask.mockImplementation(async () => {
      callCount += 1;
      return makeJob({
        id: "job_long",
        status: callCount >= 182 ? "succeeded" : "running",
        timeout_seconds: 1800,
      });
    });

    const waitPromise = useTaskStore.getState().waitForJob("job_long", { intervalMs: 2000 });
    await vi.runAllTimersAsync();
    const job = await waitPromise;

    expect(job.status).toBe("succeeded");
    expect(mockApi.getTask).toHaveBeenCalledTimes(182);
  });

  it("throws a clear message when a job remains active after waiting budget", async () => {
    vi.useFakeTimers();
    mockApi.getTask.mockResolvedValue(
      makeJob({
        id: "job_still_running",
        status: "running",
        timeout_seconds: 1800,
      }),
    );

    const waitPromise = useTaskStore.getState().waitForJob("job_still_running", {
      intervalMs: 1000,
      maxAttempts: 2,
    });
    const assertion = expect(waitPromise).rejects.toThrow("任务仍在后台执行");
    await vi.runAllTimersAsync();
    await assertion;
  });
});
