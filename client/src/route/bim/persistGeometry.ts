/**
 * Storing a browser-converted model back in the workspace.
 *
 * The viewer converts an IFC file to glTF in the browser when no `.glb` sits
 * beside it, and throws the result away, so opening the same model again
 * converts it again. Writing the `.glb` next to the `.ifc` means the next open
 * loads the file instead, and the conversion happens once.
 *
 * Where the write goes
 * --------------------
 * The models live in the user's workspace, the same place the Library page
 * embeds and the viewer lists through `api/contents`. That workspace is a
 * Jupyter server, so a file is written with the Jupyter Contents API: a PUT to
 * `api/contents/<path>` whose body carries the bytes as base64. The server
 * guards writes with a token it sets as the `_xsrf` cookie and expects echoed
 * in the `X-XSRFToken` header, so the token is read from the cookie and sent
 * back. The session cookie travels because every request here is credentialed,
 * exactly as the reads the viewer already makes are.
 *
 * Why the write is split
 * ----------------------
 * A whole building converts to tens of megabytes, and base64 adds a third on
 * top. Sent as one request the workspace closes the connection part way through
 * and the write fails, so a large model was converted again on every open. The
 * Contents API takes a file in pieces instead: the body carries a `chunk`
 * number, the server truncates and writes on chunk one, appends on the ones
 * after it, and runs its post-save hooks on `chunk: -1`. That is what
 * JupyterLab's own uploader does, and it is handled by `AsyncLargeFileManager`,
 * which is the contents manager a Jupyter server uses unless it is configured
 * otherwise. The pieces have to arrive in order, since the server appends as
 * each one lands, so they are sent one after another and never together.
 *
 * Why the pieces go to another name first
 * ---------------------------------------
 * A write in pieces can stop part way: the tab is closed, the page is left, the
 * connection drops. Pieces written straight to the `.glb` then leave half a
 * model under the name the viewer lists as converted, which fails to load, and
 * which the existence check below then protects from ever being rewritten. So
 * the pieces go to `<model>.glb.part`, which the viewer does not list, and the
 * file takes its real name only once the last piece has landed. An interrupted
 * write leaves a `.part` behind, and the next write starts it again from
 * piece one, which truncates it.
 */

import { contentsUrl } from '@into-cps-association/bim-kit/react';
import MODELS_DIRECTORY from 'route/bim/library';

const IFC_SUFFIX = '.ifc';
const GEOMETRY_SUFFIX = '.glb';
const PARTIAL_SUFFIX = '.part';

/**
 * How many bytes of the model go in one request.
 *
 * The workspace refuses a request body of a megabyte with HTTP 413 and then
 * closes the connection, which is the broken pipe a large model used to fail
 * with. Base64 adds a third, so the body is four thirds of this number: at
 * 512 KB it is 683 KB, which the workspace accepts, and the first size measured
 * to fail was a 768 KB piece, whose body is exactly 1024 KB.
 *
 * Measured against the running workspace rather than assumed, because the limit
 * belongs to the server in front of Jupyter and is not in its configuration.
 */
export const CHUNK_BYTES = 512 * 1024;

/**
 * Refuse any path that is not a file directly inside the models directory.
 *
 * The path is derived from a listing the workspace returned, so it is not user
 * input today. It becomes one the moment anything else feeds this function, and
 * a `..` segment in a credentialed PUT writes wherever it points. The guard is
 * here because this is the only place in the application that writes to the
 * workspace, and it costs nothing.
 */
export function isWritableGeometryPath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\')) return false;

  const prefix = `${MODELS_DIRECTORY}/`;
  if (!path.startsWith(prefix)) return false;

  const name = path.slice(prefix.length);
  // One segment, so nothing nests out of the directory and nothing nests into
  // it either.
  return name.length > 0 && !name.includes('/') && !name.includes('..');
}

/**
 * The path the geometry is written to: the model's own path with `.ifc`
 * replaced by `.glb`, so the two sit side by side and the listing pairs them.
 */
export function geometryPathFor(ifcPath: string): string {
  const lower = ifcPath.toLowerCase();
  const stem = lower.endsWith(IFC_SUFFIX)
    ? ifcPath.slice(0, ifcPath.length - IFC_SUFFIX.length)
    : ifcPath;
  return `${stem}${GEOMETRY_SUFFIX}`;
}

/**
 * The XSRF token the Jupyter server set, or undefined when there is none.
 *
 * A Jupyter server configured with XSRF protection rejects a write that does
 * not echo it. A server without that protection sets no `_xsrf` cookie and
 * accepts the write regardless, which is the case for the workspace image this
 * runs against. So the token is sent when present and left out when it is not,
 * instead of blocking the write on its absence.
 */
export function readXsrfToken(): string | undefined {
  const match = /(?:^|;\s*)_xsrf=([^;]+)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Base64 of the bytes, built in chunks.
 *
 * `btoa` takes a string, and turning a large byte array into one with
 * `String.fromCodePoint(...bytes)` spreads every byte as an argument, which
 * overflows the call stack on a real model. The chunk keeps each call small.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK) {
    const slice = bytes.subarray(index, index + CHUNK);
    binary += String.fromCodePoint(...slice);
  }
  return btoa(binary);
}

/** Whether the workspace already holds a file at this address. */
async function exists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });
    return response.ok;
  } catch {
    // A failure here says nothing about the file. Writing is the better guess,
    // since the caller only asks when it believes there is nothing to lose.
    return false;
  }
}

/**
 * Write the geometry beside its model, so it is not reconverted next time.
 *
 * Rejects when the server does not accept the write. The caller treats a
 * rejection as a missed optimisation and not an error: the model already drew
 * from the in-browser conversion, and it will convert again next time instead
 * of loading a file that was never written.
 */
export async function uploadGeometry(
  libraryUrl: string,
  ifcPath: string,
  glb: Uint8Array,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = readXsrfToken();
  if (token) {
    headers['X-XSRFToken'] = token;
  }

  const path = geometryPathFor(ifcPath);
  if (!isWritableGeometryPath(path)) {
    throw new Error(`${path} is not a file in ${MODELS_DIRECTORY}`);
  }

  // `libraryUrl` is assembled by the application from its own deployment
  // configuration and the signed-in user name. It is not user input, which is
  // what makes a credentialed write to it acceptable.
  const url = contentsUrl(libraryUrl, path);

  // A geometry produced outside the browser is better than one produced in it,
  // and the documentation tells an administrator to make one for a large model.
  // The package only asks for a conversion to be stored when it found none, so
  // this repeats that check against the server at the moment of writing, where
  // the listing this decision came from may be minutes old.
  if (await exists(url)) {
    return;
  }

  const put = async (target: string, bytes: Uint8Array, chunk?: number) => {
    const body: Record<string, unknown> = {
      type: 'file',
      format: 'base64',
      content: toBase64(bytes),
    };
    if (chunk !== undefined) {
      body.chunk = chunk;
    }
    const response = await fetch(target, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${target} returned HTTP ${response.status}`);
    }
  };

  // A model that fits in one request is sent as one, without a chunk number.
  // Chunk one truncates the file, and nothing would then mark the end, so the
  // server would never run the hooks that follow a completed save.
  // One request is written whole or not at all, so it needs no other name.
  if (glb.length <= CHUNK_BYTES) {
    await put(url, glb);
    return;
  }

  const partialPath = `${path}${PARTIAL_SUFFIX}`;
  const partialUrl = contentsUrl(libraryUrl, partialPath);
  const pieces = Math.ceil(glb.length / CHUNK_BYTES);
  for (let index = 0; index < pieces; index += 1) {
    const slice = glb.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    // Counted from one, with the last one marked -1, which is how the server
    // knows the file is complete.
    const chunk = index === pieces - 1 ? -1 : index + 1;
    // The server appends as each piece lands, so they cannot be sent together.
    // eslint-disable-next-line no-await-in-loop
    await put(partialUrl, slice, chunk);
  }

  // The rename is what makes the model count as converted. The server refuses
  // it with 409 when a file took the real name in the meantime, which leaves
  // that file alone, as the existence check above does.
  const renamed = await fetch(partialUrl, {
    method: 'PATCH',
    credentials: 'include',
    headers,
    body: JSON.stringify({ path }),
  });
  if (!renamed.ok) {
    throw new Error(`${partialUrl} returned HTTP ${renamed.status}`);
  }
}
