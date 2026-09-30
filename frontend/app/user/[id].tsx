import { useLocalSearchParams } from "expo-router";
import { ProfileWall } from "@/src/components/social/profile-wall";

/** Same wall as the You tab. Visitors never get the author's settings gear. */
export default function PublicProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Array.isArray(id) ? id[0] : id;
  if (!userId) return null;
  return <ProfileWall userId={userId} variant="screen" />;
}
