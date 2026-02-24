"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

export function AlertBadge() {
  const { data: session } = useSession();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      if (!session?.user) return;
      
      try {
        const res = await fetch("/api/alerts?action=count");
        if (res.ok) {
          const data = await res.json();
          setCount(data.count || 0);
        }
      } catch (error) {
        console.error("Error fetching alert count:", error);
      }
    };

    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, [session]);

  if (!session?.user || count === 0) {
    return null;
  }

  return (
    <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
