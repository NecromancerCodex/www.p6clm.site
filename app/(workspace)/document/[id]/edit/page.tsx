import { DocumentDetail } from "../../../../../components/documents/DocumentDetail";

export const metadata = { title: "문서 편집 | p6 CLM" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DocumentEditPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <div className="ws-docs-wrap">
      <DocumentDetail id={decodeURIComponent(id)} mode="edit" />
    </div>
  );
}
