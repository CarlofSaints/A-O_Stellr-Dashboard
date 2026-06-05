export type FormType = 'merch' | 'stock-count' | 'stand' | 'signature';

export interface VisitRow {
  [key: string]: string | number | null;
}

export interface ParseResult {
  headers: string[];
  rows: VisitRow[];
  imageColumns: string[];
  imageFolderName: string;
  formType: FormType;
}

export interface LoadedFile {
  name: string;        // display name (filename without extension)
  fileName: string;    // original filename
  rowCount: number;
  headers: string[];
  imageColumns: string[];
  rows: VisitRow[];
  imageFolderName: string;
  uploadedAt?: string;   // ISO timestamp
  uploadedBy?: string;   // user name who uploaded
  channel?: string;      // channel name (e.g. Makro, Game)
  formType?: FormType;   // auto-detected form type (default: 'merch' for backward compat)
}

export interface SignatureRecord {
  visitUuid: string;
  managerName: string;
  signatureUrl: string;
  formNames: string[];
  store: string;
  storeCode: string;
  channel: string;
  date: string;
  rep: string;
}
