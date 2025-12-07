export default function AdminUtilsPage() {
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-gray-900">Admin Utilities</h1>
            <p className="text-gray-600">
                Welcome to the admin utilities dashboard. Select a tool from the sidebar to get started.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">System Status</h3>
                    <p className="text-green-600 font-medium">Operational</p>
                </div>
                {/* Add more overview widgets here later */}
            </div>
        </div>
    );
}
