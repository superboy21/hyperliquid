import type { CandleSourceProvenance } from "@/lib/candle-provenance";

interface ChartSourceCaptionProps {
  provenance?: CandleSourceProvenance;
  legProvenance?: readonly [CandleSourceProvenance, CandleSourceProvenance];
}

function turnoverNote(provenance: CandleSourceProvenance) {
  return provenance.quoteTurnover === "derived" ? " · 成交额为估算值" : "";
}

export default function ChartSourceCaption({ provenance, legProvenance }: ChartSourceCaptionProps) {
  if (legProvenance) {
    const [first, second] = legProvenance;
    return (
      <p className="mt-2 break-words text-[11px] leading-4 text-gray-500">
        K线来源 <span aria-hidden="true" className="text-gray-700">·</span> 腿1：{first.sourceKind}{turnoverNote(first)}{" "}
        <span aria-hidden="true" className="text-gray-700">·</span> 腿2：{second.sourceKind}{turnoverNote(second)}
      </p>
    );
  }

  if (!provenance) return null;

  return (
    <p className="mt-2 break-words text-[11px] leading-4 text-gray-500">
      K线来源 <span aria-hidden="true" className="text-gray-700">·</span> {provenance.sourceKind}{turnoverNote(provenance)}
    </p>
  );
}
