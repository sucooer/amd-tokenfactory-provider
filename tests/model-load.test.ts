import {
  fetchModelLoad,
  formatModelLoad,
  matchModelLoad,
  ModelLoadSnapshot,
  normalizeLoadKey,
  parseModelLoad,
  watchModelLoad,
} from "../src/model-load";

const payload = {
  scope: "fleet",
  models: {
    "DeepSeek-V4.1-Flash": { state: "full", label: "At capacity", utilization: 100.0 },
    "GLM-5.3-Flash": { state: "busy", label: "Busy", utilization: 62.5 },
    "Qwen3.8-27B": { state: "idle", label: "Idle", utilization: 9.84 },
    "MiniCPM5-2B": { state: "idle", label: "Idle" },
  },
};

const models = [
  { id: "deepseek-ai/deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash" },
  { id: "zai/GLM-5.3-Flash", displayName: "GLM 5.3 Flash" },
  { id: "qwen/qwen3.8-27b", displayName: "Qwen 3.8 27B" },
  { id: "vendor/not-on-the-fleet", displayName: "Not On The Fleet" },
];

describe("parseModelLoad", () => {
  it("reads state, label and utilization for every entry", () => {
    const snapshot = parseModelLoad(payload, 1_700_000_000_000);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.scope).toBe("fleet");
    expect(snapshot?.fetchedAt).toBe(1_700_000_000_000);
    expect(snapshot?.entries).toEqual([
      { key: "DeepSeek-V4.1-Flash", state: "full", label: "At capacity", utilization: 100 },
      { key: "GLM-5.3-Flash", state: "busy", label: "Busy", utilization: 62.5 },
      // 9.84 is rounded to one decimal, like the percentage the website prints
      { key: "Qwen3.8-27B", state: "idle", label: "Idle", utilization: 9.8 },
      { key: "MiniCPM5-2B", state: "idle", label: "Idle", utilization: undefined },
    ]);
  });

  it("falls back to a label derived from the state and clamps out-of-range utilization", () => {
    const snapshot = parseModelLoad({
      models: {
        A: { state: "IDLE", utilization: 140 },
        B: { state: "busy", label: "   ", utilization: -3 },
      },
    });

    expect(snapshot?.scope).toBe("fleet");
    expect(snapshot?.entries).toEqual([
      { key: "A", state: "idle", label: "Idle", utilization: 100 },
      { key: "B", state: "busy", label: "Busy", utilization: 0 },
    ]);
  });

  it("skips entries with an unknown state or a non-object body", () => {
    const snapshot = parseModelLoad({
      models: { A: { state: "idle" }, B: { state: "weird" }, C: "idle", D: null },
    });

    expect(snapshot?.entries).toHaveLength(1);
    expect(snapshot?.entries[0].key).toBe("A");
  });

  it.each([
    ["a string", "nope"],
    ["null", null],
    ["an array", [{ state: "idle" }]],
    ["no models key", { scope: "fleet" }],
    ["models as an array", { models: [] }],
    ["only malformed entries", { models: { A: { state: "?" } } }],
  ])("returns null for %s", (_label, value) => {
    expect(parseModelLoad(value)).toBeNull();
  });
});

describe("normalizeLoadKey", () => {
  it("collapses the spellings of a model name onto one token", () => {
    expect(normalizeLoadKey("DeepSeek-V4.1-Flash")).toBe("deepseekv41flash");
    expect(normalizeLoadKey("DeepSeek V4.1 Flash")).toBe("deepseekv41flash");
    expect(normalizeLoadKey("deepseek-v4.1-flash")).toBe("deepseekv41flash");
  });

  it("keeps the org prefix of an id, which is why matching uses the id tail", () => {
    expect(normalizeLoadKey("deepseek-ai/deepseek-v4.1-flash")).toBe("deepseekaideepseekv41flash");
  });
});

describe("matchModelLoad", () => {
  const snapshot = parseModelLoad(payload, 1000) as ModelLoadSnapshot;

  it("pairs models with fleet entries by display name or id tail", () => {
    const match = matchModelLoad(models, snapshot);

    expect(match.rows.map((row) => [row.model.id, row.entry?.key])).toEqual([
      ["deepseek-ai/deepseek-v4.1-flash", "DeepSeek-V4.1-Flash"],
      ["zai/GLM-5.3-Flash", "GLM-5.3-Flash"],
      ["qwen/qwen3.8-27b", "Qwen3.8-27B"],
      ["vendor/not-on-the-fleet", undefined],
    ]);
  });

  it("reports fleet entries no model matched, so newly added models stay visible", () => {
    const match = matchModelLoad(models.slice(0, 1), snapshot);

    expect(match.unmatched.map((entry) => entry.key)).toEqual([
      "GLM-5.3-Flash",
      "Qwen3.8-27B",
      "MiniCPM5-2B",
    ]);
  });
});

describe("formatModelLoad", () => {
  const snapshot = parseModelLoad(
    payload,
    new Date(2026, 9, 18, 9, 2, 3).getTime(),
  ) as ModelLoadSnapshot;

  it("groups models by state, usable first, with the account disclaimer", () => {
    const markdown = formatModelLoad(matchModelLoad(models, snapshot), snapshot);

    expect(markdown).toContain("**AMD TokenFactory fleet load** · 09:02:03");
    expect(markdown).toContain("not your account's quota");
    expect(markdown).toContain("2 of 4 models reported usable");
    expect(markdown).toContain("**$(check) Available**\n- Qwen 3.8 27B · 9.8%");
    expect(markdown).toContain("**$(warning) Busy");
    expect(markdown).toContain("- GLM 5.3 Flash · 62.5%");
    expect(markdown).toContain("**$(error) At capacity");
    expect(markdown).toContain("- DeepSeek V4.1 Flash · 100%");
    // Available must be listed before Busy, and Busy before At capacity
    expect(markdown.indexOf("Available")).toBeLessThan(markdown.indexOf("Busy"));
    expect(markdown.indexOf("Busy")).toBeLessThan(markdown.indexOf("At capacity"));
  });

  it("lists models the fleet did not report, and caps the 'also on the fleet' list", () => {
    const crowded = parseModelLoad(
      {
        models: Object.fromEntries(
          Array.from({ length: 9 }, (_, index) => [
            `Stranger${index}`,
            { state: "idle", utilization: index },
          ]),
        ),
      },
      1000,
    ) as ModelLoadSnapshot;
    const match = matchModelLoad(models, crowded);
    const markdown = formatModelLoad(match, crowded);

    expect(markdown).toContain("**No load reported**");
    expect(markdown).toContain("- GLM 5.3 Flash");
    expect(markdown).toContain("**Also on the fleet** (not in your model list)");
    expect(markdown).toContain("- Stranger0 · Idle · 0%");
    expect(markdown).toContain("…and 3 more");
  });

  it("falls back to the picker count when rows exceed the reported total", () => {
    const markdown = formatModelLoad(matchModelLoad(models, snapshot), snapshot, { total: 16 });

    expect(markdown).toContain("2 of 16 models reported usable");
  });
});

describe("fetchModelLoad", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns a parsed snapshot on a 200", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    })) as unknown as typeof fetch;

    const snapshot = await fetchModelLoad();

    expect(snapshot?.entries).toHaveLength(4);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://developer.amd.com.cn/radeon/api/tokenfactory/load",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns null on a non-2xx response", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchModelLoad()).resolves.toBeNull();
  });

  it("returns null instead of throwing when the request fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;

    await expect(fetchModelLoad()).resolves.toBeNull();
  });

  it("rethrows a caller cancellation so it stays recognisable", async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = jest.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;

    await expect(fetchModelLoad(controller.signal)).rejects.toThrow();
  });
});

describe("watchModelLoad", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve();
    }
  };

  it("fetches immediately and then once per interval", async () => {
    const snapshot = parseModelLoad(payload, 1000) as ModelLoadSnapshot;
    const fetchLoad = jest.fn(async () => snapshot);
    const onSnapshot = jest.fn();

    const watcher = watchModelLoad({ onSnapshot, fetchLoad, intervalMs: 60000 });

    await flush();
    expect(fetchLoad).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenLastCalledWith(snapshot);

    await jest.advanceTimersByTimeAsync(60000);
    expect(fetchLoad).toHaveBeenCalledTimes(2);

    watcher.dispose();
    await jest.advanceTimersByTimeAsync(180000);
    expect(fetchLoad).toHaveBeenCalledTimes(2);
  });

  it("reports a failed fetch as null instead of dropping the update", async () => {
    const onSnapshot = jest.fn();
    const fetchLoad = jest.fn(async () => null);

    const watcher = watchModelLoad({ onSnapshot, fetchLoad, intervalMs: 60000 });
    await flush();

    expect(onSnapshot).toHaveBeenCalledWith(null);
    watcher.dispose();
  });

  it("swallows a thrown error and keeps polling", async () => {
    const onSnapshot = jest.fn();
    const fetchLoad = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(parseModelLoad(payload, 1000));

    const watcher = watchModelLoad({ onSnapshot, fetchLoad, intervalMs: 60000 });
    await flush();
    expect(onSnapshot).toHaveBeenLastCalledWith(null);

    await jest.advanceTimersByTimeAsync(60000);
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "fleet" }));

    watcher.dispose();
  });
});
