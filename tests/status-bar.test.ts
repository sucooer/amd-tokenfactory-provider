const mockShowInformationMessage = jest.fn();
const mockCreateStatusBarItem = jest.fn(() => ({
  text: "",
  tooltip: "",
  command: "",
  show: jest.fn(),
  dispose: jest.fn(),
}));
const mockExecuteCommand = jest.fn();

jest.mock("vscode", () => ({
  window: {
    showInformationMessage: mockShowInformationMessage,
    createStatusBarItem: mockCreateStatusBarItem,
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  commands: { executeCommand: mockExecuteCommand },
  MarkdownString: class {
    public supportThemeIcons = false;
    constructor(public readonly value = "") {}
  },
}));

describe("StatusBarManager", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("creates a status bar item on construction", async () => {
    const { StatusBarManager } = await import("../src/status-bar");
    new StatusBarManager();
    expect(mockCreateStatusBarItem).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
  });

  it("shows model count when set to ok state", async () => {
    const { StatusBarManager } = await import("../src/status-bar");
    const manager = new StatusBarManager();
    const item = mockCreateStatusBarItem.mock.results[0].value;
    manager.showOk(5);
    expect(item.text).toBe("$(copilot) AMD TokenFactory: 5 models");
    expect(item.command).toBe("amd-tokenfactory.refreshModels");
    expect(item.show).toHaveBeenCalled();
  });

  it("shows spinning icon when set to refreshing state", async () => {
    const { StatusBarManager } = await import("../src/status-bar");
    const manager = new StatusBarManager();
    const item = mockCreateStatusBarItem.mock.results[0].value;
    manager.showRefreshing();
    expect(item.text).toBe("$(loading~spin) AMD TokenFactory");
    expect(item.show).toHaveBeenCalled();
  });

  it("shows error icon and tooltip when set to error state", async () => {
    const { StatusBarManager } = await import("../src/status-bar");
    const manager = new StatusBarManager();
    const item = mockCreateStatusBarItem.mock.results[0].value;
    manager.showError("API key invalid");
    expect(item.text).toBe("$(error) AMD TokenFactory");
    expect(item.tooltip).toBe("AMD TokenFactory Error: API key invalid");
    expect(item.show).toHaveBeenCalled();
  });

  it("dispose removes the status bar item", async () => {
    const { StatusBarManager } = await import("../src/status-bar");
    const manager = new StatusBarManager();
    const item = mockCreateStatusBarItem.mock.results[0].value;
    manager.dispose();
    expect(item.dispose).toHaveBeenCalled();
  });

  it("tooltip says the fleet load is still loading before the first result", async () => {
    const { StatusBarManager } = await import("../src/status-bar");
    const manager = new StatusBarManager();
    const item = mockCreateStatusBarItem.mock.results[0].value;
    manager.showOk(3);

    expect(item.tooltip.supportThemeIcons).toBe(true);
    expect(item.tooltip.value).toContain("Click to refresh AMD TokenFactory models");
    expect(item.tooltip.value).toContain("Loading AMD-wide fleet load");
  });

  it("tooltip lists models by load state once a snapshot arrives", async () => {
    const { StatusBarManager } = await import("../src/status-bar");
    const manager = new StatusBarManager();
    const item = mockCreateStatusBarItem.mock.results[0].value;
    manager.setModels([
      { id: "deepseek-ai/deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash" },
      { id: "qwen/qwen3.8-27b", displayName: "Qwen 3.8 27B" },
    ]);
    manager.setModelLoad({
      scope: "fleet",
      fetchedAt: Date.now(),
      entries: [
        { key: "DeepSeek-V4.1-Flash", state: "full", label: "At capacity", utilization: 100 },
        { key: "Qwen3.8-27B", state: "idle", label: "Idle", utilization: 8.6 },
      ],
    });

    expect(item.tooltip.value).toContain("fleet load");
    expect(item.tooltip.value).toContain("(check) Available");
    expect(item.tooltip.value).toContain("DeepSeek V4.1 Flash");
    expect(item.tooltip.value).toContain("not your account's quota");
  });

  it("tooltip reports an unanswered fleet load instead of pretending it is idle", async () => {
    const { StatusBarManager } = await import("../src/status-bar");
    const manager = new StatusBarManager();
    const item = mockCreateStatusBarItem.mock.results[0].value;
    manager.setModelLoad(null);

    expect(item.tooltip.value).toContain("Fleet load unavailable");
  });

  it("rebuilds the tooltip when the model list changes after the load snapshot", async () => {
    const { StatusBarManager } = await import("../src/status-bar");
    const manager = new StatusBarManager();
    const item = mockCreateStatusBarItem.mock.results[0].value;
    manager.setModels([{ id: "other/thing", displayName: "Other Thing" }]);
    manager.setModelLoad({
      scope: "fleet",
      fetchedAt: Date.now(),
      entries: [{ key: "Qwen3.8-27B", state: "idle", label: "Idle", utilization: 8.6 }],
    });
    expect(item.tooltip.value).toContain("No load reported");

    manager.setModels([{ id: "qwen/qwen3.8-27b", displayName: "Qwen 3.8 27B" }]);

    expect(item.tooltip.value).not.toContain("No load reported");
    expect(item.tooltip.value).toContain("Qwen 3.8 27B · 8.6%");
  });
});
