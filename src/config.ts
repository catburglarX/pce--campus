/**
 * Application configuration, read once at startup.
 *
 * Nothing else in the codebase reads process.env, so every knob is visible here and a value can be
 * traced to the variable that set it.
 */

export type AppConfig = {
  /** 0 asks the operating system for a free port, which the smoke check relies on. */
  port: number;
  host: string;
  appOrigin: string;
  /** Session cookie carries Secure only over https, otherwise localhost login would break. */
  useSecureCookies: boolean;
  databasePath: string;
  /** Email domains allowed to register. A single "*" entry allows any domain. */
  allowedEmailDomains: string[];
  /** Shared code a student must present to register, which is what makes the site private. */
  joinCode: string;
  sessionLifetimeHours: number;
  loginMaxAttempts: number;
  loginWindowMinutes: number;
  /**
   * Whether X-Forwarded-For may be believed when deciding a caller's address.
   *
   * Off by default. The header is set by the client, so trusting it without a proxy in front lets an
   * attacker rotate it and walk around the per-address login limit. Only turn it on when a reverse proxy
   * you control overwrites the header.
   */
  trustProxyHeader: boolean;
  /** How many days back a student may still rate a meal. Stops retroactive rating of a whole term. */
  messRatingBackdateDays: number;
};

const DEFAULT_PORT = 4173;
const DEFAULT_JOIN_CODE = "PCE-CAMPUS-2026";

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Config ${name} must be a positive number, got "${raw}"`);
  }
  return parsed;
}

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Config PORT must be a whole number from 0 to 65535, got "${raw}"`);
  }
  return parsed;
}

function readDomainList(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS ?? "poornima.org,poornima.edu.in";
  return raw
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
}

export function loadConfig(): AppConfig {
  const port = readPort();
  const host = process.env.HOST ?? "127.0.0.1";
  const appOrigin = process.env.APP_ORIGIN ?? `http://localhost:${port === 0 ? DEFAULT_PORT : port}`;
  return {
    port,
    host,
    appOrigin,
    useSecureCookies: appOrigin.startsWith("https://"),
    databasePath: process.env.DATABASE_PATH ?? "data/campus-voice.sqlite",
    allowedEmailDomains: readDomainList(),
    joinCode: process.env.JOIN_CODE ?? DEFAULT_JOIN_CODE,
    sessionLifetimeHours: readNumber("SESSION_LIFETIME_HOURS", 24 * 14),
    loginMaxAttempts: readNumber("LOGIN_MAX_ATTEMPTS", 8),
    loginWindowMinutes: readNumber("LOGIN_WINDOW_MINUTES", 15),
    trustProxyHeader: process.env.TRUST_PROXY_HEADER === "true",
    messRatingBackdateDays: readNumber("MESS_RATING_BACKDATE_DAYS", 7),
  };
}

export const config: AppConfig = loadConfig();
