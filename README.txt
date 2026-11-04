ZoneRide Driver Dashboard

How to run:
1. Unzip this folder.
2. Double-click index.html (opens in your browser).
   An internet connection is needed for the satellite map tiles.
   Allow location access to see your own position on the map.

Files:
- index.html  page layout (map, detail, zone list, history vs prediction, ZoneBot)
- style.css   design and colours
- app.js      demand logic, map, forecast chart and assistant

What is new:
1. Satellite map
   Leaflet + Esri World Imagery (free, no API key). Use the layer button
   (top right of the map) to switch to Street view or hide place names.
   Circles grow and change colour with demand. Click a circle to select a zone.
   Buttons at top left: go to my location, show all zones.
   Note: satellite imagery is real but refreshed by Esri every few months,
   not second by second. What is live is your GPS position and the demand data.

2. History vs prediction (bottom of the page)
   Yellow line = cabs needed in the past 60 minutes.
   Dashed blue line = predicted cabs needed (30 or 60 minutes ahead), with a
   confidence band. It turns red where prediction is above the cabs nearby.
   Green line = cabs nearby. Hover or tap the chart for exact numbers.
   The forecast uses the zone's arrival/event schedule (arr list in app.js).
   History from before you opened the page is simulated; real readings are
   recorded while the page stays open.

3. ZoneBot (AI button, bottom right)
   Answers from the live dashboard data: where to go, busiest zone,
   forecast for a zone, nearest zone, zone status, and Navigate links.
   The built-in version is rule-based and works offline.
   To use a real LLM, set BOT_URL at the top of app.js to your own server.
   The page sends POST {"message": "...", "context": {...dashboard data...}}
   and expects {"reply": "..."}. Keep your LLM API key on that server,
   never inside app.js. If the server fails, ZoneBot falls back to the built-in answers.

To use live demand data, set API_URL at the top of app.js to your server.
It should return: [{"id":"ndls","crowd":250,"supply":90}, ...]
