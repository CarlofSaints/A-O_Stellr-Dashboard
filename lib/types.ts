export interface VisitRow {
  [key: string]: string | number | null;
}

export interface ParseResult {
  headers: string[];
  rows: VisitRow[];
  imageColumns: string[];
}
