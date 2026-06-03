import type { CorsOptions } from "cors";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "https://qdish-three.vercel.app"
];

const ENV_ORIGIN_KEYS = [
  "CORS_ORIGINS",
  "APP_BASE_URL",
  "FRONTEND_URL",
  "CLIENT_URL",
  "PAYOS_RETURN_URL",
  "PAYOS_CANCEL_URL"
];

const splitOriginList = (value?: string) => {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeOrigin = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (trimmed === "*") return "*";
  if (trimmed.includes("*")) return trimmed.toLowerCase();

  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
};

const wildcardToRegExp = (pattern: string) => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, "[^.]+")}$`, "i");
};

export const buildAllowedOrigins = (env: NodeJS.ProcessEnv = process.env) => {
  const configuredOrigins = ENV_ORIGIN_KEYS.flatMap((key) => splitOriginList(env[key]));
  const origins = [...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin));

  return Array.from(new Set(origins));
};

export const isOriginAllowed = (
  origin: string | undefined,
  allowedOrigins = buildAllowedOrigins()
) => {
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;
  if (allowedOrigins.includes("*")) return true;

  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin.includes("*")) {
      return wildcardToRegExp(allowedOrigin).test(normalizedOrigin);
    }
    return allowedOrigin === normalizedOrigin;
  });
};

export const createCorsOptions = (env: NodeJS.ProcessEnv = process.env): CorsOptions => {
  const allowedOrigins = buildAllowedOrigins(env);

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin is not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-restaurant-id"],
    optionsSuccessStatus: 204
  };
};

export const createSocketCorsOptions = (env: NodeJS.ProcessEnv = process.env) => {
  const allowedOrigins = buildAllowedOrigins(env);

  return {
    origin: allowedOrigins.length > 0 ? allowedOrigins : [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://qdish-three.vercel.app"
    ],
    methods: ["GET", "POST"],
    credentials: true
  };
};
