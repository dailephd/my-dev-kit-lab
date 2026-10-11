import type { AgentSuccessCampaignProgressReportV1 } from "./agentSuccessCampaignProgressReportModel.js";
import { renderAgentSuccessCampaignProgressText } from "./renderAgentSuccessCampaignProgressText.js";
/** A static accessible projection of the same text; every dynamic character is escaped. */
export function renderAgentSuccessCampaignProgressHtml(model: AgentSuccessCampaignProgressReportV1): string {
  const text = renderAgentSuccessCampaignProgressText(model).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Campaign progress</title></head><body><main><h1>Campaign progress and evidence</h1><pre style="white-space:pre-wrap">${text}</pre></main></body></html>\n`;
}
