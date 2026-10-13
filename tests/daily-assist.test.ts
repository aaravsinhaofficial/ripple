import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assist,
  presetServiceUrl,
  safeEndpoint,
  verifyConnection,
} from "../src/daily/assist";
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
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
describe("explicit assistant connection", () => {
  const liveHealth = {
    status: "ok",
    mode: "live",
    requiresAuth: true,
    configured: { nebius: true, tavily: false },
  };
  function replies(session: unknown, status = 200, health = liveHealth) {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(health)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(session), { status }),
      );
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }
  it("prefills only a safe public URL and makes no connection request", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("VITE_RIPPLE_API_URL", " https://ripple.example/ ");
    expect(presetServiceUrl()).toBe("https://ripple.example");
    expect(presetServiceUrl("")).toBe("");
    expect(presetServiceUrl(undefined)).toBe("https://ripple.example");
    for (const raw of [
      null,
      "http://public.example",
      "https://user:secret@ripple.example",
      "https://ripple.example?token=secret",
      "not a URL",
    ])
      expect(presetServiceUrl(raw)).toBe("");
    vi.stubEnv("VITE_RIPPLE_API_URL", "");
    expect(presetServiceUrl()).toBe("");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("checks health without credentials, then authenticates without sending task text", async () => {
    const fetcher = replies({ status: "ok", mode: "live" });
    await expect(
      verifyConnection({ url: `${connection.url}/`, token: " memory-only " }),
    ).resolves.toEqual({ connection, mode: "live" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]).toEqual([
      `${connection.url}/health`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    ]);
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
    expect(fetcher.mock.calls[1]).toEqual([
      `${connection.url}/api/session`,
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer memory-only" },
        cache: "no-store",
      }),
    ]);
    for (const [, request] of fetcher.mock.calls)
      expect(request.body).toBeUndefined();
  });
  it("rejects an incorrect access code despite healthy service status", async () => {
    const fetcher = replies({ detail: "An organizer access token is required." }, 401);
    await expect(verifyConnection(connection)).rejects.toThrow(
      "That access code was not accepted",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("requires a code for live mode even if the health auth flag is absent or false", async () => {
    const fetcher = replies(
      { status: "ok", mode: "live" },
      200,
      { ...liveHealth, requiresAuth: false },
    );
    await expect(
      verifyConnection({ ...connection, token: " " }),
    ).rejects.toThrow("Enter the access code");
    expect(fetcher).toHaveBeenCalledTimes(1);
    replies({ status: "ok", mode: "live" }, 200, {
      ...liveHealth,
      requiresAuth: false,
    });
    await expect(verifyConnection(connection)).resolves.toMatchObject({ mode: "live" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: "ok", mode: "demo" },
    { status: "pending", mode: "live" },
    null,
  ])("rejects an invalid authenticated response %j", async (session) => {
    replies(session);
    await expect(verifyConnection(connection)).rejects.toThrow(
      "invalid connection check",
    );
  });
  it("checks access for a protected demo service while leaving public demos compatible", async () => {
    replies({ status: "ok", mode: "demo" }, 200, {
      ...liveHealth,
      mode: "demo",
    });
    await expect(verifyConnection(connection)).resolves.toMatchObject({ mode: "demo" });
    expect(fetch).toHaveBeenCalledTimes(2);
    mock({ status: "ok", mode: "demo", requiresAuth: false });
    await expect(
      verifyConnection({ ...connection, token: "" }),
    ).resolves.toEqual({ connection: { ...connection, token: "" }, mode: "demo" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not accept an unconfigured live service or hide a session outage", async () => {
    mock({ ...liveHealth, configured: { nebius: false, tavily: false } });
    await expect(verifyConnection(connection)).rejects.toThrow("not ready for AI");
    expect(fetch).toHaveBeenCalledTimes(1);
    replies({ error: { message: "Service access is temporarily unavailable." } }, 503);
    await expect(verifyConnection(connection)).rejects.toThrow(
      "Service access is temporarily unavailable.",
    );
  });
});
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
