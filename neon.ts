import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  preview: {
    // Live slot availability on the booking page. Browsers may connect only from these origins;
    // add the Vercel URL (https://<project>.vercel.app) once the page is deployed.
    realtime: { allowedOrigins: ["http://localhost:3000", "http://localhost:3222"] },
  },
  auth: false,
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
