"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface AIConfigData {
  configured: boolean;
  hasApiKey: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  availableModels: { id: string; name: string; description?: string }[];
  customModels: { id: string; name: string; description?: string }[];
  envModel: string;
}

export default function AdminAIPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [config, setConfig] = useState<AIConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [selectedModel, setSelectedModel] = useState("");
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [enabled, setEnabled] = useState(true);

  // Custom model form
  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelDesc, setNewModelDesc] = useState("");
  const [addingModel, setAddingModel] = useState(false);

  // Model discovery
  const [discoveredModels, setDiscoveredModels] = useState<{
    id: string; name: string; description: string; contextLength: number;
    promptPrice: string; completionPrice: string; isFree: boolean; modality: string;
  }[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverSort, setDiscoverSort] = useState("free");
  const [discoverSearch, setDiscoverSearch] = useState("");
  const [discoverFreeOnly, setDiscoverFreeOnly] = useState(true);
  const [showDiscovery, setShowDiscovery] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || !session.user || (session.user as any).role !== "admin") {
      router.push("/admin/access-denied");
    }
  }, [session, status, router]);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai/config");
      if (res.ok) {
        const data: AIConfigData = await res.json();
        setConfig(data);
        setSelectedModel(data.model);
        setTemperature(data.temperature);
        setMaxTokens(data.maxTokens);
        setEnabled(data.enabled);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated") fetchConfig();
  }, [status]);

  const saveConfig = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel, temperature, maxTokens, enabled }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "AI configuration updated successfully." });
        await fetchConfig();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save configuration" });
    } finally {
      setSaving(false);
    }
  };

  const addCustomModel = async () => {
    if (!newModelId.trim()) {
      setMessage({ type: "error", text: "Model ID is required (e.g., openrouter/auto-beta)" });
      return;
    }
    setAddingModel(true);
    setMessage(null);
    try {
      // First, select this model (which validates and saves it)
      const res = await fetch("/api/admin/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: newModelId.trim() }),
      });
      if (res.ok) {
        // Now persist as custom model
        const customRes = await fetch("/api/admin/ai/custom-models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add",
            model: {
              id: newModelId.trim(),
              name: newModelName.trim() || newModelId.trim(),
              description: newModelDesc.trim() || undefined,
            },
          }),
        });
        if (customRes.ok) {
          setMessage({ type: "success", text: `Model "${newModelId}" added successfully.` });
          setNewModelId("");
          setNewModelName("");
          setNewModelDesc("");
          await fetchConfig();
        } else {
          const err = await customRes.json();
          setMessage({ type: "error", text: err.error || "Failed to add custom model" });
        }
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Invalid model ID" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to add custom model" });
    } finally {
      setAddingModel(false);
    }
  };

  const removeCustomModel = async (modelId: string) => {
    if (!confirm(`Remove model "${modelId}"?`)) return;
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai/config", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: `Model "${modelId}" removed.` });
        await fetchConfig();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to remove model" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to remove model" });
    }
  };

  const testConnection = async () => {
    setMessage(null);
    try {
      const res = await fetch("/api/ai/screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "What is the current NIFTY 50 index value?" }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "Connection successful! AI responded correctly." });
      } else {
        setMessage({ type: "error", text: data.analysis || "AI failed to respond" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Connection failed. Verify that your .env file has a valid OPENROUTERKEY." });
    }
  };

  const discoverModels = async () => {
    setDiscovering(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        sort: discoverSort,
        freeOnly: String(discoverFreeOnly),
        limit: "100",
      });
      if (discoverSearch) params.set("search", discoverSearch);
      const res = await fetch(`/api/admin/ai/discover-models?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDiscoveredModels(data.models || []);
        setShowDiscovery(true);
        setMessage({ type: "success", text: `Found ${data.returned} models (${data.total} total on OpenRouter)` });
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to discover models" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to fetch models from OpenRouter" });
    } finally {
      setDiscovering(false);
    }
  };

  const addDiscoveredModel = async (modelId: string, modelName: string) => {
    setMessage(null);
    try {
      // Select the model
      const configRes = await fetch("/api/admin/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      });
      if (!configRes.ok) {
        const err = await configRes.json();
        setMessage({ type: "error", text: err.error || "Invalid model" });
        return;
      }
      // Persist as custom model
      const customRes = await fetch("/api/admin/ai/custom-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          model: { id: modelId, name: modelName },
        }),
      });
      if (customRes.ok) {
        setMessage({ type: "success", text: `Model "${modelName}" added and selected.` });
        await fetchConfig();
      } else {
        const err = await customRes.json();
        setMessage({ type: "error", text: err.error || "Failed to save custom model" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to add model" });
    }
  };

  if (status === "loading" || !session || (session.user as any).role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Agent Configuration</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure LangChain/LangGraph agents for AI-powered stock screening and alert analysis
        </p>
      </div>

      {/* Status banner */}
      {loading ? (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700 animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-gray-200 dark:bg-slate-600 rounded" />)}
        </div>
      ) : config ? (
        <>
          {/* API Key Status */}
          <div className={`rounded-lg p-4 border ${config.hasApiKey ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  OpenRouter API Key
                </p>
                <p className="text-xs mt-1">
                  {config.hasApiKey
                    ? "Configured"
                    : "Not configured — add OPENROUTERKEY to .env file"}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${config.hasApiKey ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300" : "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300"}`}>
                {config.hasApiKey ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>

          {/* Model Selection */}
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700 space-y-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Model Settings</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                AI Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              >
                <optgroup label="Built-in Models">
                  {config.availableModels
                    .filter((m) => !config.customModels.some((c) => c.id === m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </optgroup>
                {config.customModels.length > 0 && (
                  <optgroup label="Custom Models">
                    {config.customModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.id})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Default: openrouter/free (uses OpenRouter's free tier model)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Temperature: {temperature.toFixed(1)}
                </label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Lower = focused, Higher = creative
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Max Tokens
                </label>
                <input
                  type="number"
                  min={128}
                  max={16384}
                  step={128}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-400 mt-1">Max response length</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600" />
              </label>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                AI Agents {enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save Configuration"}
            </button>
            <button
              onClick={testConnection}
              disabled={!config.hasApiKey || saving}
              className="px-4 py-2 bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg hover:bg-gray-300 dark:hover:bg-slate-500 disabled:opacity-50 transition-colors"
            >
              Test Connection
            </button>
          </div>

          {/* Custom Models */}
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Custom Models</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Add any OpenRouter model (e.g., <code>openrouter/auto-beta</code>, <code>nvidia/nemotron-3-embed-1b:free</code>, <code>tencent/hy3:free</code>)
            </p>

            {/* Add form */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Model ID *</label>
                <input
                  type="text"
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                  placeholder="org/model-name:free"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Display Name</label>
                <input
                  type="text"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  placeholder="Friendly name"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description</label>
                <input
                  type="text"
                  value={newModelDesc}
                  onChange={(e) => setNewModelDesc(e.target.value)}
                  placeholder="Short description"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={addCustomModel}
                  disabled={addingModel || !newModelId.trim()}
                  className="w-full px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {addingModel ? "Adding..." : "Add Model"}
                </button>
              </div>
            </div>

            {/* Custom models list */}
            {config.customModels.length > 0 ? (
              <div className="mt-3 space-y-2">
                {config.customModels.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{m.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{m.id}</div>
                      {m.description && <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{m.description}</div>}
                    </div>
                    <button
                      onClick={() => removeCustomModel(m.id)}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No custom models added yet.</p>
            )}
          </div>

          {/* Discover Free Models */}
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Discover OpenRouter Models</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Browse and add free or low-cost models from OpenRouter&apos;s catalog
                </p>
              </div>
              <button
                onClick={() => setShowDiscovery(!showDiscovery)}
                className="px-3 py-1.5 text-xs font-bold bg-gray-200 dark:bg-slate-600 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-500"
              >
                {showDiscovery ? "Hide" : "Show"} Discovery
              </button>
            </div>

            {showDiscovery && (
              <>
                {/* Discovery controls */}
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Sort By</label>
                    <select
                      value={discoverSort}
                      onChange={(e) => setDiscoverSort(e.target.value)}
                      className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                    >
                      <option value="free">Free First</option>
                      <option value="pricing">Lowest Price</option>
                      <option value="top">Top Rated</option>
                      <option value="newest">Newest</option>
                      <option value="latency">By Latency</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Search</label>
                    <input
                      type="text"
                      value={discoverSearch}
                      onChange={(e) => setDiscoverSearch(e.target.value)}
                      placeholder="e.g. llama, gemini, free"
                      className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 w-48"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={discoverFreeOnly}
                      onChange={(e) => setDiscoverFreeOnly(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-gray-700 dark:text-gray-300">Free only</span>
                  </label>
                  <button
                    onClick={discoverModels}
                    disabled={discovering}
                    className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {discovering ? "Discovering..." : "Discover Models"}
                  </button>
                </div>

                {/* Discovered models list */}
                {discoveredModels.length > 0 && (
                  <div className="mt-3 space-y-2 max-h-96 overflow-y-auto">
                    {discoveredModels.map((m) => (
                      <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{m.name}</span>
                            {m.isFree && (
                              <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded text-[10px] font-bold">FREE</span>
                            )}
                            <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 rounded text-[10px] font-mono">{m.modality}</span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{m.id}</div>
                          {m.description && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{m.description.substring(0, 120)}</div>
                          )}
                          <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                            {m.contextLength > 0 && <span>Context: {(m.contextLength / 1000).toFixed(0)}K</span>}
                            {parseFloat(m.promptPrice) > 0 && <span>Prompt: ${m.promptPrice}/1K</span>}
                            {parseFloat(m.completionPrice) > 0 && <span>Completion: ${m.completionPrice}/1K</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => addDiscoveredModel(m.id, m.name)}
                          className="ml-3 px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                        >
                          + Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Message */}
          {message && (
            <div className={`rounded-lg p-4 text-sm ${
              message.type === "success"
                ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
            }`}>
              {message.text}
            </div>
          )}

          {/* Environment info */}
          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-4 border border-gray-200 dark:border-slate-700">
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Environment</h4>
            <div className="space-y-1 text-xs">
              <p><span className="text-gray-400">Env Model:</span> <code className="text-gray-600 dark:text-gray-300">{config.envModel}</code></p>
              <p><span className="text-gray-400">API Key Env Var:</span> <code className="text-gray-600 dark:text-gray-300">OPENROUTERKEY</code></p>
              <p><span className="text-gray-400">Base URL:</span> <code className="text-gray-600 dark:text-gray-300">https://openrouter.ai/api/v1</code></p>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-8 text-center border border-gray-200 dark:border-slate-700">
          <p className="text-gray-500">Could not load AI configuration.</p>
          <button onClick={fetchConfig} className="mt-3 text-blue-600 hover:underline text-sm">Retry</button>
        </div>
      )}
    </div>
  );
}
