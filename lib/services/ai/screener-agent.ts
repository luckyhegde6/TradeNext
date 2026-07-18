/**
 * LangGraph-based stock screener agent.
 * Uses OpenRouter (via LangChain ChatOpenAI) with tool calling
 * to analyze stocks based on natural language queries.
 */
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { StructuredTool, tool } from "@langchain/core/tools";
import { z } from "zod";
import { getLLM } from "./llm-provider";
import { SCREENER_SYSTEM_PROMPT, getScreenerUserPrompt } from "./prompts";
import type { AIConfig } from "./config";
import logger from "@/lib/logger";

// ─── Tools ───────────────────────────────────────────────────────────────

const getStockQuoteTool = tool(
  async ({ symbol }: { symbol: string }) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/nse/stock?symbol=${encodeURIComponent(symbol)}`
      );
      if (!res.ok) return `Could not fetch data for ${symbol}`;
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (err) {
      logger.error({ msg: "getStockQuote tool failed", symbol, error: err });
      return `Error fetching data for ${symbol}`;
    }
  },
  {
    name: "get_stock_quote",
    description: "Get real-time stock quote for a given NSE symbol",
    schema: z.object({
      symbol: z.string().describe("NSE stock symbol (e.g., RELIANCE, TCS, INFY)"),
    }),
  }
);

const getTopGainersTool = tool(
  async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/nse/gainers`
      );
      if (!res.ok) return "Could not fetch gainers";
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (err) {
      logger.error({ msg: "getTopGainers tool failed", error: err });
      return "Error fetching gainers";
    }
  },
  {
    name: "get_top_gainers",
    description: "Get today's top gaining stocks on NSE",
    schema: z.object({}),
  }
);

const getTopLosersTool = tool(
  async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/nse/losers`
      );
      if (!res.ok) return "Could not fetch losers";
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (err) {
      logger.error({ msg: "getTopLosers tool failed", error: err });
      return "Error fetching losers";
    }
  },
  {
    name: "get_top_losers",
    description: "Get today's top losing stocks on NSE",
    schema: z.object({}),
  }
);

const getMarketIndicesTool = tool(
  async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/nse/indexes`
      );
      if (!res.ok) return "Could not fetch indices";
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (err) {
      logger.error({ msg: "getMarketIndices tool failed", error: err });
      return "Error fetching indices";
    }
  },
  {
    name: "get_market_indices",
    description: "Get current NSE market indices data (NIFTY 50, BANK NIFTY, etc.)",
    schema: z.object({}),
  }
);

const tools: StructuredTool[] = [getStockQuoteTool, getTopGainersTool, getTopLosersTool, getMarketIndicesTool];

// ─── Agent Node ──────────────────────────────────────────────────────────

async function callModel(state: typeof MessagesAnnotation.State) {
  const llm = getLLM().bindTools(tools);
  const systemMessage = new SystemMessage(SCREENER_SYSTEM_PROMPT);
  const result = await llm.invoke([systemMessage, ...state.messages]);
  return { messages: [result] };
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage._getType() !== "ai" || !(lastMessage as AIMessage).tool_calls?.length) {
    return "end";
  }
  return "continue";
}

// Tool function map for direct execution (avoids type issues with tool.invoke overloads)
const toolFunctionMap: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  get_stock_quote: async (args) => {
    const symbol = args.symbol as string;
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/nse/stock?symbol=${encodeURIComponent(symbol)}`
      );
      if (!res.ok) return `Could not fetch data for ${symbol}`;
      return JSON.stringify(await res.json(), null, 2);
    } catch (err) {
      return `Error fetching data for ${symbol}`;
    }
  },
  get_top_gainers: async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/nse/gainers`
      );
      if (!res.ok) return "Could not fetch gainers";
      return JSON.stringify(await res.json(), null, 2);
    } catch { return "Error fetching gainers"; }
  },
  get_top_losers: async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/nse/losers`
      );
      if (!res.ok) return "Could not fetch losers";
      return JSON.stringify(await res.json(), null, 2);
    } catch { return "Error fetching losers"; }
  },
  get_market_indices: async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/nse/indexes`
      );
      if (!res.ok) return "Could not fetch indices";
      return JSON.stringify(await res.json(), null, 2);
    } catch { return "Error fetching indices"; }
  },
};

async function callTool(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls || [];

  const results: BaseMessage[] = [];
  for (const tc of toolCalls) {
    const fn = toolFunctionMap[tc.name];
    if (!fn) {
      results.push(new HumanMessage({ content: `Tool "${tc.name}" not found`, name: tc.name }));
      continue;
    }
    try {
      const content = await fn(tc.args as Record<string, unknown>);
      results.push(new HumanMessage({ content, name: tc.name }));
    } catch (err) {
      results.push(new HumanMessage({ content: `Error: ${err}`, name: tc.name }));
    }
  }

  return { messages: results };
}

// ─── Build Graph ─────────────────────────────────────────────────────────

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", callTool)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue, {
    continue: "tools",
    end: "__end__",
  })
  .addEdge("tools", "agent");

const app = workflow.compile();

// ─── Execute ─────────────────────────────────────────────────────────────

export interface ScreenerAgentResult {
  success: boolean;
  analysis: string;
  executionTimeMs: number;
  model: string;
}

/**
 * Run the screener agent with a natural language query.
 */
export async function runScreenerAgent(
  query: string,
  config?: AIConfig
): Promise<ScreenerAgentResult> {
  const startTime = Date.now();

  try {
    const userPrompt = getScreenerUserPrompt(query);
    const result = await app.invoke({
      messages: [new HumanMessage(userPrompt)],
    }, { configurable: { configurable: { ...config } } });

    const lastMessage = result.messages[result.messages.length - 1];
    const analysis = typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

    return {
      success: true,
      analysis,
      executionTimeMs: Date.now() - startTime,
      model: config?.model || "openrouter/free",
    };
  } catch (err) {
    logger.error({ msg: "Screener agent failed", query, error: err });
    return {
      success: false,
      analysis: `AI analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      executionTimeMs: Date.now() - startTime,
      model: config?.model || "openrouter/free",
    };
  }
}
