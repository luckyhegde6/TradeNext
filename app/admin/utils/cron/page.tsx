export default function CronConfigPage() {
    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-end border-b dark:border-slate-800 pb-6">
                <div className="space-y-1">
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                        Cron Configurations
                    </h1>
                    <p className="text-lg text-gray-500 dark:text-slate-400">
                        Manage scheduled tasks, heartbeat intervals, and automated maintenance jobs.
                    </p>
                </div>
                <div className="flex items-center px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-2xl text-[10px] font-black uppercase text-indigo-700 dark:text-indigo-400 tracking-widest">
                    Preview Mode
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-12 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-gray-100 dark:border-slate-800 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-3xl flex items-center justify-center mb-6 text-slate-300 dark:text-slate-700">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-2">Editor Coming Soon</h3>
                <p className="text-gray-500 dark:text-slate-500 max-w-sm font-medium italic">
                    The cron management interface is currently under development to ensure atomic configuration updates.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 opacity-40 grayscale pointer-events-none">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800">
                        <div className="h-4 w-24 bg-gray-200 dark:bg-slate-800 rounded-full mb-4"></div>
                        <div className="h-8 w-full bg-gray-100 dark:bg-slate-800/50 rounded-xl mb-2"></div>
                        <div className="h-4 w-1/2 bg-gray-100 dark:bg-slate-800/50 rounded-full"></div>
                    </div>
                ))}
            </div>
        </div>
    );
}
