/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Hub Settings Management
 *
 * Handles loading and persistence of hub configuration.
 * Priority: environment variable > settings.hub.json > default value
 *
 * When a value is loaded from environment variable and not present in settings.hub.json,
 * it will be saved to settings.hub.json for future use
 */

import { hostname } from "node:os";

import {
  getSettingsFile,
  readSettings,
  withSettingsLock,
  writeSettings,
} from "./settings";

export interface ServerSettings {
  listenHost: string;
  listenPort: number;
  publicUrl: string;
  corsOrigins: string[];
  hubName: string;
}

export interface ServerSettingsResult {
  settings: ServerSettings;
  sources: {
    listenHost: "env" | "file" | "default";
    listenPort: "env" | "file" | "default";
    publicUrl: "env" | "file" | "default";
    corsOrigins: "env" | "file" | "default";
    hubName: "env" | "file" | "default";
  };
  savedToFile: boolean;
}

/**
 * Parse and normalize CORS origins
 */
function parseCorsOrigins(str: string): string[] {
  const entries = str
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (entries.includes("*")) {
    return ["*"];
  }

  const normalized: string[] = [];
  for (const entry of entries) {
    try {
      normalized.push(new URL(entry).origin);
    } catch {
      // Keep raw value if it's already an origin-like string
      normalized.push(entry);
    }
  }
  return normalized;
}

/**
 * Derive CORS origins from public URL
 */
function deriveCorsOrigins(publicUrl: string): string[] {
  try {
    return [new URL(publicUrl).origin];
  } catch {
    return [];
  }
}

/**
 * Load hub settings with priority: env > file > default
 * Saves new env values to file when not already present
 */
export async function loadServerSettings(
  dataDir: string,
): Promise<ServerSettingsResult> {
  const settingsFile = getSettingsFile(dataDir);
  // 锁内完成 读→env 回填→写 整个临界区（与 cli 受限写/其他 hub 写点互斥）
  return withSettingsLock(settingsFile, async () => {
    const settings = await readSettings(settingsFile);

    // If settings file exists but couldn't be parsed, fail fast
    if (settings === null) {
      throw new Error(
        `Cannot read ${settingsFile}. Please fix or remove the file and restart.`,
      );
    }

    let needsSave = false;
    const sources: ServerSettingsResult["sources"] = {
      listenHost: "default",
      listenPort: "default",
      publicUrl: "default",
      corsOrigins: "default",
      hubName: "default",
    };

    // listenHost: env > file > default
    let listenHost = "127.0.0.1";
    if (process.env.MOBI_LISTEN_HOST) {
      listenHost = process.env.MOBI_LISTEN_HOST;
      sources.listenHost = "env";
      if (settings.listenHost === undefined) {
        settings.listenHost = listenHost;
        needsSave = true;
      }
    } else if (settings.listenHost !== undefined) {
      listenHost = settings.listenHost;
      sources.listenHost = "file";
    }

    // listenPort: env > file > default (2222)
    let listenPort = 2222;
    if (process.env.MOBI_LISTEN_PORT) {
      const parsed = parseInt(process.env.MOBI_LISTEN_PORT, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("MOBI_LISTEN_PORT must be a valid port number");
      }
      listenPort = parsed;
      sources.listenPort = "env";
      if (settings.listenPort === undefined) {
        settings.listenPort = listenPort;
        needsSave = true;
      }
    } else if (settings.listenPort !== undefined) {
      listenPort = settings.listenPort;
      sources.listenPort = "file";
    }

    // publicUrl: env > file > default
    let publicUrl = `http://localhost:${listenPort}`;
    if (process.env.MOBI_PUBLIC_URL) {
      publicUrl = process.env.MOBI_PUBLIC_URL;
      sources.publicUrl = "env";
      if (settings.publicUrl === undefined) {
        settings.publicUrl = publicUrl;
        needsSave = true;
      }
    } else if (settings.publicUrl !== undefined) {
      publicUrl = settings.publicUrl;
      sources.publicUrl = "file";
    }

    // corsOrigins: env > file > derived from publicUrl
    let corsOrigins: string[];
    if (process.env.CORS_ORIGINS) {
      corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
      sources.corsOrigins = "env";
      if (settings.corsOrigins === undefined) {
        settings.corsOrigins = corsOrigins;
        needsSave = true;
      }
    } else if (settings.corsOrigins !== undefined) {
      corsOrigins = settings.corsOrigins;
      sources.corsOrigins = "file";
    } else {
      corsOrigins = deriveCorsOrigins(publicUrl);
    }

    // hubName: env > file > os.hostname()
    let hubName: string;
    if (process.env.MOBI_HUB_NAME) {
      hubName = process.env.MOBI_HUB_NAME;
      sources.hubName = "env";
      if (settings.hubName === undefined) {
        settings.hubName = hubName;
        needsSave = true;
      }
    } else if (settings.hubName !== undefined) {
      hubName = settings.hubName;
      sources.hubName = "file";
    } else {
      hubName = hostname() || "mobi";
      sources.hubName = "default";
    }

    // Save settings if any new values were added
    if (needsSave) {
      await writeSettings(settingsFile, settings);
    }

    return {
      settings: {
        listenHost,
        listenPort,
        publicUrl,
        corsOrigins,
        hubName,
      },
      sources,
      savedToFile: needsSave,
    };
  });
}
