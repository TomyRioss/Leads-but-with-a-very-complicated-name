import { initBotId } from "botid/client/core";
import posthog from "posthog-js";

// BotID attaches its challenge headers to these requests; the routes verify them with checkBotId().
// In development initBotId() is a no-op, so local signup/login keep working without the Vercel proxy.
initBotId({
  protect: [
    { path: "/api/auth/register", method: "POST" },
    { path: "/api/auth/login", method: "POST" },
  ],
});

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (projectToken && apiHost) {
  posthog.init(projectToken, {
    api_host: apiHost,
    defaults: "2026-08-30",
    // Session replay's DOM observer flags React/Next's streamed script tags in development.
    // Keep product analytics enabled locally, and record sessions in production as configured.
    disable_session_recording: process.env.NODE_ENV !== "production",
  });
}
