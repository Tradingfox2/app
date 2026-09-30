import { useAuth } from "@/src/auth-context";
import { ProfileWall } from "@/src/components/social/profile-wall";

/** You opens on your wall. Account settings live behind the gear. */
export default function Profile() {
  const { user } = useAuth();
  if (!user) return null;
  return <ProfileWall userId={user.id} variant="tab" />;
}
