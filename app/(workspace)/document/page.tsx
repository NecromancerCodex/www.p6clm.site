import { DocAutoGen } from "../../../components/organisms/DocAutoGen";

export const metadata = { title: "문서 작성 | p6 CLM" };

export default function DocumentPage() {
  return (
    <div className="ws-docs-wrap">
      <DocAutoGen />
    </div>
  );
}
