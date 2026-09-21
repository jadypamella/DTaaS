/**
 * Tests for storing a browser-converted model back in the workspace.
 *
 * The upload talks to the Jupyter Contents API, so these check the parts that
 * make that request correct: the path the geometry is written to, the XSRF
 * token read from the cookie, the base64 body, the pieces a model too large for
 * one request is split into, and that a rejection is raised when the server
 * refuses a write. The URL building itself belongs to the package and is tested
 * where the package is built, so the package is mocked here through the same
 * stand-in the route tests use.
 */

import {
  CHUNK_BYTES,
  geometryPathFor,
  isWritableGeometryPath,
  readXsrfToken,
  toBase64,
  uploadGeometry,
  UploadError,
} from 'route/bim/persistGeometry';

describe('geometryPathFor', () => {
  it('writes the geometry beside the model, with a glb suffix', () => {
    expect(geometryPathFor('common/models/Substation.ifc')).toBe(
      'common/models/Substation.glb',
    );
  });

  it('recognises the suffix whatever its case', () => {
    expect(geometryPathFor('common/models/Substation.IFC')).toBe(
      'common/models/Substation.glb',
    );
  });

  it('appends the suffix when the name does not end in ifc', () => {
    // Not a path the viewer produces, but a name without the suffix must not
    // silently overwrite the source it was derived from.
    expect(geometryPathFor('common/models/model')).toBe(
      'common/models/model.glb',
    );
  });
});

describe('readXsrfToken', () => {
  afterEach(() => {
    // Clear whatever a test set, so one test's cookie does not leak into the
    // next. Setting a cookie with an expiry in the past removes it.
    document.cookie = '_xsrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('reads the token the server set', () => {
    document.cookie = '_xsrf=a-token-value';
    expect(readXsrfToken()).toBe('a-token-value');
  });

  it('decodes a token the cookie stored percent-encoded', () => {
    document.cookie = `_xsrf=${encodeURIComponent('a b/c')}`;
    expect(readXsrfToken()).toBe('a b/c');
  });

  it('returns undefined when there is no token', () => {
    expect(readXsrfToken()).toBeUndefined();
  });
});

describe('toBase64', () => {
  it('encodes the bytes', () => {
    // "IFC" as bytes.
    expect(toBase64(new Uint8Array([73, 70, 67]))).toBe('SUZD');
  });

  it('encodes an array larger than one chunk without overflowing', () => {
    // Larger than the 0x8000 chunk, so the loop runs more than once. Spreading
    // this many bytes into one fromCharCode call is what overflows the stack.
    const bytes = new Uint8Array(0x8000 * 2 + 5).fill(65);
    const encoded = toBase64(bytes);
    expect(atob(encoded)).toHaveLength(bytes.length);
  });
});

describe('isWritableGeometryPath', () => {
  it('accepts a file directly inside the models directory', () => {
    expect(isWritableGeometryPath('common/models/Substation.glb')).toBe(true);
  });

  it.each([
    ['escapes the directory', 'common/models/../../secrets.glb'],
    ['is an absolute path', '/etc/passwd'],
    ['is outside the directory', 'common/functions/a.glb'],
    ['nests inside the directory', 'common/models/sub/a.glb'],
    ['is the directory itself', 'common/models/'],
    ['uses a backslash', 'common/models/..\\a.glb'],
    ['only looks like the directory', 'common/models-other/a.glb'],
  ])('refuses a destination that %s', (_reason, path) => {
    // The destination is derived from a listing today, so none of these can
    // arrive yet. The guard is what keeps that true if anything else ever
    // feeds this function, because the write that follows is credentialed.
    expect(isWritableGeometryPath(path)).toBe(false);
  });
});

describe('uploadGeometry', () => {
  const libraryUrl = 'http://localhost/jane/';
  const ifcPath = 'common/models/Substation.ifc';
  const glb = new Uint8Array([1, 2, 3, 4]);
  const target =
    'http://localhost/jane/api/contents/common/models/Substation.glb';
  const partial = `${target}.part`;

  type Answer = { ok: boolean; status: number };
  type Call = [
    string,
    {
      method: string;
      body?: string;
      signal?: AbortSignal;
      credentials?: string;
      headers?: Record<string, string>;
    },
  ];

  /**
   * A workspace that answers each method its own way.
   *
   * By default nothing sits at the destination (the check gets 404) and every
   * write, rename and delete is accepted. A test overrides only the method it
   * is about. `put` may be a function of the piece number, for a server that
   * refuses one piece and not the others.
   */
  const workspace = (
    answers: {
      get?: Answer | Error;
      put?: Answer | ((index: number) => Answer);
      patch?: Answer;
    } = {},
  ) => {
    let puts = 0;
    const mock = jest.fn(
      (_url: string, init: { method: string }): Promise<Answer> => {
        if (init.method === 'GET') {
          const get = answers.get ?? { ok: false, status: 404 };
          return get instanceof Error
            ? Promise.reject(get)
            : Promise.resolve(get);
        }
        if (init.method === 'PUT') {
          puts += 1;
          const put = answers.put ?? { ok: true, status: 201 };
          return Promise.resolve(typeof put === 'function' ? put(puts) : put);
        }
        if (init.method === 'PATCH') {
          return Promise.resolve(answers.patch ?? { ok: true, status: 200 });
        }
        return Promise.resolve({ ok: true, status: 204 });
      },
    );
    globalThis.fetch = mock as unknown as typeof fetch;
    return mock;
  };

  const callsOf = (mock: jest.Mock, method: string) =>
    (mock.mock.calls as Call[]).filter(([, init]) => init.method === method);

  afterEach(() => {
    document.cookie = '_xsrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    jest.restoreAllMocks();
  });

  it('writes without the XSRF header when the workspace sets no token', async () => {
    // The workspace image this runs against sets no _xsrf cookie and accepts
    // the write regardless, so a missing token must not block the write.
    const mock = workspace();

    await uploadGeometry(libraryUrl, ifcPath, glb);

    const [write] = callsOf(mock, 'PUT');
    expect(write[1].headers?.['X-XSRFToken']).toBeUndefined();
  });

  it('puts the geometry to the partial name with the token and a base64 body', async () => {
    document.cookie = '_xsrf=tok';
    const mock = workspace();

    await uploadGeometry(libraryUrl, ifcPath, glb);

    const writes = callsOf(mock, 'PUT');
    expect(writes).toHaveLength(1);
    const [url, init] = writes[0];
    expect(url).toBe(partial);
    expect(init.credentials).toBe('include');
    expect(init.headers?.['X-XSRFToken']).toBe('tok');
    expect(init.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'file',
      format: 'base64',
      content: toBase64(glb),
    });
  });

  it('names the file only after the bytes are written, for a model of any size', async () => {
    // A model that fits in one request goes the same way as a large one, so a
    // file that appears between the check and the write is not replaced.
    const mock = workspace();

    await uploadGeometry(libraryUrl, ifcPath, glb);

    const methods = (mock.mock.calls as Call[]).map(([, init]) => init.method);
    expect(methods).toEqual(['GET', 'PUT', 'PATCH']);
    const [rename] = callsOf(mock, 'PATCH');
    expect(rename[0]).toBe(partial);
    expect(JSON.parse(rename[1].body as string)).toEqual({
      path: 'common/models/Substation.glb',
    });
  });

  it('asks whether the file exists without downloading it', async () => {
    const mock = workspace();

    await uploadGeometry(libraryUrl, ifcPath, glb);

    const [check] = callsOf(mock, 'GET');
    expect(check[0]).toBe(`${target}?content=0`);
  });

  it('sends a large model in ordered pieces, with the last one marked', async () => {
    // Two and a bit chunks, so there is a first, a middle and a last. Sent as
    // one request the workspace closes the connection part way through, which
    // is what left a large model converting again on every open.
    const large = new Uint8Array(CHUNK_BYTES * 2 + 512).fill(7);
    const mock = workspace();

    await uploadGeometry(libraryUrl, ifcPath, large);

    const writes = callsOf(mock, 'PUT');
    const bodies = writes.map(([, init]) => JSON.parse(init.body as string));
    expect(bodies.map((body) => body.chunk)).toEqual([1, 2, -1]);
    writes.forEach(([url]) => expect(url).toBe(partial));

    // The sizes matter: a lost or repeated piece would still pass a count check.
    const sent = bodies.reduce(
      (total, body) => total + atob(body.content).length,
      0,
    );
    expect(sent).toBe(large.length);
    expect(atob(bodies[2].content)).toHaveLength(512);

    const { calls } = mock.mock;
    expect((calls[calls.length - 1] as Call)[1].method).toBe('PATCH');
  });

  it('sends a model that fits in one request without a chunk number', async () => {
    // Chunk one truncates the file and nothing would mark the end, so the
    // server would never run the hooks that follow a completed save.
    const mock = workspace();

    await uploadGeometry(libraryUrl, ifcPath, new Uint8Array(CHUNK_BYTES));

    const writes = callsOf(mock, 'PUT');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body as string).chunk).toBeUndefined();
  });

  it('tries once more in pieces of half the size when a piece is too large', async () => {
    // The piece size was measured against one deployment. A stricter proxy
    // answers 413 to the first piece, and the write starts over smaller.
    const large = new Uint8Array(CHUNK_BYTES + 1).fill(3);
    const mock = workspace({
      put: (index) =>
        index === 1 ? { ok: false, status: 413 } : { ok: true, status: 201 },
    });

    await uploadGeometry(libraryUrl, ifcPath, large);

    const bodies = callsOf(mock, 'PUT').map(([, init]) =>
      JSON.parse(init.body as string),
    );
    // The refused piece, then three of half the size.
    expect(bodies.map((body) => body.chunk)).toEqual([1, 1, 2, -1]);
    expect(atob(bodies[1].content)).toHaveLength(CHUNK_BYTES / 2);
    expect(callsOf(mock, 'PATCH')).toHaveLength(1);
  });

  it('gives up when the smaller pieces are refused as well', async () => {
    const mock = workspace({ put: { ok: false, status: 413 } });

    await expect(
      uploadGeometry(libraryUrl, ifcPath, new Uint8Array(CHUNK_BYTES + 1)),
    ).rejects.toThrow(/HTTP 413/);
    // One try at each size, and nothing named.
    expect(callsOf(mock, 'PUT')).toHaveLength(2);
    expect(callsOf(mock, 'PATCH')).toHaveLength(0);
  });

  it('stops at the piece the server refuses, deletes the partial file and never names it', async () => {
    // Carrying on would write the rest of a model whose middle is missing.
    const mock = workspace({
      put: (index) =>
        index === 1 ? { ok: true, status: 201 } : { ok: false, status: 500 },
    });

    await expect(
      uploadGeometry(libraryUrl, ifcPath, new Uint8Array(CHUNK_BYTES * 3)),
    ).rejects.toThrow(UploadError);
    expect(callsOf(mock, 'PUT')).toHaveLength(2);
    expect(callsOf(mock, 'PATCH')).toHaveLength(0);
    const deletes = callsOf(mock, 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toBe(partial);
  });

  it('rejects when the rename is refused, and deletes the partial file', async () => {
    // Jupyter answers 409 when a file took the real name while the bytes were
    // being written. That file stays, and the partial one goes.
    const mock = workspace({ patch: { ok: false, status: 409 } });

    await expect(uploadGeometry(libraryUrl, ifcPath, glb)).rejects.toThrow(
      /Substation\.glb\.part returned HTTP 409/,
    );
    expect(callsOf(mock, 'DELETE')).toHaveLength(1);
  });

  it('still rejects with the write error when deleting the partial file fails', async () => {
    const mock = jest.fn((_url: string, init: { method: string }) => {
      if (init.method === 'GET')
        return Promise.resolve({ ok: false, status: 404 });
      if (init.method === 'DELETE')
        return Promise.reject(new TypeError('down'));
      return Promise.resolve({ ok: false, status: 403 });
    });
    globalThis.fetch = mock as unknown as typeof fetch;

    await expect(uploadGeometry(libraryUrl, ifcPath, glb)).rejects.toThrow(
      /HTTP 403/,
    );
  });

  it('stops when the page is left, and deletes the partial file without the signal', async () => {
    const controller = new AbortController();
    const mock = jest.fn(
      (_url: string, init: { method: string; signal?: AbortSignal }) => {
        if (init.method === 'GET') {
          return Promise.resolve({ ok: false, status: 404 });
        }
        if (init.method === 'PUT') {
          // The person leaves while the first piece is in flight.
          controller.abort();
          return Promise.reject(new DOMException('aborted', 'AbortError'));
        }
        return Promise.resolve({ ok: true, status: 204 });
      },
    );
    globalThis.fetch = mock as unknown as typeof fetch;

    await expect(
      uploadGeometry(
        libraryUrl,
        ifcPath,
        new Uint8Array(CHUNK_BYTES * 2),
        controller.signal,
      ),
    ).rejects.toThrow('aborted');

    const calls = mock.mock.calls as Call[];
    // Every request of the write carries the signal. The clean-up does not,
    // since the signal is already aborted and it would never be sent.
    calls
      .filter(([, init]) => init.method !== 'DELETE')
      .forEach(([, init]) => expect(init.signal).toBe(controller.signal));
    const deletes = calls.filter(([, init]) => init.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0][1].signal).toBeUndefined();
    expect(calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1);
  });

  it('refuses a destination outside the models directory', async () => {
    const mock = workspace();

    await expect(
      uploadGeometry(libraryUrl, '../../etc/passwd.ifc', glb),
    ).rejects.toThrow(/not a file in common\/models/);
    // Nothing is sent at all, so a refused destination is never even read.
    expect(mock).not.toHaveBeenCalled();
  });

  it('leaves a geometry that is already there alone', async () => {
    // A .glb produced outside the browser is the better artifact, and the
    // administrator documentation tells you to make one for a large model.
    const mock = workspace({ get: { ok: true, status: 200 } });

    await uploadGeometry(libraryUrl, ifcPath, glb);

    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the existence check fails', async () => {
    // A failed check says nothing about the file, and the file it protects may
    // have been made by hand. Skipping costs a reconversion. Writing could
    // replace that file.
    const mock = workspace({ get: new TypeError('network down') });

    await uploadGeometry(libraryUrl, ifcPath, glb);

    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the check gets any answer but not found', async () => {
    const mock = workspace({ get: { ok: false, status: 500 } });

    await uploadGeometry(libraryUrl, ifcPath, glb);

    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('rejects when the server refuses the write', async () => {
    document.cookie = '_xsrf=tok';
    workspace({ put: { ok: false, status: 403 } });

    await expect(uploadGeometry(libraryUrl, ifcPath, glb)).rejects.toThrow(
      /HTTP 403/,
    );
  });
});
