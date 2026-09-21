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

  /**
   * A workspace where nothing sits at the destination yet.
   *
   * The upload asks before it writes, so a mock answering every request the
   * same way would report the file as already there and skip the write.
   */
  const emptyWorkspace = (write: object = { ok: true, status: 201 }) => {
    const mock = jest.fn();
    mock.mockImplementation((_url: unknown, init: { method?: string } = {}) =>
      Promise.resolve(
        init.method === 'GET' ? { ok: false, status: 404 } : write,
      ),
    );
    return mock;
  };

  /** Only the writes, since every call now starts with the existence check. */
  const writesOf = (mock: jest.Mock) =>
    mock.mock.calls.filter(([, init]) => init.method === 'PUT');

  afterEach(() => {
    document.cookie = '_xsrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    jest.restoreAllMocks();
  });

  it('writes without the XSRF header when the workspace sets no token', async () => {
    // The workspace image this runs against sets no _xsrf cookie and accepts
    // the write regardless, so a missing token must not block the write.
    const fetchMock = emptyWorkspace();
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, glb);

    const writes = writesOf(fetchMock);
    expect(writes).toHaveLength(1);
    expect(writes[0][1].headers['X-XSRFToken']).toBeUndefined();
  });

  it('puts the geometry to the contents API with the token and a base64 body', async () => {
    document.cookie = '_xsrf=tok';
    const fetchMock = emptyWorkspace();
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, glb);

    const writes = writesOf(fetchMock);
    expect(writes).toHaveLength(1);
    const [url, init] = writes[0];
    expect(url).toBe(
      'http://localhost/jane/api/contents/common/models/Substation.glb',
    );
    expect(init.credentials).toBe('include');
    expect(init.headers['X-XSRFToken']).toBe('tok');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      type: 'file',
      format: 'base64',
      content: toBase64(glb),
    });
  });

  it('sends a large model in ordered pieces, with the last one marked', async () => {
    // Two and a bit chunks, so there is a first, a middle and a last. Sent as
    // one request the workspace closes the connection part way through, which
    // is what left a large model converting again on every open.
    const large = new Uint8Array(CHUNK_BYTES * 2 + 512).fill(7);
    const fetchMock = emptyWorkspace();
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, large);

    const writes = writesOf(fetchMock);
    const bodies = writes.map(([, init]) => JSON.parse(init.body));
    expect(bodies.map((body) => body.chunk)).toEqual([1, 2, -1]);

    // Every piece goes to the partial name, and the model takes its real name
    // only after the last one, so a write that stops half way is never listed.
    writes.forEach(([url]) => {
      expect(url).toBe(
        'http://localhost/jane/api/contents/common/models/Substation.glb.part',
      );
    });
    const renames = fetchMock.mock.calls.filter(
      ([, init]) => init.method === 'PATCH',
    );
    expect(renames).toHaveLength(1);
    expect(renames[0][0]).toBe(
      'http://localhost/jane/api/contents/common/models/Substation.glb.part',
    );
    expect(JSON.parse(renames[0][1].body)).toEqual({
      path: 'common/models/Substation.glb',
    });
    const { calls } = fetchMock.mock;
    expect(calls[calls.length - 1][1].method).toBe('PATCH');

    // Every piece is a file in base64, and together they are the model. The
    // sizes matter: a lost or repeated piece would still pass a count check.
    bodies.forEach((body) => {
      expect(body.type).toBe('file');
      expect(body.format).toBe('base64');
    });
    const sent = bodies.reduce(
      (total, body) => total + atob(body.content).length,
      0,
    );
    expect(sent).toBe(large.length);
    expect(atob(bodies[2].content)).toHaveLength(512);
  });

  it('sends a model that fits in one request without a chunk number', async () => {
    // Chunk one truncates the file and nothing would mark the end, so the
    // server would never run the hooks that follow a completed save.
    const fetchMock = emptyWorkspace();
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, new Uint8Array(CHUNK_BYTES));

    const writes = writesOf(fetchMock);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body).chunk).toBeUndefined();
    // One request is written whole or not at all, so it goes to the real name.
    expect(writes[0][0]).toBe(
      'http://localhost/jane/api/contents/common/models/Substation.glb',
    );
    expect(
      fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH'),
    ).toHaveLength(0);
  });

  it('stops at the piece the server refuses, and never names the model', async () => {
    // Carrying on would write the rest of a model whose middle is missing.
    // What was written stays under the partial name, which the viewer does not
    // list, so the model keeps converting instead of loading a broken file.
    let put = 0;
    const fetchMock = jest.fn();
    fetchMock.mockImplementation(
      (_url: unknown, init: { method?: string } = {}) => {
        if (init.method === 'GET') {
          return Promise.resolve({ ok: false, status: 404 });
        }
        put += 1;
        return Promise.resolve(
          put === 1 ? { ok: true, status: 201 } : { ok: false, status: 413 },
        );
      },
    );
    globalThis.fetch = fetchMock;

    await expect(
      uploadGeometry(libraryUrl, ifcPath, new Uint8Array(CHUNK_BYTES * 3)),
    ).rejects.toThrow(/HTTP 413/);
    expect(writesOf(fetchMock)).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH'),
    ).toHaveLength(0);
  });

  it('rejects when the rename is refused, leaving the file at the real name alone', async () => {
    // Jupyter answers 409 when a file took the real name while the pieces were
    // being written. That file stays, as the existence check would have left it.
    const fetchMock = jest.fn();
    fetchMock.mockImplementation(
      (_url: unknown, init: { method?: string } = {}) => {
        if (init.method === 'GET') {
          return Promise.resolve({ ok: false, status: 404 });
        }
        if (init.method === 'PATCH') {
          return Promise.resolve({ ok: false, status: 409 });
        }
        return Promise.resolve({ ok: true, status: 201 });
      },
    );
    globalThis.fetch = fetchMock;

    await expect(
      uploadGeometry(libraryUrl, ifcPath, new Uint8Array(CHUNK_BYTES + 1)),
    ).rejects.toThrow(/Substation\.glb\.part returned HTTP 409/);
  });

  it('refuses a destination outside the models directory', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;

    await expect(
      uploadGeometry(libraryUrl, '../../etc/passwd.ifc', glb),
    ).rejects.toThrow(/not a file in common\/models/);
    // Nothing is sent at all, so a refused destination is never even read.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves a geometry that is already there alone', async () => {
    // A .glb produced outside the browser is the better artifact, and the
    // administrator documentation tells you to make one for a large model.
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, glb);

    expect(writesOf(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('writes when the existence check itself fails', async () => {
    // A network failure on the check says nothing about the file. The caller
    // only asks when it believes there is nothing to lose, so writing is the
    // better guess than skipping.
    const fetchMock = jest.fn();
    fetchMock.mockImplementation(
      (_url: unknown, init: { method?: string } = {}) =>
        init.method === 'GET'
          ? Promise.reject(new TypeError('network down'))
          : Promise.resolve({ ok: true, status: 201 }),
    );
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, glb);

    expect(writesOf(fetchMock)).toHaveLength(1);
  });

  it('rejects when the server refuses the write', async () => {
    document.cookie = '_xsrf=tok';
    globalThis.fetch = emptyWorkspace({ ok: false, status: 403 });

    await expect(uploadGeometry(libraryUrl, ifcPath, glb)).rejects.toThrow(
      /HTTP 403/,
    );
  });
});
