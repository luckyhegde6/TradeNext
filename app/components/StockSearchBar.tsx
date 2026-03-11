"use client";

import { useRouter } from "next/navigation";
import Autocomplete from "@/app/components/ui/Autocomplete";

export default function StockSearchBar() {
    const router = useRouter();

    const handleSelect = (symbol: string) => {
        router.push(`/company/${symbol}`);
    };

    return (
        <div className="max-w-md mx-auto mt-4">
            <Autocomplete
                onSelect={handleSelect}
                placeholder="Search stocks (e.g., RELIANCE, TCS, INFY)..."
                className="w-full"
            />
        </div>
    );
}
