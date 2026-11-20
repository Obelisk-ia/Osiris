import agent from "@convex-dev/agent/convex.config.js";
import auth from "@convex-dev/auth/convex.config.js";
import authUsername from "@convex-dev/auth/components/username/convex.config.js";
import authPassword from "@convex-dev/auth/components/password/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    OPENROUTER_API_KEY: v.optional(v.string()),
    OPENROUTER_MODEL: v.optional(v.string()),
  },
});

app.use(auth);
app.use(authUsername);
app.use(authPassword);
app.use(rateLimiter);
app.use(agent);

export default app;
