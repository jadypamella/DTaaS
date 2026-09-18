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

describe('uploadGeometry', () => {
  const libraryUrl = 'http://localhost/jane/';
  const ifcPath = 'common/models/Substation.ifc';
  const glb = new Uint8Array([1, 2, 3, 4]);

  afterEach(() => {
    document.cookie = '_xsrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    jest.restoreAllMocks();
  });

  it('writes without the XSRF header when the workspace sets no token', async () => {
    // The workspace image this runs against sets no _xsrf cookie and accepts
    // the write regardless, so a missing token must not block the write.
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, glb);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers['X-XSRFToken']).toBeUndefined();
  });

  it('puts the geometry to the contents API with the token and a base64 body', async () => {
    document.cookie = '_xsrf=tok';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, glb);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://localhost/jane/api/contents/common/models/Substation.glb',
    );
    expect(init.method).toBe('PUT');
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
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, large);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(init.body),
    );
    expect(bodies.map((body) => body.chunk)).toEqual([1, 2, -1]);

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
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    globalThis.fetch = fetchMock;

    await uploadGeometry(libraryUrl, ifcPath, new Uint8Array(CHUNK_BYTES));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chunk).toBeUndefined();
  });

  it('stops at the piece the server refuses', async () => {
    // The file is left incomplete either way. Carrying on would write the rest
    // of a model whose middle is missing, and the listing would then show a
    // geometry that loads as a broken file instead of no geometry at all.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockResolvedValueOnce({ ok: false, status: 413 });
    globalThis.fetch = fetchMock;

    await expect(
      uploadGeometry(libraryUrl, ifcPath, new Uint8Array(CHUNK_BYTES * 3)),
    ).rejects.toThrow(/HTTP 413/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects when the server refuses the write', async () => {
    document.cookie = '_xsrf=tok';
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });

    await expect(uploadGeometry(libraryUrl, ifcPath, glb)).rejects.toThrow(
      /HTTP 403/,
    );
  });
});
