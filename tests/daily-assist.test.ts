import { afterEach, describe, expect, it, vi } from "vitest";
import { assist, safeEndpoint } from "../src/daily/assist";
const connection = { url: "https://service.example", token: "memory-only" };
const task = {
  title: "Write a proposal",
  minutes: 45,
  priority: "normal",
  project: "Client",
  notes: "Estimate to review.",
  dependsOnIndices: [],
};
const result = {
  mode: "live",
  summary: "Review these tasks.",
  tasks: [task],
  steps: [],
  sources: [],
  trace: [],
};
afterEach(() => vi.unstubAllGlobals());
function mock(data: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(data), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
  );
}
describe("reviewed assistant boundary", () => {
  it("sends only requested context with the access token in headers", async () => {
    mock(result);
    expect(
      (await assist(connection, "capture", "Write proposal 45m", "2026-10-13"))
        .tasks,
    ).toHaveLength(1);
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://service.example/api/daily/assist");
    expect(request?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer memory-only",
    });
    expect(JSON.parse(request?.body as string)).toEqual({
      action: "capture",
      text: "Write proposal 45m",
      date: "2026-10-13",
      useWeb: false,
    });
  });
  it.each([-1, 1, 0, 0.5])(
    "rejects invalid dependency index %s instead of dropping it",
    async (index) => {
      mock({ ...result, tasks: [{ ...task, dependsOnIndices: [index] }] });
      await expect(
        assist(connection, "capture", "proposal", "2026-10-13"),
      ).rejects.toThrow("prerequisite");
    },
  );
  it("rejects cyclic dependencies", async () => {
    mock({
      ...result,
      tasks: [
        { ...task, dependsOnIndices: [1] },
        { ...task, title: "Other", dependsOnIndices: [0] },
      ],
    });
    await expect(
      assist(connection, "capture", "proposal", "2026-10-13"),
    ).rejects.toThrow("loop");
  });
  it("rejects impossible dates and oversized notes", async () => {
    for (const draft of [
      { ...task, dueDate: "2026-02-30" },
      { ...task, notes: "x".repeat(2001) },
    ]) {
      mock({ ...result, tasks: [draft] });
      await expect(
        assist(connection, "capture", "proposal", "2026-10-13"),
      ).rejects.toThrow("invalid");
    }
  });
  it("requires every citation to appear in retrieved sources", async () => {
    mock({
      ...result,
      tasks: [],
      steps: [
        {
          title: "Read this",
          detail: "Unverified citation",
          sourceUrls: ["https://invented.example"],
        },
      ],
    });
    await expect(
      assist(connection, "research", "proposal", "2026-10-13"),
    ).rejects.toThrow("not retrieved");
  });
  it("shows provider errors without creating substitute tasks", async () => {
    mock({ error: { message: "Daily allowance reached." } }, 429);
    await expect(
      assist(connection, "capture", "proposal", "2026-10-13"),
    ).rejects.toThrow("Daily allowance reached.");
  });
  it("limits connection URLs to HTTPS or local HTTP without embedded credentials", () => {
    expect(safeEndpoint("http://127.0.0.1:8000/")).toBe(
      "http://127.0.0.1:8000",
    );
    expect(safeEndpoint("https://api.example/")).toBe("https://api.example");
    for (const u of [
      "http://api.example",
      "https://user:secret@api.example",
      "https://api.example?key=secret",
      "javascript:alert(1)",
    ])
      expect(() => safeEndpoint(u)).toThrow();
  });
});
