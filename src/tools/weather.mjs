import { SafetyError } from "../errors.mjs";

const geocoding = "https://geocoding-api.open-meteo.com/v1/search";
const forecast = "https://api.open-meteo.com/v1/forecast";
const credit = "Weather by Open-Meteo (https://open-meteo.com/); place names from GeoNames.";
const conditions = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  56: "Light freezing drizzle", 57: "Heavy freezing drizzle", 61: "Light rain", 63: "Rain",
  65: "Heavy rain", 66: "Light freezing rain", 67: "Heavy freezing rain", 71: "Light snow",
  73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light showers", 81: "Rain showers",
  82: "Heavy showers", 85: "Light snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
  96: "Thunderstorm and hail", 97: "Heavy thunderstorm", 99: "Thunderstorm and heavy hail",
};

export const weatherArgsSchema = {
  type: "object",
  properties: {
    location: {
      type: "string", minLength: 2, maxLength: 100,
      description: "City or postal code, optionally followed by a comma and a state, region, or country.",
    },
    countryCode: {
      type: "string", minLength: 2, maxLength: 2,
      description: "Optional two-letter country code such as US, GB, or JP.",
    },
    units: { type: "string", enum: ["metric", "imperial"], description: "Metric (default) or imperial." },
    forecastDays: { type: "integer", minimum: 1, maximum: 7, description: "Daily forecast length including today. Defaults to 3." },
  },
  required: ["location"],
  additionalProperties: false,
};

function unavailable() {
  return new SafetyError("weather_unavailable", "Open-Meteo weather data is unavailable right now.");
}

async function getJSON(endpoint, params, fetchAllowed, signal) {
  signal.throwIfAborted();
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params).toString();
  try {
    const response = await fetchAllowed(url.href, { allowedDomains: [url.hostname], signal });
    if (response.statusCode < 200 || response.statusCode >= 300) throw unavailable();
    const data = JSON.parse(response.body.toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data) || data.error) throw unavailable();
    signal.throwIfAborted();
    return data;
  } catch {
    signal.throwIfAborted();
    throw unavailable();
  }
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function condition(code) {
  return Number.isInteger(code) ? conditions[code] ?? null : null;
}

function name(value) {
  return typeof value === "string" ? value.slice(0, 100) : "";
}

function usablePlace(place) {
  return typeof place?.name === "string" && place.name.length > 0
    && Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90
    && Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180;
}

function readForecast(report, days, units) {
  const { current, daily } = report;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(current?.time ?? "")
      || !Array.isArray(daily?.time) || !daily.time.length) throw unavailable();
  const values = (key, index) => Array.isArray(daily[key]) ? daily[key][index] : undefined;
  const outlook = daily.time.slice(0, days).map((date, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw unavailable();
    return {
      date,
      condition: condition(values("weather_code", index)),
      high: finite(values("temperature_2m_max", index)),
      low: finite(values("temperature_2m_min", index)),
      precipitationChance: finite(values("precipitation_probability_max", index)),
    };
  });
  return {
    current: {
      time: current.time,
      condition: condition(current.weather_code),
      temperature: finite(current.temperature_2m),
      feelsLike: finite(current.apparent_temperature),
      humidity: finite(current.relative_humidity_2m),
      windSpeed: finite(current.wind_speed_10m),
    },
    forecast: outlook,
    units: {
      temperature: units === "imperial" ? "°F" : "°C",
      windSpeed: units === "imperial" ? "mph" : "km/h",
      humidity: "%",
      precipitationChance: "%",
    },
  };
}

export async function lookupWeather({ location, countryCode, units = "metric", forecastDays = 3 }, fetchAllowed, signal) {
  const search = location.trim();
  if (search.length < 2 || /[\p{Cc}\p{Cf}]/u.test(search) || (countryCode && !/^[a-z]{2}$/i.test(countryCode))) {
    throw new SafetyError("weather_location", "Enter a city or postal code and an optional two-letter country code.");
  }
  const geo = await getJSON(geocoding, {
    name: search, count: "3", language: "en",
    ...(countryCode && { countryCode: countryCode.toUpperCase() }),
  }, fetchAllowed, signal);
  const place = Array.isArray(geo.results) && geo.results.find(usablePlace);
  if (!place) {
    throw new SafetyError("weather_location", "No matching location. Try adding a state, region, or country.");
  }

  const imperial = units === "imperial";
  const report = await getJSON(forecast, {
    latitude: place.latitude.toFixed(4),
    longitude: place.longitude.toFixed(4),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max",
    temperature_unit: imperial ? "fahrenheit" : "celsius",
    wind_speed_unit: imperial ? "mph" : "kmh",
    timezone: "auto",
    forecast_days: String(forecastDays),
  }, fetchAllowed, signal);
  return {
    source: "web",
    attribution: credit,
    location: {
      name: name(place.name),
      region: name(place.admin1),
      country: name(place.country),
      timeZone: name(report.timezone) || name(place.timezone),
    },
    ...readForecast(report, forecastDays, units),
  };
}
