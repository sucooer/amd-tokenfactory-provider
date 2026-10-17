import * as vscode from "vscode";
import { AmdTokenFactoryAnalyzeImageTool, registerAmdTokenFactoryTools } from "../src/tools";

jest.mock("vscode", () => ({
  LanguageModelToolResult: class {
    constructor(public content: Array<{ value: string }>) {}
  },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  Disposable: {
    from: jest.fn(() => ({ dispose: jest.fn() })),
  },
  lm: {
    registerTool: jest.fn(() => ({ dispose: jest.fn() })),
  },
}));

jest.mock("../src/mcp", () => ({
  AmdTokenFactoryMcpClient: jest.fn().mockImplementation(() => ({
    analyzeImage: jest.fn().mockResolvedValue("Analyzed result"),
  })),
}));

describe("AmdTokenFactoryAnalyzeImageTool", () => {
  let tool: AmdTokenFactoryAnalyzeImageTool;
  let secrets: { get: jest.Mock };

  beforeEach(() => {
    secrets = { get: jest.fn() };
    tool = new AmdTokenFactoryAnalyzeImageTool(secrets as any);
  });

  it("has correct metadata", () => {
    expect(tool.name).toBe("amd_tokenfactory_analyze_image");
    expect(tool.description).toContain("Analyze an image");
    expect(tool.tags).toContain("vision");
  });

  it("invokes analyzeImage successfully", async () => {
    const result = await tool.invoke(
      {
        input: { image_data: "data:image/png;base64,abc", prompt: "What is this?" },
      } as any,
      {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as any,
    );
    expect((result.content[0] as any).value).toBe("Analyzed result");
  });

  it("handles analyzeImage errors gracefully", async () => {
    const { AmdTokenFactoryMcpClient } = jest.requireMock("../src/mcp") as {
      AmdTokenFactoryMcpClient: jest.Mock;
    };
    AmdTokenFactoryMcpClient.mockImplementationOnce(() => ({
      analyzeImage: jest.fn().mockRejectedValue(new Error("API down")),
    }));
    const failingTool = new AmdTokenFactoryAnalyzeImageTool(secrets as any);
    const result = await failingTool.invoke(
      {
        input: { image_data: "data:image/png;base64,abc", prompt: "What?" },
      } as any,
      {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as any,
    );
    expect((result.content[0] as any).value).toContain("Failed to analyze image");
    expect((result.content[0] as any).value).toContain("API down");
  });

  it("prepareInvocation returns invocation message", async () => {
    const prepared = await tool.prepareInvocation!(
      { input: { image_data: "", prompt: "" } } as any,
      {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      } as any,
    );
    expect(prepared).toEqual({
      invocationMessage: "Analyzing image with AMD TokenFactory Vision...",
    });
  });
});

describe("registerAmdTokenFactoryTools", () => {
  it("returns a disposable", () => {
    const secrets = { get: jest.fn() } as any;
    const disposable = registerAmdTokenFactoryTools(secrets);
    expect(disposable).toBeDefined();
    expect(typeof disposable.dispose).toBe("function");
    expect(vscode.Disposable.from).toHaveBeenCalled();
    expect((vscode as any).lm.registerTool).toHaveBeenCalledWith(
      "amd_tokenfactory_analyze_image",
      expect.any(AmdTokenFactoryAnalyzeImageTool),
    );
  });
});
