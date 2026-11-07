// Vercel's Fastify entrypoint. Vercel checks src/app.ts before src/index.ts, so the app factory lives in
// buildApp.ts (an app.ts without a default-exported server crashes the function on load).
import "./server.js";
