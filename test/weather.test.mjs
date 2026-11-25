import assert from "node:assert/strict";
import { test } from "node:test";
import { assertToolMix, createToolRegistry } from "../src/tools/registry.mjs";

const tool = { id: 42, type: "weather", permission: "read", name: "Weather", scope: {} };
const location = {
  name: "Portland", admin1: "Oregon", country: "United States",
  latitude: 45.523064, longitude: -122.676483, timezone: "America/Los_Angeles",
};
const forecast = {
  timezone: "America/Los_Angeles",
  current: {
    time: "2026-11-25T08:15", weather_code: 3, temperature_2m: 48,
    apparent_temperature: 43, relative_humidity_2m: 88, wind_speed_10m: 9,
  },
  daily: {
    time: ["2026-11-25", "2026-11-26", "2026-11-27"],
    weather_code: [61, 2, 3], temperature_2m_max: [51, 54, 52],
    temperature_2m_min: [40, 39, 40], precipitation_probability_max: [70, 20, null],
  },
  unexpected: "discard provider fields",
};

const response = (data, statusCode = 200) => ({ statusCode, body: Buffer.from(JSON.stringify(data)) });

function fakeWeather(...replies) {
  const calls = [];
  const registry = createToolRegistry({
    async fetchAllowed(url, options) {
      calls.push({ url: new URL(url), ...options });
      const next = replies[calls.length - 1];
      assert.ok(next, "Unexpected provider request");
      return next;
    },
  });
  return { registry, calls };
}

test("weather geocodes a location and fetches a bounded, attributed forecast from the two approved hosts", async () => {
  const { registry, calls } = fakeWeather(response({ results: [location] }), response(forecast));
  const result = await registry.run(tool, { location: "  Portland, Oregon  ", countryCode: "us", units: "imperial", forecastDays: 2 });
  assert.deepEqual(calls.map(({ allowedDomains }) => allowedDomains), [
    ["geocoding-api.open-meteo.com"], ["api.open-meteo.com"],
  ]);
  assert.deepEqual(calls.map(({ url }) => url.pathname), ["/v1/search", "/v1/forecast"]);
  assert.equal(calls[0].url.searchParams.get("name"), "Portland, Oregon");
  assert.equal(calls[0].url.searchParams.get("countryCode"), "US");
  assert.equal(calls[1].url.searchParams.get("latitude"), "45.5231");
  assert.equal(calls[1].url.searchParams.get("longitude"), "-122.6765");
  assert.equal(calls[1].url.searchParams.get("forecast_days"), "2");
  assert.equal(calls[1].url.searchParams.get("temperature_unit"), "fahrenheit");
  assert.equal(calls[1].url.searchParams.get("wind_speed_unit"), "mph");
  assert.equal(result.location.region, "Oregon");
  assert.equal(result.location.timeZone, "America/Los_Angeles");
  assert.equal(result.current.condition, "Overcast");
  assert.equal(result.current.temperature, 48);
  assert.equal(result.units.temperature, "°F");
  assert.equal(result.units.windSpeed, "mph");
  assert.deepEqual(result.forecast[0], {
    date: "2026-11-25", condition: "Light rain", high: 51, low: 40, precipitationChance: 70,
  });
  assert.equal(result.forecast.length, 2);
  assert.equal(result.source, "web");
  assert.match(result.attribution, /Open-Meteo/);
  assert.ok(!Object.hasOwn(result, "unexpected"));
});

test("weather has three-day metric defaults and propagates no-match and upstream failures", async () => {
  const defaults = fakeWeather(response({ results: [location] }), response(forecast));
  const result = await defaults.registry.run(tool, { location: "Portland" });
  assert.equal(defaults.calls[1].url.searchParams.get("forecast_days"), "3");
  assert.equal(defaults.calls[1].url.searchParams.get("temperature_unit"), "celsius");
  assert.equal(result.units.temperature, "°C");
  assert.equal(result.forecast[2].precipitationChance, null);

  for (const geocoding of [{}, { results: [] }, { results: [{ ...location, latitude: 999 }] }]) {
    const { registry, calls } = fakeWeather(response(geocoding));
    await assert.rejects(registry.run(tool, { location: "Unknown" }), { code: "weather_location" });
    assert.equal(calls.length, 1);
  }
  for (const upstream of [response({}, 429), { statusCode: 200, body: Buffer.from("bad JSON") }, response({})]) {
    const { registry } = fakeWeather(response({ results: [location] }), upstream);
    await assert.rejects(registry.run(tool, { location: "Portland" }), { code: "weather_unavailable" });
  }
});

test("weather rejects invalid inputs and honors the outbound guard's abort signal", async () => {
  const { registry, calls } = fakeWeather();
  for (const args of [
    { location: "   " }, { location: "Portland", countryCode: "1a" },
    { location: "Portland", units: "kelvin" }, { location: "Portland", forecastDays: 8 },
    { location: "Portland", forecastDays: 1.5 }, { location: "Portland", url: "http://127.0.0.1" },
  ]) {
    await assert.rejects(registry.run(tool, args));
  }
  assert.equal(calls.length, 0);

  const controller = new AbortController();
  let requests = 0;
  const cancellable = createToolRegistry({
    async fetchAllowed(_url, { signal }) {
      requests++;
      assert.equal(signal.aborted, false);
      controller.abort();
      assert.equal(signal.aborted, true);
      return response({ results: [location] });
    },
  });
  await assert.rejects(cancellable.run(tool, { location: "Portland" }, {}, controller.signal), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("weather is read-only and obeys the web and file-change separation", () => {
  const { registry } = fakeWeather();
  assert.throws(() => registry.instance({ ...tool, permission: "propose" }));
  assert.throws(() => registry.instance({ ...tool, scope: { allowedDomains: ["example.com"] } }));
  assert.doesNotThrow(() => assertToolMix([tool, { type: "file_reader", permission: "read" }]));
  assert.throws(() => assertToolMix([tool, { type: "file_mover", permission: "propose" }]),
    { code: "invalid_tool" });
});
