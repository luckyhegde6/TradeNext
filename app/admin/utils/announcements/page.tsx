"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { PlusIcon, PencilIcon, TrashIcon, BellIcon } from "@heroicons/react/24/outline";

interface AdminAnnouncement {
  id: number;
  title: string;
  message: string;
  type: "info" | "warning" | "error" | "success";
  target: "all" | "user" | "admin";
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  link: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function AdminAnnouncementsPage() {
  const { data: session, status } = useSession();
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    message: "",
    type: "info" as const,
    target: "all" as const,
    isActive: true,
    startsAt: "",
    endsAt: "",
    link: "",
  });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      fetchAnnouncements();
    }
  }, [status]);

  const fetchAnnouncements = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/announcements");
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data);
      }
    } catch (error) {
      console.error("Failed to fetch announcements:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const method = editingId ? "PUT" : "POST";
      const body = editingId
        ? { ...formData, id: editingId }
        : formData;

      const res = await fetch("/api/admin/announcements", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setMessage({ type: "success", text: `Announcement ${editingId ? "updated" : "created"} successfully` });
        setShowForm(false);
        setEditingId(null);
        setFormData({
          title: "",
          message: "",
          type: "info",
          target: "all",
          isActive: true,
          startsAt: "",
          endsAt: "",
          link: "",
        });
        fetchAnnouncements();
      } else {
        throw new Error("Failed to save");
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to save announcement" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this announcement?")) return;
    try {
      const res = await fetch(`/api/admin/announcements?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchAnnouncements();
      }
    } catch (error) {
      console.error("Failed to delete:", error);
    }
  };

  const handleToggleActive = async (id: number, isActive: boolean) => {
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "toggleActive", isActive }),
      });
      if (res.ok) fetchAnnouncements();
    } catch (error) {
      console.error("Failed to toggle:", error);
    }
  };

  const startEdit = (ann: AdminAnnouncement) => {
    setEditingId(ann.id);
    setFormData({
      title: ann.title,
      message: ann.message,
      type: ann.type,
      target: ann.target,
      isActive: ann.isActive,
      startsAt: ann.startsAt ? new Date(ann.startsAt).toISOString().slice(0, 16) : "",
      endsAt: ann.endsAt ? new Date(ann.endsAt).toISOString().slice(0, 16) : "",
      link: ann.link || "",
    });
    setShowForm(true);
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "success": return "bg-green-100 text-green-800";
      case "warning": return "bg-yellow-100 text-yellow-800";
      case "error": return "bg-red-100 text-red-800";
      default: return "bg-blue-100 text-blue-800";
    }
  };

  if (status === "loading") {
    return <div className="p-8 text-center">Loading...</div>;
  }

  if (status === "unauthenticated") {
    return <div className="p-8 text-center">Access denied</div>;
  }

  return (
    <div className="space-y-8 p-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
            <BellIcon className="w-10 h-10" />
            Admin Announcements
          </h1>
          <p className="text-lg text-gray-500 dark:text-slate-400 mt-2">
            Create and manage banner notifications for users and admins.
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setFormData({ title: "", message: "", type: "info", target: "all", isActive: true, startsAt: "", endsAt: "", link: "" }); }}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 flex items-center gap-2"
        >
          <PlusIcon className="w-5 h-5" />
          New Announcement
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-lg ${message.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
          {message.text}
        </div>
      )}

      {showForm && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800">
          <h2 className="text-xl font-bold mb-4">{editingId ? "Edit Announcement" : "Create New Announcement"}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800"
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                  <option value="success">Success</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Target Audience</label>
                <select
                  value={formData.target}
                  onChange={(e) => setFormData({ ...formData, target: e.target.value as any })}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800"
                >
                  <option value="all">All Users</option>
                  <option value="user">Regular Users</option>
                  <option value="admin">Admins Only</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="isActive" className="text-sm font-medium">Active / Visible</label>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Start Date/Time (optional)</label>
                <input
                  type="datetime-local"
                  value={formData.startsAt}
                  onChange={(e) => setFormData({ ...formData, startsAt: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End Date/Time (optional)</label>
                <input
                  type="datetime-local"
                  value={formData.endsAt}
                  onChange={(e) => setFormData({ ...formData, endsAt: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Link (optional)</label>
                <input
                  type="url"
                  value={formData.link}
                  onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Message</label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800"
                  required
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                {editingId ? "Update" : "Create"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Target</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Valid Until</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {announcements.map((ann) => (
                <tr key={ann.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{ann.title}</div>
                    <div className="text-xs text-gray-500 truncate max-w-xs">{ann.message}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${getTypeColor(ann.type)}`}>
                      {ann.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">{ann.target}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(ann.id, !ann.isActive)}
                      className={`px-2 py-1 rounded-full text-xs font-bold ${ann.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}
                    >
                      {ann.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {ann.endsAt ? new Date(ann.endsAt).toLocaleDateString() : "No expiry"}
                  </td>
                  <td className="px-4 py-3 text-xs">{new Date(ann.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <button onClick={() => startEdit(ann)} className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(ann.id)} className="p-1 text-red-600 hover:bg-red-50 rounded">
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {announcements.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No announcements created yet. Create your first announcement to inform users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
