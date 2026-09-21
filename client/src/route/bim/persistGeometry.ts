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
 * Why the bytes go to another name first
 * --------------------------------------
 * A write in pieces can stop part way: the tab is closed, the page is left, the
 * connection drops. Pieces written straight to the `.glb` then leave half a
 * model under the name the viewer lists as converted, which fails to load, and
 * which the existence check below then protects from ever being rewritten. So
 * every write, one piece or many, goes to `<model>.glb.part`, which the viewer
 * does not list, and the file takes its real name with a rename once the last
 * piece has landed. The server refuses that rename when the real name is
 * already taken, so a file that appeared while the pieces were being written
 * is not replaced either. A write that fails deletes its `.part`. One the
 * browser could not delete, a closed tab, is truncated by the next write.
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
 * Measured against the running workspace and not assumed, because the limit
 * belongs to the server in front of Jupyter and is not in its configuration.
 * A stricter proxy answers 413, and the write is then tried once more in pieces
 * of half this size, so one deployment's limit is not a constant for all.
 */
export const CHUNK_BYTES = 512 * 1024;

/** A write the server refused, with the status it refused it with. */
export class UploadError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} returned HTTP ${status}`);
  }
}

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

/**
 * Whether nothing sits at this address yet.
 *
 * Only a 404 says so. Any other answer, and a request that fails outright, is
 * taken to mean a file may be there, because the file this protects is one an
 * administrator produced by hand. Guessing wrong that way costs a reconversion
 * next time. Guessing wrong the other way would replace that file.
 *
 * `content=0` asks for the file's details without its bytes, so checking a
 * 70 MB model does not download it.
 */
async function isFree(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${url}?content=0`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });
    return response.status === 404;
  } catch {
    return false;
  }
}

/**
 * Delete a partial file a failed write left behind.
 *
 * Sent without the caller's signal, because a write that stopped since the page
 * was left should still not leave several megabytes nobody can see in the
 * library. It is best effort: a `.part` that stays is truncated by the next
 * write to the same model.
 */
async function discard(url: string, headers: Record<string, string>) {
  try {
    await fetch(url, { method: 'DELETE', credentials: 'include', headers });
  } catch {
    // Nothing more to do. The next write starts the file over.
  }
}

/**
 * Write the geometry beside its model, so it is not reconverted next time.
 *
 * Rejects when the server does not accept the write, and when `signal` aborts
 * it. The caller treats a rejection as a missed optimisation and not an error:
 * the model already drew from the in-browser conversion, and it will convert
 * again next time instead of loading a file that was never written.
 */
export async function uploadGeometry(
  libraryUrl: string,
  ifcPath: string,
  glb: Uint8Array,
  signal?: AbortSignal,
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
  if (!(await isFree(url, signal))) {
    return;
  }

  const partialUrl = contentsUrl(libraryUrl, `${path}${PARTIAL_SUFFIX}`);

  const put = async (bytes: Uint8Array, chunk?: number) => {
    const body: Record<string, unknown> = {
      type: 'file',
      format: 'base64',
      content: toBase64(bytes),
    };
    if (chunk !== undefined) {
      body.chunk = chunk;
    }
    const response = await fetch(partialUrl, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new UploadError(partialUrl, response.status);
    }
  };

  const send = async (pieceBytes: number) => {
    // A model that fits in one request is sent as one, without a chunk number.
    // Chunk one truncates the file, and nothing would then mark the end, so the
    // server would never run the hooks that follow a completed save.
    if (glb.length <= pieceBytes) {
      await put(glb);
      return;
    }
    const pieces = Math.ceil(glb.length / pieceBytes);
    for (let index = 0; index < pieces; index += 1) {
      const slice = glb.subarray(index * pieceBytes, (index + 1) * pieceBytes);
      // Counted from one, with the last one marked -1, which is how the server
      // knows the file is complete.
      const chunk = index === pieces - 1 ? -1 : index + 1;
      // The server appends as each piece lands, so they cannot be sent together.
      // eslint-disable-next-line no-await-in-loop
      await put(slice, chunk);
    }
  };

  try {
    try {
      await send(CHUNK_BYTES);
    } catch (error) {
      // Once, at half the size. Starting over is safe, since the first piece
      // truncates the partial file.
      if (!(error instanceof UploadError) || error.status !== 413) throw error;
      await send(CHUNK_BYTES / 2);
    }

    // The rename is what makes the model count as converted. The server refuses
    // it with 409 when a file took the real name in the meantime, which leaves
    // that file alone, as the existence check above does.
    const renamed = await fetch(partialUrl, {
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: JSON.stringify({ path }),
      signal,
    });
    if (!renamed.ok) {
      throw new UploadError(partialUrl, renamed.status);
    }
  } catch (error) {
    await discard(partialUrl, headers);
    throw error;
  }
}
