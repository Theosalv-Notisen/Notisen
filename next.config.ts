import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {};

/**
 * Feilovervåking er BACKEND-ONLY (server-, cron- og API-rute-feil). Ingen
 * klient-SDK – holder klient- og middleware-bundlene små.
 *
 * Sentry aktiveres kun når `SENTRY_DSN` er satt. Uten den bygges appen som en
 * helt vanlig Next-app.
 *
 * Source maps lastes opp kun hvis `SENTRY_AUTH_TOKEN` (+ `SENTRY_ORG` /
 * `SENTRY_PROJECT`) er satt – ellers fanges feil fortsatt, men stacktrace er
 * minifisert.
 */

// Vi bruker med vilje ikke Sentry sin klient-SDK / `global-error`-instrumentering.
process.env.SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING = "1";
process.env.SENTRY_SUPPRESS_TURBOPACK_WARNING = "1";

const config: NextConfig = process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      disableLogger: true,
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      widenClientFileUpload: false,
    })
  : nextConfig;

export default config;
