export default function WorkersPage() {
    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-end border-b dark:border-slate-800 pb-6">
                <div className="space-y-1">
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                        Background Workers
                    </h1>
                    <p className="text-lg text-gray-500 dark:text-slate-400">
                        Monitor and manage distributed processing nodes and queue performance.
                    </p>
                </div>
                <div className="flex items-center px-4 py-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/50 rounded-2xl text-[10px] font-black uppercase text-purple-700 dark:text-purple-400 tracking-widest">
                    Node Monitoring
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-12 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-3xl flex items-center justify-center mb-6 text-slate-300 dark:text-slate-700">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                </div>
                <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-2">Visualizer Coming Soon</h3>
                <p className="text-gray-500 dark:text-slate-500 max-w-sm font-medium italic">
                    Real-time resource utilization and queue depth metrics for background worker nodes.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 opacity-40 grayscale pointer-events-none">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-gray-100 dark:border-slate-800 h-48 flex items-center justify-center">
                        <div className="w-full space-y-4">
                            <div className="h-3 w-1/3 bg-gray-200 dark:bg-slate-800 rounded-full mx-auto"></div>
                            <div className="h-10 w-2/3 bg-gray-100 dark:bg-slate-800/50 rounded-2xl mx-auto"></div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
