import { TlinkCallsView } from "../../../components/organisms/TlinkCallsView";

export const metadata = { title: "전화 내역 | p6 CLM" };

export default function CallsPage() {
  return (
    <div className="ws-inner-pad">
      <TlinkCallsView />
    </div>
  );
}
