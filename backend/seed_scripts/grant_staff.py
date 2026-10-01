"""Grant or revoke a staff role from the server console.

The first admin must be created here: there is deliberately no API path to
self-grant staff powers. After that, admins manage the team in the app.

    python seed_scripts/grant_staff.py alice@example.com admin
    python seed_scripts/grant_staff.py alice@example.com none
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# db.py reads MONGO_URL at import. server.py uses the same client.
# staff_roles, not staff: staff imports server, which imports routers that
# call staff.require before staff has finished loading.
from db import client, db  # noqa: E402
from staff_roles import STAFF_ROLES  # noqa: E402


async def main(email: str, role: str | None) -> int:
    try:
        result = await db.users.update_one({"email": email.lower()}, {"$set": {"staff_role": role}})
        if result.matched_count == 0:
            print(f"No user with email {email}")
            return 1
        print(f"{email} -> staff_role={role or 'none'}")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(2)
    requested = sys.argv[2].lower()
    if requested not in (*STAFF_ROLES, "none"):
        print(f"Role must be one of: {', '.join(STAFF_ROLES)}, none")
        raise SystemExit(2)
    raise SystemExit(asyncio.run(main(sys.argv[1], None if requested == "none" else requested)))
