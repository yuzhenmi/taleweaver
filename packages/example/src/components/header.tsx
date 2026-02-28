import { FileText } from "lucide-react";

export function Header() {
  return (
    <div className="flex items-center h-12 px-4 border-b border-[#dadce0] bg-white">
      <FileText className="w-6 h-6 text-[#4285f4] mr-2" />
      <span className="text-lg text-[#1f1f1f]">Untitled document</span>
    </div>
  );
}
