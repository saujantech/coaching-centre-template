// GET /api/manifest
// Serves the PWA web app manifest, generated from centre.config.js on
// every request rather than a static public/manifest.json — so a future
// client's centreName/brandColor apply automatically the moment
// centre.config.js is edited, with no separate build/regeneration step
// (unlike the app icons, which are raster images and do need one — see
// scripts/generate-icons.js).

const centreConfig = require("../public/centre.config");

module.exports = (req, res) => {
  const manifest = {
    name: centreConfig.centreName,
    short_name: centreConfig.centreName,
    start_url: "/admin/dashboard.html",
    display: "standalone",
    background_color: centreConfig.brandColor,
    theme_color: centreConfig.brandColor,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };

  res.setHeader("Content-Type", "application/manifest+json");
  res.status(200).json(manifest);
};
