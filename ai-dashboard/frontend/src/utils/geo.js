/**
 * Helper to get location using IP address
 */
async function getIPLocation() {
  const services = [
    { url: "https://ipapi.co/json/", keyCity: "city", keyLat: "latitude", keyLon: "longitude" },
    { url: "http://ip-api.com/json/", keyCity: "city", keyLat: "lat", keyLon: "lon" },
    { url: "https://geolocation-db.com/json/", keyCity: "city", keyLat: "latitude", keyLon: "longitude" }
  ];

  for (const service of services) {
    try {
      console.log(`Attempting IP geolocation via ${service.url}...`);
      const response = await fetch(service.url);
      if (response.ok) {
        const data = await response.json();
        if (data && data[service.keyCity]) {
          console.log(`Successfully resolved location via ${service.url}: ${data[service.keyCity]}`);
          return {
            city: data[service.keyCity],
            latitude: data[service.keyLat],
            longitude: data[service.keyLon],
            source: service.url
          };
        }
      }
    } catch (e) {
      console.warn(`IP geolocation service ${service.url} failed:`, e);
    }
  }
  throw new Error("All IP geolocation services failed.");
}

/**
 * Attempts to get the user's location.
 * First tries the browser Geolocation API.
 * If that fails or is denied (e.g. in insecure HTTP contexts),
 * falls back to IP-based geolocation.
 */
export async function detectLocation() {
  if (!navigator.geolocation) {
    console.log("Browser geolocation not supported. Falling back to IP-based location.");
    try {
      return await getIPLocation();
    } catch (err) {
      console.error("IP fallback failed:", err);
      return null;
    }
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: "browser"
        });
      },
      async (error) => {
        console.warn("Browser geolocation failed or denied. Falling back to IP-based location.", error);
        try {
          const ipLoc = await getIPLocation();
          resolve(ipLoc);
        } catch (ipErr) {
          console.error("IP-based location also failed:", ipErr);
          resolve(null);
        }
      },
      { timeout: 5000 } // Wait up to 5 seconds before timeout and fallback
    );
  });
}
