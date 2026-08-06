"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface TelegramStatus {
  subscribed: boolean;
  verified: boolean;
  chatId: string | null;
  chatIdHint: string | null;
}

export default function TelegramSubscription() {
  const { data: session } = useSession();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatIdInput, setChatIdInput] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [step, setStep] = useState<"register" | "verify" | "done">("register");
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [codeHint, setCodeHint] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);

  useEffect(() => {
    if (session) {
      fetchStatus();
    }
  }, [session]);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/user/telegram");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.subscribed) {
          setStep(data.verified ? "done" : "verify");
          if (data.chatIdHint) {
            setChatIdInput(`...${data.chatIdHint}`);
          }
        }
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!chatIdInput.trim()) return;
    setSending(true);
    setMessage(null);

    try {
      const res = await fetch("/api/user/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chatIdInput.trim() }),
      });
      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Chat ID registered!" });
        setStep("verify");
        setStatus(prev => prev ? { ...prev, subscribed: true, chatIdHint: data.chatIdHint } : null);
        setVerificationSent(false);
        setVerificationCode("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to register." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setSending(false);
    }
  };

  const handleSendCode = async () => {
    setSending(true);
    setMessage(null);

    try {
      const res = await fetch("/api/user/telegram/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = await res.json();

      if (res.ok) {
        setMessage({
          type: "success",
          text: `Verification code sent to your Telegram! ${data.hint ? `(ends in ...${data.hint})` : ""}`,
        });
        setCodeHint(data.hint || null);
        setVerificationSent(true);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to send code." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    if (!verificationCode.trim() || verificationCode.trim().length !== 6) {
      setMessage({ type: "error", text: "Enter the 6-digit code from Telegram." });
      return;
    }
    setSending(true);
    setMessage(null);

    try {
      const res = await fetch("/api/user/telegram/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", code: verificationCode.trim() }),
      });
      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: "Telegram verified! You'll now receive alerts via bot." });
        setStep("done");
        setStatus(prev => prev ? { ...prev, verified: true } : null);
      } else {
        setMessage({ type: "error", text: data.error || "Verification failed." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setSending(false);
    }
  };

  const handleTest = async () => {
    setSending(true);
    setMessage(null);

    try {
      const res = await fetch("/api/user/telegram/test", {
        method: "POST",
      });
      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: "Test message sent! Check your Telegram." });
      } else {
        setMessage({ type: "error", text: data.error || "Test failed." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    } finally {
      setSending(false);
    }
  };

  const handleUnsubscribe = async () => {
    if (!confirm("Unsubscribe from Telegram alerts?")) return;
    setSending(true);

    try {
      const res = await fetch("/api/user/telegram", { method: "DELETE" });
      if (res.ok) {
        setStatus(null);
        setStep("register");
        setChatIdInput("");
        setVerificationCode("");
        setVerificationSent(false);
        setMessage({ type: "info", text: "Unsubscribed from Telegram alerts." });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to unsubscribe." });
    } finally {
      setSending(false);
    }
  };

  if (!session) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>Please sign in to manage your Telegram subscription.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Telegram Bot Subscription</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Receive alerts and notifications directly on Telegram via @tradenext6Bot
          </p>
        </div>
        {status?.subscribed && (
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              status.verified
                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
            }`}
          >
            {status.verified ? "✅ Verified" : "⏳ Pending Verification"}
          </span>
        )}
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
              : message.type === "error"
              ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
              : "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {step === "register" && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Step 1: Link Your Telegram</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Telegram Chat ID</label>
              <p className="text-xs text-muted-foreground mb-2">
                Open Telegram, message <strong>@tradenext6Bot</strong>, and send{" "}
                <code className="bg-muted px-1 rounded">/start</code>. The bot will reply with your Chat ID.
              </p>
              <input
                type="text"
                placeholder="Paste your Chat ID here (e.g., 123456789)"
                className="w-full p-2 border border-border rounded bg-background"
                value={chatIdInput}
                onChange={e => setChatIdInput(e.target.value)}
              />
            </div>

            <button
              onClick={handleRegister}
              disabled={!chatIdInput.trim() || sending}
              className="w-full py-2 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? "Registering..." : "Register Chat ID"}
            </button>
          </div>
        </div>
      )}

      {step === "verify" && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">
            Step 2: Verify Your Chat ID
          </h3>

          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-3 text-sm">
              <p className="font-medium">Chat ID: {status?.chatId || "Registered"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                A verification code will be sent to this chat on Telegram.
              </p>
            </div>

            {!verificationSent ? (
              <button
                onClick={handleSendCode}
                disabled={sending}
                className="w-full py-2 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send Verification Code to Telegram"}
              </button>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Enter 6-Digit Code</label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Check your Telegram and enter the code sent by @tradenext6Bot
                    {codeHint && <span> (hint: ends with ...{codeHint})</span>}
                  </p>
                  <input
                    type="text"
                    placeholder="000000"
                    maxLength={6}
                    className="w-full p-2 border border-border rounded bg-background text-center text-lg tracking-widest"
                    value={verificationCode}
                    onChange={e => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleVerify}
                    disabled={verificationCode.length !== 6 || sending}
                    className="flex-1 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    {sending ? "Verifying..." : "Verify Code"}
                  </button>
                  <button
                    onClick={handleSendCode}
                    disabled={sending}
                    className="px-4 py-2 border border-border rounded hover:bg-muted text-sm"
                  >
                    Resend
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="text-center py-4">
            <div className="text-4xl mb-3">✅</div>
            <h3 className="text-lg font-semibold mb-2">Telegram Connected!</h3>
            <p className="text-sm text-muted-foreground mb-1">
              You'll receive alerts here when your rules trigger.
            </p>
            {status?.chatId && (
              <p className="text-xs text-muted-foreground mb-4">Chat ID: {status.chatId}</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleTest}
              disabled={sending}
              className="flex-1 py-2 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send Test Message"}
            </button>
            <button
              onClick={handleUnsubscribe}
              disabled={sending}
              className="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-sm"
            >
              Unsubscribe
            </button>
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <h4 className="font-medium text-sm mb-2">Try these bot commands:</h4>
            <div className="space-y-1 text-sm">
              <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">/recommendations</code> — Current stock recommendations</p>
              <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">/alerts</code> — Check your triggered alerts</p>
              <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">/updates</code> — Latest admin announcements</p>
              <p><code className="bg-muted px-1.5 py-0.5 rounded text-xs">/help</code> — Show all commands</p>
            </div>
          </div>
        </div>
      )}

      {/* Bot info card */}
      <div className="mt-6 bg-muted/50 border border-border rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl">🤖</div>
          <div>
            <h4 className="font-medium text-sm">About @tradenext6Bot</h4>
            <p className="text-xs text-muted-foreground mt-1">
              This bot delivers real-time alerts, recommendations, and market updates
              directly to your Telegram. Messages are rate-limited for security,
              and only your own data is accessible after verification.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                Rate limited (5/min, 20/hr)
              </span>
              <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded">
                Verified only
              </span>
              <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded">
                Audit logged
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
