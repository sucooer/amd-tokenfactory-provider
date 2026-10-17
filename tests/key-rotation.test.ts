import { ApiKeyPool, maskApiKey } from "../src/key-rotation";
import { API_KEYS_STORAGE_KEY, SECRET_STORAGE_KEY } from "../src/constants";

function createSecrets(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: jest.fn(async (key: string) => store.get(key)),
    store: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    _raw: store,
  };
}

describe("maskApiKey", () => {
  it("masks the middle of the key", () => {
    expect(maskApiKey("rc-35c3810a56237a65975cbc0b268583d72cc4dbcb2eca8e54")).toBe("rc-35c3…8e54");
  });

  it("fully masks short keys", () => {
    expect(maskApiKey("short")).toBe("••••••••");
  });
});

describe("ApiKeyPool", () => {
  it("loads zero keys from empty storage", async () => {
    const secrets = createSecrets();
    const pool = new ApiKeyPool();
    await pool.load(secrets as never);

    expect(pool.size).toBe(0);
    expect(pool.getKeys()).toEqual([]);
  });

  it("migrates the legacy single key into the pool on first load", async () => {
    const secrets = createSecrets({ [SECRET_STORAGE_KEY]: "legacy-key" });
    const pool = new ApiKeyPool();
    await pool.load(secrets as never);

    expect(pool.getKeys()).toEqual(["legacy-key"]);
    const persisted = JSON.parse(secrets._raw.get(API_KEYS_STORAGE_KEY) ?? "[]");
    expect(persisted).toEqual(["legacy-key"]);
  });

  it("loads previously persisted keys and ignores malformed storage", async () => {
    const secrets = createSecrets({ [API_KEYS_STORAGE_KEY]: "not-json{{" });
    const pool = new ApiKeyPool();
    await pool.load(secrets as never);

    expect(pool.size).toBe(0);
  });

  it("adds keys, deduplicates, and persists them", async () => {
    const secrets = createSecrets();
    const pool = new ApiKeyPool();
    await pool.load(secrets as never);

    expect(await pool.addKey(secrets as never, "  key-one  ")).toBe(true);
    expect(await pool.addKey(secrets as never, "key-two")).toBe(true);
    expect(await pool.addKey(secrets as never, "key-one")).toBe(false);
    expect(await pool.addKey(secrets as never, "   ")).toBe(false);

    expect(pool.getKeys()).toEqual(["key-one", "key-two"]);
    expect(JSON.parse(secrets._raw.get(API_KEYS_STORAGE_KEY) ?? "[]")).toEqual([
      "key-one",
      "key-two",
    ]);
  });

  it("removes keys by index", async () => {
    const secrets = createSecrets();
    const pool = new ApiKeyPool();
    await pool.load(secrets as never);
    await pool.addKey(secrets as never, "key-one");
    await pool.addKey(secrets as never, "key-two");

    expect(await pool.removeKey(secrets as never, 0)).toBe("key-one");
    expect(pool.getKeys()).toEqual(["key-two"]);
    expect(await pool.removeKey(secrets as never, 5)).toBeUndefined();
    expect(await pool.removeKey(secrets as never, -1)).toBeUndefined();
  });

  it("load is idempotent and does not re-migrate", async () => {
    const secrets = createSecrets({ [SECRET_STORAGE_KEY]: "legacy-key" });
    const pool = new ApiKeyPool();
    await pool.load(secrets as never);
    await pool.addKey(secrets as never, "second-key");
    await pool.load(secrets as never);

    expect(pool.getKeys()).toEqual(["legacy-key", "second-key"]);
  });
});
