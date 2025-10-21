// src/pages/UsdaMonthly.jsx
import { useState } from "react";
// If your util has a named export, adjust accordingly:
import { downloadbuildEfapMonthlyPdf } from "../utils/buildEfapMonthlyPdf.jsx";

export default function UsdaMonthly() {
  const [busy, setBusy] = useState(false);

  const buildPdf = async () => {
    try {
      setBusy(true);
      await downloadbuildEfapMonthlyPdf(); // assumes your util triggers a download
    } catch (e) {
      console.error(e);
      alert("Could not build the EFAP Monthly PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <h1 className="text-xl font-semibold mb-3">USDA Monthly</h1>
      <p className="text-sm text-gray-600 mb-4">
        Generate the EFAP Monthly PDF for your active organization.
      </p>
      <button
        onClick={buildPdf}
        disabled={busy}
        className="h-11 px-5 rounded-xl bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {busy ? "Building…" : "Build EFAP Monthly PDF"}
      </button>
    </div>
  );
}
