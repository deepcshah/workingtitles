import notices from "@/data/notices.json";
import type { Notice } from "@/lib/types";
import Explorer from "@/components/Explorer";

export default function Page() {
  const sorted = [...(notices as Notice[])].sort((a, b) =>
    (b.spottedAt ?? "").localeCompare(a.spottedAt ?? "")
  );
  return <Explorer notices={sorted} />;
}
