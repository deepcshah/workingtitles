export type Status = "decoded" | "hunch" | "unknown";
export type Kind = "film" | "tv" | "commercial" | "music-video" | "other";

export interface Notice {
  /** stable slug, usually derived from the photo filename */
  id: string;
  /** the fake title on the sign, e.g. "BLUE HARVEST" */
  codename: string;
  /** what it actually turned out to be */
  realTitle?: string;
  kind?: Kind;
  /** release year of the real title */
  year?: number;
  status: Status;
  imdb?: string;
  letterboxd?: string;
  /** /photos/<file>.webp, served from public/ */
  photo?: string;
  /** ISO date the photo was taken */
  spottedAt?: string;
  lat: number;
  lng: number;
  /** cross streets or neighborhood, free text */
  place?: string;
  borough?: "Manhattan" | "Brooklyn" | "Queens" | "Bronx" | "Staten Island";
  notes?: string;
  /** true for the placeholder rows that ship with the repo */
  example?: boolean;
}
