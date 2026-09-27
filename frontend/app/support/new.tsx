import { useRouter } from "expo-router";
import { SupportTicketForm } from "@/src/components/support/ticket-form";

export default function NewSupportTicket() {
  const router = useRouter();
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/support");
  };
  return (
    <SupportTicketForm
      onBack={back}
      onCreated={id => router.replace({ pathname: "/support/[id]", params: { id } })}
    />
  );
}
