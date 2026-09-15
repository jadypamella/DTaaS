import Layout from 'page/Layout';
import PageShell from 'components/PageShell';
import TabComponent from 'components/tab/TabComponent';
import { TabData } from 'components/tab/subcomponents/TabRender';
import { DigitalTwinsAutomationPanel } from 'route/digitaltwins/DigitalTwinsPreview';
import { LibraryAutomationPanel } from 'route/library/cart/LibraryPreview';

/** One line saying what the page is for, in the frame every page shares. */
const DESCRIPTION =
  'The digital twins automation preview and the library preview in one place. ' +
  'These features demonstrate the DTaaS integration with GitLab CI/CD and are ' +
  'experimental.';

/**
 * The Automation page.
 *
 * It gathers the two preview experiences, digital twins and library, into one
 * place under a single frame. Each is the same panel its own preview route
 * renders, so the two never drift apart.
 */
function Automation() {
  const panels: TabData[] = [
    {
      label: 'Digital Twins',
      loggerContext: { automation: { tab: 'digital-twins' } },
      body: <DigitalTwinsAutomationPanel />,
    },
    {
      label: 'Library',
      loggerContext: { automation: { tab: 'library' } },
      body: <LibraryAutomationPanel />,
    },
  ];

  return (
    <Layout>
      <PageShell title="Automation" description={DESCRIPTION}>
        <TabComponent assetType={panels} scope={[]} />
      </PageShell>
    </Layout>
  );
}

export default Automation;
