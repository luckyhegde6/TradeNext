"use client";

import { useState, useEffect, useCallback } from "react";
import FilterBuilder from "@/app/components/screener/FilterBuilder";
import type { FilterGroup } from "@/lib/screener/condition-tree";
import { createDefaultFilterGroup } from "@/lib/screener/condition-tree";

interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  symbol: string | null;
  filterGroup: FilterGroup;
  schedule: string | null;
  cooldownMinutes: number;
  channelIds: string[];
  isActive: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
}

interface AlertChannel {
  id: string;
  name: string;
  type: string;
}

export default function RuleList() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSymbol, setFormSymbol] = useState("");
  const [formFilter, setFormFilter] = useState<FilterGroup>(createDefaultFilterGroup());
  const [formSchedule, setFormSchedule] = useState("");
  const [formCooldown, setFormCooldown] = useState(60);
  const [formChannels, setFormChannels] = useState<string[]>([]);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts/rules");
      if (!res.ok) throw new Error("Failed to fetch rules");
      const data = await res.json();
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts/channels");
      if (!res.ok) return;
      const data = await res.json();
      setChannels(data);
    } catch {
      // Silently fail — channels are optional
    }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchChannels();
  }, [fetchRules, fetchChannels]);

  const openNewForm = () => {
    setEditingRule(null);
    setFormName("");
    setFormDescription("");
    setFormSymbol("");
    setFormFilter(createDefaultFilterGroup());
    setFormSchedule("");
    setFormCooldown(60);
    setFormChannels([]);
    setShowForm(true);
  };

  const openEditForm = (rule: AlertRule) => {
    setEditingRule(rule);
    setFormName(rule.name);
    setFormDescription(rule.description || "");
    setFormSymbol(rule.symbol || "");
    setFormFilter(rule.filterGroup);
    setFormSchedule(rule.schedule || "");
    setFormCooldown(rule.cooldownMinutes);
    setFormChannels(rule.channelIds || []);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingRule(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload = {
        name: formName,
        description: formDescription || undefined,
        symbol: formSymbol.toUpperCase() || undefined,
        filterGroup: formFilter,
        schedule: formSchedule || undefined,
        cooldownMinutes: formCooldown,
        channelIds: formChannels,
      };

      const url = editingRule ? `/api/alerts/rules/${editingRule.id}` : "/api/alerts/rules";
      const method = editingRule ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Failed to ${editingRule ? "update" : "create"} rule`);
      }

      closeForm();
      fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (rule: AlertRule) => {
    try {
      const res = await fetch(`/api/alerts/rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (res.ok) fetchRules();
    } catch (err) {
      console.error("Failed to toggle rule:", err);
    }
  };

  const deleteRule = async (rule: AlertRule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      const res = await fetch(`/api/alerts/rules/${rule.id}`, { method: "DELETE" });
      if (res.ok) fetchRules();
    } catch (err) {
      console.error("Failed to delete rule:", err);
    }
  };

  const evaluateNow = async (ruleId?: string) => {
    try {
      const res = await fetch("/api/alerts/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleId ? { ruleIds: [ruleId] } : {}),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Evaluation complete: ${data.triggered} triggered out of ${data.evaluated} rules`);
      }
    } catch (err) {
      console.error("Failed to evaluate:", err);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading alert rules...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {rules.filter((r) => r.isActive).length} active of {rules.length} rules
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => evaluateNow()}
            className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted"
          >
            Evaluate All
          </button>
          <button
            onClick={openNewForm}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary/90"
          >
            + New Rule
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 pb-10 bg-black/40 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-border w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-border px-6 py-4 flex justify-between items-center z-10">
              <h3 className="text-lg font-semibold">
                {editingRule ? "Edit Alert Rule" : "New Alert Rule"}
              </h3>
              <button onClick={closeForm} className="text-muted-foreground hover:text-foreground text-xl">&times;</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Basic info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Rule Name *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., RSI Oversold Bounce"
                    className="w-full p-2 border border-border rounded bg-background text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Stock Symbol (optional)</label>
                  <input
                    type="text"
                    value={formSymbol}
                    onChange={(e) => setFormSymbol(e.target.value)}
                    placeholder="Leave empty for any stock"
                    className="w-full p-2 border border-border rounded bg-background text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    If set, only this symbol is evaluated
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description (optional)</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="What does this alert rule do?"
                  rows={2}
                  className="w-full p-2 border border-border rounded bg-background text-sm"
                />
              </div>

              {/* Filter conditions */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium">Filter Conditions</label>
                  <span className="text-xs text-muted-foreground">
                    Alert triggers when conditions match
                  </span>
                </div>
                <div className="border border-border rounded-lg p-4 bg-background">
                  <FilterBuilder value={formFilter} onChange={setFormFilter} />
                </div>
              </div>

              {/* Schedule & cooldown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Schedule (cron) (optional)</label>
                  <input
                    type="text"
                    value={formSchedule}
                    onChange={(e) => setFormSchedule(e.target.value)}
                    placeholder="e.g., */5 * * * 1-5"
                    className="w-full p-2 border border-border rounded bg-background text-sm font-mono"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Empty = check on every evaluate. Default work hours: */5 * * * 1-5
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cooldown (minutes)</label>
                  <input
                    type="number"
                    min={0}
                    value={formCooldown}
                    onChange={(e) => setFormCooldown(parseInt(e.target.value) || 0)}
                    className="w-full p-2 border border-border rounded bg-background text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Min minutes between repeats. 0 = no cooldown.
                  </p>
                </div>
              </div>

              {/* Delivery channels */}
              <div>
                <label className="block text-sm font-medium mb-2">Delivery Channels</label>
                {channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    No channels configured. Create one in the Channels tab first.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {channels.map((ch) => (
                      <label
                        key={ch.id}
                        className={`flex items-center gap-2 p-2 border rounded cursor-pointer text-sm ${
                          formChannels.includes(ch.id)
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formChannels.includes(ch.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormChannels([...formChannels, ch.id]);
                            } else {
                              setFormChannels(formChannels.filter((id) => id !== ch.id));
                            }
                          }}
                          className="rounded"
                        />
                        <span className="font-medium">{ch.name}</span>
                        <span className="text-xs text-muted-foreground">({ch.type})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? "Saving..." : editingRule ? "Update Rule" : "Create Rule"}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 border border-border rounded hover:bg-muted text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rule list */}
      {rules.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">No alert rules yet</p>
          <p className="text-sm">Create your first rule to get notified when market conditions match</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`bg-card border rounded-lg p-4 ${
                rule.isActive ? "border-l-4 border-l-green-500" : "border-border opacity-70"
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleRule(rule)}
                      className={`w-8 h-5 rounded-full relative transition-colors ${
                        rule.isActive ? "bg-green-500" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          rule.isActive ? "translate-x-[18px]" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <span className="font-semibold truncate">{rule.name}</span>
                    {rule.symbol && (
                      <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 rounded">
                        {rule.symbol}
                      </span>
                    )}
                  </div>

                  {rule.description && (
                    <p className="text-sm text-muted-foreground mt-1 ml-10">{rule.description}</p>
                  )}

                  <div className="flex items-center gap-3 mt-2 ml-10 text-xs text-muted-foreground">
                    <span>
                      {rule.filterGroup.conditions.length} condition{rule.filterGroup.conditions.length !== 1 ? "s" : ""}
                    </span>
                    {rule.filterGroup.groups.length > 0 && (
                      <span>{rule.filterGroup.groups.length} sub-group{rule.filterGroup.groups.length !== 1 ? "s" : ""}</span>
                    )}
                    <span>Cooldown: {rule.cooldownMinutes}m</span>
                    {rule.lastTriggeredAt && (
                      <span>
                        Last triggered: {new Date(rule.lastTriggeredAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => evaluateNow(rule.id)}
                    className="px-2 py-1 text-xs border border-border rounded hover:bg-muted"
                    title="Evaluate now"
                  >
                    Run
                  </button>
                  <button
                    onClick={() => openEditForm(rule)}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteRule(rule)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
