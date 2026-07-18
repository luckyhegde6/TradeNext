/**
 * AI Context Manager — Preserves conversation context across turns,
 * manages token budgets, and provides efficient context windowing.
 *
 * Features:
 * - Multi-turn conversation history with token tracking
 * - Automatic context windowing (slides out old messages)
 * - Token budget enforcement per model
 * - Context summarization for long conversations
 * - User-specific context persistence via Prisma
 */
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

export interface ContextMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tokens: number;
  timestamp: string;
}

export interface ConversationContext {
  id: string;
  userId: number;
  analysisType: string;
  title: string | null;
  messages: ContextMessage[];
  tokenCount: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContextConfig {
  maxTokens: number; // Max context window size
  maxMessages: number; // Max messages before windowing
  preserveSystem: boolean; // Always keep system messages
  summaryTrigger: number; // Token % to trigger summarization
}

// ─── Default configs per model ───────────────────────────────────────────

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "openai/gpt-4o-mini": 128000,
  "openai/gpt-4o": 128000,
  "anthropic/claude-3.5-sonnet": 200000,
  "google/gemini-2.0-flash": 1048576,
  "meta-llama/llama-3.3-70b": 128000,
  "deepseek/deepseek-chat": 64000,
};

const DEFAULT_MAX_TOKENS = 128000;
const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxTokens: 16000, // Reserve most of the context for the response
  maxMessages: 50,
  preserveSystem: true,
  summaryTrigger: 0.7, // Summarize when context is 70% full
};

// ─── Token estimation ────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough estimation: ~4 chars per token for mixed content
  // More accurate: 1 token ~= 4 chars in English, ~1.5 chars in code
  const words = text.split(/\s+/).length;
  const charCount = text.length;
  return Math.ceil(words * 1.3) + Math.ceil(charCount * 0.25);
}

// ─── Conversation CRUD ────────────────────────────────────────────────────

/**
 * Create a new conversation.
 */
export async function createConversation(
  userId: number,
  analysisType: string,
  title?: string
): Promise<ConversationContext> {
  const conv = await prisma.aIConversation.create({
    data: {
      userId,
      analysisType,
      title: title || `${analysisType} analysis`,
      messages: [],
      tokenCount: 0,
      messageCount: 0,
    },
  });
  return mapConversation(conv);
}

/**
 * Get active conversations for a user.
 */
export async function getUserConversations(
  userId: number,
  analysisType?: string
): Promise<ConversationContext[]> {
  const where: any = { userId, isActive: true };
  if (analysisType) where.analysisType = analysisType;

  const conversations = await prisma.aIConversation.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return conversations.map(mapConversation);
}

/**
 * Get a specific conversation with full message history.
 */
export async function getConversation(id: string, userId: number): Promise<ConversationContext | null> {
  const conv = await prisma.aIConversation.findFirst({ where: { id, userId } });
  return conv ? mapConversation(conv) : null;
}

/**
 * Add a message to a conversation with token budgeting.
 * Automatically windows old messages if token budget exceeded.
 */
export async function addMessage(
  conversationId: string,
  userId: number,
  role: ContextMessage["role"],
  content: string,
  model?: string
): Promise<ConversationContext> {
  const conv = await prisma.aIConversation.findFirst({ where: { id: conversationId, userId } });
  if (!conv) throw new Error("Conversation not found");

  const messages = (conv.messages as unknown as ContextMessage[]) || [];
  const tokenCost = estimateTokens(content);
  const modelLimit = MODEL_CONTEXT_LIMITS[model || "openai/gpt-4o-mini"] || DEFAULT_MAX_TOKENS;
  const config = { ...DEFAULT_CONTEXT_CONFIG, maxTokens: Math.floor(modelLimit * 0.6) };

  const newMessage: ContextMessage = {
    role,
    content,
    tokens: tokenCost,
    timestamp: new Date().toISOString(),
  };

  let updatedMessages = [...messages, newMessage];
  let totalTokens = conv.tokenCount + tokenCost;

  // Context windowing — slide out old non-system messages if over budget
  if (totalTokens > config.maxTokens || updatedMessages.length > config.maxMessages) {
    updatedMessages = windowContext(updatedMessages, config, modelLimit);
    totalTokens = updatedMessages.reduce((sum, m) => sum + m.tokens, 0);
  }

  await prisma.aIConversation.update({
    where: { id: conversationId },
    data: {
      messages: updatedMessages as any,
      tokenCount: totalTokens,
      messageCount: updatedMessages.length,
      updatedAt: new Date(),
    },
  });

  return {
    id: conversationId,
    userId,
    analysisType: conv.analysisType,
    title: conv.title,
    messages: updatedMessages,
    tokenCount: totalTokens,
    messageCount: updatedMessages.length,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Close/deactivate a conversation.
 */
export async function closeConversation(id: string, userId: number): Promise<void> {
  await prisma.aIConversation.updateMany({
    where: { id, userId },
    data: { isActive: false },
  });
}

/**
 * Delete old inactive conversations.
 */
export async function cleanupConversations(retentionDays: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86400000);
  const result = await prisma.aIConversation.deleteMany({
    where: { isActive: false, updatedAt: { lt: cutoff } },
  });
  return result.count;
}

// ─── Context windowing ───────────────────────────────────────────────────

function windowContext(
  messages: ContextMessage[],
  config: ContextConfig,
  modelLimit: number
): ContextMessage[] {
  // Always keep system messages
  const systemMessages = config.preserveSystem
    ? messages.filter((m) => m.role === "system")
    : [];

  // Non-system messages (user + assistant)
  const nonSystem = messages.filter((m) => m.role !== "system");

  // If still under budget, keep all
  const totalSystemTokens = systemMessages.reduce((s, m) => s + m.tokens, 0);
  const budget = Math.min(config.maxTokens, Math.floor(modelLimit * 0.6)) - totalSystemTokens;

  if (budget <= 0) return systemMessages;

  // Keep the most recent messages that fit within budget
  let tokenCount = 0;
  const selected: ContextMessage[] = [];

  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const msg = nonSystem[i];
    if (tokenCount + msg.tokens <= budget) {
      selected.unshift(msg);
      tokenCount += msg.tokens;
    } else {
      break;
    }
  }

  return [...systemMessages, ...selected];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function mapConversation(conv: any): ConversationContext {
  return {
    id: conv.id,
    userId: conv.userId,
    analysisType: conv.analysisType,
    title: conv.title,
    messages: (conv.messages || []) as ContextMessage[],
    tokenCount: conv.tokenCount,
    messageCount: conv.messageCount,
    createdAt: conv.createdAt?.toISOString(),
    updatedAt: conv.updatedAt?.toISOString(),
  };
}
