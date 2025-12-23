"use client";
import { useState, useEffect } from "react";
import MarketTable from "./MarketTable";

export default function Tabs({ tabs }) {
  const [active, setActive] = useState(tabs[0]);

  return (
    <>
      <div className="flex gap-4 border-b mb-4">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActive(t)}
            className={active.key === t.key ? "font-bold" : ""}
          >
            {t.label}
          </button>
        ))}
      </div>
      <MarketTable url={active.url} />
    </>
  );
}
