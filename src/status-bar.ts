import * as vscode from "vscode";
import {
  PROVIDER_DISPLAY_NAME,
  REFRESH_MODELS_COMMAND_ID,
  STATUS_BAR_DEFAULT_TEXT,
  STATUS_BAR_ERROR_TEXT,
} from "./constants";
import { formatModelLoad, LoadableModel, matchModelLoad, ModelLoadSnapshot } from "./model-load";

export class StatusBarManager {
  private readonly item: vscode.StatusBarItem;
  private models: readonly LoadableModel[] = [];
  private load: ModelLoadSnapshot | null = null;
  /** True once a fetch has finished, so "still loading" and "did not answer" stay distinguishable. */
  private loadAttempted = false;
  private error: string | null = null;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = REFRESH_MODELS_COMMAND_ID;
    this.renderTooltip();
  }

  /** The models currently in the picker; the tooltip lists these against the fleet load. */
  setModels(models: readonly LoadableModel[]): void {
    this.models = models;
    this.renderTooltip();
  }

  /**
   * Fleet load as last read from AMD. `null` means the last attempt failed — the tooltip then says
   * so instead of claiming the fleet is idle.
   */
  setModelLoad(snapshot: ModelLoadSnapshot | null): void {
    this.load = snapshot;
    this.loadAttempted = true;
    this.renderTooltip();
  }

  showOk(modelCount: number): void {
    this.error = null;
    this.item.text = `$(copilot) ${PROVIDER_DISPLAY_NAME}: ${modelCount} models`;
    this.item.command = REFRESH_MODELS_COMMAND_ID;
    this.renderTooltip();
    this.item.show();
  }

  showRefreshing(): void {
    this.error = null;
    this.item.text = STATUS_BAR_DEFAULT_TEXT;
    this.item.command = REFRESH_MODELS_COMMAND_ID;
    this.renderTooltip();
    this.item.show();
  }

  showError(message: string): void {
    this.error = message;
    this.item.text = STATUS_BAR_ERROR_TEXT;
    this.item.command = REFRESH_MODELS_COMMAND_ID;
    this.renderTooltip();
    this.item.show();
  }

  /**
   * Hovering the item is the only surface a status bar item has, so the per-model load panel lives
   * in the tooltip: a MarkdownString with theme icons for the three states.
   */
  private renderTooltip(): void {
    if (this.error !== null) {
      this.item.tooltip = `${PROVIDER_DISPLAY_NAME} Error: ${this.error}`;
      return;
    }

    const sections: string[] = [`Click to refresh ${PROVIDER_DISPLAY_NAME} models.`];
    if (this.load) {
      sections.push(formatModelLoad(matchModelLoad(this.models, this.load), this.load));
    } else if (this.loadAttempted) {
      sections.push(`_Fleet load unavailable — AMD's load endpoint did not answer._`);
    } else {
      sections.push(`_Loading AMD-wide fleet load… the endpoint takes about 25s to answer._`);
    }

    const markdown = new vscode.MarkdownString(sections.join("\n\n"));
    markdown.supportThemeIcons = true;
    this.item.tooltip = markdown;
  }

  dispose(): void {
    this.item.dispose();
  }
}
