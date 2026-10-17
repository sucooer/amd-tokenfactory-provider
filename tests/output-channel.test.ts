const mockAppendLine = jest.fn();
const mockCreateOutputChannel = jest.fn(() => ({
  appendLine: mockAppendLine,
  show: jest.fn(),
  dispose: jest.fn(),
}));

jest.mock("vscode", () => ({
  window: {
    createOutputChannel: mockCreateOutputChannel,
  },
}));

describe("output-channel", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.AMD_TOKENFACTORY_DEBUG;
  });

  it("creates a AMD TokenFactory output channel and reads the AMD debug env var", async () => {
    process.env.AMD_TOKENFACTORY_DEBUG = "1";

    const { debugEnabled, debugLog, getOutputChannel } = await import("../src/output-channel");

    expect(debugEnabled()).toBe(true);

    getOutputChannel();
    debugLog("activate", "ready");

    expect(mockCreateOutputChannel).toHaveBeenCalledWith("AMD TokenFactory");
    expect(mockAppendLine).toHaveBeenCalledWith("[AMD TokenFactory Debug] activate: ready");
  });
});
