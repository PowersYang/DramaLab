"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2, Megaphone } from "lucide-react";
import { api, type Announcement } from "@/lib/api";

export default function AnnouncementBoard() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnnouncements = async () => {
    try {
      const data = await api.listAnnouncements();
      setAnnouncements(data);
    } catch (error) {
      console.error("Failed to fetch announcements:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const handleMarkAsRead = async (id: string, isAlreadyRead: boolean) => {
    if (isAlreadyRead) return;
    try {
      await api.markAnnouncementAsRead(id);
      // Update local state
      setAnnouncements(prev => 
        prev.map(a => a.id === id ? { ...a, is_read: true } : a)
      );
    } catch (error) {
      console.error("Failed to mark announcement as read:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (announcements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-slate-400">
        <Megaphone size={24} className="mb-2 opacity-10" />
        <p className="text-[11px]">暂无系统公告</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {announcements.map((announcement) => (
        <div 
          key={announcement.id} 
          className="flex gap-4 cursor-pointer group"
          onClick={() => handleMarkAsRead(announcement.id, announcement.is_read)}
        >
          <div className="relative shrink-0 mt-1.5">
            <div className={`h-2 w-2 rounded-full ${announcement.priority > 0 ? 'bg-amber-500' : 'bg-blue-500'}`} />
            {!announcement.is_read && (
              <div className="absolute -top-1 -right-1 h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-white animate-pulse" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={`text-sm font-medium truncate ${announcement.is_read ? 'text-slate-500' : 'text-slate-800'}`}>
                {announcement.title}
              </p>
            </div>
            <p className={`mt-1 text-xs leading-relaxed whitespace-pre-wrap ${announcement.is_read ? 'text-slate-400' : 'text-slate-500'}`}>
              {announcement.content}
            </p>
            {announcement.publish_at && (
              <p className="mt-1 text-[10px] text-slate-400">
                {new Date(announcement.publish_at).toLocaleDateString("zh-CN")}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
