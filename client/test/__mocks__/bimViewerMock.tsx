/**
 * A stand-in for `@into-cps-association/bim-kit/react` in unit tests.
 *
 * The package ships ES modules and this Jest configuration transforms
 * TypeScript only, so an `import` inside a shipped `.js` file stops any suite
 * that reaches it, and every suite loading `routes.tsx` reaches it. The real
 * component also draws with WebGL, which jsdom does not have.
 *
 * What the viewer draws is tested where the viewer is built. What is tested
 * here is that DTaaS routes to it and hands it the right library URL, and the
 * attributes below are what show that.
 */

export function BuildingModels({ libraryUrl }: { libraryUrl?: string }) {
  return <div data-testid="building-models" data-library-url={libraryUrl} />;
}

export default { BuildingModels };
