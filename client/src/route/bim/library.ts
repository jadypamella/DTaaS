/**
 * Where DTaaS keeps building models: the `models` folder of the shared
 * `common` library in each user's workspace.
 *
 * This is a DTaaS convention, so it is stated here and handed to the viewer,
 * which is told where to look instead of knowing. The page names the folder to
 * the person uploading, the viewer lists it, and the geometry upload refuses to
 * write anywhere else, and all three read this one value so they cannot drift
 * apart.
 */
const MODELS_DIRECTORY = 'common/models';

export default MODELS_DIRECTORY;
