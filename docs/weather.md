# Weather tool

Open **Tools**, choose **Web**, and save the **Weather** setup. You can attach it from **Add tool** in an agent's editor. Try a task such as “Give me a two-day forecast for Portland, Oregon in Fahrenheit.”

Weather accepts a city or postal code, an optional two-letter country code, and up to seven forecast days including today. It defaults to three days and metric units.

The tool sends the requested place to Open-Meteo's geocoding endpoint, then sends the resolved coordinates to its forecast endpoint. Both destinations are fixed and use the existing URL guard. The app records the provider credit in the run log. An agent using Weather follows the same file-change restrictions as Web Fetch. The bundled provider uses Open-Meteo's free non-commercial service. [Forecast API](https://open-meteo.com/en/docs) · [Geocoding API](https://open-meteo.com/en/docs/geocoding-api) · [Provider terms](https://open-meteo.com/en/terms)
