// Prisma configuration file (Prisma 7+)
// The database connection URL is defined here instead of in schema.prisma.
// See: https://pris.ly/d/config-datasource

import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

// Explicitly load the .env file so the Prisma CLI can see it
dotenv.config();

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
});