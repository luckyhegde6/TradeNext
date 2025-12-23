// components/InsightCard.tsx
export function InsightCard({ text }: { text: string }) {
    return (
      <div className="rounded-lg border p-4 bg-indigo-50 text-indigo-900">
        <strong>AI Insight</strong>
        <p className="mt-2 text-sm">{text}</p>
      </div>
    );
  }

  /*
  const prompt = `
Given the following market snapshot, summarize:
- unusual activity
- risk signals
- momentum shifts

Snapshot:
${JSON.stringify(snapshot, null, 2)}
`;

**/

  