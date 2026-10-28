import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

// Browser client, used only for WebAuthn (passkeys need the browser API).
// Everything else goes through server actions.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient()],
});
