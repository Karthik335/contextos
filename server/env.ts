// Load .env for local development (Replit/Render use their own secrets instead).
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
