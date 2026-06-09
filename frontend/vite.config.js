import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "ChatFix PWA",
        short_name: "ChatFix",
        description: "Mensajería PWA con IA",
        theme_color: "#0d1418",
        background_color: "#0d1418",
        display: "standalone",
        start_url: "/",
        orientation: "portrait-primary",
        categories: ["communication", "productivity"],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ],
        shortcuts: [
          {
            name: "Ver Estados",
            short_name: "Estados",
            description: "Ver estados de WhatsApp archivados",
            url: "/?view=statuses",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "Configuración IA",
            short_name: "IA",
            description: "Ajustar parámetros de Inteligencia Artificial",
            url: "/?view=ai-settings",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }]
          }
        ],
        screenshots: [
          {
            src: "/screenshots/desktop.png",
            sizes: "1280x800",
            type: "image/png",
            form_factor: "wide",
            label: "ChatFix en Escritorio"
          },
          {
            src: "/screenshots/mobile.png",
            sizes: "750x1334",
            type: "image/png",
            form_factor: "narrow",
            label: "ChatFix en Móvil"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\/media-archive\/.*\.(png|jpg|jpeg|svg|gif|webp|mp4|webm|ogg|mp3|wav)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'media-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: true
  }
});
