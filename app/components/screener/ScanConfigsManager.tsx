"use client";

import { useState, useEffect, useCallback } from "react";
import type { FilterGroup } from "@/lib/screener/condition-tree";

interface ScanConfig {
  id: string;
  name: string;
  description: string | null;
  schedule: string | null;
  isPublic: boolean;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ScanConfigsManagerProps {
  onLoadConfig: (config: ScanConfig) => void;
  onApplyFilterGroup?: (filterGroup: FilterGroup) => void;
  onClose: () => void;
}

export default function ScanConfigsManager({
  onLoadConfig,
  onApplyFilterGroup,
  onClose,
}: ScanConfigsManagerProps) {
  const [configs, setConfigs] = useState<ScanConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Running state
  const [runningId, setRunningId] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/screener/configs");
      if (res.ok) {
        const data = await res.json();
        setConfigs(data);
      } else {
        setError("Failed to load configs");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  // Start inline editing
  const startEditing = (config: ScanConfig) => {
    setEditingId(config.id);
    setEditName(config.name);
    setEditDesc(config.description || "");
  };

  // Save inline edits
  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    try {
      const res = await fetch(`/api/screener/configs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null }),
      });
      if (res.ok) {
        setEditingId(null);
        fetchConfigs();
      }
    } catch { /* */ }
  };

  // Delete config
  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/screener/configs/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDeleteId(null);
        fetchConfigs();
      }
    } catch { /* */ }
    finally { setDeleting(false); }
  };

  // Run config
  const handleRun = async (config: ScanConfig) => {
    setRunningId(config.id);
    try {
      const res = await fetch(`/api/screener/configs/${config.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        onLoadConfig(config);
        // If there's a filter group callback, we'd apply it here
        onClose();
      }
    } catch { /* */ }
    finally { setRunningId(null); }
  };

  // Toggle public/private
  const togglePublic = async (config: ScanConfig) => {
    try {
      await fetch(`/api/screener/configs/${config.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !config.isPublic }),
      });
      fetchConfigs();
    } catch { /* */ }
  };

  // Copy share link
  const copyShareLink = async (config: ScanConfig) => {
    const link = `${window.location.origin}/markets/screener/advanced?config=${config.id}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch { /* fallback */ }
  };

  const filtered = configs.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Saved Scan Configs</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {configs.length} saved scan{configs.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search saved scans..."
        className="w-full p-2 text-sm border border-border rounded-lg bg-background"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="py-8 text-center">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
        </div>
      )}

      {/* Config list */}
      {!loading && (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {search ? "No matching scans" : "No saved scans yet. Run a scan and save it!"}
            </div>
          ) : (
            filtered.map((config) => (
              <div
                key={config.id}
                className="border border-border rounded-lg p-3 hover:bg-muted/30 transition-colors group"
              >
                {editingId === config.id ? (
                  /* Inline editing mode */
                  <div className="space-y-2">
                    <input
                      type="text"
                      className="w-full p-2 text-sm font-medium border border-blue-400 rounded-lg bg-background focus:ring-2 focus:ring-blue-500 outline-none"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(config.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <textarea
                      className="w-full p-2 text-xs border border-border rounded-lg bg-background resize-none"
                      rows={2}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description (optional)"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(config.id)}
                        disabled={!editName.trim()}
                        className="px-4 py-1 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <>
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-sm truncate">{config.name}</h4>
                          {config.isPublic && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 rounded-full font-medium">
                              Public
                            </span>
                          )}
                        </div>
                        {config.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{config.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                          <span>{config.runCount} run{config.runCount !== 1 ? "s" : ""}</span>
                          {config.lastRunAt && (
                            <span>Last: {new Date(config.lastRunAt).toLocaleDateString()}</span>
                          )}
                          <span>Created: {new Date(config.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/40">
                      {/* Run */}
                      <button
                        onClick={() => handleRun(config)}
                        disabled={runningId === config.id}
                        className="px-3 py-1 text-[11px] font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        {runningId === config.id ? "Running..." : "▶ Run"}
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => startEditing(config)}
                        className="px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                      >
                        Edit
                      </button>

                      {/* Share */}
                      <button
                        onClick={() => copyShareLink(config)}
                        className="px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                        title="Copy share link"
                      >
                        🔗 Share
                      </button>

                      {/* Visibility toggle */}
                      <button
                        onClick={() => togglePublic(config)}
                        className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                          config.isPublic
                            ? "text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                        title={config.isPublic ? "Make private" : "Make public"}
                      >
                        {config.isPublic ? "🌐 Public" : "🔒 Private"}
                      </button>

                      <div className="flex-1" />

                      {/* Delete */}
                      {deleteId === config.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-red-500">Confirm?</span>
                          <button
                            onClick={() => handleDelete(config.id)}
                            disabled={deleting}
                            className="px-2 py-1 text-[11px] font-medium bg-red-600 text-white rounded-md hover:bg-red-700"
                          >
                            {deleting ? "..." : "Yes"}
                          </button>
                          <button
                            onClick={() => setDeleteId(null)}
                            className="px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted rounded-md"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteId(config.id)}
                          className="px-2 py-1 text-[11px] font-medium text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
