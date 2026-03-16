export interface VisitRow {
  [key: string]: string | number | null;
}

export interface ParseResult {
  headers: string[];
  rows: VisitRow[];
  imageColumns: string[];
}

export interface LoadedFile {
  name: string;        // display name (filename without extension)
  fileName: string;    // original filename
  rowCount: number;
  headers: string[];
  imageColumns: string[];
  rows: VisitRow[];
}
