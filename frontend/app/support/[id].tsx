import { useLocalSearchParams, useRouter } from "expo-router";
import { SupportTicketDetail } from "@/src/components/support/ticket-detail";

export default function SupportTicketRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const ticketId = Array.isArray(params.id) ? params.id[0] ?? "" : params.id ?? "";
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/support");
  };
  return <SupportTicketDetail ticketId={ticketId} onBack={back} />;
}
