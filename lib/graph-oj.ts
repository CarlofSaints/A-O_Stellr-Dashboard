/**
 * OJ tenant Microsoft Graph API client
 * Env vars required: OJ_TENANT_ID, OJ_CLIENT_ID, OJ_CLIENT_SECRET,
 *                    OJ_SP_HOST (e.g. exceler8xl.sharepoint.com),
 *                    OJ_SP_LIBRARY (e.g. Clients)
 */

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const resp = await fetch(
    `https://login.microsoftonline.com/${process.env.OJ_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.OJ_CLIENT_ID!,
        client_secret: process.env.OJ_CLIENT_SECRET!,
        scope: 'https://graph.microsoft.com/.default',
      }),
    }
  );

  if (!resp.ok) throw new Error(`Token fetch failed: ${resp.status}`);
  const data = await resp.json();
  cachedToken = data.access_token as string;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

let cachedDriveId: string | null = null;

async function getDriveId(token: string): Promise<string> {
  if (cachedDriveId) return cachedDriveId;

  const host = process.env.OJ_SP_HOST!;
  const library = process.env.OJ_SP_LIBRARY ?? 'Clients';

  const siteResp = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${host}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!siteResp.ok) throw new Error(`Site fetch failed: ${siteResp.status}`);
  const siteData = await siteResp.json();
  const siteId: string = siteData.id;

  const drivesResp = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drives?$select=id,name`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!drivesResp.ok) throw new Error(`Drives fetch failed: ${drivesResp.status}`);
  const drivesData = await drivesResp.json();
  const drive = (drivesData.value as { id: string; name: string }[]).find(
    d => d.name === library
  );
  if (!drive) throw new Error(`Library "${library}" not found`);

  cachedDriveId = drive.id;
  return cachedDriveId;
}

/**
 * Fetch a file from SharePoint and return its ArrayBuffer.
 * @param filePath  Path relative to the library root, e.g.
 *   "MERCHANDISING SA (AO)/PERIGEE - FIELD GOOSE/.../01 Mar 2026 - 27 Mar 2026 - Stellr/perigee-TOKEN.jpg"
 */
export async function fetchSpFile(filePath: string): Promise<ArrayBuffer> {
  const token = await getAccessToken();
  const driveId = await getDriveId(token);

  // Encode each path segment individually to preserve slashes
  const encodedPath = filePath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');

  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/content`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) throw new Error(`SP file fetch failed: ${resp.status} — ${filePath}`);
  return resp.arrayBuffer();
}

/**
 * Upload content to a SharePoint file path, creating or overwriting it.
 */
export async function uploadSpFile(filePath: string, content: string | Buffer | Uint8Array, contentType = 'application/json'): Promise<void> {
  const token = await getAccessToken();
  const driveId = await getDriveId(token);

  const encodedPath = filePath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');

  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/content`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body: content,
    }
  );

  if (!resp.ok) throw new Error(`SP upload failed: ${resp.status} — ${filePath}`);
}

/**
 * Delete a file from SharePoint. Returns true if deleted, false if it didn't exist.
 */
export async function deleteSpFile(filePath: string): Promise<boolean> {
  const token = await getAccessToken();
  const driveId = await getDriveId(token);

  const encodedPath = filePath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');

  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (resp.status === 404) return false;
  if (!resp.ok) throw new Error(`SP delete failed: ${resp.status} — ${filePath}`);
  return true;
}
