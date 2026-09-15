import Layout from 'page/Layout';
import TabComponent from 'components/tab/TabComponent';
import { Paper, Typography } from '@mui/material';
import ShoppingCart from 'components/cart/ShoppingCart';
import PageShell from 'components/PageShell';
import AssetLibrary from 'components/asset/AssetLibrary';
import { assetType, scope } from 'route/library/cart/LibraryTabDataPreview';

export function createTabs() {
  return assetType.map((tab) => ({
    label: tab.label,
    loggerContext: { library: { assetType: tab.label } },
    body: <Typography variant="body1">{tab.body}</Typography>,
  }));
}

export function createCombinedTabs() {
  return assetType.map((tab) =>
    scope.map((subtab) => ({
      label: `${subtab.label}`,
      loggerContext: {
        library: { assetType: tab.label, scope: subtab.label },
      },
      body: (
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div style={{ flex: 2 }}>
            <Typography variant="body1">{subtab.body}</Typography>
            <AssetLibrary
              pathToAssets={tab.label}
              privateRepo={subtab.label === 'Private'}
            />
          </div>
          <Paper
            sx={{
              flex: 1,
              minWidth: '20rem',
              textAlign: 'center',
              paddingTop: '2rem',
              height: '300px',
            }}
          >
            <Typography variant="h5">Selection</Typography>
            <ShoppingCart />
          </Paper>
        </div>
      ),
    })),
  );
}

/**
 * The tabbed body of the library preview, without the page frame. The
 * standalone route wraps this in a Layout and a PageShell, and the Automation
 * page places it beside the digital twins preview in one of its tabs.
 */
export function LibraryAutomationPanel() {
  return <TabComponent assetType={createTabs()} scope={createCombinedTabs()} />;
}

function LibraryContent() {
  return (
    <Layout>
      <PageShell title="Library Page Preview">
        <LibraryAutomationPanel />
      </PageShell>
    </Layout>
  );
}

export default function LibraryPreview() {
  return <LibraryContent />;
}
