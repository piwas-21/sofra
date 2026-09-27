import { describe, expect, it } from "vitest";
import { cataloguePoolConfig } from "@/lib/catalogue/config";

const validPoolEnvironment = {
  CATALOGUE_POOL_MAX: "5",
  CATALOGUE_POOL_CONNECTION_TIMEOUT_MS: "2000",
  CATALOGUE_POOL_IDLE_TIMEOUT_MS: "30000",
};

describe("catalogue database pool configuration", () => {
  it("parses bounded environment settings", () => {
    expect(cataloguePoolConfig(validPoolEnvironment)).toEqual({
      max: 5,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 30000,
    });
  });

  it("reports invalid pool settings as type errors", () => {
    expect(() => cataloguePoolConfig({
      ...validPoolEnvironment,
      CATALOGUE_POOL_MAX: "invalid",
    })).toThrow(TypeError);
  });

  it.each(Object.keys(validPoolEnvironment))("requires %s", (key) => {
    const environment = { ...validPoolEnvironment };
    delete environment[key as keyof typeof environment];

    expect(() => cataloguePoolConfig(environment)).toThrow(
      `${key} must be configured as a positive safe integer.`,
    );
  });

  it.each([
    ["CATALOGUE_POOL_MAX", "0"],
    ["CATALOGUE_POOL_MAX", "11"],
    ["CATALOGUE_POOL_CONNECTION_TIMEOUT_MS", "99"],
    ["CATALOGUE_POOL_CONNECTION_TIMEOUT_MS", "60001"],
    ["CATALOGUE_POOL_IDLE_TIMEOUT_MS", "999"],
    ["CATALOGUE_POOL_IDLE_TIMEOUT_MS", "600001"],
    ["CATALOGUE_POOL_IDLE_TIMEOUT_MS", "1.5"],
  ])("rejects out-of-range %s=%s", (key, value) => {
    expect(() => cataloguePoolConfig({
      ...validPoolEnvironment,
      [key]: value,
    })).toThrow();
  });
});
