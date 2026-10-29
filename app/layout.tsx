import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Working Titles — NYC film shoot notices, decoded",
  description:
    "Film shoot notices photographed around New York, mapped, with the codename on the sign next to what it actually was.",
  metadataBase: new URL("https://workingtitles.nyc"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
