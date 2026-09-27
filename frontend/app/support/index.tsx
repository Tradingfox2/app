import { useRouter } from "expo-router";
import { SupportTicketList } from "@/src/components/support/ticket-list";

export default function SupportIndex() {
  const router = useRouter();
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/profile");
  };
  return (
    <SupportTicketList
      onBack={back}
      onOpen={id => router.push({ pathname: "/support/[id]", params: { id } })}
      onCreate={() => router.push("/support/new")}
    />
  );
}
