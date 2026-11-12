import type { PublicUser } from "@sm/shared";
import { ActivityPanel } from "../components/ActivityPanel";
import { UsersPanel } from "../components/UsersPanel";

export default function UsersPage({
  user,
  notify,
}: {
  user: PublicUser;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  if (user.role !== "admin") {
    return <div className="panel">Only administrators can manage users.</div>;
  }
  return (
    <div className="config-page">
      <UsersPanel currentUser={user} notify={notify} />
      <ActivityPanel notify={notify} />
    </div>
  );
}
