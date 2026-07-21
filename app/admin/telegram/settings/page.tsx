"use client";

import { useState, useEffect } from "react";

interface TelegramEnvStatus {
  configured: boolean;
  hasBotToken: boolean;
  hasChatId: boolean;
  botUsername?: string;
  error?: string;
}

export default function TelegramSettingsPage() {
  const [envStatus, setEnvStatus] = useState<TelegramEnvStatus | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/alerts/telegram-status");
      if (res.ok) setEnvStatus(await res.json());
    } catch (e) {
      console.error("Failed to fetch Telegram status:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch("/api/admin/alerts/telegram-status?verify=true");
      if (res.ok) setEnvStatus(await res.json());
    } catch (e) {
      console.error("Failed to verify Telegram:", e);
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bot Configuration Status */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Bot Configuration</h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">Bot Token</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">TELEGRAM_SECRET environment variable</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
              envStatus?.hasBotToken
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
            }`}>
              {envStatus?.hasBotToken ? "Configured" : "Missing"}
            </span>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">Default Chat ID</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">TELEGRAM_CHATID environment variable</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
              envStatus?.hasChatId
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
            }`}>
              {envStatus?.hasChatId ? "Configured" : "Missing"}
            </span>
          </div>

          {envStatus?.botUsername && (
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Bot Username</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">Verified via Telegram API</p>
              </div>
              <span className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400">
                @{envStatus.botUsername}
              </span>
            </div>
          )}

          {envStatus?.error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{envStatus.error}</p>
            </div>
          )}

          <button
            onClick={handleVerify}
            disabled={verifying}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 text-white text-sm font-bold rounded-xl transition-all disabled:cursor-not-allowed"
          >
            {verifying ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Verifying...
              </span>
            ) : (
              "Verify Bot Connection"
            )}
          </button>
        </div>
      </div>

      {/* Environment Variables Guide */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Environment Variables</h3>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
          Add these to your <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-slate-800 rounded text-[10px] font-mono">.env</code> file to enable Telegram integration:
        </p>
        <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 font-mono text-xs space-y-2">
          <div>
            <span className="text-gray-400"># Get from @BotFather on Telegram</span>
          </div>
          <div>
            <span className="text-blue-600 dark:text-blue-400">TELEGRAM_SECRET</span>
            <span className="text-gray-500">=</span>
            <span className="text-gray-400">your-bot-token-here</span>
          </div>
          <div className="pt-2">
            <span className="text-gray-400"># Your Telegram Chat ID (get from /chatid command)</span>
          </div>
          <div>
            <span className="text-blue-600 dark:text-blue-400">TELEGRAM_CHATID</span>
            <span className="text-gray-500">=</span>
            <span className="text-gray-400">your-chat-id-here</span>
          </div>
        </div>
      </div>

      {/* Setup Instructions */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Setup Instructions</h3>
        <ol className="space-y-3 text-xs text-gray-600 dark:text-slate-400">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-bold">1</span>
            <span>Open Telegram and search for <strong>@BotFather</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-bold">2</span>
            <span>Send <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-800 rounded">/newbot</code> and follow the prompts to create your bot</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-bold">3</span>
            <span>Copy the bot token and add it as <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-800 rounded">TELEGRAM_SECRET</code> in your .env</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-bold">4</span>
            <span>Start a chat with your bot and send <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-800 rounded">/chatid</code> to get your Chat ID</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-bold">5</span>
            <span>Add your Chat ID as <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-800 rounded">TELEGRAM_CHATID</code> in your .env</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-bold">6</span>
            <span>Set the webhook: <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-800 rounded">POST https://api.telegram.org/bot{'<TOKEN>'}/setWebhook?url={'<YOUR_APP>'}/api/telegram/webhook</code></span>
          </li>
        </ol>
      </div>
    </div>
  );
}
